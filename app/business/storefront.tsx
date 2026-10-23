import { useCallback, useEffect, useState } from 'react';
import { View, ScrollView, Pressable, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { launchCameraAsync, launchImageLibraryAsync } from '@/lib/imagePickerSafe';
import { Redirect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { BackButton } from '@/components/BackButton';
import { Screen } from '@/components/Screen';
import { Text } from '@/components/Text';
import { Card } from '@/components/Card';
import { Badge } from '@/components/Badge';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';
import { ErrorState } from '@/components/ErrorState';
import { BusinessHoursEditor } from '@/components/BusinessHoursEditor';
import { useTheme } from '@/theme/ThemeContext';
import { useAuthStore } from '@/store/auth';
import { supabase } from '@/lib/supabase';
import { imageUrl, deleteR2Assets } from '@/lib/r2';
import { PROFILE_IMAGE_PRESETS } from '@/lib/imagePipeline';
import { useImageUpload } from '@/hooks/useImageUpload';
import { useRequireAuthScreen } from '@/hooks/useRequireAuthScreen';
import { showSnackbar } from '@/lib/snackbar';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import {
  STOREFRONT_COLUMNS,
  LIMITS,
  StorefrontRow,
  VerificationInfo,
  VERIFICATION_BUCKET,
  checkVerificationFile,
  formFromRow,
  isOwnVerificationPath,
  storefrontActions,
  storefrontErrorKind,
  storefrontImageFolder,
  toStorefrontPayload,
  validateStorefrontForm,
  verificationObjectPath,
} from '@/lib/storefront';
import { WeekDay, DayHours } from '@/types';

type Doc = { path: string; label: string };

// Business-owner storefront management against migration 0054: edit and save a draft, logo/banner, preview, publish/unpublish,
// submit verification documents, and show the verification status. Reads and writes only public.storefronts (owner policies)
// and the owner RPCs; status and verification are never written by the client. Reachable only when STOREFRONTS_ENABLED.
export default function BusinessStorefront() {
  const { colors, spacing, radius } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const authed = useRequireAuthScreen();
  const session = useAuthStore((s) => s.session);
  const userId = session?.user.id ?? null;
  const { upload: uploadLogo, uploading: uploadingLogo } = useImageUpload(storefrontImageFolder(userId ?? 'unknown', 'logo'), { skipMinDimension: true, prepare: PROFILE_IMAGE_PRESETS.logo });
  const { upload: uploadBanner, uploading: uploadingBanner } = useImageUpload(storefrontImageFolder(userId ?? 'unknown', 'banner'), { skipMinDimension: true, prepare: PROFILE_IMAGE_PRESETS.banner });

  const [row, setRow] = useState<StorefrontRow | null>(null);
  const [verification, setVerification] = useState<VerificationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState(formFromRow(null));
  const [hoursDays, setHoursDays] = useState<Partial<Record<WeekDay, DayHours>>>({});
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'verify' | 'document'>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [note, setNote] = useState('');

  const errorText = useCallback((error: { code?: string; message?: string } | null | undefined) => t(`storefront.errors.${storefrontErrorKind(error)}`), [t]);

  const apply = useCallback((next: StorefrontRow | null) => {
    setRow(next);
    setForm(formFromRow(next));
    setHoursDays(((next?.hours as { days?: Partial<Record<WeekDay, DayHours>> } | undefined)?.days) ?? {});
  }, []);

  // No state is set before the first await, so the mount effect below never triggers a synchronous re-render.
  const load = useCallback(async () => {
    if (!userId) return;
    const { data, error } = await supabase.from('storefronts').select(STOREFRONT_COLUMNS).eq('owner_id', userId).maybeSingle();
    if (error) {
      setLoadError(errorText(error));
      setLoading(false);
      return;
    }
    setLoadError(null);
    apply((data as StorefrontRow | null) ?? null);
    if (data) {
      const v = await supabase.rpc('my_storefront_verification');
      if (!v.error) setVerification((v.data as VerificationInfo | null) ?? null);
    } else {
      setVerification(null);
    }
    setLoading(false);
  }, [userId, apply, errorText]);

  useEffect(() => {
    if (!STOREFRONTS_ENABLED) return;
    let active = true;
    // Deferred to a microtask so no state is set synchronously in the effect body, and skipped if unmounted first.
    Promise.resolve().then(() => {
      if (active) load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  if (!STOREFRONTS_ENABLED) return <Redirect href="/business/dashboard" />;
  if (!authed || !session || !userId) return <Screen />;

  const actions = storefrontActions(row);
  const hoursValue = () => (Object.keys(hoursDays).length ? { days: hoursDays } : {});

  // Insert on first save, update afterwards. Returns the stored row, or null after showing why it failed.
  const persist = async (extra: Record<string, unknown> = {}, opts: { fields?: boolean } = { fields: true }): Promise<StorefrontRow | null> => {
    const fields = opts.fields === false ? {} : { ...toStorefrontPayload(form), hours: hoursValue() };
    const res = row
      ? await supabase.from('storefronts').update({ ...fields, ...extra }).eq('id', row.id).select(STOREFRONT_COLUMNS).single()
      : await supabase.from('storefronts').insert({ owner_id: userId, ...fields, ...extra }).select(STOREFRONT_COLUMNS).single();
    if (res.error) {
      showSnackbar(errorText(res.error));
      return null;
    }
    const saved = res.data as StorefrontRow;
    setRow(saved);
    return saved;
  };

  const validate = (needName: boolean) => {
    const errors = validateStorefrontForm(form, { needName });
    const first = (Object.keys(errors) as (keyof typeof errors)[])[0];
    if (!first) return true;
    Alert.alert(t('storefront.fixFieldsTitle'), t(`storefront.fieldErrors.${first}.${errors[first]}`));
    return false;
  };

  const saveDraft = async () => {
    if (busy || !validate(false)) return;
    setBusy('save');
    const saved = await persist();
    setBusy(null);
    if (saved) {
      apply(saved);
      showSnackbar(t('storefront.savedSnackbar'), { tone: 'success' });
    }
  };

  const pickImage = (kind: 'logo' | 'banner') => {
    Alert.alert(t(kind === 'logo' ? 'storefront.logoTitle' : 'storefront.bannerTitle'), undefined, [
      { text: t('storefront.camera'), onPress: () => launchPicker(kind, 'camera') },
      { text: t('storefront.photoLibrary'), onPress: () => launchPicker(kind, 'library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const launchPicker = async (kind: 'logo' | 'banner', source: 'camera' | 'library') => {
    if (!actions.canEdit) return;
    const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(t('storefront.permissionTitle'), t(source === 'camera' ? 'storefront.cameraPermission' : 'storefront.photoPermission'));
      return;
    }
    const aspect: [number, number] = kind === 'logo' ? [1, 1] : [16, 9];
    const result =
      source === 'camera'
        ? await launchCameraAsync({ allowsEditing: true, aspect, quality: 0.9 })
        : await launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect, quality: 0.9 });
    if (result.canceled || result.assets.length === 0) return;

    const uploaded = await (kind === 'logo' ? uploadLogo : uploadBanner)(result.assets[0]);
    if (!uploaded) return;
    const previous = (kind === 'logo' ? row?.logo_public_id : row?.banner_public_id) ?? null;
    // Only the image columns are written here: unsaved text edits stay in the form, not half-saved.
    const saved = await persist(kind === 'logo' ? { logo_url: uploaded.url, logo_public_id: uploaded.publicId } : { banner_url: uploaded.url, banner_public_id: uploaded.publicId }, { fields: false });
    if (!saved) {
      deleteR2Assets([uploaded.publicId]); // the upload is orphaned: nothing references it
      return;
    }
    showSnackbar(t(kind === 'logo' ? 'storefront.logoUpdated' : 'storefront.bannerUpdated'), { tone: 'success' });
    // Delete the replaced image only after the new one is saved.
    if (previous && previous !== uploaded.publicId) deleteR2Assets([previous]);
  };

  const publish = async () => {
    if (busy || !validate(true)) return;
    setBusy('publish');
    try {
      // Save first so the published page is exactly what the owner is looking at.
      if (!(await persist())) return;
      const { error } = await supabase.rpc('storefront_publish');
      if (error) return showSnackbar(errorText(error));
      await load();
      showSnackbar(t('storefront.publishedSnackbar'), { tone: 'success' });
    } finally {
      setBusy(null);
    }
  };

  const unpublish = () => {
    Alert.alert(t('storefront.unpublishTitle'), t('storefront.unpublishMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('storefront.unpublish'),
        style: 'destructive',
        onPress: async () => {
          setBusy('publish');
          const { error } = await supabase.rpc('storefront_unpublish');
          setBusy(null);
          if (error) return showSnackbar(errorText(error));
          await load();
          showSnackbar(t('storefront.unpublishedSnackbar'));
        },
      },
    ]);
  };

  const addDocument = async () => {
    if (busy || docs.length >= LIMITS.documents) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return Alert.alert(t('storefront.permissionTitle'), t('storefront.photoPermission'));
    const result = await launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    const check = checkVerificationFile(asset.mimeType ?? 'image/jpeg', asset.fileSize);
    if (!check.ok) return Alert.alert(t('storefront.documentRejectedTitle'), t(`storefront.documentRejected.${check.reason}`));

    setBusy('document');
    try {
      const bytes = await new File(asset.uri).arrayBuffer();
      if (bytes.byteLength === 0) return Alert.alert(t('storefront.documentRejectedTitle'), t('storefront.documentRejected.empty'));
      const path = verificationObjectPath(userId, randomUUID(), check.ext);
      const { error } = await supabase.storage.from(VERIFICATION_BUCKET).upload(path, bytes, { contentType: asset.mimeType ?? 'image/jpeg', upsert: false });
      if (error) return showSnackbar(t('storefront.errors.documentUpload'));
      setDocs((d) => [...d, { path, label: asset.fileName ?? path.split('/')[1] }]);
    } catch {
      showSnackbar(t('storefront.errors.documentUpload'));
    } finally {
      setBusy(null);
    }
  };

  const submitVerification = async () => {
    if (busy || docs.length === 0) return;
    if (!validate(true)) return;
    if (!docs.every((d) => isOwnVerificationPath(userId, d.path))) return showSnackbar(t('storefront.errors.unknownDocument'));
    setBusy('verify');
    try {
      // The identity under review is the SAVED name/address (frozen server-side while pending), so save what is on screen first.
      if (!(await persist())) return;
      const { error } = await supabase.rpc('request_storefront_verification', { p_document_paths: docs.map((d) => d.path), p_note: note.trim() || null });
      if (error) return showSnackbar(errorText(error));
      setDocs([]);
      setNote('');
      await load();
      showSnackbar(t('storefront.verificationSubmitted'), { tone: 'success' });
    } finally {
      setBusy(null);
    }
  };

  const status = row?.status ?? 'draft';
  const vStatus = row?.verification_status ?? 'not_requested';
  const set = (key: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [key]: v }));

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: spacing.sm, marginBottom: spacing.md }}>
      <BackButton onPress={() => router.back()} />
      <Text variant="h2" style={{ marginLeft: spacing.sm }}>
        {t('storefront.title')}
      </Text>
    </View>
  );

  if (loading) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} accessibilityLabel={t('storefront.loading')} />
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen edges={['top', 'left', 'right', 'bottom']}>
        {header}
        <ErrorState title={t('storefront.loadFailedTitle')} message={loadError} onRetry={() => {
          setLoading(true);
          void load();
        }} />
      </Screen>
    );
  }

  const imageBox = (url: string | null, kind: 'logo' | 'banner', uploading: boolean) => (
    <Pressable
      onPress={() => pickImage(kind)}
      disabled={!actions.canEdit || uploading}
      accessibilityRole="button"
      accessibilityLabel={t(kind === 'logo' ? 'storefront.changeLogoLabel' : 'storefront.changeBannerLabel')}
    >
      <View
        style={{
          width: kind === 'logo' ? 72 : '100%',
          height: kind === 'logo' ? 72 : 120,
          borderRadius: kind === 'logo' ? 16 : radius.md,
          backgroundColor: colors.skeleton,
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {url ? (
          <Image cachePolicy="memory-disk" source={{ uri: imageUrl(url, { width: kind === 'logo' ? 200 : 800 }) }} style={{ width: '100%', height: '100%' }} contentFit={kind === 'logo' ? 'contain' : 'cover'} accessibilityLabel={t(kind === 'logo' ? 'storefront.logoImageLabel' : 'storefront.bannerImageLabel')} />
        ) : (
          <Ionicons name={kind === 'logo' ? 'briefcase-outline' : 'image-outline'} size={26} color={colors.textMuted} />
        )}
        {uploading && (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.overlay }}>
            <ActivityIndicator color="#fff" />
          </View>
        )}
      </View>
    </Pressable>
  );

  return (
    <Screen edges={['top', 'left', 'right', 'bottom']}>
      {header}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }} keyboardShouldPersistTaps="handled">
          <Card elevated={false} style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginBottom: spacing.xs }}>
              <Badge label={t(`storefront.status.${status}`)} tone={status === 'published' ? 'success' : status === 'suspended' ? 'warning' : 'neutral'} />
              <Badge label={t(`storefront.verification.${vStatus}`)} tone={vStatus === 'verified' ? 'success' : vStatus === 'pending' ? 'brand' : vStatus === 'rejected' ? 'warning' : 'neutral'} />
            </View>
            <Text variant="caption" color="secondary">
              {t(`storefront.statusHelp.${status}`)}
            </Text>
            {status === 'published' && row ? (
              <Button label={t('storefront.viewPublic')} variant="ghost" size="sm" onPress={() => router.push(`/storefront/${row.id}` as any)} style={{ alignSelf: 'flex-start', marginTop: spacing.xs }} />
            ) : null}
            {verification?.message && (vStatus === 'verified' || vStatus === 'rejected') ? (
              <Text variant="caption" style={{ marginTop: spacing.xs }}>
                {t('storefront.reviewerMessage', { message: verification.message })}
              </Text>
            ) : null}
          </Card>

          {imageBox(row?.banner_url ?? null, 'banner', uploadingBanner)}
          <View style={{ alignItems: 'flex-start', marginTop: spacing.md, marginBottom: spacing.lg }}>{imageBox(row?.logo_url ?? null, 'logo', uploadingLogo)}</View>
          {!row ? (
            <Text variant="caption" color="muted" style={{ marginBottom: spacing.md }}>
              {t('storefront.imagesNeedSave')}
            </Text>
          ) : null}

          <View style={{ gap: spacing.md }}>
            <Input
              label={t('storefront.nameLabel')}
              value={form.name}
              onChangeText={set('name')}
              maxLength={LIMITS.name}
              editable={actions.canEdit && !actions.identityLocked}
            />
            {actions.identityLocked || actions.editVoidsVerification ? (
              <Text variant="caption" color="muted" style={{ marginTop: -spacing.xs }}>
                {t(actions.identityLocked ? 'storefront.identityLockedHint' : 'storefront.editVoidsHint')}
              </Text>
            ) : null}
            <Input label={t('storefront.descriptionLabel')} value={form.description} onChangeText={set('description')} multiline numberOfLines={3} maxLength={LIMITS.description} editable={actions.canEdit} style={{ height: 90, textAlignVertical: 'top', paddingTop: spacing.xs }} />
            <Input label={t('storefront.addressLabel')} value={form.address} onChangeText={set('address')} maxLength={LIMITS.address} editable={actions.canEdit && !actions.identityLocked} />
            <Input label={t('storefront.websiteLabel')} placeholder="https://example.com" value={form.website} onChangeText={set('website')} autoCapitalize="none" keyboardType="url" editable={actions.canEdit} />
            <Text variant="bodyMedium">{t('storefront.hoursLabel')}</Text>
            <BusinessHoursEditor value={hoursDays} onChange={actions.canEdit ? setHoursDays : () => {}} />
          </View>

          <View style={{ gap: spacing.sm, marginTop: spacing.lg }}>
            <Button label={t('storefront.saveDraft')} onPress={saveDraft} loading={busy === 'save'} disabled={!!busy || !actions.canEdit} fullWidth size="lg" variant="outline" />
            <Button label={t(showPreview ? 'storefront.hidePreview' : 'storefront.preview')} onPress={() => setShowPreview((v) => !v)} fullWidth size="md" variant="ghost" icon={<Ionicons name="eye-outline" size={18} color={colors.primary} />} />
          </View>

          {showPreview && (
            <Card style={{ marginTop: spacing.sm }}>
              <Text variant="tiny" color="muted" style={{ marginBottom: spacing.xs }}>
                {t('storefront.previewNote')}
              </Text>
              {row?.banner_url ? <Image cachePolicy="memory-disk" source={{ uri: imageUrl(row.banner_url, { width: 800 }) }} style={{ width: '100%', height: 100, borderRadius: radius.md, marginBottom: spacing.xs }} contentFit="cover" accessibilityLabel={t('storefront.bannerImageLabel')} /> : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                {row?.logo_url ? <Image cachePolicy="memory-disk" source={{ uri: imageUrl(row.logo_url, { width: 200 }) }} style={{ width: 48, height: 48, borderRadius: 12 }} contentFit="contain" accessibilityLabel={t('storefront.logoImageLabel')} /> : null}
                <Text variant="h3" style={{ flex: 1 }}>
                  {form.name.trim() || t('storefront.previewNoName')}
                </Text>
                {vStatus === 'verified' ? <Badge label={t('storefront.verification.verified')} tone="success" icon="shield-checkmark-outline" /> : null}
              </View>
              {form.description.trim() ? <Text variant="body" color="secondary" style={{ marginTop: spacing.xs }}>{form.description.trim()}</Text> : null}
              {form.address.trim() ? <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>{form.address.trim()}</Text> : null}
              {form.website.trim() ? <Text variant="caption" color="muted">{form.website.trim()}</Text> : null}
            </Card>
          )}

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.lg }} />

          {status === 'suspended' ? null : status === 'published' ? (
            <Button label={t('storefront.unpublish')} onPress={unpublish} loading={busy === 'publish'} disabled={!!busy || !actions.canUnpublish} fullWidth size="lg" variant="outline" />
          ) : (
            <Button label={t('storefront.publish')} onPress={publish} loading={busy === 'publish'} disabled={!!busy || !form.name.trim()} fullWidth size="lg" />
          )}
          {status === 'draft' && !form.name.trim() ? (
            <Text variant="caption" color="muted" style={{ marginTop: spacing.xs }}>
              {t('storefront.publishNeedsName')}
            </Text>
          ) : null}

          <Text variant="h3" style={{ marginTop: spacing.xl, marginBottom: spacing.xs }}>
            {t('storefront.verifyTitle')}
          </Text>
          {actions.canRequestVerification ? (
            <View style={{ gap: spacing.sm }}>
              <Text variant="caption" color="secondary">
                {t('storefront.verifyIntro', { max: LIMITS.documents })}
              </Text>
              {docs.map((d) => (
                <Card key={d.path} elevated={false} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="document-outline" size={18} color={colors.primary} />
                  <Text variant="body" style={{ marginLeft: spacing.sm, flex: 1 }} numberOfLines={1}>
                    {d.label}
                  </Text>
                </Card>
              ))}
              <Button label={t('storefront.addDocument')} onPress={addDocument} loading={busy === 'document'} disabled={!!busy || docs.length >= LIMITS.documents} fullWidth variant="outline" icon={<Ionicons name="add-outline" size={18} color={colors.primary} />} />
              <Text variant="tiny" color="muted">
                {t('storefront.documentHelp')}
              </Text>
              <Input label={t('storefront.noteLabel')} value={note} onChangeText={setNote} multiline maxLength={LIMITS.note} style={{ height: 70, textAlignVertical: 'top', paddingTop: spacing.xs }} />
              <Button label={t('storefront.submitVerification')} onPress={submitVerification} loading={busy === 'verify'} disabled={!!busy || docs.length === 0} fullWidth size="lg" />
            </View>
          ) : (
            <Text variant="caption" color="secondary">
              {t(`storefront.verifyState.${status === 'suspended' ? 'suspended' : vStatus === 'not_requested' ? 'needName' : vStatus}`)}
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
