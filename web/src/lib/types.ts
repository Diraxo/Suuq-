// Mirrors types/index.ts from the SUUQIYE mobile app — kept in sync so the
// service layer (src/services) can swap mock data for real Supabase rows in
// Phase 2 without changing the shape components render.

// Mirrors the `profiles` table columns actually used by the web app (a
// subset of types/index.ts's mobile Profile — business/verification fields
// aren't rendered anywhere in the Phase 1 web UI yet).
import type { HoursDays, SocialLinks } from './profileRules';

export type AccountStatus = 'active' | 'suspended' | 'banned';

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** R2 object key for avatar_url (null for Google-seeded / legacy avatars); used to delete the old file on replace/remove. */
  avatar_public_id?: string | null;
  email: string | null;
  phone: string | null;
  /** Dial-code country matching `phone` ('ET' | 'SO'), same as mobile. */
  phone_country?: string | null;
  city: string | null;
  region?: string | null;
  gender?: string | null;
  birthday?: string | null;
  bio?: string | null;
  /** Which identity other people see (migration 0064). Absent until that migration is applied. */
  active_mode?: 'personal' | 'business';
  business_name?: string | null;
  /** Marketplace category ids, up to 5 (migration 0067). Absent until that migration is applied. */
  business_categories?: string[] | null;
  /** Owner's opt-in to publish the account phone under the business (migration 0068). Absent/false = private. */
  business_phone_public?: boolean;
  business_description?: string | null;
  business_address?: string | null;
  business_website?: string | null;
  business_hours?: { days?: HoursDays } | null;
  business_logo_url?: string | null;
  business_banner_url?: string | null;
  business_logo_public_id?: string | null;
  business_banner_public_id?: string | null;
  delivery_available?: boolean | null;
  social_links?: SocialLinks | null;
  language: string | null;
  /** Set only by staff (admin_set_verified). Null = not verified. */
  verified_at?: string | null;
  created_at: string;
  account_status: AccountStatus;
  /** End of a temporary suspension (null = none). An end date in the past means the suspension is over. */
  suspended_until?: string | null;
};

export type SellerLevel = 'new' | 'trusted' | 'silver' | 'gold' | 'platinum';

export type Seller = {
  id: string;
  name: string;
  avatar: string;
  city: string;
  memberSince: string;
  rating: number;
  reviewCount: number;
  responseTime: string;
  verified: boolean;
  level: SellerLevel;
  listingsCount: number;
  soldCount: number;
  followers: number;
  phone?: string;
  /** How this listing presents its seller (its own explicit choice, listings.seller_presentation). */
  presentedAs?: 'personal' | 'business';
  /** For a business-branded listing: the account holder behind it, so the owner stays visible. */
  ownerName?: string;
};

export type ListingStatus = 'available' | 'reserved' | 'sold' | 'expired' | 'removed' | 'deactivated';

export type Listing = {
  id: string;
  title: string;
  price: number;
  currency: string;
  negotiable: boolean;
  condition: 'new' | 'like-new' | 'used' | 'for-parts';
  category: string;
  city: string;
  region: string;
  images: string[];
  /** R2 object keys parallel to images (may be absent/shorter for legacy rows). */
  imagePublicIds?: string[];
  description: string;
  postedLabel: string;
  createdAt: number;
  updatedAt: number;
  status: ListingStatus;
  seller: Seller;
  views: number;
  favoritesCount: number;
  attributes?: Record<string, string>;
  subcategory?: string;
  features?: string[];
  sellerNotes?: string[];
  /** Search results only: a staff-granted boost is live right now. */
  boosted?: boolean;
  /** Search results only: price lowered within the last 14 days and still below the old price. */
  priceReduced?: boolean;
};

export type Subcategory = { name: string; icon: string };

export type Category = {
  id: string;
  name: string;
  icon: string;
  subcategories?: Subcategory[];
};

export type Message = {
  id: string;
  conversationId: string;
  fromMe: boolean;
  text: string;
  sentAt: string;
};

export type Conversation = {
  id: string;
  buyerId: string;
  sellerId: string;
  listing: Pick<Listing, 'id' | 'title' | 'price' | 'currency' | 'images'>;
  /** True when the listing row isn't visible to the viewer (removed or hidden by a block); `listing` then holds placeholders. */
  listingUnavailable?: boolean;
  withUser: Pick<Seller, 'id' | 'name' | 'avatar'> & { lastSeenAt: string | null };
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  messages: Message[];
};

export type NotifType = 'favorite' | 'follow' | 'message' | 'offer' | 'listing' | 'system' | 'moderation' | 'verification' | 'report';

export type Notif = {
  id: string;
  type: NotifType;
  /** Raw notifications.type (e.g. 'offer_new', 'verification') - drives the click destination. */
  rawType: string | null;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  /** Raw `notifications.data` jsonb (e.g. {listingId} / {conversationId}) — kept for future click-to-navigate wiring. */
  data?: Record<string, unknown>;
};

export type OfferStatus = 'pending' | 'accepted' | 'rejected' | 'countered' | 'cancelled' | 'expired' | 'sold';

export type Offer = {
  id: string;
  listingId: string;
  buyerId: string;
  sellerId: string;
  fromUserId: string;
  amount: number;
  message: string | null;
  status: OfferStatus;
  createdAt: string;
};

export type Review = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  reviewer: { id: string; name: string; avatar: string };
};

// ---------------------------------------------------------------------------
// Admin dashboard (Phase 1) — see supabase/migrations/0027_admin_foundation.sql
// ---------------------------------------------------------------------------
export type ReportTargetType = 'listing' | 'user' | 'review';
export type ReportStatus = 'pending' | 'reviewing' | 'reviewed' | 'dismissed';

export type AdminReport = {
  id: string;
  reporterId: string;
  reporterName: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: string;
  details: string | null;
  status: ReportStatus;
  createdAt: string;
};

export type ModerationWarning = {
  id: string;
  userId: string;
  adminId: string;
  adminName: string;
  reason: string;
  note: string | null;
  createdAt: string;
};

export type AdminAuditLogEntry = {
  id: string;
  adminId: string;
  adminName: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
};

export type AdminUserSummary = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  city: string | null;
  created_at: string;
  account_status: AccountStatus;
  suspended_until?: string | null;
  verified_at?: string | null;
  listingsCount: number;
};
