'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { FadeImage } from '@/components/FadeImage';
import { WatermarkedPhoto, rememberPhotoSize } from '@/components/WatermarkedPhoto';
import Link from 'next/link';
import { useRouter, notFound } from 'next/navigation';
import { Heart, Share2, ChevronLeft, MapPin, ShieldCheck, Flag, Phone, MessageCircle, Tag as TagIcon, CheckCircle2, X, Trash2, PencilLine } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Listing } from '@/lib/types';
import { getListing, incrementListingViews, markListingSold, updateListing, deleteListingRow } from '@/services/listings';
import { deleteFromR2, imageKeyFor } from '@/services/r2';
import { startConversation } from '@/services/chat';
import { formatBirr } from '@/lib/currency';
import { activeDiscount, discountEndsText, formatDiscountInstant } from '@/lib/discount';
import { useFavoritesStore } from '@/store/favorites';
import { recordRecentlyViewed } from '@/services/account';
import { useAuthStore } from '@/store/auth';
import { registerKnownListingIds, useVisibilityStore } from '@/store/visibility';
import { requireAuth } from '@/store/authPrompt';
import { ReportModal } from '@/components/ReportModal';
import { UserSafetyMenu } from '@/components/UserSafetyMenu';
import { listingPriceText, priceUnitText } from '@/lib/sellText';
import { isContactPriceListing } from '@/lib/serviceConfig';
import { serviceDetail } from '@/lib/serviceDetail';
import { listingDetail } from '@/lib/listingDetail';
import { ListingDetails } from '@/components/ListingDetails';
import { ServiceDetails, ServiceIdentity } from '@/components/ServiceDetails';
import { closeKind, conditionApplies, isRentalListing } from '@/lib/sellRules';
import { categoryLabel, subcategoryLabel } from '@/lib/categoryNames';
import { listMyReportedKeys } from '@/services/reports';
import { useT } from '@/lib/i18n';
import { useContactPhone } from '@/lib/contactPhone';
import { DiscountModal } from '@/components/DiscountModal';
import { useSellerDiscount } from '@/hooks/useSellerDiscount';

// Mirrors app/listing/[id].tsx on mobile: hero gallery, price/title/badges,
// specifications, features, seller notes, description, seller card, safety
// tip, report link, and a sticky Call / Chat / Make an offer action bar.
// Phase 2: real Supabase listing + chat/offer RPCs (mobile's store/listings.ts,
// store/chatConversations.ts, store/offers.ts).
// The viewer box is max-w-3xl (768 px), so never ask the optimizer for more than that: "100vw" made it produce 1920-3840 px
// copies (up to ~700 kB) on wide or high-density screens. DETAIL_SIZES is the page's own copy, reused as the instant preview.
const DETAIL_SIZES = '(max-width: 768px) 100vw, 50vw';
const LIGHTBOX_SIZES = '(min-width: 768px) 768px, 100vw';

/** Background-fetching every full-screen copy is for good connections only: never on Data Saver or a 2G link. */
function fullScreenPreloadOk(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !(c?.saveData || c?.effectiveType === 'slow-2g' || c?.effectiveType === '2g');
}

export default function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const [listing, setListing] = useState<Listing | null | undefined>(undefined); // undefined = loading, null = not found
  const [activeImage, setActiveImage] = useState(0);
  const [heroSettled, setHeroSettled] = useState(false);
  const [thumbsWaited, setThumbsWaited] = useState(false);
  const onHeroSettled = useCallback(() => setHeroSettled(true), []);
  useEffect(() => {
    const timer = setTimeout(() => setThumbsWaited(true), 1500);
    return () => clearTimeout(timer);
  }, []);
  const thumbsReady = heroSettled || thumbsWaited;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState<'sold' | 'delete' | 'reopen' | null>(null);
  // After a discount is set or ended the page re-reads the listing, so no old price stays on screen.
  const sellerDiscount = useSellerDiscount(() => {
    void getListing(id).then((l) => {
      if (l) setListing(l);
    });
  });
  const favorited = useFavoritesStore((s) => s.isFavorited(id));
  const toggleFavorite = useFavoritesStore((s) => s.toggle);

  useEffect(() => {
    let cancelled = false;
    getListing(id).then((l) => {
      if (cancelled) return;
      setListing(l ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Staff hid this listing while the page was open (real-time broadcast, or found on reconnect): it is gone for
  // everyone except its owner. A direct visit is already blocked by RLS; this covers the already-open page.
  const hiddenByServer = useVisibilityStore((s) => s.hidden.has(id));
  const viewerIsOwner = !!listing && !!session && listing.seller.id === session.user.id;
  // The seller's phone is private (0072): the database hands it to a signed-in viewer only where the owner shares it for this listing.
  const callPhone = useContactPhone(listing?.seller.id, listing ? { kind: 'listing', listingId: listing.id } : null, !!listing && !!session && !viewerIsOwner);
  // Count one view per visit, and never the owner's own: wait until the listing and the auth state are both known so
  // an owner opening their own listing is not counted before we can tell who they are.
  const authInitializing = useAuthStore((s) => s.initializing);
  const loadedListingId = listing?.id;
  useEffect(() => {
    if (!loadedListingId || authInitializing || viewerIsOwner) return;
    void incrementListingViews(loadedListingId);
  }, [loadedListingId, authInitializing, viewerIsOwner]);
  useEffect(() => {
    if (!loadedListingId || authInitializing) return;
    void recordRecentlyViewed(session?.user.id ?? null, loadedListingId);
  }, [loadedListingId, authInitializing, session?.user.id]);
  useEffect(() => {
    registerKnownListingIds([id]);
  }, [id]);

  if (listing === null || (listing && hiddenByServer && !viewerIsOwner)) notFound();
  if (listing === undefined) return <div className="min-h-[50vh]" />;

  const isUnavailable = listing.status === 'sold' || listing.status === 'expired' || listing.status === 'removed' || listing.status === 'deactivated';
  const discount = isUnavailable ? null : activeDiscount(listing);
  // The stored status is 'sold' for every closed listing; the words depend on what it was: sold, rented, filled or closed.
  const kind = closeKind(listing);
  const isRental = isRentalListing(listing.category, listing.subcategory, listing.attributes);
  // A service can be "Contact for price" (stored as 0 with its mode) or charged per hour / job / ...
  const contactPrice = isContactPriceListing(listing);
  const priceUnit = contactPrice ? undefined : priceUnitText(t, listing.category, listing.attributes);
  // Services get their own grouped sections instead of one long list of raw fields.
  const service = serviceDetail(t, listing.category, listing.subcategory, listing.attributes);
  const goChat = async () => {
    if (startingChat) return;
    setStartingChat(true);
    const result = await startConversation(listing.id);
    setStartingChat(false);
    if ('error' in result) {
      alert(result.error);
      return;
    }
    router.push(`/chat/${result.id}`);
  };

  // Matches app/listing/[id].tsx on mobile exactly: "Make offer" navigates to
  // the offers screen (inline amount/message form + full accept/counter/
  // decline/cancel lifecycle) instead of a one-shot prompt.
  const makeOffer = () => {
    router.push(`/offers?listingId=${listing.id}&currency=${listing.currency}`);
  };

  // Owner actions — same behaviour as the owner bar on mobile (app/listing/[id].tsx).
  const confirmMarkSold = async () => {
    if (ownerBusy) return;
    if (!window.confirm(t(`listing.close.${kind}.confirmMessage`))) return;
    setOwnerBusy('sold');
    const { error } = await markListingSold(listing.id);
    setOwnerBusy(null);
    if (error) {
      alert(t(`listing.close.${kind}.errorTitle`));
      return;
    }
    setListing({ ...listing, status: 'sold' });
  };

  // Undo for an accidental "sold": puts the listing back on sale.
  const confirmReopen = async () => {
    if (ownerBusy) return;
    if (!window.confirm(t('listing.reopen.confirmMessage'))) return;
    setOwnerBusy('reopen');
    const { error } = await updateListing(listing.id, { status: 'available' });
    setOwnerBusy(null);
    if (error) {
      alert(t('listing.reopen.errorTitle'));
      return;
    }
    setListing({ ...listing, status: 'available' });
  };

  const confirmDelete = async () => {
    if (ownerBusy) return;
    if (!window.confirm(t('web.t.deleteThisListingThisCannot'))) return;
    setOwnerBusy('delete');
    const keys = listing.images.map((u) => imageKeyFor(listing, u)).filter((k): k is string => !!k);
    const { error } = await deleteListingRow(listing.id);
    if (error) {
      setOwnerBusy(null);
      alert(t('web.t.couldNotDeleteThisListing'));
      return;
    }
    if (keys.length > 0) deleteFromR2(keys);
    router.push('/my-listings');
  };

  const openReport = async () => {
    const userId = useAuthStore.getState().session?.user.id;
    if (!userId || viewerIsOwner) return;
    const reportedKeys = await listMyReportedKeys(userId);
    setAlreadyReported(reportedKeys.has(`listing:${listing.id}`));
    setReportOpen(true);
  };

  return (
    <div className="pb-28 md:pb-16">
      <div className="grid gap-6 md:grid-cols-2 md:px-6 md:pt-8">
        {/* Gallery */}
        <div>
          <div className="relative aspect-square w-full bg-skeleton md:rounded-lg md:overflow-hidden">
            {listing.images[activeImage] && (
              <button onClick={() => setLightboxOpen(true)} aria-label={t('web.t.viewPhotoFullScreen')} className="absolute inset-0 h-full w-full">
                <WatermarkedPhoto src={listing.images[activeImage]} alt={listing.title} sizes={DETAIL_SIZES} fit="cover" priority onSettled={onHeroSettled} />
              </button>
            )}
            {/* The photos either side, at the size this box uses, so choosing a thumbnail swaps to a picture already in the browser cache. */}
            <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
              {/* Neighbours at once; every other photo once the hero has settled, so none is still loading when tapped. */}
              {listing.images.map((uri, i) =>
                i !== activeImage && (Math.abs(i - activeImage) === 1 || thumbsReady) ? <Image key={uri} src={uri} alt="" fill sizes={DETAIL_SIZES} loading="eager" onLoad={(e) => rememberPhotoSize(uri, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} /> : null,
              )}
            </div>
            {/* The full-screen copy of every photo, fetched in the background once the page's own copies are in (nearest photo first),
                so opening the viewer or paging shows a photo that is already in the browser cache. Skipped on Data Saver / 2G. */}
            {thumbsReady && !lightboxOpen && fullScreenPreloadOk() && (
              <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
                {[...listing.images.keys()]
                  .sort((a, b) => Math.abs(a - activeImage) - Math.abs(b - activeImage))
                  .map((i) => <Image key={listing.images[i]} src={listing.images[i]} alt="" fill sizes={LIGHTBOX_SIZES} loading="eager" onLoad={(e) => rememberPhotoSize(listing.images[i], e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)} />)}
              </div>
            )}
            <div className="absolute left-3 top-3 flex justify-between md:hidden" style={{ right: '3rem' }}>
              <button onClick={() => router.back()} aria-label={t('components.backButton.goBack')} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white">
                <ChevronLeft size={18} />
              </button>
            </div>
            {discount && (
              <div className="pointer-events-none absolute bottom-3 left-3">
                <Badge label={t('components.listingCard.discountOff', { percent: discount.percent })} tone="sale" />
              </div>
            )}
            <div className="absolute right-3 top-3 flex gap-2">
              <button aria-label={t('post.success.shareListing')} className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white">
                <Share2 size={16} />
              </button>
              {!viewerIsOwner && (
                <button
                  onClick={() => requireAuth(() => toggleFavorite(listing.id), { pendingFavoriteId: listing.id })}
                  aria-label={favorited ? t('components.listingCard.removeFromFavorites') : t('components.listingCard.addToFavorites')}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45"
                >
                  <Heart size={16} className={favorited ? 'fill-accent text-accent' : 'text-white'} />
                </button>
              )}
            </div>
            {listing.status === 'sold' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                <span className="rounded-md bg-black/70 px-5 py-2 text-2xl font-bold uppercase tracking-widest text-white">{t(`listing.close.${kind}.status`)}</span>
              </div>
            )}
            {listing.status === 'available' && isRental && (
              <div className="absolute left-3 top-14 flex gap-1.5">
                <Badge label={t('listing.forRent')} tone="solid" />
              </div>
            )}
            {listing.status !== 'available' && (
              <div className="absolute left-3 top-14 flex gap-1.5">
                <Badge
                  label={listing.status === 'sold' ? t(`listing.close.${kind}.status`) : listing.status === 'expired' ? t('myListings.tabs.expired') : listing.status === 'removed' ? t('support.listings.removed') : t('myListings.tabs.reserved')}
                  tone={listing.status === 'sold' ? 'solid' : 'warning'}
                />
              </div>
            )}
          </div>
          {listing.images.length > 1 && (
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-4 md:px-0">
              {listing.images.map((uri, i) => (
                <button key={uri} onClick={() => setActiveImage(i)} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm">
                  {/* Thumbnails wait for the hero photo (or 1.5 s) so their downloads never compete with it. */}
                  {thumbsReady && <FadeImage src={uri} alt="" fill sizes="56px" className={`object-cover ${i === activeImage ? 'ring-2 ring-primary' : ''}`} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="px-4 pt-4 md:px-0 md:pt-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-3xl font-bold text-primary">{listingPriceText(t, listing, formatBirr)}</p>
              {priceUnit && <p className="text-sm text-textSecondary">{priceUnit}</p>}
              {discount && (
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-base text-textMuted line-through">{formatBirr(discount.originalPrice, listing.currency)}</span>
                  <Badge label={t('components.listingCard.discountOff', { percent: discount.percent })} tone="sale" />
                  <span className="text-sm text-success">{t('listing.discountSave', { amount: formatBirr(discount.originalPrice - listing.price, listing.currency) })}</span>
                </p>
              )}
              {discount && (() => {
                const ends = discountEndsText(discount, t);
                return (
                  <>
                    {ends && <p className="mt-0.5 text-sm text-textSecondary">{ends}</p>}
                    {discount.note && <p className="mt-0.5 text-sm text-textSecondary">{discount.note}</p>}
                  </>
                );
              })()}
            </div>
            {listing.negotiable && !isUnavailable && <Badge label={t('post.preview.negotiable')} tone="accent" />}
          </div>
          {service && <ServiceIdentity subcategory={listing.subcategory} providerKindLabel={service.providerKindLabel} />}
          <h1 className="mt-1 break-words text-xl font-semibold text-textPrimary">{listing.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {conditionApplies(listing.category, listing.subcategory) && <Badge label={listing.condition} />}
            <Badge label={listing.city} />
            {listing.subcategory && !service && <Badge label={subcategoryLabel(t, listing.category, listing.subcategory)} />}
          </div>
          <p className="mt-2 text-xs text-textMuted">{t('listing.postedLabel', { time: listing.postedLabel })}</p>

          {service ? <ServiceDetails detail={service} extra={[]} /> : <ListingDetails detail={listingDetail(t, listing.category, listing.subcategory, listing.attributes)} />}

          {!!listing.features?.length && (
            <Card elevated={false} className="mt-4">
              <p className="mb-2 text-sm font-semibold text-textPrimary">{service ? t('listing.service.included', { defaultValue: 'What is included' }) : t('post.preview.featuresTitle')}</p>
              <div className="grid grid-cols-2 gap-2">
                {listing.features.map((f) => (
                  <div key={f} className="flex items-center gap-1.5 text-sm text-textSecondary">
                    <CheckCircle2 size={15} className="shrink-0 text-success" />
                    {f}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {!!listing.sellerNotes?.length && (
            <Card elevated={false} className="mt-4">
              <p className="mb-2 text-sm font-semibold text-textPrimary">{t('post.preview.sellerNotesTitle')}</p>
              <ul className="space-y-1 text-sm text-textSecondary">
                {listing.sellerNotes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </Card>
          )}

          <p className="mb-2 mt-5 text-sm font-semibold text-textPrimary">{t('settings.businessProfile.descriptionLabel')}</p>
          <p className="whitespace-pre-line text-sm text-textSecondary">{listing.description}</p>

          {!viewerIsOwner && (
          <Card className="mt-5 flex items-center gap-3">
            <Link href={`/seller/${listing.seller.id}`} aria-label={`View ${listing.seller.name}'s profile`} className="flex min-w-0 flex-1 items-center gap-3">
            <Image src={listing.seller.avatar} alt={listing.seller.name} width={48} height={48} className="rounded-full object-cover" />
            <div className="flex-1">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium text-textPrimary">{listing.seller.name}</span>
                {listing.seller.verified && <ShieldCheck size={14} className="text-primary" />}
              </div>
              <p className="text-xs text-textSecondary">
                {t('listing.sellerRatingSummary', { rating: listing.seller.rating.toFixed(1), count: listing.seller.reviewCount, responseTime: listing.seller.responseTime })}
              </p>
              <p className="text-xs font-medium text-primary">{t('safety.viewProfile')}</p>
            </div>
            </Link>
            <UserSafetyMenu userId={listing.seller.id} userName={listing.seller.name} listingId={listing.id} source="listing" />
          </Card>
          )}

          {!viewerIsOwner && (
            <Card elevated={false} className="mt-4 flex items-start gap-2">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
              <p className="text-xs text-textSecondary">{t('web.t.meetInASafePublic')}</p>
            </Card>
          )}

          {!viewerIsOwner && (
            <button
              onClick={() => requireAuth(openReport, { next: `/listing/${listing.id}` })}
              className="mx-auto mt-4 flex items-center gap-1.5 py-2 text-xs text-textMuted"
            >
              <Flag size={14} />
              {t('safety.reportListing')}
            </button>
          )}
        </div>
      </div>

      {sellerDiscount.notice && (
        <div role="status" className="fixed inset-x-4 top-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-lg bg-success px-4 py-3 text-sm font-medium text-white shadow-lg">
          <span className="flex-1">{sellerDiscount.notice}</span>
          <button type="button" onClick={sellerDiscount.clearNotice} aria-label={t('common.close')} className="shrink-0 text-white/90">✕</button>
        </div>
      )}
      <DiscountModal
        open={!!sellerDiscount.target}
        listing={sellerDiscount.target}
        loading={sellerDiscount.loading}
        error={sellerDiscount.error}
        onCancel={sellerDiscount.close}
        onStart={sellerDiscount.start}
        onEnd={sellerDiscount.end}
      />

      {/* Sticky action bar */}
      {viewerIsOwner && (listing.status === 'available' || listing.status === 'reserved') && (
        <div className="fixed inset-x-0 bottom-16 z-30 grid grid-cols-2 gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0 md:mt-6 md:px-6">
          <Button fullWidth icon={<PencilLine size={16} />} disabled={!!ownerBusy} onClick={() => router.push(`/listing/edit/${listing.id}`)}>
            {t('common.edit')}
          </Button>
          {listing.status === 'available' && !contactPrice ? (
            <Button variant="outline" fullWidth icon={<TagIcon size={16} />} disabled={!!ownerBusy} onClick={() => sellerDiscount.open(listing)}>
              {discount ? t('discount.manage') : t('discount.action')}
            </Button>
          ) : (
            <span aria-hidden="true" />
          )}
          <Button variant="outline" fullWidth icon={<CheckCircle2 size={16} />} loading={ownerBusy === 'sold'} disabled={!!ownerBusy} onClick={confirmMarkSold}>
            {t(`listing.close.${kind}.mark`)}
          </Button>
          <Button variant="danger" fullWidth icon={<Trash2 size={16} />} loading={ownerBusy === 'delete'} disabled={!!ownerBusy} onClick={confirmDelete}>
            {t('common.delete')}
          </Button>
        </div>
      )}
      {!viewerIsOwner && !isUnavailable && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0 md:mt-6 md:px-6">
          {callPhone && (
            <a href={`tel:${callPhone}`} className="flex-1">
              <Button variant="outline" fullWidth icon={<Phone size={16} />}>
                {t('seller.call')}
              </Button>
            </a>
          )}
          <Button
            fullWidth
            className="flex-1"
            icon={<MessageCircle size={16} />}
            loading={startingChat}
            disabled={session?.user.id === listing.seller.id}
            onClick={() => requireAuth(goChat, { next: `/listing/${listing.id}` })}
          >
            {t('settings.notificationPreferences.categories.chat.label')}
          </Button>
          {!contactPrice && (
          <Button
            variant="secondary"
            fullWidth
            className="flex-1"
            icon={<TagIcon size={16} />}
            disabled={session?.user.id === listing.seller.id}
            onClick={() => requireAuth(makeOffer, { next: `/listing/${listing.id}` })}
          >
            {t('listing.makeOffer')}
          </Button>
          )}
        </div>
      )}
      {viewerIsOwner && listing.status === 'sold' && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex flex-col gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0 md:mt-6 md:px-6">
          <p className="text-center text-sm font-medium text-textMuted">{t(`listing.close.${kind}.message`)}</p>
          <Button fullWidth icon={<CheckCircle2 size={16} />} loading={ownerBusy === 'reopen'} disabled={!!ownerBusy} onClick={confirmReopen}>
            {t('listing.reopen.button')}
          </Button>
        </div>
      )}
      {!(viewerIsOwner && listing.status === 'sold') && (isUnavailable || (viewerIsOwner && listing.status !== 'available' && listing.status !== 'reserved')) && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex items-center justify-center gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0">
          <MapPin size={16} className="text-textMuted" />
          <p className="text-sm font-medium text-textMuted">
            {listing.status === 'expired' ? t('web.t.thisListingHasExpired') : listing.status === 'removed' ? t('web.t.thisListingWasRemovedBy') : t('web.t.thisItemHasBeenSold')}
          </p>
        </div>
      )}

      {/* Full-screen gallery viewer — web equivalent of app/listing/gallery/[id].tsx
          on mobile (a dedicated route there; an in-page overlay here, since
          modal lightboxes are the idiomatic web pattern for this). */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black">
          <button
            onClick={() => setLightboxOpen(false)}
            aria-label={t('common.close')}
            className="absolute left-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X size={20} />
          </button>
          <div className="relative h-full w-full max-w-3xl">
            <WatermarkedPhoto
              key={listing.images[activeImage]}
              src={listing.images[activeImage]}
              alt={listing.title}
              sizes={LIGHTBOX_SIZES}
              previewSizes={DETAIL_SIZES}
              fit="contain"
            />
          </div>
          {/* Warm the browser cache with the photos either side, at the exact size the viewer uses, so paging is instant. */}
          <div aria-hidden className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0">
            {[activeImage - 1, activeImage + 1].map((i) =>
              listing.images[i] ? <Image key={listing.images[i]} src={listing.images[i]} alt="" fill sizes={LIGHTBOX_SIZES} loading="eager" /> : null,
            )}
          </div>
          {activeImage > 0 && (
            <button
              onClick={() => setActiveImage((i) => Math.max(0, i - 1))}
              aria-label={t('web.t.previousPhoto')}
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {activeImage < listing.images.length - 1 && (
            <button
              onClick={() => setActiveImage((i) => Math.min(listing.images.length - 1, i + 1))}
              aria-label={t('web.t.nextPhoto')}
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white"
              style={{ transform: 'translateY(-50%) scaleX(-1)' }}
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {listing.images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 gap-1.5">
              {listing.images.map((_, i) => (
                <span key={i} className={`h-1.5 rounded-pill ${i === activeImage ? 'w-4 bg-white' : 'w-1.5 bg-white/40'}`} />
              ))}
            </div>
          )}
        </div>
      )}

      <ReportModal
        open={reportOpen}
        targetType="listing"
        targetId={listing.id}
        alreadyReported={alreadyReported}
        onClose={() => setReportOpen(false)}
        onSubmitted={() => setAlreadyReported(true)}
      />
    </div>
  );
}
