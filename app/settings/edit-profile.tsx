import { useEffect, useRef, useState } from 'react';
import { View, ScrollView, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, LayoutChangeEvent, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { ChoiceChips } from '@/components/ChoiceChips';
import { CityPicker } from '@/components/CityPicker';
import { PhoneNumberInput } from '@/components/PhoneNumberInput';
import { BirthdayPicker } from '@/components/BirthdayPicker';
import { AvatarViewerModal } from '@/components/AvatarViewerModal';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { imageUrl } from '@/lib/r2';
import { useAvatarActions } from '@/hooks/useAvatarActions';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { showSnackbar } from '@/lib/snackbar';
import { cityRegion } from '@/data/categories';
import { validatePhoneLocal, validateName } from '@/data/validation';
import { getPhoneCountry, formatFullPhone, PhoneCountryCode } from '@/data/phoneCountries';

const GENDER_OPTIONS = ['Male', 'Female', 'Prefer not to say'];

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
  const [bio, setBio] = useState(profile?.bio ?? '');
  const [saving, setSaving] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
    if (validatePhoneLocal(phoneCountry, phoneLocal) || validateName(firstName) || validateName(lastName)) {
      showSnackbar('Fix the highlighted fields before saving.');
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
          showSnackbar(emailError.message || 'Could not update email. Try again.');
          setSaving(false);
          return;
        }
        showSnackbar('Check your inbox to confirm your new email address.');
      }

      const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(' ') || null;
      const { error } = await supabase
        .from('profiles')
        .update({
          full_name: fullName,
          phone: phoneLocal ? formatFullPhone(phoneCountry, phoneLocal) : null,
          phone_country: phoneLocal ? phoneCountry : null,
          gender: gender || null,
          birthday: birthday || null,
          city: city ?? null,
          region: city ? cityRegion[city] ?? null : null,
          bio: bio.trim() || null,
        })
        .eq('id', session.user.id);

      if (error) {
        showSnackbar('Could not save your profile. Check your connection and try again.');
        return;
      }
      await refreshProfile();
      showSnackbar('Profile updated.');
      router.back();
    } finally {
      setSaving(false);
    }
  };

  if (!authed || !session) return <Screen />;

  const avatarUri = profile?.avatar_url ? imageUrl(profile.avatar_url, { width: 200 }) : `https://picsum.photos/seed/${session.user.id}/200/200`;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          Edit Profile
        </Text>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          <View style={{ alignItems: 'center', marginBottom: spacing.lg }}>
            <Pressable onPress={openAvatarMenu} accessibilityRole="button" accessibilityLabel="Profile photo options" style={{ position: 'relative' }}>
              <Image
                source={{ uri: avatarUri }}
                accessibilityLabel="Your profile photo"
                style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.skeleton }}
                cachePolicy="memory-disk"
                transition={200}
              />
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
                <Input label="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" onFocus={handleFieldFocus('firstName')} />
              </View>
              <View style={{ flex: 1 }} onLayout={trackLayout('lastName')}>
                <Input label="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" onFocus={handleFieldFocus('lastName')} />
              </View>
            </View>

            <View onLayout={trackLayout('email')}>
              <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" onFocus={handleFieldFocus('email')} />
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

            <ChoiceChips label="Gender" options={GENDER_OPTIONS} value={gender || undefined} onChange={setGender} />

            <BirthdayPicker value={birthday || undefined} onChange={setBirthday} />

            <CityPicker label="Location" value={city} onChange={setCity} />

            <View onLayout={trackLayout('bio')}>
              <Input
                label="Bio"
                value={bio}
                onChangeText={setBio}
                onFocus={handleFieldFocus('bio')}
                multiline
                numberOfLines={3}
                style={{ height: 80, textAlignVertical: 'top', paddingTop: spacing.xs }}
              />
            </View>

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />
            <Pressable
              onPress={() => router.push('/settings/business-profile' as any)}
              accessibilityRole="button"
              accessibilityLabel="Edit business profile"
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}
            >
              <Ionicons name="briefcase-outline" size={20} color={colors.textSecondary} />
              <View style={{ flex: 1, marginLeft: spacing.sm }}>
                <Text variant="bodyMedium">Business Profile</Text>
                <Text variant="caption" color="secondary">
                  Logo, banner, hours, delivery, and more
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        </ScrollView>

        <Button label="Save" onPress={save} loading={saving} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.sm }} />
      </KeyboardAvoidingView>

      <AvatarViewerModal visible={viewerVisible} uri={avatarUri} onClose={closeViewer} />
    </Screen>
  );
}
