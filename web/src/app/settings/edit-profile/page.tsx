'use client';

// Web port of the text fields of app/settings/edit-profile.tsx (name, phone, city). Same profiles columns.
import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary';

export default function EditProfilePage() {
  const router = useRouter();
  const authed = useRequireAuthPage('/settings/edit-profile');
  const profile = useAuthStore((s) => s.profile);
  const refreshProfile = useAuthStore((s) => s.refreshProfile);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Fill the form once, when the profile first arrives; later realtime refreshes must not overwrite what is being typed.
  useEffect(() => {
    if (!profile || seeded) return;
    setName(profile.full_name ?? '');
    setPhone(profile.phone ?? '');
    setCity(profile.city ?? '');
    setSeeded(true);
  }, [profile, seeded]);

  if (!authed || !profile) return <div className="min-h-[50vh]" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const cleanName = name.trim();
    const cleanPhone = phone.replace(/[\s-]/g, '');
    if (cleanName.length < 2) return setError('Please enter your name.');
    if (cleanPhone && !/^\+?\d{7,15}$/.test(cleanPhone)) return setError('Enter a valid phone number, for example +251911234567.');
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase
      .from('profiles')
      .update({ full_name: cleanName, phone: cleanPhone || null, city: city.trim() || null })
      .eq('id', profile.id);
    setBusy(false);
    if (err) return setError('Could not save your profile. Check your connection and try again.');
    await refreshProfile();
    setSaved(true);
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <PageHeader title="Edit Profile" fallbackHref="/settings" />
        <form onSubmit={submit}>
          <label className="block text-sm font-medium text-textPrimary">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={INPUT} autoComplete="name" />
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            Phone number
            <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} inputMode="tel" placeholder="+251911234567" className={INPUT} autoComplete="tel" />
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            City
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className={INPUT} autoComplete="address-level2" />
          </label>
          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="mt-3 text-sm text-success" role="status">
              Profile saved.
            </p>
          )}
          <div className="mt-5 flex gap-3">
            <Button type="submit" loading={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push('/settings')}>
              Done
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
