'use client';

// Seller profile — web twin of app/seller/[id].tsx: avatar, name, member-since, stats, the seller's listings, and the
// shared safety menu (report / block). The listings come from the block-aware seller_listings() RPC (0043), so a blocked
// pair sees an empty, indistinguishable "unavailable" page. Nobody gets block/report controls on their own profile.
import { use, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ShieldCheck } from 'lucide-react';
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

export default function SellerProfilePage({ params }: { params: Promise<{ id: string }> }) {
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
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);

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
      setSeller(profileToSeller(profile, stats));
      setListings(page.items);
      setHasMore(page.hasMore);
    })();
    return () => {
      cancelled = true;
    };
  }, [id, blockVersion]);

  const back = (
    <button onClick={() => router.back()} aria-label="Back" className="rounded-full p-1 hover:bg-inputBackground">
      <ChevronLeft size={20} />
    </button>
  );

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
          <Image src={seller.avatar} alt={seller.name} width={88} height={88} className="rounded-full object-cover" />
          <h1 className="mt-3 text-xl font-bold text-textPrimary">{seller.name}</h1>
          <p className="mt-1 max-w-sm text-sm text-textSecondary">You blocked this person. Their listings and reviews are hidden until you unblock them.</p>
          <button
            onClick={() => void useBlockedUsersStore.getState().unblock(seller.id)}
            className="mt-4 rounded-pill border border-primary px-5 py-2 text-sm font-medium text-primary hover:bg-primary/5"
          >
            Unblock
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
          <h1 className="text-lg font-bold text-textPrimary">Profile unavailable</h1>
          <p className="mt-1 text-sm text-textSecondary">This profile can’t be shown right now.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] px-4 py-6">
      <div className="flex items-center justify-between">
        {back}
        <UserSafetyMenu userId={seller.id} userName={seller.name} source="profile" hideViewProfile />
      </div>

      <div className="mt-4 flex flex-col items-center text-center">
        <Image src={seller.avatar} alt={seller.name} width={88} height={88} className="rounded-full object-cover" />
        <div className="mt-3 flex items-center gap-1">
          <h1 className="text-xl font-bold text-textPrimary">{seller.name}</h1>
          {seller.verified && <ShieldCheck size={18} className="text-primary" />}
        </div>
        <p className="text-sm text-textSecondary">Member since {seller.memberSince}</p>
        <p className="mt-1 text-sm text-textSecondary">
          {seller.rating.toFixed(1)} ★ ({seller.reviewCount}) · {seller.followers} followers · {seller.soldCount} sold
        </p>
      </div>

      {meId !== id && !blockedByMe && !blockedIds.has(id) && (
        <div className="mt-4 flex justify-center">
          <Button size="sm" variant={following ? 'outline' : 'primary'} loading={followBusy} onClick={toggleFollow}>
            {following ? 'Following' : 'Follow'}
          </Button>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-base font-semibold text-textPrimary">Listings ({seller.listingsCount})</h2>
      {listings && listings.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {hasMore && <p className="mt-4 text-center text-xs text-textMuted">Showing the latest {listings.length} listings.</p>}
        </>
      ) : (
        <p className="py-10 text-center text-sm text-textSecondary">No listings yet.</p>
      )}
    </div>
  );
}
