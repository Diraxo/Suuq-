import { useState } from 'react';
import { View, ScrollView, Pressable, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
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
import { BusinessHoursEditor } from '@/components/BusinessHoursEditor';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { imageUrl, deleteR2Assets } from '@/lib/r2';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { showSnackbar } from '@/lib/snackbar';
import { WeekDay, DayHours } from '@/types';

export default function BusinessProfile() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const { upload: uploadLogo, uploading: uploadingLogo } = useImageUpload(`business/${session?.user.id ?? 'unknown'}/logo`);
  const { upload: uploadBanner, uploading: uploadingBanner } = useImageUpload(`business/${session?.user.id ?? 'unknown'}/banner`);

  const [name, setName] = useState(profile?.business_name ?? '');
  const [description, setDescription] = useState(profile?.business_description ?? '');
  const [address, setAddress] = useState(profile?.business_address ?? '');
  const [website, setWebsite] = useState(profile?.business_website ?? '');
  const [hoursDays, setHoursDays] = useState<Partial<Record<WeekDay, DayHours>>>(profile?.business_hours?.days ?? {});
  const [facebook, setFacebook] = useState(profile?.social_links?.facebook ?? '');
  const [instagram, setInstagram] = useState(profile?.social_links?.instagram ?? '');
  const [telegram, setTelegram] = useState(profile?.social_links?.telegram ?? '');
  const [tiktok, setTiktok] = useState(profile?.social_links?.tiktok ?? '');
  const [whatsapp, setWhatsapp] = useState(profile?.social_links?.whatsapp ?? '');
  const [deliveryAvailable, setDeliveryAvailable] = useState(profile?.delivery_available ?? false);
  const [saving, setSaving] = useState(false);

  const pickImage = (kind: 'logo' | 'banner') => {
    Alert.alert(kind === 'logo' ? t('settings.businessProfile.updateLogoTitle') : t('settings.businessProfile.updateBannerTitle'), undefined, [
      { text: t('settings.businessProfile.camera'), onPress: () => launchPicker(kind, 'camera') },
      { text: t('settings.businessProfile.photoLibrary'), onPress: () => launchPicker(kind, 'library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const launchPicker = async (kind: 'logo' | 'banner', source: 'camera' | 'library') => {
    const permission =
      source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('settings.businessProfile.permissionNeededTitle'), source === 'camera' ? t('settings.businessProfile.cameraPermissionMessage') : t('settings.businessProfile.photoPermissionMessage'));
      return;
    }
    const aspect: [number, number] = kind === 'logo' ? [1, 1] : [16, 9];
    const result =
      source === 'camera'
        ? await launchCameraAsync({ allowsEditing: true, aspect, quality: 0.9 })
        : await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.9 });
    if (result.canceled || result.assets.length === 0 || !session) return;

    const uploaded = await (kind === 'logo' ? uploadLogo : uploadBanner)(result.assets[0]);
    if (!uploaded) return;

    const urlColumn = kind === 'logo' ? 'business_logo_url' : 'business_banner_url';
    const publicIdColumn = kind === 'logo' ? 'business_logo_public_id' : 'business_banner_public_id';
    // Captured before the DB write so cleanup targets the asset this upload
    // replaces, never the brand-new one that was just saved. Null for
    // pre-migration rows (an old Cloudinary logo/banner) — those are simply
    // left in place, since there's no Cloudinary credential left to delete them with.
    const cleanupPublicId = (kind === 'logo' ? profile?.business_logo_public_id : profile?.business_banner_public_id) ?? null;

    const { error } = await supabase
      .from('profiles')
      .update({ [urlColumn]: uploaded.url, [publicIdColumn]: uploaded.publicId })
      .eq('id', session.user.id);
    if (error) {
      showSnackbar(kind === 'logo' ? t('settings.businessProfile.updateLogoFailedSnackbar') : t('settings.businessProfile.updateBannerFailedSnackbar'));
      return;
    }
    await refreshProfile();
    showSnackbar(kind === 'logo' ? t('settings.businessProfile.logoUpdatedSnackbar') : t('settings.businessProfile.bannerUpdatedSnackbar'));

    // Delete the old asset only after the new one is safely saved — never
    // block the UI on cleanup, and never delete before the save succeeds.
    if (cleanupPublicId && cleanupPublicId !== uploaded.publicId) {
      deleteR2Assets([cleanupPublicId]);
    }
  };

  const save = async () => {
    if (!session) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          business_name: name.trim() || null,
          business_description: description.trim() || null,
          business_address: address.trim() || null,
          business_website: website.trim() || null,
          business_hours: Object.keys(hoursDays).length ? { days: hoursDays } : {},
          social_links: {
            ...(facebook.trim() ? { facebook: facebook.trim() } : {}),
            ...(instagram.trim() ? { instagram: instagram.trim() } : {}),
            ...(telegram.trim() ? { telegram: telegram.trim() } : {}),
            ...(tiktok.trim() ? { tiktok: tiktok.trim() } : {}),
            ...(whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
          },
          delivery_available: deliveryAvailable,
        })
        .eq('id', session.user.id);

      if (error) {
        showSnackbar(t('settings.businessProfile.saveFailedSnackbar'));
        return;
      }
      await refreshProfile();
      showSnackbar(t('settings.businessProfile.savedSnackbar'));
      router.back();
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

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => pickImage('banner')} accessibilityRole="button" accessibilityLabel={t('settings.businessProfile.changeBannerLabel')}>
          <View style={{ width: '100%', height: 120, borderRadius: radius.md, backgroundColor: colors.skeleton, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {profile?.business_banner_url ? (
              <Image source={{ uri: imageUrl(profile.business_banner_url, { width: 800 }) }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} />
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

        <Pressable onPress={() => pickImage('logo')} accessibilityRole="button" accessibilityLabel={t('settings.businessProfile.changeLogoLabel')} style={{ alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg }}>
          <View style={{ width: 72, height: 72, borderRadius: 16, backgroundColor: colors.skeleton, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {profile?.business_logo_url ? (
              <Image source={{ uri: imageUrl(profile.business_logo_url, { width: 200 }) }} style={{ width: '100%', height: '100%' }} contentFit="contain" transition={200} />
            ) : (
              <Ionicons name="briefcase-outline" size={24} color={colors.textMuted} />
            )}
            {uploadingLogo && (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay }}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            )}
          </View>
          <Text variant="tiny" color="muted" style={{ marginTop: spacing.xxs }}>
            {t('settings.businessProfile.businessLogoLabel')}
          </Text>
        </Pressable>

        <View style={{ gap: spacing.md }}>
          <Input label={t('settings.businessProfile.nameLabel')} value={name} onChangeText={setName} />
          <Input
            label={t('settings.businessProfile.descriptionLabel')}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={3}
            style={{ height: 80, textAlignVertical: 'top', paddingTop: spacing.xs }}
          />
          <Input label={t('settings.businessProfile.addressLabel')} value={address} onChangeText={setAddress} />
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

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.xs }} />
          <Text variant="bodyMedium">{t('settings.businessProfile.socialLinksLabel')}</Text>
          {/* Third-party brand names (Facebook, Instagram, Telegram, TikTok, WhatsApp) are never translated. */}
          <Input label="Facebook" placeholder="https://facebook.com/..." value={facebook} onChangeText={setFacebook} autoCapitalize="none" keyboardType="url" />
          <Input label="Instagram" placeholder="https://instagram.com/..." value={instagram} onChangeText={setInstagram} autoCapitalize="none" keyboardType="url" />
          <Input label="Telegram" placeholder="https://t.me/..." value={telegram} onChangeText={setTelegram} autoCapitalize="none" keyboardType="url" />
          <Input label="TikTok" placeholder="https://tiktok.com/@..." value={tiktok} onChangeText={setTiktok} autoCapitalize="none" keyboardType="url" />
          <Input label="WhatsApp" placeholder="https://wa.me/..." value={whatsapp} onChangeText={setWhatsapp} autoCapitalize="none" keyboardType="url" />
        </View>

        <Button label={t('common.save')} onPress={save} loading={saving} disabled={saving} fullWidth size="lg" style={{ marginTop: spacing.lg }} />
      </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
