import { Listing } from '@/types';

// Ranks candidates against a primary listing using the fields a buyer
// actually cares about when judging "similar": same subcategory/brand/model
// count for more than a same-ish price, and price closeness is measured as a
// fraction of the primary's own price rather than a fixed dollar amount so it
// scales sensibly from a $5 phone case to a $20,000 car. Shared by the
// Compare screen and the listing detail page's market-price estimate.
export function similarityScore(primary: Listing, candidate: Listing): number {
  let score = 0;
  if (primary.subcategory && candidate.subcategory === primary.subcategory) score += 40;

  const primaryBrand = primary.attributes?.brand?.trim().toLowerCase();
  const candidateBrand = candidate.attributes?.brand?.trim().toLowerCase();
  if (primaryBrand && primaryBrand === candidateBrand) score += 30;

  const primaryModel = primary.attributes?.model?.trim().toLowerCase();
  const candidateModel = candidate.attributes?.model?.trim().toLowerCase();
  if (primaryModel && primaryModel === candidateModel) score += 20;

  if (candidate.condition === primary.condition) score += 10;
  if (primary.city && candidate.city === primary.city) score += 10;

  const priceBand = Math.max(primary.price * 0.5, 1);
  const priceDelta = Math.abs(candidate.price - primary.price);
  score += Math.max(0, 30 - (priceDelta / priceBand) * 30);

  return score;
}

/** Same-category, available candidates ranked by similarity — highest first. */
export function findSimilarListings(primary: Listing, allListings: Listing[], limit = 10): Listing[] {
  return allListings
    .filter((l) => l.id !== primary.id && l.category === primary.category && l.status === 'available')
    .map((listing) => ({ listing, score: similarityScore(primary, listing) }))
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : (b.listing.createdAt ?? 0) - (a.listing.createdAt ?? 0)))
    .slice(0, limit)
    .map((s) => s.listing);
}

export type MarketPriceStats = {
  sampleSize: number;
  /** True once the sample is large enough that `average` is worth showing as a number. */
  trusted: boolean;
  /** Only set when `trusted` is true — showing a computed average off a handful of listings would be misleading. */
  average?: number;
  /** Positive when the listing is priced below the comparable average — the "good deal" case. Undefined otherwise. */
  savingsPercent?: number;
  savingsAmount?: number;
};

const MIN_COMPARABLE_SCORE = 40; // at least a subcategory (or equivalent) match — weak/no-signal candidates would make the average meaningless
const MIN_TRUSTED_SAMPLE_SIZE = 5; // below this, a numeric "average" reads as more confident than the data supports — show the count instead

/** Average price across closely comparable, available listings. Returns null when there are no comparable listings at all; returns an untrusted (no `average`) result when there are some but too few to average honestly. */
export function getMarketPriceStats(listing: Listing, allListings: Listing[]): MarketPriceStats | null {
  const comparable = allListings
    .filter((l) => l.id !== listing.id && l.category === listing.category && l.status === 'available')
    .map((candidate) => ({ candidate, score: similarityScore(listing, candidate) }))
    .filter((s) => s.score >= MIN_COMPARABLE_SCORE);

  if (comparable.length === 0) return null;
  if (comparable.length < MIN_TRUSTED_SAMPLE_SIZE) return { sampleSize: comparable.length, trusted: false };

  const average = comparable.reduce((sum, s) => sum + s.candidate.price, 0) / comparable.length;
  const stats: MarketPriceStats = { sampleSize: comparable.length, trusted: true, average: Math.round(average) };

  if (listing.price < average) {
    stats.savingsAmount = Math.round(average - listing.price);
    stats.savingsPercent = Math.round(((average - listing.price) / average) * 100);
  }

  return stats;
}
