// Pure helpers over the location directory (country → region → city).
// No imports on purpose: the identical file lives at web/src/lib/locationTree.ts
// (the web app is a separate package) — keep the two copies in sync.

export type LocKind = 'country' | 'region' | 'city';
export type Lang = 'en' | 'so' | 'am';

export type LocNode = {
  id: string;
  kind: LocKind;
  /** Canonical English name — the value stored on listings. */
  name: string;
  nameSo: string | null;
  nameAm: string | null;
  parentId: string | null;
  iso2: string | null;
  /** Own currency options; null = inherit from the parent. */
  currencyCodes: string[] | null;
  defaultCurrency: string | null;
  aliases: string[];
  isFeatured: boolean;
  isAppRegion: boolean;
  /** Directory review status. Absent on older cached rows (which were fetched as approved). Only 'approved' places are ever selectable. */
  status?: string | null;
};

export type LocRow = {
  id: string;
  kind: LocKind;
  name: string;
  parent_id: string | null;
  iso2: string | null;
  currency_codes: string[] | null;
  default_currency: string | null;
  name_so: string | null;
  name_am: string | null;
  aliases: string[] | null;
  is_featured: boolean;
  is_app_region: boolean;
  status?: string | null;
};

export const LOCATION_COLUMNS =
  'id, kind, name, parent_id, iso2, currency_codes, default_currency, name_so, name_am, aliases, is_featured, is_app_region, status';

export function rowToNode(r: LocRow): LocNode {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    nameSo: r.name_so,
    nameAm: r.name_am,
    parentId: r.parent_id,
    iso2: r.iso2,
    currencyCodes: r.currency_codes && r.currency_codes.length ? r.currency_codes : null,
    defaultCurrency: r.default_currency,
    aliases: r.aliases ?? [],
    isFeatured: r.is_featured,
    isAppRegion: r.is_app_region,
    status: r.status ?? null,
  };
}

/** Only approved places can be browsed, searched or suggested (an unknown status is a cached row that was fetched as approved). */
export function isSelectable(n: LocNode): boolean {
  return n.status == null || n.status === 'approved';
}

export function toLang(code: string | undefined | null): Lang {
  const c = (code ?? 'en').slice(0, 2).toLowerCase();
  return c === 'so' || c === 'am' ? c : 'en';
}

export function displayName(n: LocNode, lang: Lang): string {
  if (lang === 'so' && n.nameSo) return n.nameSo;
  if (lang === 'am' && n.nameAm) return n.nameAm;
  return n.name;
}

/** Lower-case, accent-insensitive, whitespace-collapsed — for matching only. */
export function norm(s: string): string {
  let out = s.trim().toLowerCase();
  try {
    out = out.normalize('NFD').replace(/[̀-ͯ]/g, '');
  } catch {
    /* normalize unsupported — fall back to plain lower-casing */
  }
  return out.replace(/\s+/g, ' ');
}

/** `norm` plus punctuation → space ("Dire-Dawa", "Dire  Dawa." and "dire dawa" all match). */
export function normLoose(s: string): string {
  return norm(s.replace(/[^\p{L}\p{N}\s]/gu, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export type LocIndex = {
  nodes: LocNode[];
  byId: Map<string, LocNode>;
  children: Map<string | null, LocNode[]>;
  /** normalized English name → most specific node (city > region > country). */
  byName: Map<string, LocNode>;
};

const RANK: Record<LocKind, number> = { city: 0, region: 1, country: 2 };

export function buildIndex(all: LocNode[]): LocIndex {
  // Defence in depth on top of the approved-only query: drop anything that is
  // not approved, and anything whose parent chain is broken by such a drop, so
  // a pending/inactive/rejected place can never surface as a choice or suggestion.
  let nodes = all.filter(isSelectable);
  for (;;) {
    const ids = new Set(nodes.map((n) => n.id));
    const kept = nodes.filter((n) => !n.parentId || ids.has(n.parentId));
    if (kept.length === nodes.length) break;
    nodes = kept;
  }
  const byId = new Map<string, LocNode>();
  const children = new Map<string | null, LocNode[]>();
  const byName = new Map<string, LocNode>();
  for (const n of nodes) {
    byId.set(n.id, n);
    const list = children.get(n.parentId) ?? [];
    list.push(n);
    children.set(n.parentId, list);
    const key = norm(n.name);
    const existing = byName.get(key);
    if (!existing || RANK[n.kind] < RANK[existing.kind]) byName.set(key, n);
  }
  return { nodes, byId, children, byName };
}

export const EMPTY_INDEX: LocIndex = buildIndex([]);

export function sortNodes(list: LocNode[], lang: Lang): LocNode[] {
  return [...list].sort((a, b) => displayName(a, lang).localeCompare(displayName(b, lang), lang, { sensitivity: 'base' }));
}

export function childrenOf(index: LocIndex, parentId: string | null, lang: Lang): LocNode[] {
  return sortNodes(index.children.get(parentId) ?? [], lang);
}

export function hasChildren(index: LocIndex, id: string): boolean {
  return (index.children.get(id)?.length ?? 0) > 0;
}

export function ancestors(index: LocIndex, id: string): LocNode[] {
  const out: LocNode[] = [];
  let cur = index.byId.get(id);
  while (cur?.parentId) {
    cur = index.byId.get(cur.parentId);
    if (cur) out.unshift(cur);
  }
  return out;
}

export function countryOf(index: LocIndex, id: string): LocNode | undefined {
  const self = index.byId.get(id);
  if (self?.kind === 'country') return self;
  return ancestors(index, id).find((a) => a.kind === 'country');
}

/** "Somali Region · Ethiopia" — the context line shown under a result. */
export function pathLabel(index: LocIndex, id: string, lang: Lang): string {
  return ancestors(index, id)
    .reverse()
    .map((a) => displayName(a, lang))
    .join(' · ');
}

export type Effective = {
  /** Currencies sellers may choose here (own list, else nearest ancestor's). */
  currencies: string[];
  defaultCurrency: string;
  /** Value for listings.region: nearest region, else the country. */
  regionLabel: string;
};

export function normaliseCurrencyCode(code: string): string {
  const c = code.trim().toUpperCase();
  return c === 'BIRR' || c === 'BR' ? 'ETB' : c;
}

export function effectiveFor(index: LocIndex, id: string): Effective {
  const self = index.byId.get(id);
  const chain = self ? [self, ...ancestors(index, id).reverse()] : [];
  const withCodes = chain.find((n) => n.currencyCodes);
  // Ethiopia sells in Birr only. Directory rows may also spell Birr "BIRR"/"BR" — normalise to the ISO code ETB.
  const inEthiopia = chain.some((n) => n.kind === 'country' && ((n.iso2 ?? '').toUpperCase() === 'ET' || n.name.trim().toLowerCase() === 'ethiopia'));
  const normalised = Array.from(new Set((withCodes?.currencyCodes ?? ['USD']).map(normaliseCurrencyCode)));
  const currencies = inEthiopia ? ['ETB'] : normalised;
  const own = chain.find((n) => n.defaultCurrency && currencies.includes(normaliseCurrencyCode(n.defaultCurrency)));
  const region = chain.find((n) => n.kind === 'region') ?? chain.find((n) => n.kind === 'country');
  return { currencies, defaultCurrency: own?.defaultCurrency ? normaliseCurrencyCode(own.defaultCurrency) : currencies[0], regionLabel: region?.name ?? '' };
}

export function findByName(index: LocIndex, name: string | null | undefined): LocNode | undefined {
  return name ? index.byName.get(norm(name)) : undefined;
}

/** True when `nodeId` is `scopeId` itself or sits anywhere below it. */
export function isWithin(index: LocIndex, nodeId: string, scopeId: string): boolean {
  let cur = index.byId.get(nodeId);
  while (cur) {
    if (cur.id === scopeId) return true;
    cur = cur.parentId ? index.byId.get(cur.parentId) : undefined;
  }
  return false;
}

/** Does a listing (identified by its stored location name) fall inside the chosen scope? */
export function listingInScope(index: LocIndex, listingCity: string, scopeId: string | null): boolean {
  if (!scopeId) return true;
  const node = findByName(index, listingCity);
  return !!node && isWithin(index, node.id, scopeId);
}

/** Searches every level by display name, English name, translations, aliases and ISO code. */
export function searchNodes(index: LocIndex, query: string, lang: Lang, limit = 60): LocNode[] {
  const q = normLoose(query);
  if (!q) return [];
  const scored: { n: LocNode; score: number }[] = [];
  for (const n of index.nodes) {
    const names = [displayName(n, lang), n.name, n.nameSo ?? '', n.nameAm ?? '', ...n.aliases, n.iso2 ?? ''];
    let best = Infinity;
    for (const raw of names) {
      if (!raw) continue;
      const h = normLoose(raw);
      const at = h === q ? 0 : h.startsWith(q) ? 1 : h.split(' ').some((w) => w.startsWith(q)) ? 2 : h.includes(q) ? 3 : Infinity;
      if (at < best) best = at;
    }
    if (best < Infinity) scored.push({ n, score: best * 10 + RANK[n.kind] });
  }
  scored.sort((a, b) => a.score - b.score || displayName(a.n, lang).localeCompare(displayName(b.n, lang), lang));
  return scored.slice(0, limit).map((s) => s.n);
}

// ── Typo-tolerant suggestions ───────────────────────────────────────────────
// Used only when nothing matches the typed text. Two generic mechanisms, no
// per-place special cases:
//  1. phonetic() folds spellings that routinely vary when Somali/Amharic names
//     are written in Latin letters (j/g, gh/g, kh/k, sh/s, z/s, y/i …), so
//     "GIG" and "GIGH" reach "Jigjiga".
//  2. A small edit distance (with transposition) for ordinary typos.
// Transliterations no rule can predict ("Gigiga", "Djidjiga") belong in the
// directory's `aliases` column, which both searches already read — add the
// alias there instead of adding code.

const PHONETIC_DIGRAPHS: [RegExp, string][] = [
  [/gh/g, 'g'],
  [/kh/g, 'k'],
  [/ph/g, 'f'],
  [/sh/g, 's'],
  [/ch/g, 'c'],
  [/dh/g, 'd'],
  [/th/g, 't'],
  [/ck/g, 'k'],
];
const PHONETIC_LETTERS: Record<string, string> = { j: 'g', z: 's', q: 'k', x: 'k', y: 'i', w: 'u', v: 'f' };

/** Spelling-variant-insensitive form of a place name, for suggestions only (never for exact matching). */
export function phonetic(s: string): string {
  let out = normLoose(s);
  for (const [re, to] of PHONETIC_DIGRAPHS) out = out.replace(re, to);
  out = out.replace(/[jzqxywv]/g, (c) => PHONETIC_LETTERS[c]);
  return out.replace(/(\p{L})\1+/gu, '$1');
}

/** Optimal-string-alignment distance (insert, delete, substitute, swap neighbours). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur[j] = v;
    }
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Fewest letters worth guessing from; shorter text matches too many places. */
export const MIN_SUGGEST_LENGTH = 3;

/**
 * Likely intended places for text that matched nothing exactly, best first.
 * Only places in `index` (approved directory entries) are ever returned, and
 * short or very different text yields nothing rather than a pile of countries.
 */
export function suggestNodes(index: LocIndex, query: string, lang: Lang, limit = 5): LocNode[] {
  const typed = normLoose(query);
  if (typed.replace(/ /g, '').length < MIN_SUGGEST_LENGTH) return [];
  const q = phonetic(query);
  if (q.length < MIN_SUGGEST_LENGTH) return []; // e.g. "zzzzzz" folds to a single letter
  const maxDistance = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  const scored: { n: LocNode; score: number }[] = [];
  for (const n of index.nodes) {
    let best = Infinity;
    for (const raw of [displayName(n, lang), n.name, n.nameSo ?? '', ...n.aliases]) {
      if (!raw) continue;
      const p = phonetic(raw);
      if (!p) continue;
      const words = p.split(' ');
      let at = Infinity;
      if (p === q) at = 0;
      else if (p.startsWith(q)) at = 1;
      else if (words.some((w) => w.startsWith(q))) at = 2;
      else if (maxDistance > 0) {
        let d = editDistance(q, p);
        for (const c of [p, ...words]) {
          for (const len of [q.length - 1, q.length, q.length + 1]) d = Math.min(d, editDistance(q, c.slice(0, len)));
        }
        if (d <= maxDistance) at = 2 + d;
      }
      if (at < best) best = at;
    }
    if (best < Infinity) scored.push({ n, score: best * 10 + RANK[n.kind] });
  }
  scored.sort((a, b) => a.score - b.score || displayName(a.n, lang).localeCompare(displayName(b.n, lang), lang));
  return scored.slice(0, limit).map((s) => s.n);
}

export type LocationSearchResult = {
  /** Places containing the typed text (exact, prefix, word or partial), best first. */
  matches: LocNode[];
  /** Only when `matches` is empty: "did you mean" alternatives. Never auto-selected. */
  suggestions: LocNode[];
};

export function searchLocations(index: LocIndex, query: string, lang: Lang, limit = 60): LocationSearchResult {
  const matches = searchNodes(index, query, lang, limit);
  return { matches, suggestions: matches.length ? [] : suggestNodes(index, query, lang) };
}

/** A root country is "active" when the directory has places below it. */
export function activeCountries(index: LocIndex, lang: Lang): LocNode[] {
  return childrenOf(index, null, lang).filter((c) => hasChildren(index, c.id));
}

export function otherCountries(index: LocIndex, lang: Lang): LocNode[] {
  return childrenOf(index, null, lang).filter((c) => !hasChildren(index, c.id));
}
