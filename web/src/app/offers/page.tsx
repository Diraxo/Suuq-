'use client';

import { Suspense, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ChevronLeft, X } from 'lucide-react';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Tag as TagIcon } from '@/lib/icons';
import { useOfferStore, Offer, OfferThread, OfferStatus } from '@/store/offers';
import { useAuthStore } from '@/store/auth';
import { useRequireAuthPage } from '@/hooks/useRequireAuthPage';
import { getListing, markListingSold } from '@/services/listings';
import { Listing } from '@/lib/types';
import { formatBirr } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { closeKind } from '@/lib/sellRules';

const toneFor = (s: OfferStatus): 'success' | 'warning' | 'accent' | 'neutral' => {
  if (s === 'accepted' || s === 'sold') return 'success';
  if (s === 'rejected' || s === 'cancelled' || s === 'expired') return 'warning';
  return 'accent';
};

const FILTERS = ['all', 'pending', 'accepted', 'countered', 'rejected'] as const;

function OfferInbox() {
  const t = useT();
  const router = useRouter();
  const inbox = useOfferStore((s) => s.inbox);
  const hasHydratedInbox = useOfferStore((s) => s.hasHydratedInbox);
  const loadInbox = useOfferStore((s) => s.loadInbox);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

  useEffect(() => {
    loadInbox();
  }, [loadInbox]);

  const filtered = inbox.filter((o) => {
    if (filter === 'all') return true;
    if (filter === 'rejected') return o.status === 'rejected' || o.status === 'cancelled' || o.status === 'expired';
    return o.status === filter;
  });

  return (
    <div className="px-4 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-textPrimary">{t('settings.notificationPreferences.categories.offers.label')}</h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-pill px-3 py-1.5 text-xs font-medium capitalize ${filter === f ? 'bg-primary text-primaryText' : 'bg-surface text-textSecondary'}`}
          >
            {f}
          </button>
        ))}
      </div>

      {!hasHydratedInbox ? (
        <p className="py-10 text-center text-sm text-textSecondary">{t('web.t.loadingOffers')}</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={TagIcon} title={t('offers.emptyTitle')} message={t('web.t.offersYouSendOrReceive')} />
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <button
              key={`${item.listingId}:${item.buyerId}`}
              onClick={() => router.push(`/offers?listingId=${item.listingId}&currency=${item.currency}`)}
              className="flex w-full items-center gap-3 rounded-lg bg-surface p-3 text-left shadow-sm"
            >
              <Image
                src={item.listingImage ?? `https://picsum.photos/seed/${item.listingId}/160/160`}
                alt=""
                width={56}
                height={56}
                className="rounded-md object-cover"
                unoptimized={!item.listingImage}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-textPrimary">{item.listingTitle}</p>
                <p className="truncate text-xs text-textSecondary">
                  {t('web.m.offeredAmount', { who: item.role === 'buyer' ? t('common.you') : item.counterpartyName, amount: formatBirr(item.amount, item.currency) })}
                </p>
              </div>
              <Badge label={item.status} tone={toneFor(item.status)} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OfferThreadView({ listingId, currency }: { listingId: string; currency: string }) {
  const t = useT();
  const router = useRouter();
  const uid = useAuthStore((s) => s.session?.user.id);
  const [listing, setListing] = useState<Listing | null | undefined>(undefined);

  const offers = useOfferStore((s) => s.offers);
  const hasHydrated = useOfferStore((s) => s.hasHydrated);
  const loadForListing = useOfferStore((s) => s.loadForListing);
  const subscribeListing = useOfferStore((s) => s.subscribeListing);
  const createOffer = useOfferStore((s) => s.createOffer);
  const accept = useOfferStore((s) => s.accept);
  const decline = useOfferStore((s) => s.decline);
  const counter = useOfferStore((s) => s.counter);
  const cancel = useOfferStore((s) => s.cancel);

  const [amountDraft, setAmountDraft] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [counteringId, setCounteringId] = useState<string | null>(null);
  const [counterDraft, setCounterDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);

  useEffect(() => {
    getListing(listingId).then((l) => setListing(l ?? null));
  }, [listingId]);

  useEffect(() => {
    loadForListing(listingId);
    const unsubscribe = subscribeListing(listingId);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId]);

  const isOwner = !!listing && !!uid && listing.seller.id === uid;
  const latest = offers[offers.length - 1];
  const canRespond = latest?.status === 'pending' && !latest.fromMe;
  const canCancel = latest?.status === 'pending' && latest.fromMe;
  const canMakeNewOffer = !isOwner && (!latest || (latest.fromMe && ['rejected', 'cancelled', 'expired', 'sold'].includes(latest.status)));

  const canMarkSold = isOwner && latest?.status === 'accepted' && listing?.status !== 'sold';

  // An offer can never be higher than the asking price (also enforced in the database, migration 0065).
  const overAsking = (amount: number) => {
    if (!listing || listing.price <= 0 || amount <= listing.price) return false;
    setError(t('offers.exceedsAsking', { price: formatBirr(listing.price, listing.currency) }));
    return true;
  };

  const confirmMarkSold = async () => {
    if (!listing || marking) return;
    if (!window.confirm(t(`listing.close.${closeKind(listing)}.confirmMessage`))) return;
    setMarking(true);
    setError(null);
    const { error: err } = await markListingSold(listing.id);
    setMarking(false);
    if (err) {
      setError(err);
      return;
    }
    setListing({ ...listing, status: 'sold' });
    setNotice(t('web.t.itemMarkedAsSold'));
    loadForListing(listingId);
  };

  const submitOffer = async () => {
    const amount = Number(amountDraft);
    if (!amount || amount <= 0 || overAsking(amount)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await createOffer(listingId, amount, messageDraft.trim() || undefined);
    setBusy(false);
    if (err) setError(err);
    else {
      setAmountDraft('');
      setMessageDraft('');
    }
  };

  const submitCounter = async (offerId: string) => {
    const amount = Number(counterDraft);
    if (!amount || amount <= 0 || overAsking(amount)) return;
    setBusy(true);
    setError(null);
    const { error: err } = await counter(offerId, amount);
    setBusy(false);
    if (err) setError(err);
    else {
      setCounteringId(null);
      setCounterDraft('');
    }
  };

  const respond = async (action: 'accept' | 'decline' | 'cancel') => {
    if (!latest) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: err } = action === 'accept' ? await accept(latest.id) : action === 'decline' ? await decline(latest.id) : await cancel(latest.id);
    setBusy(false);
    if (err) setError(err);
    else if (action === 'accept' && isOwner) setNotice(t('web.t.offerAcceptedOnceYouReceive'));
  };

  return (
    <div className="mx-auto max-w-xl px-4 pt-4 md:px-6 md:pt-8">
      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => router.push('/offers')} aria-label={t('web.t.backToOffers')} className="rounded-full p-1 hover:bg-inputBackground">
          <ChevronLeft size={20} />
        </button>
        <h1 className="text-2xl font-bold text-textPrimary">{t('settings.notificationPreferences.categories.offers.label')}</h1>
      </div>

      {listing && (
        <div className="mb-3 flex items-center justify-between rounded-lg bg-surface p-3">
          <p className="truncate pr-3 text-sm text-textSecondary">{listing.title}</p>
          <p className="shrink-0 font-semibold text-primary">{formatBirr(listing.price, listing.currency)}</p>
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-error/10 px-3 py-2 text-xs text-error">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <p className="flex-1">{t.text(error)}</p>
          <button onClick={() => setError(null)} aria-label={t('web.t.dismissError')}>
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-success/10 px-3 py-2 text-xs text-success">
          <p className="flex-1">{t.text(notice)}</p>
          <button onClick={() => setNotice(null)} aria-label={t('web.t.dismissNotice')}>
            <X size={14} />
          </button>
        </div>
      )}

      {!hasHydrated ? (
        <p className="py-10 text-center text-sm text-textSecondary">{t('web.t.loadingOffers')}</p>
      ) : offers.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title={t('offers.emptyTitle')}
          message={isOwner ? t('offers.emptyMessageOwner') : t('web.t.sendAnOfferBelowTo')}
        />
      ) : (
        <div className="space-y-2">
          {offers.map((item) => {
            const diff = listing ? item.amount - listing.price : null;
            return (
              <div key={item.id} className={`flex ${item.fromMe ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-lg p-3 ${item.fromMe ? 'bg-primary text-primaryText' : 'bg-surface text-textPrimary shadow-sm'}`}>
                  <p className={`text-xs ${item.fromMe ? 'text-primaryText/70' : 'text-textMuted'}`}>{item.fromMe ? t('offers.youOffered') : t('offers.theyOffered')}</p>
                  <p className="text-lg font-bold">{formatBirr(item.amount, currency)}</p>
                  {diff !== null && (
                    <p className={`text-[11px] ${item.fromMe ? 'text-primaryText/70' : 'text-textSecondary'}`}>
                      {diff === 0 ? t('offers.matchesAsking') : diff > 0 ? t('offers.aboveAsking', { amount: formatBirr(Math.abs(diff), currency) }) : t('offers.belowAsking', { amount: formatBirr(Math.abs(diff), currency) })}
                    </p>
                  )}
                  {item.message && <p className={`mt-1 text-xs ${item.fromMe ? 'text-primaryText/90' : 'text-textSecondary'}`}>{item.message}</p>}
                  <div className="mt-1.5">
                    <Badge label={item.status} tone={toneFor(item.status)} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasHydrated && canRespond && (
        <div className="mt-4">
          {counteringId === latest.id ? (
            <div className="space-y-2">
              <input
                type="number"
                inputMode="decimal"
                placeholder={t('offers.counterAmountPlaceholder', { currency })}
                value={counterDraft}
                onChange={(e) => setCounterDraft(e.target.value)}
                className="w-full rounded-lg bg-inputBackground px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
              />
              <div className="flex gap-2">
                <Button onClick={() => submitCounter(latest.id)} loading={busy} className="flex-1">
                  {t('offers.sendCounter')}
                </Button>
                <Button variant="ghost" onClick={() => setCounteringId(null)} className="flex-1">
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button onClick={() => respond('accept')} loading={busy} className="flex-1">
                {t('offers.accept')}
              </Button>
              <Button variant="outline" onClick={() => setCounteringId(latest.id)} className="flex-1">
                {t('offers.counter')}
              </Button>
              <Button variant="ghost" onClick={() => respond('decline')} loading={busy} className="flex-1">
                {t('offers.decline')}
              </Button>
            </div>
          )}
        </div>
      )}

      {hasHydrated && canCancel && (
        <div className="mt-4">
          <Button variant="ghost" onClick={() => respond('cancel')} loading={busy} fullWidth>
            {t('web.t.cancelOffer')}
          </Button>
        </div>
      )}

      {hasHydrated && canMarkSold && (
        <div className="mt-4 space-y-2 rounded-lg bg-surface p-3">
          <p className="text-sm font-medium text-textPrimary">{t('offers.soldBannerTitle')}</p>
          <p className="text-xs text-textSecondary">{t('offers.soldBannerMessage')}</p>
          <Button onClick={confirmMarkSold} loading={marking} fullWidth>
            {t(`listing.close.${listing ? closeKind(listing) : 'sold'}.mark`)}
          </Button>
        </div>
      )}

      {hasHydrated && canMakeNewOffer && (
        <div className="mb-6 mt-4 space-y-2">
          <input
            type="number"
            inputMode="decimal"
            placeholder={t('web.m.yourOfferPlaceholder', { currency })}
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            className="w-full rounded-lg bg-inputBackground px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
          />
          <input
            type="text"
            placeholder={t('web.t.addAMessageOptional')}
            value={messageDraft}
            onChange={(e) => setMessageDraft(e.target.value)}
            className="w-full rounded-lg bg-inputBackground px-3 py-2.5 text-sm text-textPrimary placeholder:text-textMuted focus:outline-none"
          />
          <Button onClick={submitOffer} loading={busy} fullWidth>
            {t('offers.sendOffer')}
          </Button>
        </div>
      )}
    </div>
  );
}

function OfferHistoryInner() {
  const authed = useRequireAuthPage('/offers');
  const searchParams = useSearchParams();
  const listingId = searchParams.get('listingId');
  const currency = searchParams.get('currency') ?? 'ETB';

  if (!authed) return <div className="min-h-[50vh]" />;
  if (!listingId) return <OfferInbox />;
  return <OfferThreadView listingId={listingId} currency={currency} />;
}

// With a listingId query param, shows that one negotiation thread (matches
// app/offers.tsx on mobile — also where "Make offer" buttons on the listing
// and chat pages send the user). Without one, shows the cross-listing inbox
// (matches the Profile menu's "Offers" entry point on mobile).
export default function OfferHistoryPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh]" />}>
      <OfferHistoryInner />
    </Suspense>
  );
}
