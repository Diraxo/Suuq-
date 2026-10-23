import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import { categories } from '../data/categories';
import { categoryLabel, subcategoryLabel } from '../data/categoryNames';
import { makeT, makeSellT } from '../web/src/lib/webTranslate';

const root = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
const locale = (lang: string) => JSON.parse(read(`locales/${lang}/translation.json`));

function files(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((d) => {
    const p = `${dir}/${d.name}`;
    return d.isDirectory() ? files(p) : p.endsWith('.tsx') ? [p] : [];
  });
}

// ───────── the website has no hard-coded English left in what visitors see ─────────

// Staff-only consoles stay English, as do brand marks and the static page metadata.
const STAFF_ONLY = /(\/admin\/|AdminActionModal|AdminBusinessDirectory|PhotoChecksCard|GoogleLogo|WatermarkOverlay)/;
const TEXT_ATTRS = new Set(['title', 'label', 'placeholder', 'message', 'aria-label', 'alt', 'subtitle', 'description', 'actionLabel', 'emptyTitle', 'emptyMessage', 'heading']);
const BRAND_OR_SYMBOL = /^(SUUQIYE|Google|Apple|Facebook|Instagram|Telegram|TikTok|WhatsApp|https?:\/\/.*|[^A-Za-z]*)$/;

test('no visible English is hard-coded in the website’s pages and components', () => {
  const offenders: string[] = [];
  for (const file of [...files('web/src/app'), ...files('web/src/components')]) {
    if (STAFF_ONLY.test(file)) continue;
    const sf = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const flag = (text: string, node: ts.Node) => {
      const clean = text.replace(/\s+/g, ' ').trim();
      if (clean && /[A-Za-z]{2}/.test(clean) && !BRAND_OR_SYMBOL.test(clean)) {
        offenders.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} "${clean.slice(0, 60)}"`);
      }
    };
    const visit = (n: ts.Node) => {
      if (ts.isJsxText(n)) flag(n.text, n);
      else if (
        ts.isJsxAttribute(n) &&
        n.initializer &&
        ts.isStringLiteral(n.initializer) &&
        TEXT_ATTRS.has(n.name.getText(sf)) &&
        // LegalPage translates its title and sections itself (t.text) — the legal pages are server components that cannot call the hook
        !(ts.isJsxOpeningLikeElement(n.parent.parent) && n.parent.parent.tagName.getText(sf) === 'LegalPage')
      )
        flag(n.initializer.text, n);
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  assert.deepEqual(offenders, [], `hard-coded English in:\n${offenders.join('\n')}`);
});

// ───────── the text itself ─────────

test('every website text group exists in English, Somali and Amharic with the same keys', () => {
  const en = locale('en');
  for (const group of ['web', 'categoryNames', 'subcategoryNames', 'numericHint']) {
    const keys = JSON.stringify(Object.keys(flatten(en[group])).sort());
    for (const lang of ['so', 'am']) assert.equal(JSON.stringify(Object.keys(flatten(locale(lang)[group])).sort()), keys, `${lang} ${group}`);
  }
  // sentences that are the same text with {{values}} keep the same values in every language
  for (const [key, text] of Object.entries(flatten(en.web))) {
    const values = [...String(text).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();
    for (const lang of ['so', 'am']) {
      assert.deepEqual([...String(flatten(locale(lang).web)[key]).matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort(), values, `${lang} web.${key}`);
    }
  }
});

function flatten(node: unknown, prefix = ''): Record<string, unknown> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.assign({}, ...Object.entries((node ?? {}) as Record<string, unknown>).map(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k)));
}

test('the search page’s empty and filter messages are translated, not English', () => {
  const so = makeSellT('so');
  const am = makeSellT('am');
  const en = makeSellT('en');
  for (const key of ['search.emptyFilteredTitle', 'search.emptyFilteredMessage', 'search.emptyTitle', 'search.emptyMessage', 'search.noFilters']) {
    assert.notEqual(so(key), en(key), `${key} is still English in Somali`);
    assert.notEqual(am(key), en(key), `${key} is still English in Amharic`);
    assert.ok(!so(key).startsWith('search.'), `${key} resolved to a raw key`);
  }
  const page = read('web/src/app/search/page.tsx');
  assert.match(page, /t\('search\.emptyFilteredTitle'\)/);
  assert.ok(!page.includes('No listings match this filter'));
});

test('t.text() finds the translation of any English sentence the app already has', () => {
  const so = makeSellT('so');
  const am = makeSellT('am');
  assert.equal(so.text('Privacy Policy'), locale('so').settings.privacyPolicy.title);
  assert.notEqual(so.text('Delete your SUUQIYE account? This permanently removes your listings, messages, favorites, and profile. This cannot be undone.'), 'Delete your SUUQIYE account? This permanently removes your listings, messages, favorites, and profile. This cannot be undone.');
  assert.ok(am.text('Information we collect').includes('መረጃ'));
  assert.equal(so.text('A sentence nobody translated'), 'A sentence nobody translated', 'unknown text is shown as written, never a raw key');
  assert.equal(so.text('Welcome’s  odd   spacing').length > 0, true);
});

test('counted wording follows the language (minutes ago, days ago...)', () => {
  assert.equal(makeSellT('en')('time.minutesAgo', { count: 1 }), '1 minute ago');
  assert.equal(makeSellT('en')('time.minutesAgo', { count: 5 }), '5 minutes ago');
  assert.equal(makeSellT('so')('time.daysAgo', { count: 3 }), locale('so').time.daysAgo_other.replace('{{count}}', '3'));
  assert.equal(makeSellT('am')('time.hoursAgo', { count: 1 }), locale('am').time.hoursAgo_one.replace('{{count}}', '1'));
  const fallback = makeT({}, { only: { english: 'Hello {{name}}' } });
  assert.equal(fallback('only.english', { name: 'Ali' }), 'Hello Ali');
});

test('every category and subcategory has a Somali and an Amharic name, and the stored English name is untouched', () => {
  const so = makeSellT('so');
  const am = makeSellT('am');
  const en = makeSellT('en');
  // brand names and loanwords that are written the same in every language
  const SAME = new Set(['iPhone', 'Samsung', 'Tecno', 'Infinix', 'Xiaomi', 'Nokia', 'Huawei', 'Oppo', 'Vivo', 'Itel', 'Realme', 'Internet', 'IT', 'Salon', 'Makeup']);
  for (const c of categories) {
    assert.equal(categoryLabel(en, c.id, c.name), c.name);
    assert.notEqual(categoryLabel(so, c.id, c.name), c.name, `${c.id} Somali`);
    assert.notEqual(categoryLabel(am, c.id, c.name), c.name, `${c.id} Amharic`);
    for (const s of c.subcategories ?? []) {
      assert.equal(subcategoryLabel(en, c.id, s.name), s.name);
      if (SAME.has(s.name)) continue;
      assert.notEqual(subcategoryLabel(so, c.id, s.name), s.name, `${c.id}/${s.name} Somali`);
      assert.notEqual(subcategoryLabel(am, c.id, s.name), s.name, `${c.id}/${s.name} Amharic`);
    }
  }
  assert.equal(subcategoryLabel(so, 'vehicles', 'Cars'), 'Gaadhi');
  assert.equal(categoryLabel(am, 'property', 'Property'), 'ንብረት');
  // a category the translations do not know falls back to its English name
  assert.equal(categoryLabel(so, 'nonexistent', 'Mystery'), 'Mystery');
});

test('the screens that show categories use the translated names', () => {
  for (const f of ['app/(tabs)/home.tsx', 'app/category/[id].tsx', 'app/post/category.tsx', 'web/src/app/page.tsx', 'web/src/app/category/[id]/page.tsx', 'web/src/app/sell/page.tsx', 'web/src/components/Header.tsx']) {
    assert.match(read(f), /categoryLabel\(t, /, f);
  }
  for (const f of ['app/category/[id].tsx', 'app/post/category.tsx', 'web/src/app/category/[id]/page.tsx', 'web/src/app/sell/page.tsx']) assert.match(read(f), /subcategoryLabel\(t, /, f);
  assert.match(read('web/src/app/listing/[id]/page.tsx'), /subcategoryLabel\(t, listing\.category/);
  assert.match(read('app/listing/[id].tsx'), /subcategoryLabel\(t, listing\.category/);
  assert.equal(read('data/categoryNames.ts'), read('web/src/lib/categoryNames.ts'));
});

test('the page language follows the app language and legal text is translated on both platforms', () => {
  assert.match(read('web/src/components/LanguageSync.tsx'), /documentElement\.lang = activeLocale/);
  for (const f of ['app/settings/privacy-policy.tsx', 'app/settings/terms.tsx', 'app/settings/community-guidelines.tsx']) assert.match(read(f), /translateText\(t, s\.body\)/);
  assert.match(read('web/src/components/LegalPage.tsx'), /t\.text\(s\.body\)/);
  // every sentence of the three legal documents has a Somali and an Amharic version
  const so = makeSellT('so');
  const am = makeSellT('am');
  for (const f of ['app/settings/privacy-policy.tsx', 'app/settings/terms.tsx', 'app/settings/community-guidelines.tsx']) {
    const sf = ts.createSourceFile(f, read(f), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let checked = 0;
    const visit = (n: ts.Node) => {
      if (ts.isStringLiteral(n) && n.text.length > 25 && n.text.includes(' ') && /^[A-Z]/.test(n.text) && !ts.isImportDeclaration(n.parent)) {
        checked++;
        assert.notEqual(so.text(n.text), n.text, `${f}: no Somali for "${n.text.slice(0, 50)}…"`);
        assert.notEqual(am.text(n.text), n.text, `${f}: no Amharic for "${n.text.slice(0, 50)}…"`);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    assert.ok(checked >= 6, `${f}: expected to check the document's paragraphs, saw ${checked}`);
  }
});
