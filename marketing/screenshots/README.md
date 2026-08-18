# Fursad — Google Play screenshot generator

Isolated marketing-asset project. Does **not** touch the production app, its
dependencies, or its build. Safe to delete this whole folder without
affecting Fursad.

## What this is

A small, deterministic Puppeteer generator that composes the six Google Play
Store screenshots from real Fursad app screenshots + brand design tokens
pulled from `theme/colors.ts` and `theme/tokens.ts`.

## Run it

```
npm install
npm run build
```

Outputs land in `output/01-discover.png` … `output/06-trust.png`, each
exactly **1080×1920**, opaque RGB PNG (no alpha).

Requires a local Chrome or Edge install (used via `puppeteer-core`, no
Chromium download). Update `CHROME_CANDIDATES` in `src/render.js` if yours
lives elsewhere.

## How it's built

- `src/tokens.js` — colors/canvas/font/phone-frame constants, copied
  verbatim from the app's `theme/colors.ts` (indigo primary `#4F46E5`,
  coral accent `#FF6B6B`, slate neutrals).
- `src/slides.js` — the six slide definitions: which screenshot, headline
  copy, background gradient, phone offset/rotation/scale.
- `src/template.js` — renders one slide to an HTML string: gradient
  background + blurred brand-color "blobs", grain texture, Inter
  typography (via `@fontsource/inter`, bundled locally), the brand lockup,
  the headline block, and a CSS-built Android device frame (bezel, punch
  hole, side buttons) that masks the real screenshot.
- `src/render.js` — launches Chrome headless, navigates to each rendered
  slide as a `file://` HTML page (required for local image loading), and
  screenshots the exact 1080×1920 canvas.
- `input/` — the 6 source screenshots, pre-cropped by `src/crop.py` to
  remove the OS status bar (time/battery/carrier — inconsistent across
  captures) for a clean, consistent frame. The app UI itself is untouched.
- `src/qa.py` / `src/contact_sheet.py` — verify output dimensions/alpha and
  build a side-by-side preview strip (`output/_contact_sheet.png`).

## Slides

| # | File | Screen used (source) | Headline |
|---|------|----------------------|----------|
| 1 | `01-discover.png` | Home / browse (`photo_...20-52-14.jpg`) | DISCOVER WHAT YOU'RE LOOKING FOR. |
| 2 | `02-find.png` | Search + filters (`photo_...20-52-16.jpg`) | FIND IT FAST. |
| 3 | `03-sell.png` | Post flow — Add Photos (`photo_...20-52-23.jpg`) | LIST IT. SELL IT. DONE. |
| 4 | `04-connect.png` | Chat thread w/ offer & pickup (`photo_...20-52-19.jpg`) | MESSAGE SELLERS. MAKE OFFERS. |
| 5 | `05-save.png` | Favorites w/ custom lists (`photo_...20-52-24.jpg`) | KEEP YOUR FAVORITES CLOSE. |
| 6 | `06-trust.png` | Seller profile — ratings/reviews (`photo_...20-52-30.jpg`) | BUY WITH CONFIDENCE. |

Every headline maps to a feature verified in the current codebase (see
`app/(tabs)/home.tsx`, `app/(tabs)/search.tsx`, `app/post/*`, `app/chat/[id].tsx`,
`app/offers.tsx`, `app/favorites.tsx`, `app/seller/[id].tsx`,
`app/reviews.tsx`). No invented stats, no geography in the copy.

## To change something

Edit `src/slides.js` (copy/layout) or `src/tokens.js` (brand values), then
`npm run build` again — fully deterministic, safe to re-run any time the app
theme or the source screenshots change.
