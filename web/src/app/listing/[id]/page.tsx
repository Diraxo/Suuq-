'use client';

import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { WatermarkOverlay } from '@/components/WatermarkOverlay';
import Link from 'next/link';
import { useRouter, notFound } from 'next/navigation';
import { Heart, Share2, ChevronLeft, MapPin, ShieldCheck, Flag, Phone, MessageCircle, Tag as TagIcon, CheckCircle2, X, Trash2, PencilLine } from '@/lib/icons';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Listing } from '@/lib/types';
import { getListing, incrementListingViews, markListingSold, deleteListingRow } from '@/services/listings';
import { deleteFromR2, imageKeyFor } from '@/services/r2';
import { startConversation } from '@/services/chat';
import { formatBirr } from '@/lib/currency';
import { useFavoritesStore } from '@/store/favorites';
import { recordRecentlyViewed } from '@/services/account';
import { useAuthStore } from '@/store/auth';
import { registerKnownListingIds, useVisibilityStore } from '@/store/visibility';
import { requireAuth } from '@/store/authPrompt';
import { ReportModal } from '@/components/ReportModal';
import { UserSafetyMenu } from '@/components/UserSafetyMenu';
import { listMyReportedKeys } from '@/services/reports';

// Mirrors app/listing/[id].tsx on mobile: hero gallery, price/title/badges,
// specifications, features, seller notes, description, seller card, safety
// tip, report link, and a sticky Call / Chat / Make an offer action bar.
// Phase 2: real Supabase listing + chat/offer RPCs (mobile's store/listings.ts,
// store/chatConversations.ts, store/offers.ts).
export default function ListingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const [listing, setListing] = useState<Listing | null | undefined>(undefined); // undefined = loading, null = not found
  const [activeImage, setActiveImage] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Natural size of the photo on screen — the legacy-photo overlay (components/WatermarkOverlay.tsx) is drawn in image space.
  const [natural, setNatural] = useState<{ index: number; w: number; h: number } | null>(null);
  const onPhotoLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setNatural({ index: activeImage, w: img.naturalWidth, h: img.naturalHeight });
  };
  const [startingChat, setStartingChat] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState<'sold' | 'delete' | null>(null);
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
  const specFields = [
    ...Object.entries(listing.attributes ?? {}).map(([key, value]) => ({ key, label: key, value })),
    { key: '_condition', label: 'Condition', value: listing.condition },
    { key: '_location', label: 'Location', value: listing.city },
    { key: '_negotiable', label: 'Negotiable', value: listing.negotiable ? 'Yes' : 'No' },
    { key: '_posted', label: 'Posted', value: listing.postedLabel },
  ];

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
    if (!window.confirm('Mark this listing as sold? Buyers will see it is no longer available.')) return;
    setOwnerBusy('sold');
    const { error } = await markListingSold(listing.id);
    setOwnerBusy(null);
    if (error) {
      alert('Could not mark as sold. Check your connection and try again.');
      return;
    }
    setListing({ ...listing, status: 'sold' });
  };

  const confirmDelete = async () => {
    if (ownerBusy) return;
    if (!window.confirm('Delete this listing? This cannot be undone.')) return;
    setOwnerBusy('delete');
    const keys = listing.images.map((u) => imageKeyFor(listing, u)).filter((k): k is string => !!k);
    const { error } = await deleteListingRow(listing.id);
    if (error) {
      setOwnerBusy(null);
      alert('Could not delete this listing. Check your connection and try again.');
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
              <button onClick={() => setLightboxOpen(true)} aria-label="View photo full-screen" className="absolute inset-0 h-full w-full">
                <Image src={listing.images[activeImage]} alt={listing.title} fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover" priority onLoad={onPhotoLoad} />
                {natural?.index === activeImage && <WatermarkOverlay src={listing.images[activeImage]} naturalWidth={natural.w} naturalHeight={natural.h} fit="cover" />}
              </button>
            )}
            <div className="absolute left-3 top-3 flex justify-between md:hidden" style={{ right: '3rem' }}>
              <button onClick={() => router.back()} aria-label="Go back" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white">
                <ChevronLeft size={18} />
              </button>
            </div>
            <div className="absolute right-3 top-3 flex gap-2">
              <button aria-label="Share listing" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45 text-white">
                <Share2 size={16} />
              </button>
              {!viewerIsOwner && (
                <button
                  onClick={() => requireAuth(() => toggleFavorite(listing.id), { pendingFavoriteId: listing.id })}
                  aria-label={favorited ? 'Remove from favorites' : 'Add to favorites'}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/45"
                >
                  <Heart size={16} className={favorited ? 'fill-accent text-accent' : 'text-white'} />
                </button>
              )}
            </div>
            {listing.status === 'sold' && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
                <span className="rounded-md bg-black/70 px-5 py-2 text-2xl font-bold uppercase tracking-widest text-white">Sold</span>
              </div>
            )}
            {listing.status !== 'available' && (
              <div className="absolute left-3 top-14 flex gap-1.5">
                <Badge
                  label={listing.status === 'sold' ? 'Sold' : listing.status === 'expired' ? 'Expired' : listing.status === 'removed' ? 'Removed' : 'Reserved'}
                  tone={listing.status === 'sold' ? 'solid' : 'warning'}
                />
              </div>
            )}
          </div>
          {listing.images.length > 1 && (
            <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto px-4 md:px-0">
              {listing.images.map((uri, i) => (
                <button key={uri} onClick={() => setActiveImage(i)} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-sm">
                  <Image src={uri} alt="" fill sizes="56px" className={`object-cover ${i === activeImage ? 'ring-2 ring-primary' : ''}`} />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="px-4 pt-4 md:px-0 md:pt-0">
          <div className="flex items-start justify-between">
            <p className="text-3xl font-bold text-primary">{formatBirr(listing.price, listing.currency)}</p>
            {listing.negotiable && !isUnavailable && <Badge label="Negotiable" tone="accent" />}
          </div>
          <h1 className="mt-1 text-xl font-semibold text-textPrimary">{listing.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge label={listing.condition} />
            <Badge label={listing.city} />
            {listing.subcategory && <Badge label={listing.subcategory} />}
          </div>
          <p className="mt-2 text-xs text-textMuted">Posted {listing.postedLabel}</p>

          <Card elevated={false} className="mt-4">
            <p className="mb-2 text-sm font-semibold text-textPrimary">Specifications</p>
            <div className="space-y-2">
              {specFields.map((f) => (
                <div key={f.key} className="flex justify-between text-sm">
                  <span className="capitalize text-textSecondary">{f.label}</span>
                  <span className="capitalize text-textPrimary">{f.value}</span>
                </div>
              ))}
            </div>
          </Card>

          {!!listing.features?.length && (
            <Card elevated={false} className="mt-4">
              <p className="mb-2 text-sm font-semibold text-textPrimary">Features</p>
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
              <p className="mb-2 text-sm font-semibold text-textPrimary">Seller notes</p>
              <ul className="space-y-1 text-sm text-textSecondary">
                {listing.sellerNotes.map((note) => (
                  <li key={note}>• {note}</li>
                ))}
              </ul>
            </Card>
          )}

          <p className="mb-2 mt-5 text-sm font-semibold text-textPrimary">Description</p>
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
                {listing.seller.rating.toFixed(1)} ★ ({listing.seller.reviewCount}) · replies {listing.seller.responseTime}
              </p>
              <p className="text-xs font-medium text-primary">View profile</p>
            </div>
            </Link>
            <UserSafetyMenu userId={listing.seller.id} userName={listing.seller.name} listingId={listing.id} source="listing" />
          </Card>
          )}

          {!viewerIsOwner && (
            <Card elevated={false} className="mt-4 flex items-start gap-2">
              <ShieldCheck size={16} className="mt-0.5 shrink-0 text-success" />
              <p className="text-xs text-textSecondary">Meet in a safe, public place. Never send money before seeing the item in person.</p>
            </Card>
          )}

          {!viewerIsOwner && (
            <button
              onClick={() => requireAuth(openReport, { next: `/listing/${listing.id}` })}
              className="mx-auto mt-4 flex items-center gap-1.5 py-2 text-xs text-textMuted"
            >
              <Flag size={14} />
              Report this listing
            </button>
          )}
        </div>
      </div>

      {/* Sticky action bar */}
      {viewerIsOwner && (listing.status === 'available' || listing.status === 'reserved') && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0 md:mt-6 md:px-6">
          <Button variant="danger" fullWidth className="flex-1" icon={<Trash2 size={16} />} loading={ownerBusy === 'delete'} disabled={!!ownerBusy} onClick={confirmDelete}>
            Delete
          </Button>
          <Button variant="outline" fullWidth className="flex-1" icon={<CheckCircle2 size={16} />} loading={ownerBusy === 'sold'} disabled={!!ownerBusy} onClick={confirmMarkSold}>
            Mark as sold
          </Button>
          <Button fullWidth className="flex-1" icon={<PencilLine size={16} />} disabled={!!ownerBusy} onClick={() => router.push(`/listing/edit/${listing.id}`)}>
            Edit
          </Button>
        </div>
      )}
      {!viewerIsOwner && !isUnavailable && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0 md:mt-6 md:px-6">
          {listing.seller.phone && (
            <a href={`tel:${listing.seller.phone}`} className="flex-1">
              <Button variant="outline" fullWidth icon={<Phone size={16} />}>
                Call
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
            Chat
          </Button>
          <Button
            variant="secondary"
            fullWidth
            className="flex-1"
            icon={<TagIcon size={16} />}
            disabled={session?.user.id === listing.seller.id}
            onClick={() => requireAuth(makeOffer, { next: `/listing/${listing.id}` })}
          >
            Make offer
          </Button>
        </div>
      )}
      {(isUnavailable || (viewerIsOwner && listing.status !== 'available' && listing.status !== 'reserved')) && (
        <div className="fixed inset-x-0 bottom-16 z-30 flex items-center justify-center gap-2 border-t border-border bg-background p-3 md:sticky md:bottom-0">
          <MapPin size={16} className="text-textMuted" />
          <p className="text-sm font-medium text-textMuted">
            {listing.status === 'expired' ? 'This listing has expired.' : listing.status === 'removed' ? 'This listing was removed by a moderator.' : 'This item has been sold.'}
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
            aria-label="Close"
            className="absolute left-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/15 text-white"
          >
            <X size={20} />
          </button>
          <div className="relative h-full w-full max-w-3xl">
            <Image src={listing.images[activeImage]} alt={listing.title} fill sizes="100vw" className="object-contain" onLoad={onPhotoLoad} />
            {natural?.index === activeImage && <WatermarkOverlay src={listing.images[activeImage]} naturalWidth={natural.w} naturalHeight={natural.h} fit="contain" />}
          </div>
          {activeImage > 0 && (
            <button
              onClick={() => setActiveImage((i) => Math.max(0, i - 1))}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 text-white"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {activeImage < listing.images.length - 1 && (
            <button
              onClick={() => setActiveImage((i) => Math.min(listing.images.length - 1, i + 1))}
              aria-label="Next photo"
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
