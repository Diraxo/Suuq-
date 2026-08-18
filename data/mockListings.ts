import { Listing, Seller, Conversation } from '@/types';

const placeholderImg = (seed: string, w = 600, h = 600) => `https://picsum.photos/seed/${seed}/${w}/${h}`;

export const mockSellers: Seller[] = [
  {
    id: 's1',
    name: 'Ahmed Warsame',
    avatar: placeholderImg('ahmed', 200, 200),
    city: 'Hargeisa',
    memberSince: 'Jan 2025',
    rating: 4.8,
    reviewCount: 34,
    responseTime: 'within an hour',
    verified: true,
    level: 'trusted',
    listingsCount: 12,
    soldCount: 28,
    followers: 156,
    phone: '+252634000001',
  },
  {
    id: 's2',
    name: 'Hodan Ali',
    avatar: placeholderImg('hodan', 200, 200),
    city: 'Jigjiga',
    memberSince: 'Mar 2025',
    rating: 4.6,
    reviewCount: 19,
    responseTime: 'within a few hours',
    verified: true,
    level: 'silver',
    listingsCount: 6,
    soldCount: 11,
    followers: 48,
    phone: '+252634000002',
  },
  {
    id: 's3',
    name: 'Bilal Auto Parts',
    avatar: placeholderImg('bilal', 200, 200),
    city: 'Addis Ababa',
    memberSince: 'Aug 2024',
    rating: 4.9,
    reviewCount: 112,
    responseTime: 'within 30 minutes',
    verified: true,
    level: 'gold',
    listingsCount: 47,
    soldCount: 203,
    followers: 892,
    phone: '+251911000003',
  },
];

// Demo catalogue intentionally emptied — the app now runs entirely on real
// Supabase listings (see store/listings.ts). Kept as a typed empty array
// rather than removed outright so resolveListing/resolveAllListings and the
// screens that still import it don't need special-casing for its absence.
export const mockListings: Listing[] = [];

export const mockConversations: Conversation[] = [];
