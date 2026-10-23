'use client';

// Web port of app/business/storefront.tsx: the business owner's storefront management against migration 0054 (edit and save a
// draft, logo/banner, preview, publish/unpublish, verification documents and status). Only public.storefronts (owner policies)
// and the owner RPCs are used; status and verification are never written by the client. Opening hours use the same editor as the app.
// Reachable only when STOREFRONTS_ENABLED.
import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { BusinessHoursEditor } from '@/components/BusinessHoursEditor';
import { PageHeader } from '@/components/PageHeader';
import { HoursDays, normalizeHours } from '@/lib/profileRules';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { supabase } from '@/lib/supabase';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import {
  STOREFRONT_COLUMNS,
  LIMITS,
  StorefrontErrorKind,
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
import { prepareImage } from '@/services/imagePrep';
import { IMAGE_SLOTS } from '@/services/profileMedia';
import { uploadToR2, deleteFromR2 } from '@/services/r2';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/lib/i18n';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary disabled:opacity-60';

const ERRORS: Record<StorefrontErrorKind | 'documentUpload', string> = {
  notSignedIn: 'Please sign in again.',
  suspended: 'Your account or storefront is suspended, so this is not available.',
  noStorefront: 'Create your storefront first.',
  nameRequired: 'Add a business name first.',
  invalidImage: 'That image cannot be used. Choose a different photo.',
  invalidInput: 'Some details are not valid. Check them and try again.',
  identityLocked: 'Name and address cannot change while verification is pending.',
  alreadyRequested: 'A verification request is already open.',
  unknownDocument: 'One of the documents could not be found. Add it again.',
  rateLimited: 'Too many attempts. Please try again later.',
  unavailable: 'Storefronts are not available yet.',
  generic: 'Something went wrong. Please try again.',
  documentUpload: 'The document could not be uploaded. Check your connection and try again.',
};

const FIELD_ERRORS = {
  name: { required: 'Add a business name first.', tooLong: 'The business name is too long (150 characters at most).' },
  description: { tooLong: 'The description is too long (2000 characters at most).' },
  address: { tooLong: 'The address is too long (300 characters at most).' },
  website: { tooLong: 'The website address is too long.', badWebsite: 'The website must start with http:// or https://.' },
} as const;

const STATUS_LABEL = { draft: 'Draft', published: 'Published', suspended: 'Suspended' } as const;
const STATUS_HELP = {
  draft: 'Only you can see this storefront. Publish it when you are ready.',
  published: 'Your storefront is visible to everyone.',
  suspended: 'This storefront has been suspended and cannot be edited or published. Contact support if you think this is a mistake.',
} as const;
const VERIFICATION_LABEL = { not_requested: 'Not verified', pending: 'Verification pending', verified: 'Verified', rejected: 'Verification declined' } as const;
const VERIFY_STATE = {
  needName: 'Add a business name to ask for verification.',
  pending: 'Your documents are being reviewed. We will notify you when there is a decision.',
  verified: 'Your business is verified.',
  rejected: 'Your last request was declined. You can send new documents.',
  suspended: 'Verification is unavailable while the storefront is suspended.',
} as const;
const DOC_REJECTED = { type: 'Use a JPEG, PNG, WebP or PDF file.', size: 'That file is larger than 10 MB.', empty: 'That file is empty.' } as const;

type Doc = { path: string; label: string };
type Msg = { tone: 'ok' | 'error'; text: string } | null;

export default function BusinessStorefrontPage() {
  if (!STOREFRONTS_ENABLED) notFound();
  return <StorefrontEditor />;
}

function StorefrontEditor() {
  const t = useT();
  const authed = useRequireAuthPage('/business/storefront');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [row, setRow] = useState<StorefrontRow | null>(null);
  const [verification, setVerification] = useState<VerificationInfo | null>(null);
  const [form, setForm] = useState(formFromRow(null));
  const [hours, setHours] = useState<HoursDays>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'save' | 'publish' | 'verify' | 'document' | 'logo' | 'banner'>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [note, setNote] = useState('');

  const errorText = (error: { code?: string; message?: string } | null | undefined) => ERRORS[storefrontErrorKind(error)];

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase.from('storefronts').select(STOREFRONT_COLUMNS).eq('owner_id', userId).maybeSingle();
    if (error) {
      setLoadError(ERRORS[storefrontErrorKind(error)]);
      setLoading(false);
      return;
    }
    const next = (data as StorefrontRow | null) ?? null;
    setRow(next);
    setForm(formFromRow(next));
    setHours(((next?.hours as { days?: HoursDays } | undefined)?.days) ?? {});
    if (next) {
      const v = await supabase.rpc('my_storefront_verification');
      if (!v.error) setVerification((v.data as VerificationInfo | null) ?? null);
    } else {
      setVerification(null);
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!authed || !userId) return <div className="min-h-[50vh]" />;

  const actions = storefrontActions(row);
  const status = row?.status ?? 'draft';
  const vStatus = row?.verification_status ?? 'not_requested';
  const fail = (text: string) => setMsg({ tone: 'error', text });
  const ok = (text: string) => setMsg({ tone: 'ok', text });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const validate = (needName: boolean) => {
    const errors = validateStorefrontForm(form, { needName });
    const first = (Object.keys(errors) as (keyof typeof errors)[])[0];
    if (!first) return true;
    const table = FIELD_ERRORS[first] as Record<string, string>;
    fail(table[errors[first] as string]);
    return false;
  };

  // Insert on first save, update afterwards. Returns the stored row, or null after showing why it failed.
  const persist = async (extra: Record<string, unknown> = {}, withFields = true): Promise<StorefrontRow | null> => {
    let fields: Record<string, unknown> = {};
    if (withFields) {
      const cleanHours = normalizeHours(hours);
      if (cleanHours === null) {
        fail(t('settings.businessProfile.hoursInvalidSnackbar'));
        return null;
      }
      fields = { ...toStorefrontPayload(form), hours: Object.keys(cleanHours).length ? { days: cleanHours } : {} };
    }
    const res = row
      ? await supabase.from('storefronts').update({ ...fields, ...extra }).eq('id', row.id).select(STOREFRONT_COLUMNS).single()
      : await supabase.from('storefronts').insert({ owner_id: userId, ...fields, ...extra }).select(STOREFRONT_COLUMNS).single();
    if (res.error) {
      fail(errorText(res.error));
      return null;
    }
    const saved = res.data as StorefrontRow;
    setRow(saved);
    return saved;
  };

  const saveDraft = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy || !validate(false)) return;
    setBusy('save');
    setMsg(null);
    const saved = await persist();
    setBusy(null);
    if (saved) {
      setForm(formFromRow(saved));
      ok(t('storefront.savedSnackbar'));
    }
  };

  const onImage = (kind: 'logo' | 'banner') => async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy || !actions.canEdit) return;
    setBusy(kind);
    setMsg(null);
    try {
      const prepared = await prepareImage(file, IMAGE_SLOTS[kind].prepare);
      const uploaded = await uploadToR2(prepared, storefrontImageFolder(userId, kind));
      const previous = (kind === 'logo' ? row?.logo_public_id : row?.banner_public_id) ?? null;
      const saved = await persist(kind === 'logo' ? { logo_url: uploaded.url, logo_public_id: uploaded.key } : { banner_url: uploaded.url, banner_public_id: uploaded.key }, false);
      if (!saved) {
        deleteFromR2([uploaded.key]); // orphaned: nothing references it
        return;
      }
      ok(kind === 'logo' ? t('storefront.logoUpdated') : t('storefront.bannerUpdated'));
      if (previous && previous !== uploaded.key) deleteFromR2([previous]);
    } catch (err) {
      fail(err instanceof Error && err.message ? err.message : ERRORS.generic);
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (busy || !validate(true)) return;
    setBusy('publish');
    setMsg(null);
    try {
      if (!(await persist())) return;
      const { error } = await supabase.rpc('storefront_publish');
      if (error) return fail(errorText(error));
      await load();
      ok(t('storefront.publishedSnackbar'));
    } finally {
      setBusy(null);
    }
  };

  const unpublish = async () => {
    if (busy || !window.confirm(t('web.t.unpublishYourStorefrontItGoes'))) return;
    setBusy('publish');
    setMsg(null);
    const { error } = await supabase.rpc('storefront_unpublish');
    setBusy(null);
    if (error) return fail(errorText(error));
    await load();
    ok(t('storefront.unpublishedSnackbar'));
  };

  const onDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy || docs.length >= LIMITS.documents) return;
    const check = checkVerificationFile(file.type, file.size);
    if (!check.ok) return fail(DOC_REJECTED[check.reason]);
    setBusy('document');
    setMsg(null);
    const path = verificationObjectPath(userId, crypto.randomUUID(), check.ext);
    const { error } = await supabase.storage.from(VERIFICATION_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    setBusy(null);
    if (error) return fail(ERRORS.documentUpload);
    setDocs((d) => [...d, { path, label: file.name }]);
  };

  const submitVerification = async () => {
    if (busy || docs.length === 0 || !validate(true)) return;
    if (!docs.every((d) => isOwnVerificationPath(userId, d.path))) return fail(ERRORS.unknownDocument);
    setBusy('verify');
    setMsg(null);
    try {
      // The identity under review is the SAVED name/address (frozen server-side while pending), so save what is on screen first.
      if (!(await persist())) return;
      const { error } = await supabase.rpc('request_storefront_verification', { p_document_paths: docs.map((d) => d.path), p_note: note.trim() || null });
      if (error) return fail(errorText(error));
      setDocs([]);
      setNote('');
      await load();
      ok(t('web.t.sentForReviewWeWill'));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <div className="min-h-[50vh]" role="status" aria-label={t('storefront.loading')} />;

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl pb-10">
        <PageHeader title={t('storefront.title')} fallbackHref="/business/dashboard" />
        {loadError ? (
          <Card elevated={false} role="alert">
            <p className="text-sm font-medium text-textPrimary">{t('web.t.couldNotLoadYourStorefront')}</p>
            <p className="mt-1 text-sm text-textSecondary">{t.text(loadError)}</p>
            <div className="mt-3">
              <Button size="sm" onClick={load}>
                {t('common.retry')}
              </Button>
            </div>
          </Card>
        ) : (
          <>
            <Card elevated={false} className="mb-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge label={t.text(STATUS_LABEL[status])} tone={status === 'published' ? 'success' : status === 'suspended' ? 'warning' : 'neutral'} />
                <Badge label={t.text(VERIFICATION_LABEL[vStatus])} tone={vStatus === 'verified' ? 'success' : vStatus === 'rejected' ? 'warning' : 'neutral'} />
              </div>
              <p className="text-xs text-textSecondary">{t.text(STATUS_HELP[status])}</p>
              {status === 'published' && row ? (
                <Link href={`/storefront/${row.id}`} className="mt-2 inline-block text-sm font-medium text-primary">
                  {t('storefront.viewPublic')}
                </Link>
              ) : null}
              {verification?.message && (vStatus === 'verified' || vStatus === 'rejected') ? (
                <p className="mt-2 text-xs text-textPrimary">{t('storefront.reviewerMessage', { message: verification.message })}</p>
              ) : null}
            </Card>

            {msg && (
              <p className={`mb-3 text-sm ${msg.tone === 'ok' ? 'text-success' : 'text-error'}`} role={msg.tone === 'ok' ? 'status' : 'alert'}>
                {t.text(msg.text)}
              </p>
            )}

            <div className="mb-2 flex h-32 w-full items-center justify-center overflow-hidden rounded-md bg-surface">
              {row?.banner_url ? <img src={row.banner_url} alt={t('storefront.bannerTitle')} className="h-full w-full object-cover" /> : <span className="text-xs text-textMuted">{t('web.t.noBanner')}</span>}
            </div>
            <div className="mb-4 flex items-center gap-4">
              <div className="flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-md bg-surface">
                {row?.logo_url ? <img src={row.logo_url} alt={t('settings.businessProfile.businessLogoLabel')} className="h-full w-full object-contain" /> : <span className="text-xs text-textMuted">{t('web.t.noLogo')}</span>}
              </div>
              <div className="flex flex-col gap-2 text-sm">
                <label className="cursor-pointer font-medium text-primary">
                  {busy === 'logo' ? t('web.t.uploadingLogo') : t('web.t.changeLogo')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy || !actions.canEdit} onChange={onImage('logo')} />
                </label>
                <label className="cursor-pointer font-medium text-primary">
                  {busy === 'banner' ? t('web.t.uploadingBanner') : t('web.t.changeBanner')}
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy || !actions.canEdit} onChange={onImage('banner')} />
                </label>
              </div>
            </div>
            {!row && <p className="mb-3 text-xs text-textMuted">{t('storefront.imagesNeedSave')}</p>}

            <form onSubmit={saveDraft}>
              <label className="block text-sm font-medium text-textPrimary">
                {t('settings.businessProfile.nameLabel')}
                <input value={form.name} onChange={set('name')} maxLength={LIMITS.name} disabled={!actions.canEdit || actions.identityLocked} className={INPUT} />
              </label>
              {(actions.identityLocked || actions.editVoidsVerification) && (
                <p className="mt-1 text-xs text-textMuted">
                  {actions.identityLocked
                    ? t('storefront.identityLockedHint')
                    : t('storefront.editVoidsHint')}
                </p>
              )}
              <label className="mt-4 block text-sm font-medium text-textPrimary">
                {t('settings.businessProfile.descriptionLabel')}
                <textarea value={form.description} onChange={set('description')} maxLength={LIMITS.description} rows={4} disabled={!actions.canEdit} className={INPUT} />
              </label>
              <label className="mt-4 block text-sm font-medium text-textPrimary">
                {t('settings.businessProfile.addressLabel')}
                <input value={form.address} onChange={set('address')} maxLength={LIMITS.address} disabled={!actions.canEdit || actions.identityLocked} className={INPUT} />
              </label>
              <label className="mt-4 block text-sm font-medium text-textPrimary">
                {t('settings.businessProfile.websiteLabel')}
                <input value={form.website} onChange={set('website')} maxLength={LIMITS.website} inputMode="url" placeholder="https://" disabled={!actions.canEdit} className={INPUT} />
              </label>
              <h3 className="mt-5 text-sm font-medium text-textPrimary">{t('seller.hours.title')}</h3>
              <div className="mt-2">
                <BusinessHoursEditor value={hours} onChange={actions.canEdit ? setHours : () => {}} />
              </div>

              <div className="mt-5 flex flex-col gap-3">
                <Button type="submit" variant="outline" loading={busy === 'save'} disabled={!!busy || !actions.canEdit}>
                  {t('storefront.saveDraft')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? t('storefront.hidePreview') : t('storefront.preview')}
                </Button>
              </div>
            </form>

            {showPreview && (
              <Card className="mt-3">
                <p className="mb-2 text-xs text-textMuted">{t('storefront.previewNote')}</p>
                {row?.banner_url ? <img src={row.banner_url} alt={t('storefront.bannerTitle')} className="mb-2 h-24 w-full rounded-md object-cover" /> : null}
                <div className="flex items-center gap-3">
                  {row?.logo_url ? <img src={row.logo_url} alt={t('settings.businessProfile.businessLogoLabel')} className="h-12 w-12 rounded-md object-contain" /> : null}
                  <p className="flex-1 text-lg font-semibold text-textPrimary">{form.name.trim() || t('storefront.previewNoName')}</p>
                  {vStatus === 'verified' ? <Badge label={t('profile.verifiedBadge')} tone="success" /> : null}
                </div>
                {form.description.trim() ? <p className="mt-2 text-sm text-textSecondary">{form.description.trim()}</p> : null}
                {form.address.trim() ? <p className="mt-2 text-xs text-textMuted">{form.address.trim()}</p> : null}
                {form.website.trim() ? <p className="text-xs text-textMuted">{form.website.trim()}</p> : null}
              </Card>
            )}

            <hr className="my-6 border-border" />

            {status === 'suspended' ? null : status === 'published' ? (
              <Button variant="outline" fullWidth loading={busy === 'publish'} disabled={!!busy || !actions.canUnpublish} onClick={unpublish}>
                {t('storefront.unpublish')}
              </Button>
            ) : (
              <>
                <Button fullWidth loading={busy === 'publish'} disabled={!!busy || !form.name.trim()} onClick={publish}>
                  {t('storefront.publish')}
                </Button>
                {!form.name.trim() && <p className="mt-2 text-xs text-textMuted">{t('storefront.publishNeedsName')}</p>}
              </>
            )}

            <h2 className="mb-1 mt-8 text-lg font-semibold text-textPrimary">{t('storefront.verifyTitle')}</h2>
            {actions.canRequestVerification ? (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-textSecondary">
                  {t('storefront.verifyIntro', { max: LIMITS.documents })}
                </p>
                {docs.map((d) => (
                  <Card key={d.path} elevated={false} className="text-sm text-textPrimary">
                    {d.label}
                  </Card>
                ))}
                <label className={`inline-flex h-10 cursor-pointer items-center justify-center self-start rounded-pill border-[1.5px] border-primary px-4 text-[15px] font-semibold text-primary ${busy || docs.length >= LIMITS.documents ? 'pointer-events-none opacity-50' : ''}`}>
                  {busy === 'document' ? t('web.t.uploading') : t('web.t.addADocument')}
                  <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={!!busy || docs.length >= LIMITS.documents} onChange={onDocument} />
                </label>
                <p className="text-xs text-textMuted">{t('web.t.jpegPngWebpOrPdf')}</p>
                <label className="block text-sm font-medium text-textPrimary">
                  {t('storefront.noteLabel')}
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={LIMITS.note} rows={3} className={INPUT} />
                </label>
                <Button fullWidth loading={busy === 'verify'} disabled={!!busy || docs.length === 0} onClick={submitVerification}>
                  {t('storefront.submitVerification')}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-textSecondary">{t.text(VERIFY_STATE[status === 'suspended' ? 'suspended' : vStatus === 'not_requested' ? 'needName' : vStatus])}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
