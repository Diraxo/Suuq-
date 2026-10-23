# Sell flow usability and category audit (2026-10-22)

Local changes only. No migration, deployment, remote write, commit or release was made.

## What the audit found

| Area | Finding | Resolution |
| --- | --- | --- |
| Title examples | Mobile had its own example for 122 of 132 subcategories (ten job types fell back to "Receptionist Needed"); examples were English-only. Web ignored them and showed "Samsung Galaxy A54 128GB" for every category. | One example per category/subcategory (135 keys, incl. every job type), in `titleExamples` (`data/categoryFields.ts`). Mobile reads the translated text from `post.titleExamples.*`; web uses the English text. The example changes the moment the subcategory changes. |
| Field examples | Text fields used their own label as the placeholder ("Brand" inside the Brand box). A shared `phones` field list would have suggested the same brand for every phone. | `fieldExamples`, resolved per exact subcategory (Apple for iPhone, Honda for motorcycles, Hisense for kitchen appliances...). A test fails if any text field lacks one. |
| Condition | Required for **every** category: "Like new" for a house for rent, "Needs repair" for bread or a goat. | `conditionOptionsFor()` in `data/sellRules.ts`. See the table below. |
| Quality 0–100 | **No such field exists in the Sell flow.** The only 0–100 value is phone *Battery Health (%)*, a real spec shown on phones. | Kept, optional, with the hint "only if your phone shows it". Nothing was removed. |
| Scroll indicator | **No custom scroll component exists.** The visible bars are the platform defaults of lists that did not set `showsVerticalScrollIndicator={false}` (photos step, both category lists, the city list, the year picker) and the browser scrollbars on web. | Indicators hidden everywhere in the Sell flow; scrolling untouched. See "Scrollbars". |
| Year picker | Current year down 45 years; next year (new model years) could not be chosen. | Next year down to 1950 (`yearOptions()`), computed from the clock; never pre-selected. |
| Engine size | A 10-value chip list ending in "Other", so sellers had to guess. | Optional free text with the example "1.6 L" (cars) / "2.7 L" (SUVs). Old values such as "1.5L" stay valid. |
| Property | One bedroom-based form; no way to list a single room; no address, landmark, electricity, water or rent period; Yes/No for utilities. | See "Property". |
| Food | Condition plus nothing about freshness or expiry. | Packaging, expiry date, freshness, baked-on, quantity, unit. No condition. |
| Mobile/web differences | Web: phone example on every title, "For parts" label, condition required everywhere, no placeholders, listing detail printed raw attribute keys ("rentPeriod"). | Same rules, same schema (byte-identical copies, `tests/sellParity.test.ts`), same examples (English), same condition rules; detail page uses schema labels. |

## Condition policy

| Applies | Categories / subcategories |
| --- | --- |
| New, Like new, Used, Needs repair (unchanged) | vehicles (all, incl. spare parts and boats), phones (brands), electronics (all), furniture (all), business equipment (all), kitchen/Appliances, construction/Tools & Equipment, agriculture/Farm Equipment, Irrigation, Poultry Equipment, sports/Fitness Equipment, sports/Bicycles, baby/Baby Gear |
| New, Like new, Used (no repair) | fashion (all), beauty (all), books (all), phones/Accessories, baby/Clothing, Toys, Feeding, Baby Safety, kitchen/Cookware, Utensils, Storage, Bakeware, construction materials (Building Materials, Cement & Blocks, Electrical, Plumbing, Roofing, Steel & Metal), sports/Team Sports, Outdoor & Camping, Swimming, Running & Athletics, agriculture/Greenhouse & Nursery |
| Not asked at all | property (all), jobs (all), services (all), food (all), animals (all), agriculture/Livestock, agriculture/Seeds & Crops |

Where it is not asked, the listing row stores `condition = NULL` (the column is nullable and migration 0049's constraint already allows null) and the listing pages do not show a condition. Listings saved earlier keep their stored value; editing never forces a change (the edit screens offer the allowed options plus the one the listing already has).

## Property

| Subcategory | Form |
| --- | --- |
| House for Sale | bedrooms*, bathrooms, size, furnished, electricity, water, parking, year built, title deed, neighborhood, address, landmark |
| House for Rent | bedrooms*, bathrooms, size, furnished, **rent is paid***, availability, electricity, water, utilities included, parking, minimum lease, neighborhood, address, landmark |
| Apartment for Sale / Rent | as above plus floor |
| **Single Room for Rent** (new) | **rent is paid***, furnished, private/shared bathroom, electricity, water, utilities included, availability, neighborhood, address, landmark. No bedrooms, parking or size. |
| Land | area*, unit, purpose, title deed, road access, water, electricity, neighborhood, address, landmark |
| Shop / Office / Commercial / Warehouse | **for sale or for rent***, then rent period (rent only) or title deed (sale only), size*, floor or ceiling height/loading dock, electricity, water, parking, neighborhood, address, landmark |
| Guest House / Villa | for sale or for rent*, rent period (per night/week/month; rent only), bedrooms*, bathrooms, furnished, electricity, water, parking, pool, title deed (sale only), neighborhood, address, landmark |

`*` required. The two asterisked "new" items (rent period, sale-or-rent) are required only when **creating** a listing (`requiredForNew`), so editing a listing that predates them is never blocked.

- Electricity and water: Available / Not available / Not sure, never mandatory.
- Address: required free text when creating a listing (150 characters; editing older listings is not blocked). Landmark: optional (200 characters). No street name, no GPS, no location permission.
- The existing structured country/region/city/district selection is unchanged.
- The price step says "Rent amount" with the chosen period for rentals.
- Answers from the older forms (`furnished: Yes/No`, land `water: Yes`) remain valid (`legacyOptions`).
- "Single Room for Rent" is a new subcategory name in `data/categories.ts` / `web/src/lib/categories.ts`. Subcategory names are plain text in the database; no schema change is needed.

## Scrollbars

- Mobile: `showsVerticalScrollIndicator={false}` on the photos step, both category lists, the city list and the year picker (the details, price and preview steps already had it). Nothing sets `scrollEnabled={false}`.
- Web: the Sell page adds `no-scrollbar` (`scrollbar-width: none` + `::-webkit-scrollbar { display: none }`) to `<html>` while mounted and removes it on leaving; the nested city list uses the same class. Wheel, touch, keyboard and focus scrolling are unaffected.

## Translations

English, Somali and Amharic title examples for all 135 keys, field labels, hints, option labels and the "e.g." wrapper are in `locales/*/translation.json` (`post.titleExamples`, `post.fieldLabels`, `post.fieldHints`, `post.fieldOptions`, `post.examples`, `post.details.exampleWrap`...). `lib/sellText.ts` looks them up and falls back to English, so a missing entry never shows a raw key. The Somali and Amharic text was written by hand for natural reading but **has not been reviewed by a native speaker**; terms worth a second look: *Musqulaha* (bathrooms), *Biraeg* (brake pads), *Garaynder*, *Cudbi* (cotton), *Galley* (maize), *Alaab leh* (furnished), *Jira / Ma jiro* (available / not available).

## Not done / out of scope

- Every field label and choice is now translated except brand names, model codes and technical abbreviations (4G, USB, HD...), which are written the same in every language.
- Web: the Sell page, step header and fields are translated (en/so/am, following the website language store). Not yet translated: the photo-check dialog (ImageScanDialog), ErrorNotice, the city picker already had its own text, and the web edit-listing page.
- Business bulk upload (`app/business/bulk-upload`, `web/src/app/business/bulk-upload`) still requires a condition on every row.
- Brand/model are free text; no autocomplete exists in the codebase and none was added.
- `app/post/details.tsx` has pre-existing `react-hooks/refs` lint errors in its scroll helpers (untouched).

## Validation messages and the website

- `SELL_ERROR_TEMPLATES` (`data/sellRules.ts`) holds every message the shared rules can produce; `sellError()` builds the English text and `matchSellError()` maps a message back to its id and values, so screens show it in the seller's language via `localizeSellError()` (`data/sellText.ts`) and `post.errors.*` in the locale files.
- The website reads the same strings: `node scripts/sync-sell-text.js` regenerates `web/src/lib/sellTextData.ts` from `locales/*`; a test fails if they drift. `web/src/lib/sellI18n.ts` picks the language from the existing website language store.
