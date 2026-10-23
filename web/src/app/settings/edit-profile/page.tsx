'use client';

// Web twin of app/settings/edit-profile.tsx: profile photo (change / remove / view), first + last name, email, phone with
// country, gender, birthday, city and bio — the same profiles columns, written the same way (phone stored as dial code +
// number with phone_country, full_name = "first last"). Text is cleaned and validated by lib/profileRules.ts; the database
// re-checks lengths and image ownership (migration 0056).
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { LocationPicker } from '@/components/LocationPicker';
import { PageHeader } from '@/components/PageHeader';
import { ProfileModeSwitch } from '@/components/ProfileModeSwitch';
import { ProfileImageEditor } from '@/components/ProfileImageEditor';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { useNameChangeStatus } from '@/hooks/useNameChangeStatus';
import { isNameChangeLimitError, nameChangeLimitUntil, formatNextAvailable } from '@/lib/nameChangeRules';
import { supabase } from '@/lib/supabase';
import { clearMyPhone } from '@/lib/contactPhone';
import { PhoneCountryCode, formatFullPhone, getPhoneCountry, phoneCountries } from '@/lib/phoneCountries';
import { PROFILE_LIMITS, cleanMultiline, cleanText, validateFullName } from '@/lib/profileRules';
import { interpretWrite } from '@/lib/saveOutcome';
import { showModeSwitch } from '@/lib/profileIdentity';
import { useAuthStore } from '@/store/auth';
import { useT } from '@/lib/i18n';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary';
// Stored verbatim in profiles.gender, exactly as on mobile (app/settings/edit-profile.tsx GENDER_OPTIONS).
const GENDER_OPTIONS = ['Male', 'Female', 'Prefer not to say'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Reverses formatFullPhone(): profiles keeps the combined dial+local string, so recover the local digits for editing.
function localPhoneFromProfile(phone: string | null | undefined, country: PhoneCountryCode): string {
  if (!phone) return '';
  const dial = getPhoneCountry(country).dial;
  return phone.startsWith(dial) ? phone.slice(dial.length) : phone.replace(/^\+?\d{1,4}/, '');
}

type FieldErrors = Partial<Record<'name' | 'email' | 'phone' | 'birthday' | 'bio', string>>;

export default function EditProfilePage() {
  const t = useT();
  const router = useRouter();
  const authed = useRequireAuthPage('/settings/edit-profile');
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [seeded, setSeeded] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>('ET');
  const [phoneLocal, setPhoneLocal] = useState('');
  const [gender, setGender] = useState('');
  const [birthday, setBirthday] = useState('');
  const [city, setCity] = useState<string | null>(null);
  const [region, setRegion] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const { status: nameStatus, reload: reloadNameStatus } = useNameChangeStatus(!!session);
  // Out of changes: the name fields are locked (the database enforces the limit either way).
  const nameLocked = !!nameStatus && nameStatus.remaining <= 0;

  // Fill the form once, when the profile first arrives; later realtime refreshes (e.g. after a photo upload) must not
  // overwrite what is being typed.
  useEffect(() => {
    if (!profile || seeded) return;
    const country = (profile.phone_country as PhoneCountryCode) || 'ET';
    const parts = (profile.full_name ?? '').split(' ');
    setFirstName(parts[0] ?? '');
    setLastName(parts.slice(1).join(' '));
    setEmail(session?.user.email ?? profile.email ?? '');
    setPhoneCountry(phoneCountries.some((c) => c.code === country) ? country : 'ET');
    setPhoneLocal(localPhoneFromProfile(profile.phone, country));
    setGender(profile.gender ?? '');
    setBirthday(profile.birthday ?? '');
    setCity(profile.city ?? null);
    setRegion(profile.region ?? null);
    setBio(profile.bio ?? '');
    setSeeded(true);
  }, [profile, session, seeded]);

  if (!authed || !profile || !seeded) return <div className="min-h-[50vh]" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setSaved(null);
    setFormError(null);

    const next: FieldErrors = {};
    const fullName = cleanText([firstName, lastName].filter((p) => p.trim()).join(' '));
    const nameCheck = validateFullName(fullName);
    if (!nameCheck.ok) next.name = nameCheck.error === 'nameRequired' ? t('web.t.enterYourName') : nameCheck.error === 'nameInvalid' ? t('web.t.enterYourRealName') : nameCheck.error === 'nameTooLong' ? t('web.t.yourNameIsTooLong') : t('web.t.enterYourFullName');
    const digits = phoneLocal.replace(/\D/g, '');
    const [min, max] = getPhoneCountry(phoneCountry).localLength;
    if (digits && (digits.length < min || digits.length > max)) next.phone = t('post.errors.phoneInvalid');
    const cleanEmail = email.trim();
    if (cleanEmail && !EMAIL_RE.test(cleanEmail)) next.email = t('web.t.enterAValidEmailAddress');
    if (birthday && (birthday > new Date().toISOString().slice(0, 10) || birthday < '1900-01-01')) next.birthday = t('web.t.enterAValidDateOf');
    const cleanBio = cleanMultiline(bio);
    if ([...cleanBio].length > PROFILE_LIMITS.bio) next.bio = `Your bio is too long (${PROFILE_LIMITS.bio} characters at most).`;
    setErrors(next);
    if (Object.keys(next).length || !nameCheck.ok) return;

    setBusy(true);
    try {
      // The auth email changes only after the new address is verified (Supabase), so profiles.email is left alone here —
      // same as mobile.
      let message = t('web.t.profileSaved');
      if (cleanEmail && cleanEmail !== session?.user.email) {
        const { error: emailError } = await supabase.auth.updateUser({ email: cleanEmail });
        if (emailError) {
          setFormError(emailError.message || t('web.t.couldNotUpdateYourEmail'));
          return;
        }
        message = t('web.t.profileSavedCheckYourInbox');
      }
      // A name that only differs by stray spaces from the stored one is not a change, and must not be sent (the server counts real changes only).
      const sameName = (profile.full_name ?? '').replace(/\s+/g, ' ').trim() === nameCheck.value;
      const response = await supabase
        .from('profiles')
        .update({
          ...(sameName ? {} : { full_name: nameCheck.value }),
          phone: digits ? formatFullPhone(phoneCountry, digits) : null,
          phone_country: digits ? phoneCountry : null,
          gender: gender || null,
          birthday: birthday || null,
          city: city ?? null,
          region: city ? region : null,
          bio: cleanBio || null,
        })
        .eq('id', profile.id)
        .select('id');
      if (isNameChangeLimitError(response.error)) {
        const until = nameChangeLimitUntil(response.error);
        setFormError(until ? t('settings.editProfile.nameChange.limitSnackbar', { date: formatNextAvailable(until) }) : t('settings.editProfile.nameChange.limitSnackbarNoDate'));
        void reloadNameStatus();
        return;
      }
      const written = interpretWrite(response);
      if (!written.ok) {
        setFormError(written.code === 'permission' ? t('web.t.youDonTHavePermission') : written.code === 'auth' ? t('settings.businessProfile.saveAuthSnackbar') : t('settings.editProfile.saveFailedSnackbar'));
        return;
      }
      // The database ignores a NULL phone write (so an old build cannot erase a number it never saw); removing the number is explicit.
      if (!digits && profile.phone && !(await clearMyPhone())) {
        setFormError(t('settings.editProfile.saveFailedSnackbar'));
        return;
      }
      await refreshProfile();
      void reloadNameStatus();
      setSaved(message);
    } finally {
      setBusy(false);
    }
  };

  const err = (key: keyof FieldErrors) =>
    errors[key] ? (
      <span className="mt-1 block text-xs text-error" role="alert">
        {t.text(errors[key] as string)}
      </span>
    ) : null;

  return (
    <div className="px-4 pb-10 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <PageHeader title={t('settings.editProfile.title')} fallbackHref="/settings" />
        {showModeSwitch(profile) && <ProfileModeSwitch active="personal" />}
        <div className="mt-6" />

        <ProfileImageEditor
          kind="avatar"
          userId={profile.id}
          url={profile.avatar_url}
          imageKey={profile.avatar_public_id}
          title={t('avatar.menuTitle')}
          hint={t('web.t.croppedToASquareAnd')}
        />

        <form onSubmit={submit} className="mt-6" noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-sm font-medium text-textPrimary">
              {t('settings.editProfile.firstNameLabel')}
              <input value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={50} disabled={nameLocked} className={INPUT} autoComplete="given-name" />
            </label>
            <label className="block text-sm font-medium text-textPrimary">
              {t('settings.editProfile.lastNameLabel')}
              <input value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={50} disabled={nameLocked} className={INPUT} autoComplete="family-name" />
            </label>
          </div>
          {err('name')}
          {nameStatus && (
            <p className={`mt-2 text-xs ${nameLocked ? 'text-error' : 'text-textMuted'}`} role="status" aria-live="polite">
              {nameLocked && nameStatus.nextAvailableAt
                ? t('settings.editProfile.nameChange.exhausted', { limit: nameStatus.limit, days: nameStatus.windowDays, date: formatNextAvailable(nameStatus.nextAvailableAt) })
                : t('settings.editProfile.nameChange.hint', { limit: nameStatus.limit, days: nameStatus.windowDays, remaining: nameStatus.remaining })}
            </p>
          )}

          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('settings.editProfile.emailLabel')}
            <input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} type="email" className={INPUT} autoComplete="email" />
            {err('email')}
          </label>

          <div className="mt-4">
            <span className="block text-sm font-medium text-textPrimary">{t('components.phoneNumberInput.label')}</span>
            <div className="mt-1 flex gap-2">
              <select
                value={phoneCountry}
                onChange={(e) => setPhoneCountry(e.target.value as PhoneCountryCode)}
                className="rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary"
                aria-label={t('web.t.phoneCountry')}
              >
                {phoneCountries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.flag} {c.dial}
                  </option>
                ))}
              </select>
              <input
                value={phoneLocal}
                onChange={(e) => setPhoneLocal(e.target.value.replace(/[^\d\s-]/g, ''))}
                maxLength={14}
                inputMode="tel"
                placeholder={getPhoneCountry(phoneCountry).placeholder}
                className="w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary"
                autoComplete="tel-national"
                aria-label={t('components.phoneNumberInput.label')}
              />
            </div>
            {err('phone')}
          </div>

          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('settings.editProfile.genderLabel')}
            <select value={gender} onChange={(e) => setGender(e.target.value)} className={INPUT}>
              <option value="">{t('settings.editProfile.selectGender')}</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>
                  {t.text(g)}
                </option>
              ))}
            </select>
          </label>

          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('web.m.birthday')}
            <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} min="1900-01-01" max={new Date().toISOString().slice(0, 10)} className={INPUT} autoComplete="bday" />
            {err('birthday')}
          </label>

          <div className="mt-4">
            <span className="block text-sm font-medium text-textPrimary">{t('settings.editProfile.locationLabel')}</span>
            <div className="mt-1">
              <LocationPicker
                selected={city}
                collapseOnSelect
                onSelect={(loc) => {
                  setCity(loc.name);
                  setRegion(loc.regionLabel || null);
                }}
              />
            </div>
          </div>

          <label className="mt-4 block text-sm font-medium text-textPrimary">
            {t('settings.editProfile.bioLabel')}
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} maxLength={PROFILE_LIMITS.bio} rows={4} className={INPUT} />
            <span className="mt-1 block text-right text-xs text-textMuted">
              {bio.length}/{PROFILE_LIMITS.bio}
            </span>
            {err('bio')}
          </label>

          {formError && (
            <p className="mt-4 text-sm text-error" role="alert">
              {t.text(formError)}
            </p>
          )}
          {saved && (
            <p className="mt-4 text-sm text-success" role="status">
              {saved}
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
