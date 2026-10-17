export type WeekDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type DayHours = { closed: boolean; open: string; close: string };

/** Structured per-day schedule, stored in the `business_hours` jsonb column. `note` is kept only so pre-migration free-text rows don't crash old code paths reading it — new writes always use `days`. */
export type BusinessHours = { days?: Partial<Record<WeekDay, DayHours>>; note?: string };

export type SocialLinks = Partial<Record<'facebook' | 'instagram' | 'telegram' | 'tiktok' | 'whatsapp', string>>;

export type Profile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  /** R2 object key for avatar_url, used to clean up the asset when it's replaced. Null for pre-migration rows (an old Cloudinary avatar) or non-uploaded avatars (e.g. Google-seeded). */
  avatar_public_id: string | null;
  email: string | null;
  phone: string | null;
  /** Dial-code country matching `phone` (see data/phoneCountries.ts) — lets Edit Profile pre-fill the country selector instead of re-parsing the number. */
  phone_country: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  gender: string | null;
  birthday: string | null;
  bio: string | null;
  business_name: string | null;
  business_description: string | null;
  business_address: string | null;
  business_website: string | null;
  business_hours: BusinessHours;
  business_logo_url: string | null;
  business_banner_url: string | null;
  /** R2 object keys for business_logo_url/business_banner_url, used to clean up each asset when it's replaced. */
  business_logo_public_id: string | null;
  business_banner_public_id: string | null;
  delivery_available: boolean;
  social_links: SocialLinks;
  /** Account-level UI language ('en' | 'so' | 'am'). Null means the user has
   * never explicitly set one for this account yet — see store/language.ts. */
  language: string | null;
  /** Set only by staff (admin_set_verified). Null = not verified. Never auto-granted. */
  verified_at?: string | null;
  /** 'active' | 'suspended' | 'banned'. Written only by staff (server-enforced). */
  account_status?: 'active' | 'suspended' | 'banned';
  /** End of a temporary suspension; in the past means it is already over. */
  suspended_until?: string | null;
  created_at: string;
  updated_at: string;
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
  /** Private — only ever used to launch the phone dialer via the Call button, never rendered. */
  phone?: string;
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
  /** R2 object keys, index-aligned with `images`, used to clean up removed/replaced photos. Absent for mock/static listings and pre-migration rows (an old Cloudinary photo — no longer cleaned up automatically, since there's no Cloudinary credential left to delete it with). */
  imagePublicIds?: string[];
  description: string;
  postedAt: string;
  /** Real creation timestamp (ms since epoch) for listings published in this session — used to compute a live relative time. Absent on static mock listings, which fall back to `postedAt`. */
  createdAt?: number;
  /** Real last-updated timestamp (ms since epoch). Absent on static mock listings. */
  updatedAt?: number;
  /** When status last became 'sold' (ms since epoch) — set once, unaffected by later edits. Absent unless status is 'sold'. Use this (not updatedAt) for sales analytics. */
  soldAt?: number;
  status: ListingStatus;
  seller: Seller;
  views: number;
  favoritesCount: number;
  /** Category-specific fields (e.g. vehicle Brand/Model, phone RAM/Storage), keyed by field id. Empty/absent for categories with no extra fields. */
  attributes?: Record<string, string>;
  /** The subcategory chosen at posting time (e.g. "Bajaj", "Laptops") — determines which attribute field set/labels apply. Absent for categories with no subcategories. */
  subcategory?: string;
  /** Checklist of category-specific highlights the seller selected (e.g. "Face ID", "Reverse camera"). Absent for categories with no feature list. */
  features?: string[];
  /** Short scannable highlights the seller called out, one per line (e.g. "Battery health 90%"), distinct from the free-form description. */
  sellerNotes?: string[];
  /** Search results only: a staff-granted boost is live right now. */
  boosted?: boolean;
  /** Search results only: price was lowered within the last 14 days and is still below the old price. */
  priceReduced?: boolean;
};

export type Subcategory = {
  name: string;
  icon: string;
};

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
  seen: boolean;
};

export type Conversation = {
  id: string;
  listing: Pick<Listing, 'id' | 'title' | 'price' | 'currency' | 'images'>;
  withUser: Pick<Seller, 'id' | 'name' | 'avatar'>;
  lastMessage: string;
  lastMessageAt: string;
  unread: number;
};
