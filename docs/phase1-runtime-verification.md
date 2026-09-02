# Phase 1 — Real-project runtime verification procedure

Status: **NOT verified.** This document is the procedure to run. Phase 1 stays
"implementation complete, verification pending" until the evidence below is
captured and the matrix passes.

Two things are being verified:

- **Part 1** — the publish-failure fix: `0031_rate_limit_listing_idempotent.sql`
  + the R2 cleanup in `web/src/app/sell/page.tsx`.
- **Part 2** — network-aware error handling: `web/src/lib/errors.ts`,
  `web/src/lib/network.ts`, `web/src/components/ErrorNotice.tsx` and the mobile
  equivalents.

Do **not** change 0031, the R2 cleanup, migrations, package/EAS/Supabase/Firebase
IDs, bucket names, or brand assets during this. If a test proves something is
wrong, record the evidence and stop — the fix is a separate step.

---

## Known project facts (so you don't have to look them up)

| Thing | Value |
|---|---|
| Supabase project ref | `waksddinkjbrggxkfofk` |
| REST base URL | `https://waksddinkjbrggxkfofk.supabase.co/rest/v1` |
| Anon (publishable) key | `sb_publishable_nWRm20prWZZ_TIwwyE6QSA_QiaqXS4p` |
| Web dev URL | `http://localhost:3000` |
| Local-storage auth key | `sb-waksddinkjbrggxkfofk-auth-token` |
| Web sign-in | Google OAuth only (you need a Google account for each test account) |
| Publish request | `POST https://waksddinkjbrggxkfofk.supabase.co/rest/v1/listings` |
| Image presign request | `POST .../functions/v1/r2-presign` |
| Image upload request | `PUT https://<hash>.r2.cloudflarestorage.com/...` |
| `create_listing` limit | 10 per rolling hour, per user (`0019_security_hardening.sql`) |
| `account_status` values | `active` (default) or `suspended` |

### Test accounts you need

- **SELLER** — a throwaway Google account. Used for tests A, B, C, D, E, G, H, I, J
  and all the Part 2 tests. Never a real user.
- **VICTIM** — a second throwaway Google account that owns one listing. Used only
  by test F (cross-user UPSERT). Never a real user's account or listing.

Do every destructive step (suspend, delete, rate-limit reset, cross-user write)
**only** against these test accounts.

---

## SECTION 1 — Setup and orientation

### 1.1 Start the web app

```bash
cd web
npm install          # first time only
npm run dev
```

Wait for `✓ Ready`. Open `http://localhost:3000` in Chrome.

`web/.env.local` already exists with the two `NEXT_PUBLIC_SUPABASE_*` values — if
the app throws "Missing Supabase environment variables" on load, that file is
missing or empty; stop and say so.

### 1.2 Open Chrome DevTools

Press **F12** (or Ctrl+Shift+I). Dock it to the side so you can see the page and
DevTools at once.

### 1.3 Which tabs to open

1. **Network** — click it now. Then:
   - tick **Preserve log** (keeps requests across page loads / step changes)
   - tick **Disable cache**
   - in the filter row click **Fetch/XHR** (hides images/css noise)
2. **Console** — click the settings gear inside DevTools → tick **Preserve log**
   there too. Leave the tab open in a split view (Esc opens the drawer console).
3. **Application** — you'll use this for Local Storage (sign-in state, session
   corruption test).

### 1.4 Perform a listing publish (the canonical action)

1. Signed in as SELLER, go to `http://localhost:3000/sell`.
2. **Step 1 Photos** — Add photos → pick **2** small images → Continue.
3. **Step 2 Category** — pick any category (e.g. Electronics) → Continue.
4. **Step 3 Describe** — Title: use the exact prefix **`PHASE1-TEST A - <time>`**
   (the prefix makes cleanup safe later). Description: anything. Condition: Used →
   Continue.
5. **Step 4 Location & price** — pick a city, Price `1000` → Continue.
6. **Step 5 Preview** — this is where **Publish listing** lives. Before clicking,
   clear the Network log (🚫 icon) so only the publish requests remain.
7. Click **Publish listing**.

Expected happy path: brief spinner → **Step 6 "Listing published"**.

### 1.5 Which Network request to click

After a publish attempt you will see, in order:
- one or more `r2-presign` (POST) — the upload authorizations
- one or more requests to `*.r2.cloudflarestorage.com` (PUT) — the image bytes
- **`listings`** (POST) — **this is the one that matters.** Its URL is
  `https://waksddinkjbrggxkfofk.supabase.co/rest/v1/listings` (on a retry it may
  read `listings?on_conflict=id`).

Click that **`listings`** row.

### 1.6 Where each piece of evidence is

In the panel that opens for the `listings` request:

| Evidence | Where |
|---|---|
| **HTTP status** | **Headers** tab → *General* → "Status Code" (e.g. `201 Created`, `403`, `400`) |
| **Request payload** | **Payload** tab (raw JSON body you sent). Click "view source" for the exact bytes. |
| **Response** | **Response** tab (raw response body text) |
| **Preview** | **Preview** tab (same body, parsed/expandable) |
| Was the JWT sent? | **Headers** tab → *Request Headers* → look for `authorization: Bearer eyJ…` |

For a **failed** publish, the Response/Preview body is a PostgREST error object:
```json
{ "code": "...", "message": "...", "details": "...", "hint": "..." }
```
Record **all four fields verbatim.**

### 1.7 Which Console errors to copy

The publish handler logs failures as `[sell/publish]` (see
`web/src/app/sell/page.tsx` → `logError`). After a failed attempt:

1. In Console, find the red line starting `[sell/publish]`.
2. Click the ▸ triangle to expand the logged error object.
3. Copy: `code`, `message`, `details`, `hint`, `status` (whichever are present),
   and the first line of any stack.
4. Also copy any **other** red lines that appeared at the same timestamp
   (e.g. `Failed to load resource: … 403`, `FunctionsHttpError`, CORS lines).

Tip: right-click the logged object → **Store object as global variable** →
`temp1` → then in the console type `copy(temp1)` to put the whole thing on your
clipboard.

### 1.8 How to know whether you were signed in

Any **one** of these is enough, but check at least two:

1. The site header shows your Google avatar/name, not a "Sign in" button.
2. `/sell` shows the form immediately — it does **not** pop the sign-in modal.
3. DevTools → **Application** → **Local Storage** → `http://localhost:3000` →
   key **`sb-waksddinkjbrggxkfofk-auth-token`** exists, and its value (JSON)
   contains `"user":{"id":"…"}` with an `expires_at` timestamp in the future.
4. In the **Console**, paste:
   ```js
   JSON.parse(localStorage['sb-waksddinkjbrggxkfofk-auth-token'])?.user?.id
   ```
   → prints your user UUID if signed in, `undefined` if not.
5. In the Network tab, the `listings` POST request headers include
   `authorization: Bearer eyJ…` (a long token), not just `apikey`.

### 1.9 Get the SELLER user ID safely

Signed in as SELLER, in the DevTools **Console**:
```js
JSON.parse(localStorage['sb-waksddinkjbrggxkfofk-auth-token']).user.id
```
Copy the UUID it prints. That is `<SELLER_ID>` everywhere below. (Do the same
while signed in as VICTIM to get `<VICTIM_ID>`.)

This is read-only and touches nothing on the server.

---

## SECTION 2 — Safe SQL (Supabase Dashboard → SQL Editor)

Open the [SQL Editor](https://supabase.com/dashboard/project/waksddinkjbrggxkfofk/sql/new).
Replace every `<SELLER_ID>` / `<VICTIM_ID>` / `<LISTING_ID>` placeholder with a
real UUID before running.

### 2.1 Read the seller's create_listing rate-limit count (READ-ONLY, always safe)

```sql
select
  action,
  count(*)                       as events_last_hour,
  min(created_at)                as first_event,
  max(created_at)                as last_event
from public.rate_limit_events
where user_id = '<SELLER_ID>'
  and action  = 'create_listing'
  and created_at > now() - interval '1 hour'
group by action;
```

`events_last_hour` is how many of the 10/hour tokens are spent. `0` rows back =
none spent.

### 2.2 List the seller's actual listings (READ-ONLY, always safe)

```sql
select id, title, status, created_at
from public.listings
where user_id = '<SELLER_ID>'
order by created_at desc
limit 20;
```

Use this to tell "a listing was really created" from "the request just looked
like it succeeded", and to check for duplicates.

### 2.3 Reset the SELLER's create_listing counter (WRITE — test account only)

Needed between tests C and D so you don't have to wait an hour.

```sql
-- SAFETY: verify this is the throwaway seller first.
select id, email from auth.users where id = '<SELLER_ID>';

delete from public.rate_limit_events
where user_id = '<SELLER_ID>'
  and action  = 'create_listing';
```

### 2.4 Suspend / un-suspend the SELLER (WRITE — test account only)

```sql
-- suspend
update public.profiles set account_status = 'suspended' where id = '<SELLER_ID>';
-- ...run the suspended-account test...
-- restore (do this immediately after)
update public.profiles set account_status = 'active' where id = '<SELLER_ID>';
```

### 2.5 Clean up test listings when done (WRITE — test account only)

```sql
delete from public.listings
where user_id = '<SELLER_ID>'
  and title like 'PHASE1-TEST%';
```

R2 images for those rows are orphaned by this raw delete — acceptable for test
data; a later phase adds a server sweep.

---

## SECTION 3 — Console snippets for the security tests

These use `fetch` against the REST API with your own token — **no app code
change, no `supabase` global needed.** Paste into the DevTools Console while
signed in as the stated account. Run each line-block as one paste.

Common header (run first, in the same console session):
```js
const REF  = 'waksddinkjbrggxkfofk';
const ANON = 'sb_publishable_nWRm20prWZZ_TIwwyE6QSA_QiaqXS4p';
const AT   = JSON.parse(localStorage[`sb-${REF}-auth-token`]).access_token;
const H = { apikey: ANON, Authorization: `Bearer ${AT}`, 'Content-Type': 'application/json' };
```

### 3.1 RLS / permission probe — insert a listing owned by someone else

```js
const r = await fetch(`https://${REF}.supabase.co/rest/v1/listings`, {
  method: 'POST',
  headers: { ...H, Prefer: 'return=representation' },
  body: JSON.stringify({
    user_id: '00000000-0000-0000-0000-000000000000',
    title: 'PHASE1-TEST RLS probe', description: 'x',
    category: 'electronics', condition: 'used', price: 1,
    currency: 'ETB', city: 'Addis Ababa', region: 'Addis Ababa',
    images: [], negotiable: false,
  }),
});
console.log('status', r.status, await r.json());
```
Expected: `403` (or `401`) with body `code: "42501"` … "row-level security".
Nothing is created (confirm with 2.2).

### 3.2 Cross-user UPSERT probe (test F) — try to overwrite VICTIM's listing

Signed in as **SELLER**. `<LISTING_ID>` = a listing owned by VICTIM (get it from
2.2 run for `<VICTIM_ID>`).

```js
const r = await fetch(`https://${REF}.supabase.co/rest/v1/listings?on_conflict=id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({
    id: '<LISTING_ID>',
    user_id: JSON.parse(localStorage[`sb-${REF}-auth-token`]).user.id, // SELLER
    title: 'PHASE1-TEST HIJACK ATTEMPT', description: 'x',
    category: 'electronics', condition: 'used', price: 1,
    currency: 'ETB', city: 'Addis Ababa', region: 'Addis Ababa',
    images: [], negotiable: false,
  }),
});
console.log('status', r.status, 'body', await r.json());
```
Expected: `200` (or `201`) with an **empty array `[]`** — the UPDATE half was
filtered out by RLS, zero rows changed. Then confirm VICTIM's listing is
**unchanged** (title, price, user_id) via 2.2. A changed row = **FAIL**.

---

## SECTION 4 — Order of operations

1. **Test 0 first, with 0031 NOT yet applied** — try to reproduce the original
   failure and capture the first failing `listings` response. This is the
   biggest open gap; do not skip it.
2. Check whether 0031 is already live:
   ```bash
   supabase migration list
   ```
   If `0031_rate_limit_listing_idempotent` shows only under "Local" (not
   "Remote"), apply it — easiest low-risk path: open the SQL Editor, paste the
   **entire body of** `supabase/migrations/0031_rate_limit_listing_idempotent.sql`,
   Run. (It is a single idempotent `create or replace function` — safe to run
   even if 0028 hasn't been applied.) Alternative if your migration history is in
   sync: `supabase db push`.
3. Run tests **A → J**, then the Part 2 tests.
4. Between any two tests that create listings, note the running rate-limit count
   (2.1) so you always know how many tokens are left.
5. Paste all recorded evidence back here for analysis.

---

## SECTION 5 — Test 0: capture the first failure (do before applying 0031)

**Setup** — SELLER, fresh: run 2.1 and 2.3 so `events_last_hour` = 0. Network +
Console both preserving log.

**Action** — Do 5–10 normal publishes in a row (new title each time,
`PHASE1-TEST T0 #n`), fairly quickly. You are trying to catch the transient the
report calls "the first `createListing` failure that starts the retry chain."
Watch for a publish that shows the red error notice instead of the success step.

**If you catch a failure**, on that attempt's `listings` POST record:
- HTTP status (1.6)
- Response + Preview body, all four PostgREST fields (1.6)
- the `[sell/publish]` console object (1.7)
- **Critically: was the status `201`?** If `201` but the app still showed an
  error, the row committed and something *after* the write threw — that points
  at the post-write `hydrateSellers()` path (`web/src/services/listings.ts:205`),
  not the insert. If the status was `4xx/5xx`, the insert itself failed and the
  body says why.
- immediately run 2.2 — did the "failed" listing actually get created?
- run 2.1 — how many tokens did the burst spend?

**If you cannot reproduce any failure in ~10 tries**: record that. Note the
publish success rate (e.g. "10/10 succeeded"), and that the first-failure
transient did not reproduce in this environment. That is a real (if partial)
result — it means the compounding rate-limit wall (Part 1's actual fix) is the
only reproducible half.

**Evidence to record:** every failing response body + status, or an explicit
"0 failures in N attempts" with N.

**Pass/fail:** Test 0 has no pass/fail — it is evidence collection. But Phase 1
**cannot be marked fully verified** until either (a) a first-failure response is
captured and understood, or (b) it is formally accepted that it's non-reproducible
and tracked as a known follow-up.

---

## SECTION 6 — Runtime test matrix A–J

> After each test: clear the Network log before the next one, and keep the
> Console. Record evidence in a table with columns: Test / Status seen / Body /
> Console / rate_limit count / listings rows / Pass?

### Test A — First normal listing publish

- **Setup:** SELLER, `events_last_hour` = 0 (2.1/2.3). 0031 applied.
- **Action:** one full publish per Section 1.4, title `PHASE1-TEST A`.
- **Expected:** reaches Step 6. `listings` POST = **201**. Response body = the new
  row (one object). 2.2 shows exactly **one** new row. 2.1 shows
  `events_last_hour` = **1**.
- **Evidence:** the 201 status, the response row `id`, the before/after 2.1 counts,
  the 2.2 row.
- **Pass:** listing created AND exactly one rate-limit event recorded.
- **Fail:** any error notice; 0 or >1 rows; 0 or >1 events.

### Test B — Retry with the same listing UUID (idempotent, no quota cost)

- **Setup:** SELLER. Do a normal publish to Step 6 (title `PHASE1-TEST B`), note
  the created `id` (call it `X`) and the current 2.1 count (call it `N`).
- **Action:** you need the *same* `listingIdRef` to be re-sent. Two ways:
  1. **Preferred (real path):** on a publish attempt, after the `r2-presign` /
     PUT requests succeed but before/at the `listings` POST, use DevTools Network
     → right-click the `listings` request → **Block request URL**, then click
     **Try again** in the app 3–4 times (each blocked → error notice), then
     **unblock** and click **Try again** once more. All attempts share the
     in-memory `listingIdRef` and `uploadedUrlsRef`.
  2. **Direct:** in the Console, re-POST row `X` with
     `Prefer: resolution=merge-duplicates` (Section 3.2 shape but with your own
     `user_id` and `id: 'X'`), 3 times.
- **Expected:** every same-id retry that reaches Postgres resolves to an UPDATE.
  `events_last_hour` stays at **`N`** (0031 skips the count when a row with that
  id exists). Still exactly **one** listing row `X` (2.2). No duplicate.
- **Evidence:** 2.1 count before and after the retries (must be equal); 2.2
  showing a single row `X`; the retry `listings` requests reading
  `listings?on_conflict=id` with 200/201.
- **Pass:** count unchanged, no duplicate row.
- **Fail:** count increased by the number of retries (this is the pre-0031 bug —
  means 0031 is not applied or not working).

### Test C — 10 genuine new listings in an hour are allowed

- **Setup:** SELLER, `events_last_hour` = 0 (2.3).
- **Action:** publish **10** genuinely new listings (`PHASE1-TEST C #1`..`#10`),
  each a full fresh flow (do not reuse a draft — each must get a new UUID).
- **Expected:** all 10 reach Step 6. 2.1 shows `events_last_hour` = **10**. 2.2
  shows 10 new rows.
- **Evidence:** 2.1 = 10; count of new rows in 2.2 = 10; all 10 `listings` POSTs
  = 201.
- **Pass:** 10/10 succeed, exactly 10 events.
- **Fail:** any of the first 10 rejected; event count ≠ 10.

### Test D — the 11th genuine new listing is rejected

- **Setup:** directly continues Test C (`events_last_hour` = 10).
- **Action:** attempt an 11th brand-new publish (`PHASE1-TEST D #11`).
- **Expected:** publish fails at the `listings` POST. Status typically **400**
  (PostgREST wraps the trigger `RAISE`). Body `code: "P0001"`, `message`
  contains `Rate limit exceeded for "create_listing"`. The app shows the
  ErrorNotice with title **"Too many attempts"** and **no** "Try again" button
  (`rate-limited` is not retryable). 2.2 shows **no** 11th row. 2.1 still = 10
  (a rejected attempt does not consume a token — `enforce_rate_limit` checks
  before inserting the event).
- **Evidence:** the 400 + `P0001` body; a note that the "Too many attempts"
  notice appears with no retry button; 2.1 still 10; 2.2 has no #11.
- **Pass:** 11th rejected with P0001, no row, count stays 10.
- **Fail:** 11th succeeds; or count goes to 11; or a "Try again" button appears.

### Test E — a lost publish response does not create a duplicate

- **Setup:** SELLER, run 2.3 (count 0). Start a fresh publish flow
  (`PHASE1-TEST E`), get to Step 5.
- **Action:** DevTools Network → set throttling to **custom / add a profile with
  a huge latency**, OR: click Publish, and the instant the `listings` POST
  appears, right-click it → **Block request URL** is too late; instead use
  Network conditions → go **Offline** *after* the request is sent but before the
  response — hard to time. Simplest reliable version: let the publish **succeed**
  to Step 6, then (without reloading) press the browser Back button to return to
  the Sell flow Step 5 and press **Publish listing** again. `listingIdRef` was
  cleared on the first success, so this is actually a *new* id — that tests the
  reset. For the true "lost response" case use Test B method 1 (block → retry →
  unblock).
- **Expected (Test B method):** after the response was "lost" (blocked) and then
  retried, exactly **one** listing row exists (2.2), and `events_last_hour` = 1,
  not one-per-attempt.
- **Evidence:** 2.2 single row; 2.1 = 1; the sequence of blocked/succeeded
  `listings` requests in Network.
- **Pass:** one row, one event, regardless of how many retries.
- **Fail:** two+ rows with different ids for the same item; or event count = retry
  count.

### Test F — cross-user UPSERT cannot modify another user's listing

- **Setup:** VICTIM publishes one listing (`PHASE1-TEST F victim`), note its
  `id` and current title/price (2.2 for `<VICTIM_ID>`). Sign out, sign in as
  SELLER.
- **Action:** run the Section 3.2 console snippet with VICTIM's listing `id`.
- **Expected:** HTTP `200/201`, body `[]` (empty). VICTIM's row in 2.2 is
  **byte-for-byte unchanged** — same `title`, `price`, `user_id`, `images`.
- **Evidence:** the console `status` + `[]` body; VICTIM's listing row from 2.2
  **before and after** (paste both).
- **Pass:** empty result AND victim row unchanged.
- **Fail:** victim row's title/price/user_id changed in any way.

### Test G — a partial R2 upload batch cleans up the objects that landed

- **Setup:** SELLER. Fresh flow, **add 2 photos**, get to Step 5.
- **Action:** DevTools Network → **right-click** a `*.r2.cloudflarestorage.com`
  URL from a previous run → **Block request URL**, then edit the pattern to
  block **only the second** PUT is hard; simpler: block the `r2-presign`
  function URL pattern **`*/functions/v1/r2-presign*`** *after the first presign
  succeeds* is also hard to time. Reliable method: use
  **Network → Block request URL** and add pattern `*r2.cloudflarestorage.com*`,
  then in the app remove one photo so only 1 remains? No — you need a batch where
  *some* succeed and *some* fail.
  **Recommended:** add 2 photos. Add block pattern `*r2.cloudflarestorage.com*`
  but **disable** it. Start Publish. As soon as the first PUT completes (200),
  **enable** the block pattern (checkbox) — the second PUT now fails.
- **Expected:** publish fails with the upload error ("We couldn't upload your
  image"). In Network, shortly after the failure, a **`POST .../functions/v1/
  r2-delete`** appears whose payload `keys` array contains the key of the image
  that *did* upload. `listingIdRef`/`uploadedUrlsRef` stay null → on a retry you
  see **fresh `r2-presign` + PUT** requests for *both* images (nothing reused).
- **Evidence:** the failed PUT; the `r2-delete` POST with its `keys` payload; the
  fresh presign calls on retry.
- **Pass:** `r2-delete` fired for the succeeded key(s); retry re-uploads a clean
  set.
- **Fail:** no `r2-delete` call; or the retry skips re-upload and publishes with
  a half-set of images.

### Test H — a successful upload batch followed by a listing failure reuses the images

- **Setup:** SELLER, run 2.3 (count 0). Fresh flow, 2 photos, Step 5.
- **Action:** Network → add block pattern **`*/rest/v1/listings*`**, enabled.
  Click Publish. The 2 PUTs succeed; the `listings` POST is blocked → error
  notice. Now **disable** the block pattern and click **Try again**.
- **Expected:** on "Try again" there are **no new `r2-presign` or PUT requests** —
  only a `listings` POST (now `on_conflict=id`), which succeeds → Step 6. Exactly
  one listing row; `events_last_hour` = **1** (the blocked attempts never reached
  the trigger; the successful one counts once).
- **Evidence:** Network showing zero upload requests on the retry; 2.2 single
  row; 2.1 = 1; the listing's `images` array = the 2 URLs from the first upload.
- **Pass:** images reused, one row, one event.
- **Fail:** retry re-uploads; or multiple rows; or event count > 1.

### Test I — website publish works end-to-end

- **Setup:** SELLER, count 0, 0031 applied, **no** DevTools blocking/throttling.
- **Action:** one clean full publish (`PHASE1-TEST I`), 2 real photos.
- **Expected:** Step 6. 2.2 shows the row with a real R2 `images` URL that opens
  in a browser. Open the mobile app (or the web home feed) — the listing appears
  in the shared feed.
- **Evidence:** the 201; the live row; the image URL loading; the listing visible
  in the feed.
- **Pass:** listing is live and visible with working images on web.
- **Fail:** any step breaks.

### Test J — mobile publish remains functional

- **Setup:** SELLER signed into the mobile app (`npx expo start`, dev build /
  Expo Go). Mobile uses a plain `.insert()` (no client id, no upsert) and is
  **not** changed by Phase 1 — this test just confirms no regression.
- **Action:** publish a listing from the mobile Sell flow (`PHASE1-TEST J`).
- **Expected:** succeeds. 2.2 shows the row. 2.1 `events_last_hour` increments by
  1. The 0031 change (`not exists` check) does not affect a genuine insert with a
  fresh server-generated id.
- **Evidence:** the new row in 2.2; 2.1 before/after.
- **Pass:** mobile publish still works, one event per publish.
- **Fail:** mobile publish errors, or double-counts, or is rate-limited early.

---

## SECTION 7 — Part 2 tests (network-aware error handling)

Same recording discipline. These are web unless noted. For each: the app must
show a **titled ErrorNotice** (never a raw "Failed to fetch" / PostgREST code /
stack), with the retry affordance matching the kind.

### P2-1 — Offline before publishing

- **Setup:** SELLER, Step 5.
- **Action:** DevTools → Network → throttling dropdown → **Offline**. Click
  **Publish listing**.
- **Expected:** *fast* failure (the `isBackendReachable()` pre-flight probe, not a
  long timeout). ErrorNotice title **"No internet connection"**, with a **"Try
  again"** button. **No** `r2-presign`, **no** `listings` request is sent. 2.1
  unchanged, 2.2 no new row.
- **Pass:** offline copy, retry button present, zero network writes attempted.
- **Fail:** raw error text; long hang; any request actually sent.

### P2-2 — Reconnect and retry

- **Setup:** continues P2-1 (error showing).
- **Action:** throttling → **No throttling / Online**. Click **Try again**.
- **Expected:** publish proceeds and succeeds → Step 6. Because `listingIdRef`
  and (if uploads had happened) the upload refs are stable, there is **one**
  listing row and **one** rate-limit event.
- **Pass:** succeeds, exactly one row, one event.
- **Fail:** duplicate row; multiple events; re-upload of already-uploaded images.

### P2-3 — Remain offline and retry repeatedly

- **Setup:** SELLER, Step 5, DevTools **Offline**.
- **Action:** click **Publish**, then **Try again** 4–5 times, staying offline.
- **Expected:** every attempt fails fast with "No internet connection". After all
  of them: 2.1 `events_last_hour` **unchanged** (still 0), 2.2 **no** new rows,
  Network shows **no** `listings` or `r2-presign` requests at all.
- **Pass:** nothing sent, nothing counted, nothing created, across all retries.
- **Fail:** any request leaves the browser; any count/row change.

### P2-4 — Expired / invalid session

- **Setup:** SELLER, Step 5. DevTools → **Application** → Local Storage →
  `http://localhost:3000` → open `sb-waksddinkjbrggxkfofk-auth-token`. In the
  JSON value, corrupt **both** `access_token` and `refresh_token` (change ~5
  characters in the middle of each) and set `expires_at` to `1`. Save (Enter).
  Do **not** reload.
- **Action:** click **Publish listing**.
- **Expected:** the request (or a token refresh) returns **401**. ErrorNotice
  title **"Your session has expired"**, with a **"Sign in again"** button and
  **no** "Try again" button (`auth-expired` is not retryable). No listing row.
- **Evidence:** the 401 in Network; the notice with the sign-in button.
- **Pass:** auth-expired copy, sign-in affordance, no write succeeds.
- **Fail:** raw 401/JWT text; a generic retry button; or the publish somehow
  succeeds.
- **Cleanup:** sign out and back in (or clear that storage key and reload).

### P2-5 — Permission / RLS error

- **Setup:** SELLER, Console, Section 3 common header pasted.
- **Action:** run the Section 3.1 snippet (insert a listing with a foreign
  `user_id`).
- **Expected:** `403` (or `401`), body `code: "42501"` / "row-level security".
  Mapped by `classifyError` to **`permission`** → "You don't have permission",
  not retryable. (This is the classifier test; the Sell form itself can't send a
  foreign id, which is *why* we probe via REST.)
- **Evidence:** the console status + body.
- **Pass:** 42501 / permission classification; nothing created (2.2).
- **Fail:** the insert succeeds (RLS hole — stop and report immediately).

### P2-6 — Upload failure

- **Setup / Action / Expected:** identical to **Test G** — an upload failure must
  surface as **"We couldn't upload your image"** (`upload-failed`, retryable) and
  trigger the R2 cleanup. Record it once, reference it for both.

### P2-7 — Suspended account

- **Setup:** run 2.4 to set SELLER `account_status = 'suspended'`. SELLER already
  signed in, Step 5.
- **Action:** click **Publish listing**.
- **Expected:** the `listings` POST fails — the trigger raises `Account
  suspended` with errcode `42501`. Body message contains **"Account suspended"**.
  App shows the `permission` ErrorNotice ("You don't have permission"), not
  retryable. No listing row. 2.1 unchanged.
- **Evidence:** the response body "Account suspended"; the notice.
- **Pass:** blocked, permission copy, nothing created.
- **Fail:** publish succeeds while suspended.
- **Cleanup — do immediately:** run the restore half of 2.4
  (`account_status = 'active'`).

### P2-8 — Mobile parity spot-check (optional but recommended)

- On the mobile app, turn on Airplane mode and attempt a publish → expect the
  mobile `ErrorState` with the translated `errors.classified.offline.*` copy
  (check in English, then switch language to Somali and Amharic and repeat — the
  keys exist in all three `locales/*/translation.json`). Reconnect → retry →
  succeeds.

---

## SECTION 8 — What to paste back for analysis

For each of Test 0, A–J, P2-1..P2-8, one block:

```
TEST <id>
  signed in as: <SELLER / VICTIM / n/a>   user id: <uuid>
  0031 applied: <yes/no>
  action taken: <one line>
  listings POST status: <e.g. 201 / 400 / 403 / not sent>
  response body: <verbatim JSON or "n/a">
  console [sell/publish]: <verbatim fields or "none">
  rate_limit_events create_listing (2.1) before -> after: <n> -> <m>
  listings rows (2.2) delta: <+1 / 0 / +2 ...>
  app showed: <success step 6 / ErrorNotice "<title>" + [buttons]>
  my pass/fail: <pass/fail/unsure>
```

Plus, for **Test 0** specifically, the answer to: *did any publish fail, and if
so was its status 201?*

---

## SECTION 9 — How the results will be judged

After you paste the evidence, the analysis will state, explicitly:

1. **Part 1 verified?** — requires: A pass, B pass (retry adds 0 events),
   C pass (10 allowed), D pass (11th = P0001, count stays 10), E pass (no dup),
   F pass (victim row untouched), G + H pass (R2 cleanup + reuse), I pass, J pass.
2. **Part 2 verified?** — requires: P2-1..P2-7 each show the correct titled
   ErrorNotice, correct retryable/non-retryable affordance, and no write leaks
   through on the non-retryable ones.
3. **Still needs fixing?** — the first-failure transient (Test 0): confirmed and
   understood, or formally accepted as non-reproducible and tracked. Plus
   anything a test surfaces.

Phase 1 is **not** "PASSED" until 1 and 2 are green and 3 is resolved one way or
the other. Only then does Phase 2 (moderation / DB foundation) start.
