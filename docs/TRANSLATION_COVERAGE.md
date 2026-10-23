# Translation coverage (2026-10-22)

English, Somali and Amharic everywhere a user can see text, on the app and on the website.

## How the website is translated
- One translator for the whole site: `useT()` in `web/src/lib/i18n.ts`. It reads the **same locale files as the app** (`locales/{en,so,am}/translation.json`), copied into `web/src/lib/webText/*.ts` by `node scripts/sync-web-text.js` (run it after editing a locale; a test fails if they drift). English is bundled; Somali and Amharic load on demand. The language comes from the website's existing language store.
- `t(key, values)` for normal strings, `t.text("English sentence")` for labels kept as English constants (menus, status names, weekdays, legal text), `getT()` for code outside components (relative times, service errors), `useScanCopy()` for the photo-check dialog.
- Staff-only admin consoles stay English on purpose.

## What was added
- `web.t.*` (213 website sentences), `web.m.*` (templated sentences), `web.s.*` (service/store/error messages), `web.l.*` (location policy), `categoryNames` / `subcategoryNames` (18 + 132 category names), `post.errors.*` (form validation messages), `numericHint.*`.
- Category and subcategory names are shown translated everywhere (`data/categoryNames.ts`, shared by app and website); the stored English names are unchanged.
- Legal pages (privacy, terms, guidelines) are translated on both platforms (`lib/textKeys.ts` on the app, `t.text` on the website).
- Relative times (`3 days ago`) and month names follow the language; the page `lang` attribute follows the app language.

## Guard rails
- `tests/webTranslation.test.ts` scans every non-admin website page and component and fails on hard-coded English text or text attributes.
- It also checks the three languages have the same keys and values, that all category names are translated, and that the legal documents have Somali and Amharic versions.

## Not translated
- Admin consoles (`web/src/app/admin/**`, `AdminActionModal`, `PhotoChecksCard`, `AdminBusinessDirectory`).
- Page `<title>`/description metadata (set on the server before a language is known) and the "Page not found" tab title.
- User-written content (titles, descriptions, chat messages) is never translated.
- Somali and Amharic wording was written by hand for natural reading but has not been reviewed by a native speaker.
