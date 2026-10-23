'use client';

// Web twin of app/settings/business-profile.tsx: banner, description, address, website, opening hours,
// delivery and social links — the same profiles columns and the same shared rules (lib/profileRules.ts). Images go through
// ProfileImageEditor (validated, cropped, compressed, uploaded to the caller's own R2 folder).
import { FormEvent, useEffect, useRef, useState } from 'react';
import { categories } from '@/lib/categories';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { BusinessHoursEditor } from '@/components/BusinessHoursEditor';
import { PageHeader } from '@/components/PageHeader';
import { ProfileModeSwitch } from '@/components/ProfileModeSwitch';
import { ProfileImageEditor } from '@/components/ProfileImageEditor';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { supabase } from '@/lib/supabase';
import {
  BUSINESS_CATEGORY_MAX,
  BusinessFieldKey,
  HoursDays,
  PROFILE_LIMITS,
  ProfileErrorCode,
  SOCIAL_KEYS,
  SocialKey,
  validateBusinessProfile,
} from '@/lib/profileRules';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useAuthStore } from '@/store/auth';
import { SaveFailureCode, classifyThrown, interpretWrite } from '@/lib/saveOutcome';
import { useT } from '@/lib/i18n';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary';

const SOCIAL: Record<SocialKey, { label: string; placeholder: string }> = {
  facebook: { label: 'Facebook', placeholder: '@username or link' },
  instagram: { label: 'Instagram', placeholder: '@username or link' },
  telegram: { label: 'Telegram', placeholder: '@username or link' },
  tiktok: { label: 'TikTok', placeholder: '@username or link' },
  whatsapp: { label: 'WhatsApp', placeholder: 'Phone number, e.g. +251911234567' },
};

const ERROR_TEXT: Record<ProfileErrorCode, string> = {
  nameRequired: 'Enter a name.',
  nameTooShort: 'Enter a longer name.',
  nameTooLong: 'The name is too long.',
  nameInvalid: 'Enter a real name.',
  phoneInvalid: 'Enter a valid phone number.',
  bioTooLong: 'The bio is too long.',
  cityTooLong: 'The city is too long.',
  businessNameTooLong: `The business name is too long (${PROFILE_LIMITS.businessName} characters at most).`,
  descriptionTooLong: `The description is too long (${PROFILE_LIMITS.businessDescription} characters at most).`,
  addressTooLong: `The address is too long (${PROFILE_LIMITS.businessAddress} characters at most).`,
  websiteInvalid: 'Enter a valid website address, for example https://example.com.',
  socialInvalid: 'Use a link on that network’s own website.',
  hoursInvalid: 'Check the opening hours: each open day needs a closing time after its opening time.',
  categoryInvalid: 'Pick a category from the list.',
};

const SAVE_ERROR_TEXT: Record<SaveFailureCode, string> = {
  offline: "Your changes couldn't be saved. Check your connection and try again.",
  auth: 'Your session has expired. Please sign in again; your changes were not saved.',
  permission: "You don't have permission to change this business profile.",
  unavailable: 'The service is having a problem right now. Your changes were not saved. Please try again shortly.',
  invalid: "Your changes couldn't be saved. Please check the details and try again.",
  failed: "Your changes couldn't be saved. Please try again.",
};

export default function BusinessProfilePage() {
  const t = useT();
  const router = useRouter();
  const authed = useRequireAuthPage('/settings/business-profile');
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [seeded, setSeeded] = useState(false);
  const [description, setDescription] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const [hours, setHours] = useState<HoursDays>({});
  const [delivery, setDelivery] = useState(false);
  const [phonePublic, setPhonePublic] = useState(false);
  const [social, setSocial] = useState<Partial<Record<SocialKey, string>>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<BusinessFieldKey, ProfileErrorCode>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fill the form once, when the profile first arrives; later realtime refreshes (e.g. after an image upload) must not
  // overwrite what is being typed.
  useEffect(() => {
    if (!profile || seeded) return;
    setDescription(profile.business_description ?? '');
    setAddress(profile.business_address ?? '');
    setWebsite(profile.business_website ?? '');
    setSelectedCategories(profile.business_categories ?? []);
    setHours(profile.business_hours?.days ?? {});
    setDelivery(!!profile.delivery_available);
    setPhonePublic(profile.business_phone_public === true);
    setSocial(profile.social_links ?? {});
    setSeeded(true);
  }, [profile, seeded]);

  // Close the category dropdown on an outside click or Escape.
  useEffect(() => {
    if (!catOpen) return;
    const onDown = (e: MouseEvent) => { if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCatOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [catOpen]);

  if (!authed || !profile || !seeded) return <div className="min-h-[50vh]" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSaved(false);
    setFormError(null);
    const result = validateBusinessProfile({ description, address, website, hours, social, deliveryAvailable: delivery, categories: selectedCategories.length === (profile.business_categories ?? []).length && selectedCategories.every((c) => (profile.business_categories ?? []).includes(c)) ? undefined : selectedCategories });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      // `.select('id')` returns the written row; zero rows (RLS refusal / missing row) is a failure, never "saved".
      const outcome = interpretWrite(await supabase.from('profiles').update({ ...result.value, ...(phonePublic !== (profile.business_phone_public === true) ? { business_phone_public: phonePublic } : {}) }).eq('id', profile.id).select('id'));
      if (!outcome.ok) return setFormError(SAVE_ERROR_TEXT[outcome.code]); // form state is kept so the user can retry
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setFormError(SAVE_ERROR_TEXT[classifyThrown(err)]);
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (key: BusinessFieldKey) =>
    errors[key] ? (
      <span className="mt-1 block text-xs text-error" role="alert">
        {t.text(ERROR_TEXT[errors[key] as ProfileErrorCode])}
      </span>
    ) : null;

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-2xl">
        <PageHeader title={t('settings.businessProfile.title')} fallbackHref="/settings" />
        {showModeSwitch(profile) && <ProfileModeSwitch active="business" />}
        <div className="mt-6" />

        <div className="space-y-6">
          <ProfileImageEditor
            kind="banner"
            userId={profile.id}
            url={profile.business_banner_url}
            imageKey={profile.business_banner_public_id}
            title={t('web.m.mediaBanner')}
            hint={t('web.t.shownAtTheTopOf')}
          />
        </div>

        {/* The account's name, photo and bio are the same in both modes and are edited in one place. */}
        <p className="mt-6 flex items-center justify-between gap-3 rounded-md bg-inputBackground p-3 text-xs text-textSecondary">
          <span>{t('settings.businessProfile.identityNote')}</span>
          <Link href="/settings/edit-profile" className="shrink-0 font-semibold text-primary hover:underline">
            {t('settings.businessProfile.identityNoteLink')}
          </Link>
        </p>

        <form onSubmit={submit} className="mt-8" noValidate>
          <label className="block text-sm font-medium text-textPrimary">
            {t('settings.businessProfile.descriptionLabel')}
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={PROFILE_LIMITS.businessDescription} rows={4} className={INPUT} />
            <span className="mt-1 block text-right text-xs text-textMuted">
              {description.length}/{PROFILE_LIMITS.businessDescription}
            </span>
            {fieldError('description')}
          </label>
          <div className="mt-4" ref={catRef}>
            <span className="block text-sm font-medium text-textPrimary">{t('settings.businessProfile.categoryLabel')}</span>
            <div className="relative">
              <button
                type="button"
                onClick={() => setCatOpen((o) => !o)}
                aria-haspopup="listbox"
                aria-expanded={catOpen}
                className={`${INPUT} flex items-center justify-between text-left`}
              >
                <span className={selectedCategories.length ? 'text-textPrimary' : 'text-textMuted'}>
                  {selectedCategories.map((id) => categories.find((c) => c.id === id)?.name ?? id).join(', ') || t('settings.businessProfile.categoryPlaceholder')}
                </span>
                <span aria-hidden className="ml-2 text-textMuted">▾</span>
              </button>
              {catOpen && (
                <ul role="listbox" aria-multiselectable="true" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-md border border-border bg-background py-1 shadow-lg">
                  {categories.map((c) => {
                    const checked = selectedCategories.includes(c.id);
                    const disabled = !checked && selectedCategories.length >= BUSINESS_CATEGORY_MAX;
                    return (
                      <li key={c.id} role="option" aria-selected={checked}>
                        <label className={`flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-textPrimary hover:bg-inputBackground ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={disabled}
                            onChange={() => setSelectedCategories((cur) => (cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                            className="h-4 w-4 accent-primary"
                          />
                          {c.name}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <span className="mt-1 block text-xs text-textMuted">{t('settings.businessProfile.categoryMax')}</span>
            {fieldError('category')}
          </div>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('settings.businessProfile.addressLabel')}
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={PROFILE_LIMITS.businessAddress} className={INPUT} autoComplete="street-address" />
            {fieldError('address')}
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('settings.businessProfile.websiteLabel')}
            <input value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={PROFILE_LIMITS.url} inputMode="url" autoCapitalize="none" placeholder="https://example.com" className={INPUT} autoComplete="url" />
            {fieldError('website')}
          </label>

          <h2 className="mt-8 text-sm font-medium text-textPrimary">{t('seller.hours.title')}</h2>
          <div className="mt-2">
            <BusinessHoursEditor value={hours} onChange={setHours} invalid={!!errors.hours} />
            {fieldError('hours')}
          </div>

          <fieldset className="mt-6">
            <legend className="text-sm font-medium text-textPrimary">{t('settings.businessProfile.deliveryLabel')}</legend>
            <div className="mt-2 flex gap-6 text-sm text-textPrimary">
              {[
                [true, t('common.yes')],
                [false, t('common.no')],
              ].map(([value, label]) => (
                <label key={String(label)} className="flex items-center gap-2">
                  <input type="radio" name="delivery" checked={delivery === value} onChange={() => setDelivery(value as boolean)} className="h-4 w-4 accent-primary" />
                  {label as string}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="mt-6 flex items-start gap-3 text-sm text-textPrimary">
            <input type="checkbox" checked={phonePublic} onChange={(e) => setPhonePublic(e.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" />
            <span>
              <span className="block font-medium">{t('settings.businessProfile.phonePublicLabel')}</span>
              <span className="block text-xs text-textMuted">{t('settings.businessProfile.phonePublicHint')}</span>
            </span>
          </label>

          <h2 className="mt-8 border-t border-border pt-6 text-sm font-medium text-textPrimary">{t('settings.businessProfile.socialLinksLabel')}</h2>
          {SOCIAL_KEYS.map((key) => (
            <label key={key} className="mt-3 block text-sm font-medium text-textPrimary">
              {SOCIAL[key].label}
              <input
                value={social[key] ?? ''}
                onChange={(e) => setSocial((s) => ({ ...s, [key]: e.target.value }))}
                maxLength={PROFILE_LIMITS.url}
                inputMode="url"
                autoCapitalize="none"
                placeholder={SOCIAL[key].placeholder}
                className={INPUT}
              />
              {fieldError(key)}
            </label>
          ))}

          {formError && (
            <p className="mt-4 text-sm text-error" role="alert">
              {t.text(formError)}
            </p>
          )}
          {saved && (
            <p className="mt-4 text-sm text-success" role="status">
              {t('web.t.businessProfileSaved')}
            </p>
          )}
          <div className="mt-6 flex gap-3">
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push('/settings')}>
              {t('common.done')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
