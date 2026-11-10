import fs from 'node:fs';
import path from 'node:path';

// locales/pending-review.json lists every Somali / Amharic string that is deliberately still the English text because nobody who
// speaks the language has reviewed a translation yet. Tests that demand "really translated" skip exactly these paths — and
// tests/serviceForms.test.ts fails if a listed path has since been translated (so the list can't go stale).
const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'locales', 'pending-review.json'), 'utf8')) as Record<'so' | 'am', string[]>;

export const PENDING = file;

/** True when `dotted` (e.g. "post.fieldLabels.Provider type") is an English placeholder awaiting a reviewed translation. */
export const isPending = (lang: 'so' | 'am', dotted: string): boolean => file[lang].includes(dotted);
