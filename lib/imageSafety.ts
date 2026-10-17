// Listing-photo safety decisions — pure TypeScript (no React Native, Deno or node APIs) so the exact same
// code runs in the image-scan Worker (the trusted decision), the app (to render results and cache scans)
// and the node test suite (tests/imageSafety.test.ts).
//
// What this is: a POLICY layer. It turns raw provider evidence (SafeSearch likelihoods, labels, objects, OCR
// text, perceptual hashes, optional image-text similarity) into one verdict per image and one consolidated
// result per listing. It never calls a provider and never decides from a single weak signal: every
// "reject" needs strong evidence, every ambiguous case becomes "review", and a provider failure is never
// silently treated as "safe".
//
// What it is not: a classifier. Its accuracy is exactly the accuracy of the evidence it is fed. The
// thresholds below are starting values to be tuned against a labelled test set before launch.

// ───────────────────────────── evidence types ─────────────────────────────

export type Likelihood = 'UNKNOWN' | 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';

export type ProviderSignals = {
  safeSearch?: { adult: Likelihood; violence: Likelihood; racy: Likelihood; medical?: Likelihood; spoof?: Likelihood };
  labels: { name: string; score: number }[];
  /** Localised objects; `area` is the fraction (0–1) of the image the box covers when known. */
  objects?: { name: string; score: number; area?: number }[];
  /** Full OCR text of the image ('' when none was found). */
  text: string;
  /** Optional image-text similarity: probability the image belongs to each category id (sums to ~1). */
  categoryProbs?: Record<string, number>;
};

export type DuplicateMatch = {
  /** Hamming distance between 64-bit perceptual hashes (0 = identical). */
  distance: number;
  /** True when the matching image belongs to the same user (relisting is fine). */
  sameOwner: boolean;
};

export type ImageEvidence = {
  index: number;
  /** Set when the provider timed out / errored for this image — it must never be treated as safe. */
  providerFailed?: boolean;
  signals?: ProviderSignals;
  /** Matches against OTHER listings' images (never this batch). */
  duplicates?: DuplicateMatch[];
  /** Index of an earlier image in THIS batch that is a near-duplicate of this one. */
  batchDuplicateOf?: number;
};

export type ListingContext = {
  categoryId: string;
  /** Human category name used in user-facing text (already localised by the caller). */
  categoryLabel: string;
  title: string;
  description?: string;
  /** How many near-duplicate matches this user has hit recently — repeated abuse is flagged for staff. */
  recentDuplicateHits?: number;
};

// ───────────────────────────── result types ─────────────────────────────

export type IssueCode =
  | 'watermark_own'
  | 'watermark_other'
  | 'watermark_uncertain'
  | 'duplicate_listing'
  | 'duplicate_in_batch'
  | 'prohibited_content'
  | 'weapon'
  | 'weapon_uncertain'
  | 'content_uncertain'
  | 'category_mismatch'
  | 'category_uncertain'
  | 'check_failed';

/** pass = fine · review = a human should look (listing is held, never publicly visible meanwhile) · reject = seller must replace the photo. */
export type Verdict = 'pass' | 'review' | 'reject';

export type ImageResult = {
  index: number;
  verdict: Verdict;
  issues: IssueCode[];
  /** Internal numbers for staff only (never sent to the seller). */
  internal: Record<string, number | string | boolean>;
};

export type BatchOutcome = 'approved' | 'needs_changes' | 'pending_review';

export type ConsolidatedIssue = {
  code: IssueCode;
  /** Zero-based indexes of the affected photos. */
  indexes: number[];
  /** i18n key (imageScan.issue.<code>) — the client supplies category name via {{category}}. */
  messageKey: string;
  /** reject → seller must fix; review → informational ("we'll take a look"). */
  severity: 'fix' | 'review';
};

export type BatchResult = {
  outcome: BatchOutcome;
  images: ImageResult[];
  issues: ConsolidatedIssue[];
  /** True when the only problem is a failed/timed-out check — offer "Try again". */
  canRetry: boolean;
  /** Raise a staff flag (repeated duplicate abuse, possible weapon/explicit imagery pending review). */
  flagForStaff: boolean;
};

// ───────────────────────────── policy (tunable) ─────────────────────────────

export const POLICY = {
  /** Hamming distance (of 64) at or below which two images are treated as the same photo. */
  duplicateMaxDistance: 6,
  /** Distance at or below which a within-batch pair is the same photo. */
  batchDuplicateMaxDistance: 4,
  /** Weapon label/object confidence: ≥ reject (outside toy/sports context), ≥ review otherwise. */
  weaponReject: 0.85,
  weaponReview: 0.6,
  /** Relevance evidence needed to call a photo "on topic" for the chosen category. */
  relevanceOk: 0.45,
  /** A different category must be this strong, and the chosen one this weak, to call a mismatch. */
  mismatchOther: 0.8,
  mismatchOwnMax: 0.3,
  categoryProbMismatch: 0.7,
  /** Repeated near-duplicate hits before staff are flagged. */
  duplicateAbuseHits: 3,
} as const;

const LEVEL: Record<Likelihood, number> = { UNKNOWN: 0, VERY_UNLIKELY: 1, UNLIKELY: 2, POSSIBLE: 3, LIKELY: 4, VERY_LIKELY: 5 };
const atLeast = (l: Likelihood | undefined, min: Likelihood) => (l ? LEVEL[l] >= LEVEL[min] : false);

// ───────────────────────────── watermark text ─────────────────────────────

const own = (s: string) => /suuq\s*iye|suuq\s*plus|suuq\s*\+/.test(s);

// Other marketplaces whose watermark a re-used photo might carry. Plain product/packaging mentions of big
// retailers are common, so a SINGLE mention is only "uncertain"; repeated or URL-shaped mentions are strong.
const OTHER_MARKETS = ['jiji', 'olx', 'ebay', 'alibaba', 'aliexpress', 'amazon', 'craigslist', 'carousell', 'mercari', 'dubizzle', 'opensooq', 'avito', 'kupatana', 'facebook marketplace', 'marketplace', 'fursad'];

export type WatermarkReading = { kind: 'none' | 'own' | 'other' | 'uncertain'; matches: number };

export function readWatermarkText(rawText: string): WatermarkReading {
  const text = (rawText || '').toLowerCase().replace(/\s+/g, ' ');
  if (!text.trim()) return { kind: 'none', matches: 0 };
  if (own(text)) return { kind: 'own', matches: (text.match(/suuq\s*iye|suuq\s*plus|suuq\s*\+/g) ?? []).length };
  let matches = 0;
  let urlShaped = false;
  for (const m of OTHER_MARKETS) {
    const re = new RegExp(m.replace(/ /g, '\\s'), 'g');
    const found = text.match(re);
    if (found) {
      matches += found.length;
      if (new RegExp(`${m.replace(/ /g, '\\s')}[\\w.-]*\\.(com|net|so|et|co|org)`).test(text)) urlShaped = true;
    }
  }
  if (matches === 0) return { kind: 'none', matches: 0 };
  return { kind: matches >= 2 || urlShaped ? 'other' : 'uncertain', matches };
}

// ───────────────────────────── category policy ─────────────────────────────

type CategoryPolicy = {
  /** Keywords that, found in a label/object name, show a photo is on topic. */
  keywords: string[];
  /** Photos here legitimately show anything (services, jobs, business…): never rejected for mismatch. */
  lenient?: boolean;
};

// Keys are the real category ids from data/categories.ts. Keywords are lowercase substrings of provider
// label/object names. Deliberately generous: a wrong "mismatch" costs a seller more than a missed one.
export const CATEGORY_POLICY: Record<string, CategoryPolicy> = {
  vehicles: { keywords: ['car', 'vehicle', 'truck', 'bus', 'van', 'motorcycle', 'motorbike', 'bike', 'scooter', 'wheel', 'tire', 'tyre', 'engine', 'automotive', 'suv', 'pickup', 'bajaj', 'tuk', 'steering', 'dashboard', 'license plate', 'auto part', 'bumper', 'headlight', 'trailer', 'tractor'] },
  phones: { keywords: ['phone', 'mobile', 'smartphone', 'iphone', 'telephone', 'tablet', 'gadget', 'cellular', 'communication device', 'screen', 'charger', 'earphone', 'headphone', 'case'] },
  electronics: { keywords: ['electronic', 'computer', 'laptop', 'monitor', 'television', 'tv', 'camera', 'speaker', 'console', 'keyboard', 'router', 'printer', 'gadget', 'device', 'tablet', 'headphone', 'battery', 'cable', 'appliance', 'screen', 'drone', 'watch', 'netbook', 'display'] },
  fashion: { keywords: ['clothing', 'clothes', 'shoe', 'footwear', 'sneaker', 'dress', 'shirt', 'trousers', 'jeans', 'jacket', 'coat', 'bag', 'handbag', 'fashion', 'sandal', 'boot', 'hat', 'scarf', 'abaya', 'sleeve', 'textile', 'apparel', 'watch', 'jewel', 'sunglasses', 'suit', 'skirt', 'fabric', 'outerwear'] },
  property: { keywords: ['house', 'building', 'home', 'apartment', 'property', 'real estate', 'land', 'plot', 'room', 'roof', 'villa', 'architecture', 'field', 'grass', 'sky', 'yard', 'garden', 'door', 'window', 'floor', 'ceiling', 'kitchen', 'bedroom', 'bathroom', 'wall', 'fence', 'shop', 'office', 'condominium', 'neighbourhood', 'neighborhood', 'residential', 'terrain', 'soil', 'hill', 'tree', 'road', 'cityscape', 'tower', 'interior'] },
  jobs: { keywords: [], lenient: true },
  services: { keywords: [], lenient: true },
  animals: { keywords: ['animal', 'dog', 'cat', 'bird', 'livestock', 'cattle', 'cow', 'goat', 'sheep', 'camel', 'horse', 'donkey', 'chicken', 'hen', 'rooster', 'fish', 'pet', 'rabbit', 'mammal', 'puppy', 'kitten', 'poultry', 'pigeon', 'duck', 'turkey'] },
  furniture: { keywords: ['furniture', 'chair', 'table', 'sofa', 'couch', 'bed', 'mattress', 'wardrobe', 'cabinet', 'shelf', 'desk', 'drawer', 'bookcase', 'stool', 'bench', 'cupboard', 'carpet', 'rug', 'curtain', 'lamp', 'room', 'interior', 'living room', 'bedroom'] },
  kitchen: { keywords: ['kitchen', 'cookware', 'pot', 'pan', 'plate', 'dish', 'cutlery', 'utensil', 'appliance', 'blender', 'oven', 'stove', 'fridge', 'refrigerator', 'microwave', 'kettle', 'cup', 'mug', 'tableware', 'bowl', 'spoon', 'fork', 'knife', 'cooker', 'home appliance', 'washing machine', 'freezer'] },
  construction: { keywords: ['tool', 'construction', 'building material', 'cement', 'brick', 'steel', 'pipe', 'drill', 'hammer', 'machine', 'equipment', 'paint', 'tile', 'wood', 'lumber', 'generator', 'ladder', 'concrete', 'crane', 'excavator', 'bulldozer', 'wire', 'metal', 'iron', 'hardware', 'saw', 'roof', 'plank', 'scaffold'] },
  agriculture: { keywords: ['plant', 'crop', 'farm', 'agriculture', 'seed', 'tractor', 'field', 'soil', 'fertilizer', 'irrigation', 'grain', 'vegetable', 'fruit', 'tree', 'harvest', 'livestock', 'animal', 'cattle', 'pump', 'greenhouse', 'leaf', 'flower', 'sack', 'maize', 'wheat', 'tool', 'machine'] },
  beauty: { keywords: ['cosmetic', 'beauty', 'perfume', 'makeup', 'skin care', 'lipstick', 'cream', 'hair', 'bottle', 'fragrance', 'nail', 'brush', 'lotion', 'shampoo', 'soap', 'oil', 'razor', 'shaver', 'wig', 'henna', 'personal care', 'salon', 'comb'] },
  sports: { keywords: ['sport', 'ball', 'fitness', 'gym', 'weight', 'bicycle', 'bike', 'exercise', 'racket', 'equipment', 'jersey', 'shoe', 'helmet', 'glove', 'treadmill', 'dumbbell', 'football', 'basketball', 'tent', 'camping', 'fishing', 'goal', 'skate', 'swim'] },
  books: { keywords: ['book', 'publication', 'text', 'paper', 'novel', 'textbook', 'magazine', 'library', 'notebook', 'stationery', 'pen', 'document', 'font', 'poster', 'study', 'school supply', 'education'] },
  baby: { keywords: ['baby', 'infant', 'toddler', 'child', 'kid', 'toy', 'stroller', 'crib', 'diaper', 'pram', 'bottle', 'cradle', 'play', 'doll', 'clothing', 'car seat', 'high chair', 'nursery'] },
  food: { keywords: ['food', 'fruit', 'vegetable', 'meat', 'bread', 'drink', 'beverage', 'dish', 'meal', 'cuisine', 'ingredient', 'produce', 'snack', 'rice', 'dairy', 'spice', 'honey', 'tea', 'coffee', 'cake', 'sweet', 'grocery', 'bottle', 'packaged', 'can', 'oil', 'flour', 'sugar', 'date', 'nut', 'juice', 'egg', 'fish', 'milk', 'restaurant'] },
  business: { keywords: [], lenient: true },
};

/** Fallback for any category id not listed (new categories stay safe: lenient, never mismatch-rejected). */
const FALLBACK_POLICY: CategoryPolicy = { keywords: [], lenient: true };

const matchesAny = (name: string, keywords: string[]) => {
  const n = name.toLowerCase();
  return keywords.some((k) => n.includes(k));
};

function tokens(s: string): string[] {
  return (s || '').toLowerCase().split(/[^a-z0-9؀-ۿሀ-፿]+/).filter((t) => t.length >= 4);
}

/** Strongest evidence (0–1) that the photo shows something belonging to `categoryId`. */
export function relevanceFor(signals: ProviderSignals, categoryId: string): number {
  const policy = CATEGORY_POLICY[categoryId] ?? FALLBACK_POLICY;
  let best = 0;
  for (const l of signals.labels) if (matchesAny(l.name, policy.keywords)) best = Math.max(best, l.score);
  for (const o of signals.objects ?? []) if (matchesAny(o.name, policy.keywords)) best = Math.max(best, o.score);
  const prob = signals.categoryProbs?.[categoryId];
  if (prob !== undefined) best = Math.max(best, prob);
  return best;
}

// ───────────────────────────── weapons ─────────────────────────────

const WEAPON_WORDS = /\b(gun|firearm|rifle|pistol|handgun|shotgun|revolver|ak-?47|machine gun|assault rifle|ammunition|ammo|bullet|cartridge|magazine \(firearm\)|grenade|explosive|bomb|missile)\b/;
const TOY_WORDS = /\b(toy|water gun|nerf|airsoft|cap gun|plastic|replica|lighter|glue gun|spray gun|nail gun|hot glue|staple|paint)\b/;
/** Categories where a gun-shaped object is plausibly something else (toys, sports gear, tools). */
const WEAPON_AMBIGUOUS_CATEGORIES = new Set(['baby', 'sports', 'construction', 'agriculture']);

function weaponScore(signals: ProviderSignals): { score: number; toy: boolean } {
  let score = 0;
  let toy = false;
  const names = [...signals.labels.map((l) => ({ n: l.name.toLowerCase(), s: l.score })), ...(signals.objects ?? []).map((o) => ({ n: o.name.toLowerCase(), s: o.score }))];
  for (const { n, s } of names) {
    if (WEAPON_WORDS.test(n)) score = Math.max(score, s);
    if (TOY_WORDS.test(n)) toy = true;
  }
  return { score, toy };
}

// ───────────────────────────── per-image decision ─────────────────────────────

export function decideImage(ev: ImageEvidence, ctx: ListingContext): ImageResult {
  const issues: IssueCode[] = [];
  const internal: ImageResult['internal'] = {};
  let verdict: Verdict = 'pass';
  const raise = (v: Verdict) => {
    if (v === 'reject') verdict = 'reject';
    else if (v === 'review' && verdict !== 'reject') verdict = 'review';
  };
  const add = (code: IssueCode, v: Verdict) => {
    if (!issues.includes(code)) issues.push(code);
    raise(v);
  };

  // Provider failure is never "safe": the photo is held, not published.
  if (ev.providerFailed || !ev.signals) {
    add('check_failed', 'review');
    internal.providerFailed = true;
  }

  // Batch duplicate: two identical photos in one listing add nothing — ask for one to be removed.
  if (ev.batchDuplicateOf !== undefined) {
    add('duplicate_in_batch', 'reject');
    internal.batchDuplicateOf = ev.batchDuplicateOf;
  }

  // Cross-listing duplicate: reviewed, never an accusation, never an automatic rejection.
  const foreign = (ev.duplicates ?? []).filter((d) => !d.sameOwner && d.distance <= POLICY.duplicateMaxDistance);
  if (foreign.length) {
    add('duplicate_listing', 'review');
    internal.duplicateMinDistance = Math.min(...foreign.map((d) => d.distance));
    internal.duplicateMatches = foreign.length;
  }

  const s = ev.signals;
  if (s) {
    // ── content safety
    const ss = s.safeSearch;
    if (ss) {
      internal.adult = ss.adult;
      internal.violence = ss.violence;
      internal.racy = ss.racy;
      if (ss.adult === 'VERY_LIKELY' || ss.violence === 'VERY_LIKELY') add('prohibited_content', 'reject');
      else if (atLeast(ss.adult, 'LIKELY') || atLeast(ss.violence, 'LIKELY') || ss.racy === 'VERY_LIKELY') add('content_uncertain', 'review');
    }

    // ── weapons
    const w = weaponScore(s);
    if (w.score > 0) internal.weaponScore = w.score;
    if (w.score >= POLICY.weaponReview) {
      const ambiguous = w.toy || WEAPON_AMBIGUOUS_CATEGORIES.has(ctx.categoryId);
      if (w.score >= POLICY.weaponReject && !ambiguous) add('weapon', 'reject');
      else add('weapon_uncertain', 'review');
    }

    // ── watermark (OCR)
    const wm = readWatermarkText(s.text);
    internal.watermark = wm.kind;
    if (wm.kind === 'own') add('watermark_own', 'reject');
    else if (wm.kind === 'other') add('watermark_other', 'reject');
    else if (wm.kind === 'uncertain') add('watermark_uncertain', 'review');

    // ── category relevance
    const policy = CATEGORY_POLICY[ctx.categoryId] ?? FALLBACK_POLICY;
    if (!policy.lenient) {
      const ownScore = relevanceFor(s, ctx.categoryId);
      // The seller's own words are evidence too: a label that appears in the title/description counts.
      const words = new Set([...tokens(ctx.title), ...tokens(ctx.description ?? '')]);
      const textMatch = [...s.labels, ...(s.objects ?? [])].some((x) => x.score >= 0.5 && tokens(x.name).some((t) => words.has(t)));
      const effectiveOwn = Math.max(ownScore, textMatch ? 0.6 : 0);
      let strongestOther = 0;
      let strongestOtherId = '';
      for (const [id, p] of Object.entries(CATEGORY_POLICY)) {
        if (id === ctx.categoryId || p.lenient) continue;
        const r = relevanceFor({ ...s, categoryProbs: undefined }, id);
        if (r > strongestOther) {
          strongestOther = r;
          strongestOtherId = id;
        }
      }
      const topProb = s.categoryProbs ? Object.entries(s.categoryProbs).sort((a, b) => b[1] - a[1])[0] : undefined;
      const probMismatch = !!topProb && topProb[0] !== ctx.categoryId && !CATEGORY_POLICY[topProb[0]]?.lenient && topProb[1] >= POLICY.categoryProbMismatch && (s.categoryProbs?.[ctx.categoryId] ?? 0) < POLICY.mismatchOwnMax;
      internal.categoryOwn = Number(effectiveOwn.toFixed(2));
      internal.categoryOther = Number(strongestOther.toFixed(2));
      if (strongestOtherId) internal.categoryOtherId = strongestOtherId;

      if (effectiveOwn >= POLICY.relevanceOk) {
        // on topic — nothing to do
      } else if ((strongestOther >= POLICY.mismatchOther && effectiveOwn < POLICY.mismatchOwnMax) || probMismatch) {
        add('category_mismatch', 'reject');
      } else {
        add('category_uncertain', 'review');
      }
    }
  }

  return { index: ev.index, verdict, issues, internal };
}

// ───────────────────────────── batch decision ─────────────────────────────

const SEVERITY: Record<IssueCode, 'fix' | 'review'> = {
  watermark_own: 'fix',
  watermark_other: 'fix',
  watermark_uncertain: 'review',
  duplicate_listing: 'review',
  duplicate_in_batch: 'fix',
  prohibited_content: 'fix',
  weapon: 'fix',
  weapon_uncertain: 'review',
  content_uncertain: 'review',
  category_mismatch: 'fix',
  category_uncertain: 'review',
  check_failed: 'review',
};

/**
 * One consolidated result for the whole 1–8 photo listing. Every issue of every photo is reported in one
 * pass (the seller never fixes the same kind of problem twice); each distinct issue lists the photos it
 * affects.
 */
export function decideBatch(evidence: ImageEvidence[], ctx: ListingContext): BatchResult {
  if (evidence.length < 1 || evidence.length > 8) {
    throw new RangeError('A listing needs 1–8 photos');
  }
  const images = evidence.map((e) => decideImage(e, ctx));
  const byCode = new Map<IssueCode, number[]>();
  for (const img of images) for (const code of img.issues) byCode.set(code, [...(byCode.get(code) ?? []), img.index]);

  const issues: ConsolidatedIssue[] = [...byCode.entries()]
    .map(([code, indexes]) => ({ code, indexes, messageKey: `imageScan.issue.${code}`, severity: SEVERITY[code] }))
    .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'fix' ? -1 : 1));

  const anyReject = images.some((i) => i.verdict === 'reject');
  const anyReview = images.some((i) => i.verdict === 'review');
  const outcome: BatchOutcome = anyReject ? 'needs_changes' : anyReview ? 'pending_review' : 'approved';

  const onlyFailed = anyReview && !anyReject && images.every((i) => i.verdict === 'pass' || i.issues.every((c) => c === 'check_failed'));
  const flagForStaff =
    (ctx.recentDuplicateHits ?? 0) >= POLICY.duplicateAbuseHits ||
    images.some((i) => i.issues.some((c) => c === 'weapon_uncertain' || c === 'content_uncertain' || c === 'prohibited_content' || c === 'weapon'));

  return { outcome, images, issues, canRetry: onlyFailed, flagForStaff };
}

// ───────────────────────────── perceptual hash ─────────────────────────────

/** Luma (0–255) from RGBA pixels. */
export function grayFromRgba(rgba: Uint8Array | Uint8ClampedArray, pixelCount: number): Uint8Array {
  const g = new Uint8Array(pixelCount);
  for (let i = 0; i < pixelCount; i++) g[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
  return g;
}

/**
 * 64-bit difference hash from a 9×8 grayscale thumbnail (row-major, 72 bytes): bit = left pixel brighter
 * than its right neighbour. Robust to resizing and recompression, weak to rotation, heavy crops and overlays
 * — which is why a match only ever leads to review, never to an accusation.
 */
export function dhash(gray9x8: ArrayLike<number>): string {
  if (gray9x8.length !== 72) throw new RangeError('dhash needs a 9x8 grayscale thumbnail (72 values)');
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (gray9x8[row * 9 + col] > gray9x8[row * 9 + col + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

const POP = Array.from({ length: 16 }, (_, n) => [0, 1, 2, 3].reduce((c, b) => c + ((n >> b) & 1), 0));

/** Hamming distance between two 16-hex-digit hashes. */
export function hamming(a: string, b: string): number {
  if (a.length !== 16 || b.length !== 16) throw new RangeError('hashes must be 16 hex digits');
  let d = 0;
  for (let i = 0; i < 16; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
  return d;
}

// ───────────────────────────── scan fingerprint (cache key) ─────────────────────────────

/** FNV-1a over the string, two lanes → 16 hex digits. Not cryptographic: a cache key only. */
export function fnv1a(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193 ^ 0xdeadbeef;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Identity of a scan request: the same photo bytes (by content hash, order-independent), category, title and
 * description reuse a previous result; changing any of them rescans. Navigating back and forth does not.
 */
export function scanFingerprint(imageContentHashes: string[], ctx: Pick<ListingContext, 'categoryId' | 'title' | 'description'>): string {
  const imgs = [...imageContentHashes].sort().join(',');
  return fnv1a([imgs, ctx.categoryId, ctx.title.trim().toLowerCase(), (ctx.description ?? '').trim().toLowerCase()].join('\u0001'));
}

// ───────────────────────────── watermark layout ─────────────────────────────

export const WATERMARK_TEXT = 'Suuqiye';

export type WatermarkLayout = {
  text: string;
  /** Rotation in degrees, applied around the image centre. */
  angle: number;
  fontSize: number;
  /** Fill opacity (white text with a dark halo so it reads on light AND dark photos). */
  opacity: number;
  /** Text anchor points, relative to the image centre, in the rotated frame. */
  items: { x: number; y: number }[];
};

/**
 * Single source of truth for the diagonal repeating mark: the Worker renders it into the published JPEG and
 * the app draws the same layout over the full-screen viewer. Sizes scale with the image so the mark covers
 * the whole picture (survives moderate cropping) at any resolution while leaving the subject recognisable.
 */
export function watermarkLayout(width: number, height: number): WatermarkLayout {
  const fontSize = Math.max(14, Math.round(Math.min(width, height) * 0.055));
  const stepX = Math.round(fontSize * 7.5);
  const stepY = Math.round(fontSize * 4.6);
  const reach = Math.ceil(Math.hypot(width, height) / 2) + stepX;
  const items: { x: number; y: number }[] = [];
  let row = 0;
  for (let y = -reach; y <= reach; y += stepY, row++) {
    const offset = row % 2 ? stepX / 2 : 0;
    for (let x = -reach + offset; x <= reach; x += stepX) items.push({ x: Math.round(x), y: Math.round(y) });
  }
  return { text: WATERMARK_TEXT, angle: -30, fontSize, opacity: 0.32, items };
}

// ───────────────────────────── derivative naming ─────────────────────────────

/** Public derivatives produced by the scan Worker live under this path segment (key: `wm/listings/{uid}/{listing}/{uuid}.jpg`). */
export const WATERMARKED_PATH_SEGMENT = '/wm/';

/** True for an image that already carries the baked-in mark — the viewer overlay skips these so a photo is never marked twice. */
export function isWatermarkedDerivative(url: string): boolean {
  try {
    return new URL(url).pathname.includes(WATERMARKED_PATH_SEGMENT);
  } catch {
    return false;
  }
}

/** Where a `width`×`height` image lands inside a `boxW`×`boxH` container with contentFit="contain". */
export function containRect(width: number, height: number, boxW: number, boxH: number): { x: number; y: number; w: number; h: number } {
  if (!(width > 0 && height > 0 && boxW > 0 && boxH > 0)) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / width, boxH / height);
  const w = width * s;
  const h = height * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}
