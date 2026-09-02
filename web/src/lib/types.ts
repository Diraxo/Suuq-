// Mirrors types/index.ts from the SUUQIYE mobile app — kept in sync so the
// service layer (src/services) can swap mock data for real Supabase rows in
// Phase 2 without changing the shape components render.

// Mirrors the `profiles` table columns actually used by the web app (a
// subset of types/index.ts's mobile Profile — business/verification fields
// aren't rendered anywhere in the Phase 1 web UI yet).
export type AccountStatus = 'active' | 'suspended';

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  language: string | null;
  created_at: string;
  account_status: AccountStatus;
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
};

export type ListingStatus = 'available' | 'reserved' | 'sold' | 'expired' | 'removed';

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
  withUser: Pick<Seller, 'id' | 'name' | 'avatar'> & { phone: string | null; lastSeenAt: string | null };
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
  messages: Message[];
};

export type NotifType = 'favorite' | 'follow' | 'message' | 'offer' | 'listing' | 'system';

export type Notif = {
  id: string;
  type: NotifType;
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
  listingsCount: number;
};
