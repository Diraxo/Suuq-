import { useState } from 'react';
import { View, ScrollView, Pressable, Alert, ActivityIndicator, KeyboardAvoidingView, Platform, Switch } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { launchCameraAsync, launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { RadioGroup } from '@/components/RadioGroup';
import { MultiSelectField } from '@/components/MultiSelectField';
import { categories } from '@/data/categories';
import { ProfileModeSwitch } from '@/components/ProfileModeSwitch';
import { BusinessHoursEditor } from '@/components/BusinessHoursEditor';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { PROFILE_IMAGE_PRESETS } from '@/lib/imagePipeline';
import { imageUrl, deleteR2Assets } from '@/lib/r2';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { showSnackbar } from '@/lib/snackbar';
import { WeekDay, DayHours } from '@/types';
import { validateBusinessProfile, ProfileErrorCode, BUSINESS_CATEGORY_MAX } from '@/lib/profileRules';
import { interpretWrite, classifyThrown, SaveFailureCode } from '@/lib/saveOutcome';

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function BusinessProfile() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  // The banner is the only business image: the account's photo (Edit profile) is the avatar in both modes.
  const { upload: uploadBanner, uploading: uploadingBanner } = useImageUpload(`business/${session?.user.id ?? 'unknown'}/banner`, { skipMinDimension: true, prepare: PROFILE_IMAGE_PRESETS.banner });

  const [description, setDescription] = useState(profile?.business_description ?? '');
  const [address, setAddress] = useState(profile?.business_address ?? '');
  const [website, setWebsite] = useState(profile?.business_website ?? '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(profile?.business_categories ?? []);
  const [hoursDays, setHoursDays] = useState<Partial<Record<WeekDay, DayHours>>>(profile?.business_hours?.days ?? {});
  const [facebook, setFacebook] = useState(profile?.social_links?.facebook ?? '');
  const [instagram, setInstagram] = useState(profile?.social_links?.instagram ?? '');
  const [telegram, setTelegram] = useState(profile?.social_links?.telegram ?? '');
  const [tiktok, setTiktok] = useState(profile?.social_links?.tiktok ?? '');
  const [whatsapp, setWhatsapp] = useState(profile?.social_links?.whatsapp ?? '');
  const [deliveryAvailable, setDeliveryAvailable] = useState(profile?.delivery_available ?? false);
  const [phonePublic, setPhonePublic] = useState(profile?.business_phone_public ?? false);
  const [saving, setSaving] = useState(false);

  const removeImage = async (kind: 'banner') => {
    if (!session) return;
    const urlColumn = 'business_banner_url';
    const publicIdColumn = 'business_banner_public_id';
    const previousPublicId = profile?.business_banner_public_id ?? null;
    const removed = interpretWrite(await supabase.from('profiles').update({ [urlColumn]: null, [publicIdColumn]: null }).eq('id', session.user.id).select('id'));
    if (!removed.ok) {
      showSnackbar(t('settings.businessProfile.removeImageFailedSnackbar'));
      return;
    }
    await refreshProfile();
    showSnackbar(t('settings.businessProfile.bannerRemovedSnackbar'));
    if (previousPublicId) deleteR2Assets([previousPublicId]);
  };

  const confirmRemoveImage = (kind: 'banner') => {
    Alert.alert(t('settings.businessProfile.removeBannerConfirm'), undefined, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.remove'), style: 'destructive', onPress: () => removeImage(kind) },
    ]);
  };

  const pickImage = (kind: 'banner') => {
    const hasImage = !!profile?.business_banner_url;
    Alert.alert(t('settings.businessProfile.updateBannerTitle'), undefined, [
      { text: t('settings.businessProfile.camera'), onPress: () => launchPicker(kind, 'camera') },
      { text: t('settings.businessProfile.photoLibrary'), onPress: () => launchPicker(kind, 'library') },
      ...(hasImage ? [{ text: t('settings.businessProfile.removeImage'), style: 'destructive' as const, onPress: () => confirmRemoveImage(kind) }] : []),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const launchPicker = async (kind: 'banner', source: 'camera' | 'library') => {
    const permission =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('settings.businessProfile.permissionNeededTitle'), source === 'camera' ? t('settings.businessProfile.cameraPermissionMessage') : t('settings.businessProfile.photoPermissionMessage'));
      return;
    }
    const aspect: [number, number] = [16, 9];
    const result =
      source === 'camera'
        ? await launchCameraAsync({ allowsEditing: true, aspect, quality: 0.9 })
        : await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.9 });
    if (result.canceled || result.assets.length === 0 || !session) return;

    const uploaded = await uploadBanner(result.assets[0]);
    if (!uploaded) return;

    const urlColumn = 'business_banner_url';
    const publicIdColumn = 'business_banner_public_id';
    // Captured before the DB write so cleanup targets the asset this upload
    // replaces, never the brand-new one that was just saved. Null for
    // pre-migration rows (an old Cloudinary logo/banner) — those are simply
    // left in place, since there's no Cloudinary credential left to delete them with.
    const cleanupPublicId = profile?.business_banner_public_id ?? null;

    // The new image is already approved and stored; if saving its reference fails the old image stays on the profile.
    const written = interpretWrite(await supabase.from('profiles').update({ [urlColumn]: uploaded.url, [publicIdColumn]: uploaded.publicId }).eq('id', session.user.id).select('id'));
    if (!written.ok) {
      showSnackbar(t('settings.businessProfile.updateBannerFailedSnackbar'));
      return;
    }
    await refreshProfile();
    showSnackbar(t('settings.businessProfile.bannerUpdatedSnackbar'));

    // Delete the old asset only after the new one is safely saved — never
    // block the UI on cleanup, and never delete before the save succeeds.
    if (cleanupPublicId && cleanupPublicId !== uploaded.publicId) {
      deleteR2Assets([cleanupPublicId]);
    }
  };

  const saveFailureMessage = (code: SaveFailureCode) =>
    t(
      {
        offline: 'settings.businessProfile.saveOfflineSnackbar',
        auth: 'settings.businessProfile.saveAuthSnackbar',
        permission: 'settings.businessProfile.savePermissionSnackbar',
        unavailable: 'settings.businessProfile.saveUnavailableSnackbar',
        invalid: 'settings.businessProfile.saveFailedSnackbar',
        failed: 'settings.businessProfile.saveFailedSnackbar',
      }[code]
    );

  const save = async () => {
    if (!session) return;
    // Same rules as the website (lib/profileRules.ts): text cleaned, website must be http(s), each social link must be on its
    // own network's host, hours must be well-formed. The database re-checks all of it (migration 0056).
    const checked = validateBusinessProfile({
      description,
      address,
      website,
      hours: hoursDays,
      social: { facebook, instagram, telegram, tiktok, whatsapp },
      deliveryAvailable,
      // Only sent when changed, so saving other fields keeps working before migration 0067 is applied.
      categories: sameSet(selectedCategories, profile?.business_categories ?? []) ? undefined : selectedCategories,
    });
    if (!checked.ok) {
      const code: ProfileErrorCode = Object.values(checked.errors)[0] as ProfileErrorCode;
      const messages: Partial<Record<ProfileErrorCode, string>> = {
        websiteInvalid: t('settings.businessProfile.websiteInvalidSnackbar'),
        socialInvalid: t('settings.businessProfile.socialInvalidSnackbar'),
        hoursInvalid: t('settings.businessProfile.hoursInvalidSnackbar'),
      };
      showSnackbar(messages[code] ?? t('settings.businessProfile.saveFailedSnackbar'));
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      // `.select('id')` returns the written row: RLS or a missing row yields error:null with zero rows, which is a failure.
      const outcome = interpretWrite(await supabase.from('profiles').update({ ...checked.value, ...(phonePublic !== (profile?.business_phone_public ?? false) ? { business_phone_public: phonePublic } : {}) }).eq('id', session.user.id).select('id'));
      if (!outcome.ok) {
        showSnackbar(saveFailureMessage(outcome.code));
        return; // stay on the screen: every typed value is still in state
      }
      await refreshProfile();
      showSnackbar(t('settings.businessProfile.savedSnackbar'));
      router.back();
    } catch (err) {
      showSnackbar(saveFailureMessage(classifyThrown(err)));
    } finally {
      setSaving(false);
    }
  };

  if (!authed || !session) return <Screen />;

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
        <BackButton onPress={() => router.back()} />
        <Text variant="h2" style={{ marginLeft: spacing.sm }}>
          {t('settings.businessProfile.title')}
        </Text>
      </View>

      {showModeSwitch(profile) && <ProfileModeSwitch active="business" />}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => pickImage('banner')} accessibilityRole="button" accessibilityLabel={t('settings.businessProfile.changeBannerLabel')}>
          <View style={{ width: '100%', height: 120, borderRadius: radius.md, backgroundColor: colors.skeleton, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {profile?.business_banner_url ? (
              <Image cachePolicy="memory-disk" source={{ uri: imageUrl(profile.business_banner_url, { width: 800 }) }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} />
            ) : (
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
            )}
            {uploadingBanner && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay }}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
          </View>
          <Text variant="tiny" color="muted" align="center" style={{ marginTop: spacing.xxs }}>
            {t('settings.businessProfile.tapToChangeBanner')}
          </Text>
        </Pressable>

        <Pressable onPress={() => router.replace('/settings/edit-profile' as any)} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, marginBottom: spacing.lg, padding: spacing.sm, borderRadius: radius.md, backgroundColor: colors.inputBackground }}>
          <Ionicons name="person-circle-outline" size={22} color={colors.textSecondary} />
          <View style={{ flex: 1 }}>
            <Text variant="caption" color="secondary">{t('settings.businessProfile.identityNote')}</Text>
          </View>
          <Text variant="caption" color="brand" style={{ fontWeight: '600' }}>{t('settings.businessProfile.identityNoteLink')}</Text>
        </Pressable>

        <View style={{ gap: spacing.md }}>
          <Input
            label={t('settings.businessProfile.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            maxLength={1000}
            multiline
            numberOfLines={3}
            style={{ height: 80, textAlignVertical: 'top', paddingTop: spacing.xs }}
          />
          <MultiSelectField
            label={t('settings.businessProfile.categoryLabel')}
            placeholder={t('settings.businessProfile.categoryPlaceholder')}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            value={selectedCategories}
            onChange={setSelectedCategories}
            max={BUSINESS_CATEGORY_MAX}
            maxHint={t('settings.businessProfile.categoryMax')}
          />
          <Input label={t('settings.businessProfile.addressLabel')} value={address} onChangeText={setAddress} maxLength={250} />
          <Input label={t('settings.businessProfile.websiteLabel')} placeholder="https://example.com" value={website} onChangeText={setWebsite} autoCapitalize="none" keyboardType="url" />

          <Text variant="bodyMedium">{t('settings.businessProfile.businessHoursLabel')}</Text>
          <BusinessHoursEditor value={hoursDays} onChange={setHoursDays} />

          <RadioGroup
            label={t('settings.businessProfile.deliveryLabel')}
            options={[
              { value: true, label: t('common.yes') },
              { value: false, label: t('common.no') },
            ]}
            value={deliveryAvailable}
            onChange={setDeliveryAvailable}
          />

          {/* Contact privacy: the account phone is private until the owner opts in; this is a visibility choice only, not verification. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium">{t('settings.businessProfile.phonePublicLabel')}</Text>
              <Text variant="tiny" color="muted">{t('settings.businessProfile.phonePublicHint')}</Text>
            </View>
            <Switch value={phonePublic} onValueChange={setPhonePublic} trackColor={{ true: colors.primary }} accessibilityLabel={t('settings.businessProfile.phonePublicLabel')} />
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />
          <Text variant="bodyMedium">{t('settings.businessProfile.socialLinksLabel')}</Text>
          {/* Third-party brand names (Facebook, Instagram, Telegram, TikTok, WhatsApp) are never translated. */}
          <Input label="Facebook" placeholder={t('settings.businessProfile.handlePlaceholder')} value={facebook} onChangeText={setFacebook} autoCapitalize="none" keyboardType="url" />
          <Input label="Instagram" placeholder={t('settings.businessProfile.handlePlaceholder')} value={instagram} onChangeText={setInstagram} autoCapitalize="none" keyboardType="url" />
          <Input label="Telegram" placeholder={t('settings.businessProfile.handlePlaceholder')} value={telegram} onChangeText={setTelegram} autoCapitalize="none" keyboardType="url" />
          <Input label="TikTok" placeholder={t('settings.businessProfile.handlePlaceholder')} value={tiktok} onChangeText={setTiktok} autoCapitalize="none" keyboardType="url" />
          <Input label="WhatsApp" placeholder={t('settings.businessProfile.whatsappPlaceholder')} value={whatsapp} onChangeText={setWhatsapp} autoCapitalize="none" keyboardType="default" />
        </View>

        <Button label={t('common.save')} onPress={save} loading={saving} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.lg }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
