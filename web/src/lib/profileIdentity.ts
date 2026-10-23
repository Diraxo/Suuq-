// Pure rules for "one account, one identity, two presentations" (personal | business).
//
// The person is ALWAYS profiles.full_name / avatar_url / bio. Business mode never creates a second name, photo or bio: it adds a
// banner and the business-specific details (category, description, address, hours, links, storefront) around the same person.
// Which presentation the world sees is profiles.active_mode (migrations 0064 + 0075). Nothing here fetches or writes; the database
// stays the authority (set_active_mode RPC + guard trigger).
// profiles.business_name / business_logo_url are LEGACY columns: they are never an identity source any more. They only count as
// evidence that an old account had a business. The web build cannot import from outside web/, so web/src/lib/profileIdentity.ts is a
// byte-identical copy (tests/profileIdentity.test.ts fails if they drift).

export type ProfileMode = 'personal' | 'business';

/** Gold is reserved for businesses staff have verified. Never used for anything else. */
export const BUSINESS_GOLD = '#D4A017';

export type IdentitySource = {
  full_name?: string | null;
  avatar_url?: string | null;
  phone?: string | null;
  /** Owner's explicit opt-in to publish the account phone under the business (migration 0068). Absent/false = private. */
  business_phone_public?: boolean | null;
  bio?: string | null;
  verified_at?: string | null;
  active_mode?: string | null;
  /** Legacy (pre-0075). Not an identity source. */
  business_name?: string | null;
  business_description?: string | null;
  /** Legacy (pre-0075). Not an identity source. */
  business_logo_url?: string | null;
  business_banner_url?: string | null;
  business_address?: string | null;
  business_website?: string | null;
  business_hours?: unknown;
  business_categories?: string[] | null;
  social_links?: Record<string, string | null | undefined> | null;
};

const clean = (s: string | null | undefined): string | null => (s && s.trim() !== '' ? s.trim() : null);

function hoursSet(h: unknown): boolean {
  if (!h || typeof h !== 'object') return false;
  const days = (h as { days?: unknown }).days;
  return !!days && typeof days === 'object' && Object.keys(days as object).length > 0;
}

/**
 * Whether this account has any business-specific content to show. It is NOT a gate on Business mode (every account may switch to it)
 * and it is not an identity: it only decides whether another person sees a business section under the shared header. A legacy
 * business_name / logo counts as evidence of an existing business so old accounts do not lose their section.
 */
export function hasBusinessDetails(p: IdentitySource | null | undefined): boolean {
  if (!p) return false;
  return !!(
    clean(p.business_description) ||
    clean(p.business_banner_url) ||
    clean(p.business_address) ||
    clean(p.business_website) ||
    (p.business_categories && p.business_categories.length > 0) ||
    hoursSet(p.business_hours) ||
    (p.social_links && Object.values(p.social_links).some((v) => !!clean(v ?? null))) ||
    clean(p.business_name) ||
    clean(p.business_logo_url)
  );
}

/**
 * The presentation currently shown for this account. The column is authoritative once migration 0064 exists. When it is absent
 * (database without 0064) an account that already has business content keeps showing it, which is also what 0064's backfill does.
 */
export function activeMode(p: IdentitySource | null | undefined): ProfileMode {
  if (!p) return 'personal';
  if (p.active_mode === 'personal' || p.active_mode === 'business') return p.active_mode;
  return hasBusinessDetails(p) ? 'business' : 'personal';
}

/**
 * Whether to show the Personal/Business switch. A new account has no business yet, so it sees a "Create your business dashboard" entry
 * instead; the switch appears once business details are saved (or the account is already in business mode).
 */
export function showModeSwitch(p: IdentitySource | null | undefined): boolean {
  return !!p && (hasBusinessDetails(p) || p.active_mode === 'business');
}

export type VerificationKind = 'none' | 'personal';

export type ProfileIdentity = {
  mode: ProfileMode;
  /** The ONE name and photo of the account, in both modes. */
  name: string | null;
  avatarUrl: string | null;
  bio: string | null;
  /** Business mode only: the cover shown behind the shared avatar and name. Null in personal mode, whatever is stored. */
  bannerUrl: string | null;
  /** The account's blue check (profiles.verified_at). The gold business badge is separate and comes from the staff-verified storefront. */
  verification: VerificationKind;
  /** Staff-verified storefront (public_storefronts.verified), never derived from uploads. Only meaningful in business mode. */
  businessVerified: boolean;
};

/** `businessVerified` must come from the staff-verified storefront (public_storefronts.verified), never from uploads. */
export function resolveIdentity(p: IdentitySource, opts: { businessVerified?: boolean } = {}): ProfileIdentity {
  const mode = activeMode(p);
  return {
    mode,
    name: clean(p.full_name),
    avatarUrl: clean(p.avatar_url),
    bio: clean(p.bio),
    bannerUrl: mode === 'business' ? clean(p.business_banner_url) : null,
    verification: p.verified_at ? 'personal' : 'none',
    businessVerified: mode === 'business' && opts.businessVerified === true,
  };
}

/**
 * The stable account identity: the personal name and photo, whatever mode the owner is in. Used wherever the person
 * (not a storefront) is the subject: chat lists and headers, offers, reviews, followers, blocked lists. Switching modes must
 * never make the same account look like someone else in an open conversation or in message history.
 */
export function accountPerson(p: IdentitySource | null | undefined): { name: string | null; avatarUrl: string | null } {
  if (!p) return { name: null, avatarUrl: null };
  return { name: clean(p.full_name), avatarUrl: clean(p.avatar_url) };
}

/**
 * Whether the account phone may be shown on the business profile and on business-branded listings. Off until the owner turns it on
 * (profiles.business_phone_public, migration 0068); having a phone on the account is never consent to publish it under a business.
 */
export function businessPhone(p: IdentitySource | null | undefined): string | null {
  return p?.business_phone_public === true ? clean(p.phone) : null;
}

/** A listing's `seller_presentation` column. Anything unknown (including a database without migration 0068) means personal. */
export function listingPresentation(raw: unknown): ProfileMode {
  return raw === 'business' ? 'business' : 'personal';
}

export type ListingSellerPresentation = {
  mode: ProfileMode;
  name: string | null;
  avatarUrl: string | null;
  /** Account phone, only where the presentation allows publishing it. */
  phone: string | null;
  /** Always null since 0075: the business has no separate name to disclose the owner behind. Kept so callers need not change. */
  ownerName: string | null;
};

/**
 * How one listing presents its seller. Stored per listing (listings.seller_presentation) at publish time from the owner's mode, NOT
 * re-read from the current mode: flipping the mode switch must not rewrite listings that are already published.
 */
export function presentListingSeller(p: IdentitySource, presentedAs: unknown): ListingSellerPresentation {
  // One identity: the name and photo are the account's in both presentations. The presentation only decides which phone rule applies.
  const mode: ProfileMode = listingPresentation(presentedAs);
  // A business-presented listing never publishes the account phone unless the owner opted in (business_phone_public).
  return { mode, name: clean(p.full_name), avatarUrl: clean(p.avatar_url), phone: mode === 'business' ? businessPhone(p) : clean(p.phone), ownerName: null };
}

/**
 * How a queued bulk-import row is presented. The choice is written into the row's payload when the batch is created, so a batch
 * publishes with ONE presentation even if the owner switches mode while the photos are still being processed. Rows queued by an
 * older build carry no choice and use the fallback (the owner's mode when the row is published, which was the previous behaviour).
 */
export function rowPresentation(payload: Record<string, unknown> | null | undefined, fallback: ProfileMode): ProfileMode {
  const raw = payload?.sellerPresentation;
  return raw === 'business' || raw === 'personal' ? raw : fallback;
}
