'use client';

// Web port of the text fields of app/settings/business-profile.tsx (name, description, address, website).
import { FormEvent, useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary';

type BusinessRow = { business_name: string | null; business_description: string | null; business_address: string | null; business_website: string | null };

export default function BusinessProfilePage() {
  const authed = useRequireAuthPage('/settings/business-profile');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [form, setForm] = useState({ name: '', description: '', address: '', website: '' });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('business_name, business_description, business_address, business_website')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as BusinessRow | null;
        setForm({
          name: row?.business_name ?? '',
          description: row?.business_description ?? '',
          address: row?.business_address ?? '',
          website: row?.business_website ?? '',
        });
        setLoaded(true);
      });
  }, [userId]);

  if (!authed || !loaded) return <div className="min-h-[50vh]" />;

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !userId) return;
    const website = form.website.trim();
    if (website && !/^https?:\/\/\S+\.\S+/i.test(website)) return setError('Website must start with http:// or https://');
    setBusy(true);
    setError(null);
    setSaved(false);
    const { error: err } = await supabase
      .from('profiles')
      .update({
        business_name: form.name.trim() || null,
        business_description: form.description.trim() || null,
        business_address: form.address.trim() || null,
        business_website: website || null,
      })
      .eq('id', userId);
    setBusy(false);
    if (err) return setError('Could not save. Check your connection and try again.');
    setSaved(true);
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <PageHeader title="Business Profile" fallbackHref="/settings" />
        <form onSubmit={submit}>
          <label className="block text-sm font-medium text-textPrimary">
            Business name
            <input value={form.name} onChange={set('name')} maxLength={150} className={INPUT} />
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            Description
            <textarea value={form.description} onChange={set('description')} maxLength={1000} rows={4} className={INPUT} />
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            Address
            <input value={form.address} onChange={set('address')} maxLength={250} className={INPUT} />
          </label>
          <label className="mt-4 block text-sm font-medium text-textPrimary">
            Website
            <input value={form.website} onChange={set('website')} maxLength={250} inputMode="url" placeholder="https://" className={INPUT} />
          </label>
          <p className="mt-3 text-xs text-textMuted">Opening hours, logo and banner can be edited in the SUUQIYE app.</p>
          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
          {saved && (
            <p className="mt-3 text-sm text-success" role="status">
              Business profile saved.
            </p>
          )}
          <div className="mt-5">
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
