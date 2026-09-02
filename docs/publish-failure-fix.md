# Part 1 — Publish failure fix proposal

Status: **implemented, runtime verification pending** (this environment has no
access to the live Supabase project, so the PostgREST response body and
`rate_limit_events` rows could not be captured here — see "What still needs to
be verified on the real project" below).

---

## Symptom

Publishing a listing from the website fails. The reported chain is:

1. `Publish` tapped on the Preview step (`web/src/app/sell/page.tsx`).
2. R2 image upload succeeds.
3. `createListing()` fails.
4. The seller retries.
5. After a few retries the failure becomes a hard
   `P0001 – Rate limit exceeded for "create_listing": try again later.`

## Root cause (the compounding failure)

`0019_security_hardening.sql` installs:

```sql
create trigger rate_limit_listings
  before insert on public.listings
  for each row execute function public.trg_enforce_rate_limit('create_listing');
```

`trg_enforce_rate_limit()` records one `rate_limit_events` row per call and
raises `P0001` once a user has 10 within the last hour.

Part 2 (already in the working tree) made the web `createListing()` retry‑safe:
it now sends an **idempotent** `INSERT … ON CONFLICT (id) DO UPDATE`
(`supabase-js .upsert(row, { onConflict: 'id' })`) keyed by a stable
client‑generated UUID (`listingIdRef`), so a lost network response on a publish
that actually committed cannot create a duplicate listing on retry.

But PostgreSQL fires **`BEFORE INSERT` triggers for the proposed row before it
detects the `ON CONFLICT` and switches to the `UPDATE` path**. So:

- Every retry of an already‑committed publish still fires
  `rate_limit_listings` and still records a `create_listing` event — even
  though the statement resolves to an `UPDATE`, not a new listing.
- A seller who retries a flaky publish a handful of times silently burns their
  entire 10/hour quota, then cannot publish at all for an hour.

This is the **same class of bug** as
`0028_fix_rate_limit_create_message.sql`: a rate‑limit trigger firing on a
write that is not the end‑user action it is meant to be limiting.

The *first* `createListing()` failure in the chain (step 3) is a separate,
still‑unconfirmed transient (most likely a network blip, or a post‑write
`hydrateSellers()` throw — see "Remaining limitations"). The rate‑limit wall is
what turns a recoverable transient into a dead end.

## Fix

### 1. Rate limiting counts genuine new listings only — `0031_rate_limit_listing_idempotent.sql`

`create or replace function public.trg_enforce_rate_limit()` (no trigger
re‑creation — the existing triggers already call it by name), changing only the
`create_listing` branch:

```sql
when 'create_listing' then
  if not exists (select 1 from public.listings where id = new.id) then
    perform public.enforce_rate_limit('create_listing', 10, interval '1 hour');
  end if;
```

Column defaults (`id := gen_random_uuid()`) are applied before `BEFORE INSERT`
triggers run, so `new.id` is always populated and the existence check is exact:

- **Genuinely new listing** (fresh UUID, client‑ or server‑generated) →
  `not exists` is true → still counted, still capped at 10/hour.
- **Idempotent retry** (same UUID, row already committed) → `not exists` is
  false → not counted, upsert proceeds to its `UPDATE` half.

All other `0028` behavior is reproduced verbatim: `fursad.admin_write` bypass,
suspension enforcement, `suuqplus.skip_rate_limit` bypass, `create_message`.

**Why it is safe**

| Concern | Outcome |
|---|---|
| New‑listing abuse | Each new listing needs a new UUID → each is counted. Reusing an existing id can only ever `UPDATE` that one row, never create. |
| Cross‑user takeover (test F) | Unchanged. The upsert `UPDATE` half is gated by `"users can update their own listings" USING (auth.uid() = user_id)`, evaluated against the **existing** row. A client passing another user's id gets an RLS no‑op → `PGRST116`, not a takeover. The trigger change does not widen this. |
| RLS in general | Untouched. |
| Concurrency | Two concurrent inserts of the *same new* id: both see no row, both count, one wins the insert, the other `UPDATE`s or hits `23505`. Over‑counts by at most 1 in a genuine race; the retry scenario is sequential, not concurrent. |
| Rejected attempts | `enforce_rate_limit()` inserts the event only *after* the count check passes, so an attempt that is itself rejected never consumes a token. |

### 2. R2 orphan cleanup on failed upload — `web/src/app/sell/page.tsx`

Before: `Promise.all` uploads N images; `uploadedUrlsRef` is populated only
after *all* succeed. A partial failure leaves the succeeded objects in R2 with
nothing referencing them, and the retry re‑uploads everything.

After:

- Uploads run with `Promise.allSettled`; every fulfilled result is captured as
  it settles (`{ url, key }`).
- If any upload in the batch failed, the objects that *did* land in R2 this
  attempt are dropped via `deleteFromR2(keys)` — best‑effort, never blocks the
  error the seller sees — and the refs stay null so the retry re‑uploads a
  clean set.
- If the whole batch succeeded, `uploadedUrlsRef` / `uploadedKeysRef` are set,
  so a later `createListing()` failure retries **without re‑uploading**
  (test H).
- On unmount with uploaded‑but‑unpublished keys (seller abandons the flow
  after uploads but before a committed listing), the same best‑effort
  `deleteFromR2` runs. On successful publish the refs are cleared first, so
  nothing an existing listing references is ever deleted.

`deleteFromR2` → `r2-delete` Edge Function enforces a per‑key
`key.split('/').includes(userId)` ownership check, and R2 `DELETE` is
idempotent (204/404 both treated as success), so this cannot touch another
user's objects and cannot fail loudly on "already gone".

## Behavior: before vs after

| Scenario | Before | After |
|---|---|---|
| A. First publish under the limit | 1 listing, 1 event | unchanged |
| B. Retry with same UUID after a lost response | +1 event each retry | 0 extra events, upsert `UPDATE` |
| C. Repeated genuine new listings | reaches 10/hour | unchanged |
| D. 11th genuine listing | `P0001` | `P0001` (unchanged) |
| E. Retry after lost response | no duplicate (Part 2) | no duplicate, no quota cost |
| F. UPSERT with another user's id | RLS no‑op | RLS no‑op (unchanged) |
| G. One upload in a batch fails | succeeded objects orphaned | succeeded objects cleaned up |
| H. `createListing` fails after uploads | retry re‑uploads all | retry reuses uploaded set |

## What still needs to be verified on the real project

1. Reproduce the publish failure; capture the PostgREST response body from the
   failing `createListing()` call in the Network tab. Confirm whether it is
   `P0001` + "Rate limit exceeded", or something else (that identifies the
   *first*-failure transient in step 3).
2. `select action, count(*) from public.rate_limit_events where user_id = '<seller>' and created_at > now() - interval '1 hour' group by action;`
3. Apply `0031`, then run through tests A–J.

## Remaining limitations / follow‑ups (not in this change)

- **First‑failure transient unidentified.** `createListing()` runs
  `hydrateSellers([data])` *after* the row write with no try/catch — a throw
  there (profiles query / `getSellerStatsBatch`) turns a committed insert into
  a thrown error, which is what starts the retry chain. Worth wrapping so a
  hydration failure after a successful write returns the listing rather than
  throwing. Left out here to keep the diff focused on what was approved.
- **Tab‑close abandonment.** Cleanup on unmount covers in‑app navigation away
  from the Sell flow; a hard tab close mid‑flow can still orphan an upload.
  A server‑side sweep of unreferenced `listings/<uid>/…` objects older than N
  hours is the complete fix and belongs in a later phase.
- **Mobile** publish still uses a plain `.insert()` (no client id, no upsert).
  It is unaffected by this bug and unchanged here; retry‑safety parity is a
  Phase 5 item.
- **`listingIdRef` is in‑memory only.** A full page reload between attempts
  starts a new UUID (new upload, new listing id). Acceptable for now; a
  `sessionStorage`‑backed id is a possible small follow‑up but risks stale
  drafts and was explicitly deferred.
