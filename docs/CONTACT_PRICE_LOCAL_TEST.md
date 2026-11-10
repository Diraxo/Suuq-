# Contact for price — local visual test (2026-10-26)

**Status: nothing here has been run on a device or in a browser.** No visual, end-to-end or write test of Contact for price has been performed. The production flag is unchanged (`CONTACT_PRICE_ENABLED` is `false` in every shipped build).

## 1. Is there a safe database to test against? — No (verified 2026-10-26)

| Candidate | Finding |
|---|---|
| `.env` and `web/.env.local` | Both point at the **production** project `waksddinkjbrggxkfofk`. |
| Supabase account | Two projects only: production `Suuq+` (`waksddinkjbrggxkfofk`) and `DAwa's Project` (`ulrgkqjjiclulnuotifh`, other organization, created 2026-06-09). Nothing shows what the second one contains or that it is a Suuq+ copy; it has **not been inspected and must not be assumed isolated or safe to write to**. |
| Local stack | Docker is not installed and `supabase/config.toml` does not exist, so `supabase start` is not available yet. |
| Earlier staging attempt (2026-10-19) | Refused by Supabase: free-project limit (two) already reached. |

Because no database has been verified as isolated, the test build was **not** pointed anywhere and no write test was prepared against a live project. Do not use the production URL for create / edit / offer / discount tests.

### How to get an isolated database (pick one, then verify it)

**A. Local Supabase (fully isolated, recommended)**
1. Install Docker Desktop, start it.
2. In the repo: `supabase init` (creates `supabase/config.toml`; it does not touch the linked production project), then `supabase start`. It prints `API URL` (`http://127.0.0.1:54321`), `DB URL` and a local `anon key`.
3. Load the schema into that local database only, by explicit URL, never by `supabase link`:
   `supabase db push --db-url postgresql://postgres:postgres@127.0.0.1:54322/postgres` (applies `supabase/migrations/0001…0084`), then run, in order, `supabase/proposed/0085_service_contact_price.sql`, `0086_contact_price_safeguards.sql`, `0087_contact_price_pending_offers.sql` (and `0088`/`0089` if you want to review them) with `psql` against the same local URL.
4. From a phone or emulator use a reachable address: Android emulator `http://10.0.2.2:54321`, a physical device the PC's LAN IP.

**B. A new hosted project** — (the guarded flag refuses every hosted URL since 2026-10-27, so the sell form would not show the new question against a hosted project; using one needs a deliberate, reviewed change to `contactPriceFlag.ts`) — free tier allows two projects: pause or delete one you own and no longer need (do not delete production), or use a paid/other organization. Create it, copy its *new* ref (it must differ from `waksddinkjbrggxkfofk`), apply the same migrations by `--db-url`, never `supabase link`.

**Photos:** publishing a listing needs at least one photo and uploads go through the `r2-presign` edge function and a Cloudflare R2 bucket. A test project has neither until you deploy that function with a *separate test bucket*. Until then you can still test everything except publishing a brand-new listing from the app by inserting test listings with SQL (title, category `services`, price `0`, `attributes = {"priceMode":"Contact for price", …}`, any `images` URL).

**Verify isolation before any write** (all must hold): the URL host's ref is not `waksddinkjbrggxkfofk`; `select count(*) from public.listings` is not production's data (production has 8 rows today); you created the project/stack yourself; the keys in your env file are that project's keys. The flag code itself also refuses to turn on if the URL contains the production ref (tested), but that is a last line of defence, not proof of isolation.

## 2. Turning the feature on locally (development builds only)

Existing mechanism: `EXPO_PUBLIC_*` (app) and `NEXT_PUBLIC_*` (website) environment variables, like `STOREFRONTS_ENABLED` (`lib/storefrontFlag.ts`). The shared constant is now `CONTACT_PRICE_ENABLED = CONTACT_PRICE_LOCAL_OVERRIDE`, which is true only when **all** hold:

| Condition | App | Website |
|---|---|---|
| development bundle | `__DEV__` (false in any release build) | `NODE_ENV !== 'production'` (`next build` / `next start` / Vercel are production) |
| opt-in variable | `EXPO_PUBLIC_CONTACT_PRICE_LOCAL=true` | `NEXT_PUBLIC_CONTACT_PRICE_LOCAL=true` |
| database | Supabase URL is an **allow-listed local address** (`localhost`, `127.0.0.1`, `[::1]`, `10.0.2.2`, private `10.x` / `192.168.x` / `172.16-31.x`, `*.local`) and does not contain the production ref (any letter case) | same |

Files: `data/contactPriceFlag.ts`, `web/src/lib/contactPriceFlag.ts`; both copies of `serviceConfig.ts` import it and stay byte-identical. Nothing was added to `eas.json`, `.env`, `.env.example`, `web/.env.local`, or any deployment config (a test asserts this).

Use **git-ignored, development-only** files, which override `.env` / `.env.local` (that still point at production) only in development:

`.env.development.local` (repo root, app):
```
EXPO_PUBLIC_SUPABASE_URL=<your isolated project/stack URL>
EXPO_PUBLIC_SUPABASE_ANON_KEY=<that project's anon key>
EXPO_PUBLIC_CONTACT_PRICE_LOCAL=true
```
`web/.env.development.local` (website):
```
NEXT_PUBLIC_SUPABASE_URL=<same URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<same anon key>
NEXT_PUBLIC_CONTACT_PRICE_LOCAL=true
```
Both are covered by `.gitignore` (`.env*.local`). Alternatively set the three variables in the shell for one run (PowerShell: `$env:EXPO_PUBLIC_SUPABASE_URL='…'; npx expo start -c`), which leaves no file behind. Restart with a cleared cache (`npx expo start -c`; restart `next dev`) after changing them, because public variables are inlined at bundle time. Delete the files when finished. The mobile app needs a development build on a device or emulator (`npx expo run:android|ios`).

If the sell form does not show **"How do you charge?"** when you pick Services, the override is off (wrong URL, missing variable, or stale cache): stop and fix that before testing anything.

## 3. Test checklist (all unchecked — nothing was executed)

Run each item on **mobile (device/emulator)** and **web (desktop + a phone-width window)**, in **light and dark**, and in English, Somali and Amharic where noted. Note the wording of the six translated strings is unverified (`docs/TRANSLATION_REVIEW_CHECKLIST.md`).

**Creation**
- [ ] Services → any trade: the "How do you charge?" question appears; choosing *Contact for price* hides the amount and the "Price is charged" unit; *Set a price* shows both.
- [ ] Publish with Contact for price and no amount: succeeds; with *Set a price* and no amount: blocked with a clear message.
- [ ] A non-services category never shows the question and still requires a price > 0.
- [ ] Preview screen shows "Contact for price", never "0".

**Editing / reopening**
- [ ] Edit a contact-price listing: the mode is preselected, amount hidden; switch to *Set a price* + amount saves; switch back saves price 0 + mode.
- [ ] Close the app/tab and reopen the listing, my-listings, favorites and recently-viewed: still "Contact for price".
- [ ] With an active discount, changing to Contact for price is refused with the "end the discount first" message.

**Sharing / contact actions**
- [ ] Share message reads "<title> — Contact for price on <brand>" (never "0 Birr").
- [ ] Call and chat contact actions work from the listing page; the chat header shows Contact for price and **no** Make offer button.

**Offers (also proves migration 0087)**
- [ ] No Make offer on a contact-price listing (listing page, chat, offers screen), mobile and web.
- [ ] Priced listing with a **pending** buyer offer → seller edits it to Contact for price. On the offers screen the seller sees **Decline only** (no Accept/Counter). Declining works; the buyer can cancel their own offer; the offer expires on its own otherwise.
- [ ] Switch the listing back to a real price: Accept/Counter reappear.
- [ ] Try the same through a direct API call (use the test project's SQL editor, `update public.offers set status='accepted' …`): refused with "Offers are not available on contact-for-price listings".

**Discounts / price drops**
- [ ] No discount button on a contact-price listing (my-listings, listing page). Priced listings still discount normally.
- [ ] Moving a listing to Contact for price creates no price-drop notification, no "Price reduced" badge, and it is absent from the Price drops screen and tab.

**Sorting / filters / comparison**
- [ ] Home price sort (both directions) and search price sort keep contact-price listings **after** all priced ones; min/max price filters do not match them.
- [ ] Compare screen: the price row says Contact for price; no "cheapest/most expensive" highlight on it; similar-listing market stats ignore it.

**Admin displays**
- [ ] Admin listings list, admin listing detail and report detail show Contact for price (not 0).

**Appearance and input**
- [ ] Dark mode: the radio, the badge text and the card price are readable on every surface above.
- [ ] Keyboards: on the sell price step and edit screen, no field is hidden by the keyboard; hiding the amount field when switching mode dismisses the keyboard cleanly.
- [ ] Dropdown sheets (price unit, trade, availability): open, scroll, select, close; the selection persists after switching modes.
- [ ] Validation: error texts show in all three languages and never say "0"/"free".
- [ ] Narrow screens (320–360 px wide, large system font): "Contact for price" in Somali/Amharic fits on the card and in the chat header without clipping, and the radio options wrap.

**Languages**
- [ ] Switch to Somali and Amharic: the six strings render (draft wording); everything else on those forms is still English by design (222 strings pending).

## 4. Before any production step (not part of this test)
Read-only evidence, not a go decision: production listings today 8, none with price 0, no services rows; 0085 and 0086 are live; 0087 (accept guard) and 0088/0089 are **proposed only**. The flag must stay `false` until 0087 is approved/applied, the checklist above is passed on an isolated database, and the so/am wording is reviewed.
