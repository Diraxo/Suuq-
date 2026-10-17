'use client';

// Web port of app/settings/saved-addresses.tsx.
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { MapPin, Trash2 } from '@/lib/icons';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/store/auth';

const INPUT = 'mt-1 w-full rounded-md border border-border bg-inputBackground p-3 text-sm outline-none focus:border-primary';

type Address = { id: string; label: string; address: string; city: string | null };

export default function SavedAddressesPage() {
  const authed = useRequireAuthPage('/settings/saved-addresses');
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [items, setItems] = useState<Address[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.from('saved_addresses').select('id, label, address, city').eq('user_id', userId).order('created_at', { ascending: false });
    setItems((data ?? []) as Address[]);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!authed) return <div className="min-h-[50vh]" />;

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !userId) return;
    if (!label.trim() || !address.trim()) return setError('Add a label and an address.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('saved_addresses').insert({ user_id: userId, label: label.trim(), address: address.trim(), city: city.trim() || null });
    setBusy(false);
    if (err) return setError('Could not save this address. Try again.');
    setLabel('');
    setAddress('');
    setCity('');
    await load();
  };

  const remove = async (id: string) => {
    setItems((cur) => cur.filter((a) => a.id !== id));
    const { error: err } = await supabase.from('saved_addresses').delete().eq('id', id);
    if (err) await load();
  };

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mx-auto max-w-xl">
        <PageHeader title="Saved Addresses" fallbackHref="/settings" />
        <form onSubmit={add} className="mb-6 rounded-lg bg-surface p-4 shadow-sm">
          <label className="block text-sm font-medium text-textPrimary">
            Label
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} placeholder="Home, Work…" className={INPUT} />
          </label>
          <label className="mt-3 block text-sm font-medium text-textPrimary">
            Address
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} className={INPUT} />
          </label>
          <label className="mt-3 block text-sm font-medium text-textPrimary">
            City (optional)
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} className={INPUT} />
          </label>
          {error && (
            <p className="mt-3 text-sm text-error" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="sm" className="mt-4" loading={busy}>
            Add address
          </Button>
        </form>

        {!loaded ? (
          <p className="py-6 text-center text-sm text-textSecondary">Loading…</p>
        ) : items.length === 0 ? (
          <EmptyState icon={MapPin} title="No saved addresses" message="Save the places you often meet buyers or ship from." />
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((a) => (
              <Card key={a.id} className="flex items-center gap-3">
                <MapPin size={18} className="shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-textPrimary">{a.label}</p>
                  <p className="truncate text-xs text-textSecondary">
                    {a.address}
                    {a.city ? `, ${a.city}` : ''}
                  </p>
                </div>
                <button onClick={() => remove(a.id)} aria-label={`Delete ${a.label}`} className="shrink-0 rounded-full p-2 text-textMuted hover:bg-background">
                  <Trash2 size={18} />
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
