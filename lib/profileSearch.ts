// Search over the account screens (Profile menu + Settings), like the WhatsApp "You" search.
// Pure and language-agnostic: callers pass labels already translated into the user's language,
// so a user only ever matches the words they see. Copy lives at web/src/lib/profileSearch.ts.

export type ProfileSearchEntry = {
  id: string;
  label: string;
  /** Where it lives, already translated, e.g. "Settings → Account". Empty for top-level Profile items. */
  path: string;
  href: string;
  authRequired?: boolean;
};

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Lower is better; null = no match. Every typed word must match somewhere in the label or its path. */
function score(entry: ProfileSearchEntry, words: string[]): number | null {
  const label = normalize(entry.label);
  const path = normalize(entry.path);
  const labelWords = label.split(/[\s&/→-]+/).filter(Boolean);
  const pathWords = path.split(/[\s&/→-]+/).filter(Boolean);
  let total = 0;
  for (const w of words) {
    if (label.startsWith(w)) total += 0;
    else if (labelWords.some((lw) => lw.startsWith(w))) total += 1;
    else if (label.includes(w)) total += 2;
    else if (pathWords.some((pw) => pw.startsWith(w))) total += 3;
    else if (path.includes(w)) total += 4;
    else return null;
  }
  return total;
}

/** Empty query returns everything in its original order. Otherwise best matches first, ties keep original order. */
export function searchProfileEntries(entries: ProfileSearchEntry[], query: string): ProfileSearchEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return entries;
  return entries
    .map((entry, index) => ({ entry, index, s: score(entry, words) }))
    .filter((r): r is { entry: ProfileSearchEntry; index: number; s: number } => r.s !== null)
    .sort((a, b) => a.s - b.s || a.index - b.index)
    .map((r) => r.entry);
}
