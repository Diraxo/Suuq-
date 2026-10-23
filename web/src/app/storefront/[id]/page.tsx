'use client';

// Public storefront (web twin of app/storefront/[id].tsx). Reads ONLY the public_storefronts view: a draft, suspended or
// banned-owner storefront, an unknown id and a malformed id all render the same "unavailable" page, so the page reveals
// nothing about whether a private storefront exists. Listings come from the block-aware seller_listings() RPC, and a
// blocked pair (either direction) sees the same "unavailable" page.
import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { ChevronLeft, ShieldCheck } from '@/lib/icons';
import { Listing } from '@/lib/types';
import { listSellerListings } from '@/services/listings';
import { ListingCard } from '@/components/ListingCard';
import { Button } from '@/components/Button';
import { supabase } from '@/lib/supabase';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { STOREFRONTS_ENABLED } from '@/lib/storefrontFlag';
import { PUBLIC_STOREFRONT_COLUMNS, PublicStorefront, hoursLines, isStorefrontId, safeWebsiteHref } from '@/lib/storefront';
import { useT } from '@/lib/i18n';

const DAY_LABEL = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' } as const;

export default function PublicStorefrontPage({ params }: { params: Promise<{ id: string }> }) {
  if (!STOREFRONTS_ENABLED) notFound();
  const { id } = use(params);
  return <Storefront id={id} />;
}

function Storefront({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const blockedIds = useBlockedEitherWayIds();
  const [state, setState] = useState<{ phase: 'loading' } | { phase: 'error' } | { phase: 'missing' } | { phase: 'ready'; store: PublicStorefront }>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const ownerId = state.phase === 'ready' ? state.store.owner_id : null;
  const blocked = ownerId ? blockedIds.has(ownerId) : false;

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading' });
    if (!isStorefrontId(id)) {
      setState({ phase: 'missing' });
      return;
    }
    void supabase
      .from('public_storefronts')
      .select(PUBLIC_STOREFRONT_COLUMNS)
      .eq('id', id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setState({ phase: 'error' });
        else setState(data ? { phase: 'ready', store: data as PublicStorefront } : { phase: 'missing' });
      });
    return () => {
      cancelled = true;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (!ownerId || blocked) return;
    let cancelled = false;
    setListings(null);
    void listSellerListings(ownerId).then((page) => {
      if (cancelled) return;
      setListings(page.items);
      setHasMore(page.hasMore);
    });
    return () => {
      cancelled = true;
    };
  }, [ownerId, blocked]);

  const back = (
    <button onClick={() => (window.history.length > 1 ? router.back() : router.push('/'))} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
      <ChevronLeft size={20} />
    </button>
  );

  if (state.phase === 'loading') return <div className="min-h-[50vh]" role="status" aria-label={t('web.t.loadingStorefront')} />;
  if (state.phase === 'error') {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-6">
        {back}
        <div className="mt-10 text-center" role="alert">
          <h1 className="text-lg font-bold text-textPrimary">{t('storefront.public.loadFailedTitle')}</h1>
          <p className="mt-1 text-sm text-textSecondary">{t('search.errorMessage')}</p>
          <div className="mt-4">
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {t('common.retry')}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (state.phase === 'missing' || blocked) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-6">
        {back}
        <div className="mt-10 text-center">
          <h1 className="text-lg font-bold text-textPrimary">{t('storefront.public.unavailableTitle')}</h1>
          <p className="mt-1 text-sm text-textSecondary">{t('storefront.public.unavailable')}</p>
        </div>
      </div>
    );
  }

  const store = state.store;
  const hours = hoursLines(store.hours);
  const website = safeWebsiteHref(store.website);

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6">
      {back}
      {store.banner_url ? <img src={store.banner_url} alt={t('storefront.bannerTitle')} className="mt-3 h-40 w-full rounded-md object-cover" /> : null}
      <div className="mt-4 flex items-center gap-3">
        {store.logo_url ? <img src={store.logo_url} alt={t('settings.businessProfile.businessLogoLabel')} className="h-16 w-16 rounded-md object-contain" /> : null}
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-1 text-xl font-bold text-textPrimary">
            <span className="truncate">{store.name}</span>
            {store.verified && <ShieldCheck size={18} className="shrink-0 text-primary" aria-label={t('business.verifiedBusiness')} />}
          </h1>
        </div>
      </div>
      {store.description ? <p className="mt-3 whitespace-pre-line text-sm text-textSecondary">{store.description}</p> : null}
      {store.address ? <p className="mt-3 text-sm text-textMuted">{store.address}</p> : null}
      {website ? (
        <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="mt-3 inline-block rounded-pill border border-primary px-4 py-1.5 text-sm font-medium text-primary hover:bg-primary/5">
          {t('storefront.public.visitWebsite')}
        </a>
      ) : null}

      {hours.days.length > 0 || hours.note ? (
        <section className="mt-5 rounded-lg border border-border p-4" aria-label={t('seller.hours.title')}>
          <h2 className="mb-2 text-sm font-semibold text-textPrimary">{t('seller.hours.title')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            {hours.days.map((d) => (
              <div key={d.day} className="contents">
                <dt className="text-textSecondary">{t.text(DAY_LABEL[d.day])}</dt>
                <dd className="text-right text-textPrimary">{d.closed ? t('components.businessHoursEditor.closed') : `${d.open} – ${d.close}`}</dd>
              </div>
            ))}
          </dl>
          {hours.note ? <p className="text-sm text-textPrimary">{hours.note}</p> : null}
        </section>
      ) : null}

      <p className="mt-4 text-sm">
        <Link href={`/seller/${store.owner_id}`} className="font-medium text-primary">
          {t('storefront.public.viewSeller')}
        </Link>
      </p>

      <h2 className="mb-3 mt-8 text-base font-semibold text-textPrimary">{t('business.analytics.listings')}</h2>
      {listings === null ? (
        <div className="min-h-[20vh]" role="status" aria-label={t('web.t.loadingListings2')} />
      ) : listings.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {hasMore && <p className="mt-4 text-center text-xs text-textMuted">{t('web.m.showingLatest', { count: listings.length })}</p>}
        </>
      ) : (
        <p className="py-10 text-center text-sm text-textSecondary">{t('storefront.public.noListings')}</p>
      )}
    </div>
  );
}
