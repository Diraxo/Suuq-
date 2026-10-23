import en from '@/locales/en/translation.json';

// Some screens keep long English text in a constant (legal documents, safety tips).
// This finds the locale entry with exactly that English text and returns it in the active language,
// or the English text itself when there is none — so a constant never has to be restructured to be translated.
type Translate = (key: string, options?: Record<string, unknown>) => string;

const normalize = (s: string) => s.replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();

let index: Map<string, string> | undefined;
function keyFor(english: string): string | undefined {
  if (!index) {
    index = new Map();
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'string') {
        if (!node.includes('{{') && !index!.has(normalize(node))) index!.set(normalize(node), path);
      } else if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) walk(v, path ? `${path}.${k}` : k);
      }
    };
    walk(en, '');
  }
  return index.get(normalize(english));
}

export function translateText(t: Translate, english: string): string {
  const key = keyFor(english);
  return key ? t(key, { defaultValue: english }) : english;
}
