import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, LayoutChangeEvent, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { SelectField } from '@/components/SelectField';
import { UserAvatar } from '@/components/UserAvatar';
import { ProfileModeSwitch } from '@/components/ProfileModeSwitch';
import { CityPicker } from '@/components/CityPicker';
import { PhoneNumberInput } from '@/components/PhoneNumberInput';
import { BirthdayPicker } from '@/components/BirthdayPicker';
import { AvatarViewerModal } from '@/components/AvatarViewerModal';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { clearMyPhone } from '@/lib/contactPhone';
import { imageUrl } from '@/lib/r2';
import { useAvatarActions } from '@/hooks/useAvatarActions';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { useNameChangeStatus } from '@/hooks/useNameChangeStatus';
import { isNameChangeLimitError, nameChangeLimitUntil, formatNextAvailable, isNameChange } from '@/lib/nameChangeRules';
import i18n from '@/lib/i18n';
import { showSnackbar } from '@/lib/snackbar';
import { regionForCity } from '@/store/locations';
import { validatePhoneLocal, validateName } from '@/data/validation';
import { getPhoneCountry, formatFullPhone, PhoneCountryCode } from '@/data/phoneCountries';

// NOTE: these option strings are stored directly as profile.gender (there is
// no separate internal code / display-label split in ChoiceChips), so they
// are treated like an internal enum value per the i18n extraction guide and
// intentionally left untranslated to avoid changing what gets persisted.
const GENDER_VALUES = [
  { value: 'Male', key: 'genderMale' },
  { value: 'Female', key: 'genderFemale' },
  { value: 'Prefer not to say', key: 'genderNone' },
] as const;

// Reverses formatFullPhone(): profiles only stores the combined dial+local
// string plus phone_country, so this recovers the local digits for editing.
function localPhoneFromProfile(phone: string | null, phoneCountry: PhoneCountryCode): string {
  if (!phone) return '';
  const dial = getPhoneCountry(phoneCountry).dial;
  return phone.startsWith(dial) ? phone.slice(dial.length) : phone.replace(/^\+?\d{1,4}/, '');
}

export default function EditProfile() {
  const { colors, spacing } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const { openAvatarMenu, uploading: uploadingAvatar, viewerVisible, closeViewer } = useAvatarActions();

  const [firstName, setFirstName] = useState(profile?.full_name?.split(' ')[0] ?? '');
  const [lastName, setLastName] = useState(profile?.full_name?.split(' ').slice(1).join(' ') ?? '');
  const [email, setEmail] = useState(session?.user.email ?? profile?.email ?? '');
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>((profile?.phone_country as PhoneCountryCode) ?? 'ET');
  const [phoneLocal, setPhoneLocal] = useState(localPhoneFromProfile(profile?.phone ?? null, (profile?.phone_country as PhoneCountryCode) ?? 'ET'));
  const [gender, setGender] = useState(profile?.gender ?? '');
  const [birthday, setBirthday] = useState(profile?.birthday ?? '');
  const [city, setCity] = useState(profile?.city ?? undefined);
  const [pickedRegion, setPickedRegion] = useState<string | undefined>();
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const { status: nameStatus, reload: reloadNameStatus } = useNameChangeStatus(!!session);
  // Out of changes: the name fields are locked (the database enforces the limit either way) so nobody types a name that cannot be saved.
  const nameLocked = !!nameStatus && nameStatus.remaining <= 0;

  const scrollRef = useRef<ScrollView>(null);
  // y-offset of each field, relative to the scroll content — filled in by
  // each field's onLayout so focusing it can scroll it above the keyboard.
  const fieldY = useRef<Record<string, number>>({});
  const trackLayout = (key: string) => (e: LayoutChangeEvent) => {
    fieldY.current[key] = e.nativeEvent.layout.y;
  };

  // Keeps whichever field is currently focused visible above the keyboard.
  // Scrolls immediately on focus (covers tapping a new field while the
  // keyboard is already up) and again once the keyboard finishes animating
  // in (covers the first field focused, before the keyboard has a height).
  const focusedField = useRef<string | null>(null);
  const scrollToField = (key: string) => {
    const y = fieldY.current[key];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated: true });
  };
  const handleFieldFocus = (key: string) => () => {
    focusedField.current = key;
    scrollToField(key);
  };
  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      if (focusedField.current) scrollToField(focusedField.current);
    });
    return () => sub.remove();
  }, []);

  const phoneError = submitted ? validatePhoneLocal(phoneCountry, phoneLocal) : undefined;

  const save = async () => {
    setSubmitted(true);
    if (!session) return;
    if (!profile) {
      showSnackbar(t('settings.editProfile.saveFailedSnackbar'));
      return;
    }
    if (validatePhoneLocal(phoneCountry, phoneLocal) || validateName(firstName) || validateName(lastName)) {
      showSnackbar(t('settings.editProfile.validationSnackbar'));
      return;
    }

    setSaving(true);
    try {
      // Auth email change is handled separately from the profile row â€” Supabase
      // requires the new address to be verified before auth.users.email (and
      // therefore session.user.email) actually changes, so profiles.email is
      // deliberately left untouched here rather than optimistically written
      // with an address that isn't active yet.
      if (email.trim() && email.trim() !== session.user.email) {
        const { error: emailError } = await supabase.auth.updateUser({ email: email.trim() });
        if (emailError) {
          showSnackbar(emailError.message || t('settings.editProfile.emailUpdateFailedSnackbar'));
          setSaving(false);
          return;
        }
        showSnackbar(t('settings.editProfile.emailConfirmSnackbar'));
      }

      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || null;
      // Only fields that actually changed are written, so a value that was never loaded into this form (a slow profile load, a phone
      // number saved on another device) can never be wiped by pressing Save.
      const next = {
        full_name: fullName,
        phone: phoneLocal ? formatFullPhone(phoneCountry, phoneLocal) : null,
        phone_country: phoneLocal ? phoneCountry : null,
        gender: gender || null,
        birthday: birthday || null,
        city: city ?? null,
        region: city ? (pickedRegion ?? regionForCity(city)) || null : null,
        bio: bio.trim() || null,
      };
      // A name that only differs by stray spaces from the stored one is not a change (and must not be sent: the server counts real changes only).
      const sameName = (profile.full_name ?? '').replace(/\s+/g, ' ').trim() === (fullName ?? '');
      const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => (k === 'full_name' && sameName ? false : (profile as any)[k] !== v)));
      const { error } = Object.keys(changed).length === 0 ? { error: null } : await supabase.from('profiles').update(changed).eq('id', session.user.id);

      if (error) {
        if (isNameChangeLimitError(error)) {
          const until = nameChangeLimitUntil(error);
          showSnackbar(until ? t('settings.editProfile.nameChange.limitSnackbar', { date: formatNextAvailable(until, i18n.language) }) : t('settings.editProfile.nameChange.limitSnackbarNoDate'));
          void reloadNameStatus();
          return;
        }
        showSnackbar(t('settings.editProfile.saveFailedSnackbar'));
        return;
      }
      // The database ignores a NULL phone write (so an old build cannot erase a number it never saw); removing the number is explicit.
      if ('phone' in changed && changed.phone === null && !(await clearMyPhone())) {
        showSnackbar(t('settings.editProfile.saveFailedSnackbar'));
        return;
      }
      await refreshProfile();
      if ('full_name' in changed && isNameChange(profile.full_name, fullName)) void reloadNameStatus();
      showSnackbar(t('settings.editProfile.savedSnackbar'));
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!authed || !session) return <Screen />;

  const avatarUri = profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 200 }) : '';

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.editProfile.title')}
        </Text>
      </View>

      {showModeSwitch(profile) && <ProfileModeSwitch active="personal" />}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <Pressable onPress={openAvatarMenu} accessibilityRole="button" accessibilityLabel={t('settings.editProfile.avatarOptionsLabel')} style={{ position: 'relative' }}>
              <UserAvatar uri={profile?.avatar_url ? avatarUri : null} name={profile?.full_name} size={96} accessibilityLabel={t('settings.editProfile.avatarLabel')} />
              <View
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 16,
                  backgroundColor: colors.primary,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: colors.background,
                }}
              >
                {uploadingAvatar ? <ActivityIndicator size="small" color={colors.primaryText} /> : <Ionicons name="camera" size={16} color={colors.primaryText} />}
              </View>
            </Pressable>
          </View>

          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <View style={{ flex: 1 }} onLayout={trackLayout('firstName')}>
                <Input label={t('settings.editProfile.firstNameLabel')} value={firstName} onChangeText={setFirstName} editable={!nameLocked} autoCapitalize="words" onFocus={handleFieldFocus('firstName')} />
              </View>
              <View style={{ flex: 1 }} onLayout={trackLayout('lastName')}>
                <Input label={t('settings.editProfile.lastNameLabel')} value={lastName} onChangeText={setLastName} editable={!nameLocked} autoCapitalize="words" onFocus={handleFieldFocus('lastName')} />
              </View>
            </View>

            {nameStatus ? (
              <Text variant="caption" color={nameLocked ? 'error' : 'muted'} accessibilityLiveRegion="polite" style={{ marginTop: -spacing.xs }}>
                {nameLocked && nameStatus.nextAvailableAt
                  ? t('settings.editProfile.nameChange.exhausted', { limit: nameStatus.limit, days: nameStatus.windowDays, date: formatNextAvailable(nameStatus.nextAvailableAt, i18n.language) })
                  : t('settings.editProfile.nameChange.hint', { limit: nameStatus.limit, days: nameStatus.windowDays, remaining: nameStatus.remaining })}
              </Text>
            ) : null}

            <View onLayout={trackLayout('email')}>
              <Input label={t('settings.editProfile.emailLabel')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" onFocus={handleFieldFocus('email')} />
            </View>

            <View onLayout={trackLayout('phone')}>
              <PhoneNumberInput
                country={phoneCountry}
                local={phoneLocal}
                onChangeCountry={setPhoneCountry}
                onChangeLocal={setPhoneLocal}
                error={phoneError}
                onFocus={handleFieldFocus('phone')}
              />
            </View>

            <SelectField
              label={t('settings.editProfile.genderLabel')}
              placeholder={t('settings.editProfile.selectGender')}
              options={GENDER_VALUES.map((g) => ({ value: g.value, label: t(`settings.editProfile.${g.key}`) }))}
              value={gender || undefined}
              onChange={setGender}
            />

            <BirthdayPicker value={birthday || undefined} onChange={setBirthday} />

            <CityPicker
              label={t('settings.editProfile.locationLabel')}
              value={city}
              onChange={(name, loc) => {
                setCity(name);
                setPickedRegion(loc?.regionLabel);
              }}
            />

            <View onLayout={trackLayout('bio')}>
              <Input
                label={t('settings.editProfile.bioLabel')}
                value={bio}
                onChangeText={setBio}
                onFocus={handleFieldFocus('bio')}
                multiline
                numberOfLines={3}
                style={{ height: 80, textAlignVertical: 'top', paddingTop: spacing.xs }}
              />
            </View>
          </View>
        </ScrollView>

        <Button label={t('common.save')} onPress={save} loading={saving} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
      </KeyboardAvoidingView>

      {avatarUri ? <AvatarViewerModal visible={viewerVisible} uri={avatarUri} onClose={closeViewer} /> : null}
    </Screen>
  );
}
