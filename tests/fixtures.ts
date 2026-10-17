import { LocNode, buildIndex } from '../lib/locationTree';
import { DiscoveryTab, FeedListing, PriceOrder } from '../lib/homeFeed';

export const node = (id: string, name: string, kind: LocNode['kind'], parentId: string | null, over: Partial<LocNode> = {}): LocNode => ({
  id,
  kind,
  name,
  nameSo: null,
  nameAm: null,
  parentId,
  iso2: null,
  currencyCodes: null,
  defaultCurrency: null,
  aliases: [],
  isFeatured: false,
  isAppRegion: false,
  ...over,
});

// Ethiopia → Tigray → (Mekelle, Adigrat) · Somali Region → (Jigjiga) ; Somalia → South West State → (Baidoa, Barawe) ; Kenya (no places)
export const index = buildIndex([
  node('et', 'Ethiopia', 'country', null),
  node('tg', 'Tigray', 'region', 'et'),
  node('mk', 'Mekelle', 'city', 'tg'),
  node('ad', 'Adigrat', 'city', 'tg'),
  node('sr', 'Somali Region', 'region', 'et'),
  node('jj', 'Jigjiga', 'city', 'sr'),
  node('so', 'Somalia', 'country', null),
  node('sw', 'South West State', 'region', 'so'),
  node('bd', 'Baidoa', 'city', 'sw'),
  node('br', 'Barawe', 'city', 'sw'),
  node('ke', 'Kenya', 'country', null),
]);

let n = 0;
export function listing(over: Partial<FeedListing> = {}): FeedListing {
  n += 1;
  return { id: `l${String(n).padStart(3, '0')}`, price: 100, currency: 'ETB', category: 'phones', city: 'Mekelle', createdAt: 1_000_000 + n, views: 0, favoritesCount: 0, ...over };
}

export const NOW = 10_000_000_000;
export const baseInput = {
  index,
  scopeId: null as string | null,
  category: null as { id: string; name: string } | null,
  tab: 'For You' as DiscoveryTab,
  priceOrder: 'asc' as PriceOrder,
  currency: null as string | null,
  priceDropAt: {} as Record<string, number>,
  homePlaceId: null as string | null,
  now: NOW,
};
