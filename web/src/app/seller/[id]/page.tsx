'use client';

// Seller profile — web twin of app/seller/[id].tsx: avatar, name, member-since, stats, the seller's listings, and the
// shared safety menu (report / block). The listings come from the block-aware seller_listings() RPC (0043), so a blocked
// pair sees an empty, indistinguishable "unavailable" page. Nobody gets block/report controls on their own profile.
import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ShieldCheck, Tag } from 'lucide-react';
import { Listing, Seller } from '@/lib/types';
import { getProfile, getSellerStats, profileToSeller } from '@/services/profile';
import { listSellerListings } from '@/services/listings';
import { ListingCard } from '@/components/ListingCard';
import { UserSafetyMenu } from '@/components/UserSafetyMenu';
import { useAuthStore } from '@/store/auth';
import { useBlockedUsersStore } from '@/store/blockedUsers';
import { useBlockedEitherWayIds } from '@/lib/blocking';
import { Button } from '@/components/Button';
import { requireAuth } from '@/store/authPrompt';
import { followUser, listFollowing, unfollowUser } from '@/services/account';
import { supabase } from '@/lib/supabase';
import { usePublicStorefront } from '@/hooks/usePublicStorefront';
import { BusinessProfileCard } from '@/components/BusinessProfileCard';
import { useContactPhone } from '@/lib/contactPhone';
import { activeMode, hasBusinessDetails } from '@/lib/profileIdentity';
import { ProfileHeaderCover } from '@/components/ProfileHeaderCover';
import { startBusinessConversation, startConversation } from '@/services/chat';
import { UserAvatar } from '@/components/UserAvatar';
import type { Profile } from '@/lib/types';
import { useT } from '@/lib/i18n';

export default function SellerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const t = useT();
  const { id } = use(params);
  const router = useRouter();
  const meId = useAuthStore((s) => s.session?.user.id);
  const blockedIds = useBlockedEitherWayIds();
  const blockedByMe = useBlockedUsersStore((s) => s.blocked.some((b) => b.id === id));
  // Block / unblock changes what the server returns for this seller, so reload when it completes (otherwise the empty
  // list fetched while blocked stays on screen after unblocking).
  const blockVersion = useBlockedUsersStore((s) => s.version);
  const [seller, setSeller] = useState<Seller | null | undefined>(undefined);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [businessProfile, setBusinessProfile] = useState<Profile | null>(null);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  // The seller's PUBLISHED storefront, if any (null while the flag is off). Its verified flag is the only source of the gold badge.
  const storefront = usePublicStorefront(id);
  const storefrontId = storefront?.id ?? null;
  const [contactBusy, setContactBusy] = useState(false);
  useEffect(() => {
    if (!meId || meId === id) return;
    void listFollowing(meId).then((people) => setFollowing(people.some((p) => p.id === id)));
  }, [meId, id]);

  const toggleFollow = () =>
    requireAuth(async () => {
      const uid = useAuthStore.getState().session?.user.id;
      if (!uid || followBusy) return;
      setFollowBusy(true);
      const ok = following ? await unfollowUser(uid, id) : await followUser(uid, id);
      setFollowBusy(false);
      if (!ok) return;
      setFollowing(!following);
      setSeller((s) => (s ? { ...s, followers: Math.max(0, s.followers + (following ? -1 : 1)) } : s));
    }, { next: `/seller/${id}` });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const profile = await getProfile(id);
      if (cancelled) return;
      if (!profile) {
        setSeller(null);
        return;
      }
      const [stats, page] = await Promise.all([getSellerStats(id), listSellerListings(id)]);
      if (cancelled) return;
      setBusinessProfile(profile);
      setSeller(profileToSeller(profile, stats));
      setListings(page.items);
      setHasMore(page.hasMore);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, blockVersion]);

  // A mode switch or any profile edit by the owner reaches an open page without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`seller-page-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${id}` }, () => {
        void getProfile(id).then((profile) => {
          if (!profile) return;
          setBusinessProfile(profile);
          setSeller((prev) => (prev ? profileToSeller(profile, { listingsCount: prev.listingsCount, soldCount: prev.soldCount, followers: prev.followers, rating: prev.rating, reviewCount: prev.reviewCount }) : prev));
        });
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [id]);

  const contactBusiness = async () => {
    if (contactBusy) return;
    const first = listings?.[0];
    setContactBusy(true);
    // With a listing, chat opens on it (works on every database); with none, a direct conversation is started (migration 0066).
    const result = first ? await startConversation(first.id) : await startBusinessConversation(id);
    setContactBusy(false);
    if ('error' in result) {
      alert(result.error);
      return;
    }
    router.push(`/chat/${result.id}`);
  };

  const back = (
    <button onClick={() => router.back()} aria-label={t('common.back')} className="rounded-full p-1 hover:bg-inputBackground">
      <ChevronLeft size={20} />
    </button>
  );

  // The business number is private (0072): the database releases it to a signed-in viewer only when the owner shares it under the business.
  const callPhone = useContactPhone(id, { kind: 'business_profile' }, !!businessProfile && activeMode(businessProfile) === 'business' && !!meId && meId !== id);

  if (seller === undefined) return <div className="min-h-[50vh]" />;

  // Blocked by me: name + photo only (no listings, stats, reviews or contact), with the safety menu and an Unblock button.
  if (seller && meId !== id && blockedByMe) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-6">
        <div className="flex items-center justify-between">
          {back}
          <UserSafetyMenu userId={seller.id} userName={seller.name} source="profile" hideViewProfile />
        </div>
        <div className="mt-6 flex flex-col items-center text-center">
          <UserAvatar url={seller.avatar} name={seller.name} size={88} />
          <h1 className="mt-3 text-xl font-bold text-textPrimary">{seller.name}</h1>
          <p className="mt-1 max-w-sm text-sm text-textSecondary">{t('seller.blockedProfileNote')}</p>
          <button
            onClick={() => void useBlockedUsersStore.getState().unblock(seller.id)}
            className="mt-4 rounded-pill border border-primary px-5 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            {t('common.unblock')}
          </button>
        </div>
      </div>
    );
  }

  if (seller === null || (meId !== id && blockedIds.has(id))) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-6">
        {back}
        <div className="mt-10 text-center">
          <h1 className="text-lg font-bold text-textPrimary">{t('seller.profileUnavailable')}</h1>
          <p className="mt-1 text-sm text-textSecondary">{t('web.t.thisProfileCanTBe')}</p>
        </div>
      </div>
    );
  }

  // One account, one identity: the same avatar, name and bio in both modes. In business mode the banner goes behind that header and the
  // business details follow below it.
  const viewMode = businessProfile ? activeMode(businessProfile) : 'personal';
  const showBusiness = viewMode === 'business' && (meId === id || hasBusinessDetails(businessProfile));

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6">
      <div className="flex items-center justify-between">
        {back}
        <UserSafetyMenu userId={seller.id} userName={seller.name} source="profile" hideViewProfile />
      </div>

      <ProfileHeaderCover mode={viewMode} bannerUrl={businessProfile?.business_banner_url} className="mt-4 text-center">
        {(c) => (
          <>
            <UserAvatar url={seller.avatar} name={seller.name} size={88} className={c.ring} />
            <div className="mt-3 flex items-center gap-1">
              <h1 className={`text-xl font-bold ${c.primary}`}>{seller.name}</h1>
              {seller.verified && <ShieldCheck size={18} className="text-primary" />}
            </div>
            <p className={`text-sm ${c.secondary}`}>{t('profile.memberSince', { date: seller.memberSince })}</p>
            {businessProfile?.bio?.trim() && <p className={`mt-2 max-w-md whitespace-pre-line text-sm ${c.secondary}`}>{businessProfile.bio.trim()}</p>}
            <p className={`mt-1 text-sm ${c.secondary}`}>
              {t('web.m.sellerStatsLine', { rating: seller.rating.toFixed(1), reviews: seller.reviewCount, followers: seller.followers, sold: seller.soldCount })}
            </p>
          </>
        )}
      </ProfileHeaderCover>

      {meId !== id && !blockedByMe && !blockedIds.has(id) && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant={following ? 'outline' : 'primary'} loading={followBusy} onClick={toggleFollow}>
            {following ? t('common.following') : t('common.follow')}
          </Button>
        </div>
      )}

      {showBusiness && businessProfile && (
        <BusinessProfileCard
          profile={businessProfile}
          phone={callPhone}
          verified={storefront?.verified === true}
          isSelf={meId === id}
          onContact={meId !== id ? () => void contactBusiness() : undefined}
          contactBusy={contactBusy}
          storefrontHref={storefrontId ? `/storefront/${storefrontId}` : undefined}
        />
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold text-textPrimary">{t('web.m.listingsCount', { count: seller.listingsCount })}</h2>
      {listings && listings.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {hasMore && <p className="mt-4 text-center text-xs text-textMuted">{t('web.m.showingLatest', { count: listings.length })}</p>}
        </>
      ) : (
        <div className="flex flex-col items-center rounded-3xl border border-dashed border-border py-10 text-center">
          <Tag size={28} className="text-textMuted" />
          <p className="mt-2 text-sm font-semibold text-textPrimary">{t('business.noListingsTitle')}</p>
          <p className="mt-1 text-xs text-textSecondary">{meId === id ? t('business.noListingsSelf') : t('business.noListingsMessage')}</p>
        </div>
      )}
    </div>
  );
}
