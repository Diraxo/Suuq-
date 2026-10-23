# Media staging runbook (avatars, logos, banners, listing photos)

Written 2026-10-19 for branch `ios-app-store-readiness`. **Nothing in this file has been executed.** It is the exact procedure for the external tests that could not run locally. Status stays **RELEASE BLOCKED — EXTERNAL GATES REMAIN** until every mandatory gate in §10 has evidence and the approvals in §11 are recorded.

> **POLICY UPDATE 2026-10-21 (read first).** The shipped media policy is **direct upload, enforcement OFF** (owner decision: the scan Worker is not deployed and uploads were failing on a device). Migration 0057 therefore seeds `business_media_config` with an EXPLICIT `enforce=false` row, and a missing row / NULL reads as ON. Today's clients (mobile + web) and `r2-presign` use the presigned PUT for `avatars/` and `business/`; the Worker route and the `scanPolicy.ts` gates exist but are **not wired**. Consequences for this runbook: (1) wherever it says `enforce` must read `true`, read it as "must read the mode the owner chose for THIS environment": `false` for the direct-upload release, `true` only for the scanned-path rehearsal; (2) the U-series upload tests, the Worker gates and the "unconditional 426" deploy order describe the **scanned path**, which needs client + presign changes that are not in the repo yet; they are NOT release gates for the direct-upload release, and are kept for the day the Worker ships; (3) the direct-upload release has its own gates in `MEDIA_LAUNCH_POLICY.md` (the foreign-host mitigation, now built locally as migration 0062, and the `storefront_media_hosts` fill: see §1.5 below, which must be done BEFORE 0062 is applied). Unscanned uploads are NOT checked for content.

Companion documents (do not duplicate, follow them for the detailed test matrices): `BUSINESS_MEDIA_STAGING_CHECKLIST.md` (gates A–P), `MEDIA_LAUNCH_POLICY.md` (policy + gate table), `IMAGE_PARITY_STAGING_RUNBOOK.md` (listing photos / watermark), `PRE_STAGING_BLOCKER_CLOSURE_REPORT.md` (what changed before this runbook).

Rules for everyone running this:
- Placeholders look like `<STAGING_PROJECT_REF>`. Never paste a real key, token, service-role key, Vision key, R2 secret or user JWT into a document, ticket, chat or commit. Redact ids and private URLs in saved evidence.
- Use disposable test accounts and generated images only (`node scripts/make-staging-testset.mjs`). Never use a real user's photo.
- If any step shows the production project ref (`waksddinkjbrggxkfofk`), the production bucket (`fursad-media`) or the production public URL, **stop**. Nothing below is allowed to touch them.
- Anything not proven with evidence stays `BLOCKED`. Do not write `PASSED` from memory.

---

## 1. Staging Supabase project and migration-history inspection

**1.1 Create or choose a staging project that is not production.** A free-tier project is enough. Record `<STAGING_PROJECT_REF>` and confirm it differs from the ref in `supabase/.temp/linked-project.json` (that file links the CLI to the production project). Run the CLI with an explicit `--project-ref <STAGING_PROJECT_REF>`; do not rely on the linked project.

**1.2 Migration-history inspection (read-only, mandatory, before any apply).** The repository cannot say whether `0057` / `0059` (or any of `0054`–`0059`) were ever applied to a shared dev or staging database. 0057 and 0059 were edited in place on 2026-10-19; an earlier draft of 0057 defaulted enforcement **OFF**, and re-applying the current file over that draft would **keep** `enforce=false` (the row already exists). So inspect, do not assume. Run in the SQL editor of the target database:

```sql
-- (a) what the migration tracker says (may be empty if migrations were pasted by hand)
select version, name from supabase_migrations.schema_migrations order by version desc limit 20;

-- (b) object fingerprints: every row below must be NULL/0 on a clean database
select to_regclass('public.storefronts')                as t0054_storefronts,
       to_regclass('public.account_deletion_jobs')      as t0055_ledger,
       to_regclass('public.business_media_scans')       as t0057_scans,
       to_regclass('public.business_media_config')      as t0057_config,
       to_regclass('public.business_media_backfill')    as t0058_backfill,
       (select count(*) from pg_proc where proname in ('guard_profile_content','profile_social_ok')) as t0056_fns,
       (select count(*) from pg_proc where proname in ('_bm_key_ok','_bm_url_ok','_bm_check_slot','_bm_check_avatar',
            'business_media_enforced','trg_profile_business_media_scan','trg_storefront_business_media_scan',
            'profile_media_freeze','storefront_media_freeze')) as t0057_0059_fns;

-- (c) only if business_media_config exists: it must read the owner's chosen mode (false = direct-upload release, true = scanned path)
select id, enforce from public.business_media_config;

-- (d) how handle_new_user reads (0059 sets avatar to null; the original trusts user metadata)
select pg_get_functiondef('public.handle_new_user'::regproc);
```

Decision table:

| Result | Meaning | Action |
|---|---|---|
| All (b) empty/0, (a) has nothing ≥ 0054 | Clean database | Continue to §5 |
| Any (b) object exists | Some of 0054–0059 (or a rollback freeze) is already there | **Stop.** Save the output as evidence, identify which draft is present (compare function bodies with the files), decide with the owner whether to rebuild the staging database from scratch (recommended) or to reconcile. Do not "just apply on top". |
| (c) returns no row, or `enforce` differs from the mode the owner chose for this environment | A draft is live, or the flag was changed by hand | **Stop.** A missing row reads as ENFORCED (every avatar/logo/banner save fails). Rebuild, or after owner approval set it explicitly (`update public.business_media_config set enforce = <chosen>;`) and record who/why |
| (d) body copies `raw_user_meta_data ->> 'avatar_url'` / `picture` | 0059 not applied; signup still trusts user metadata | Expected before 0059; must be gone after §5 |

Repeat 1.2 against **production** only if the owner authorises a read-only check, and only to *record* history (§11 gate M). Never apply from this runbook to production.

**1.2a 0062 fingerprint (add to the (b) check).** `select count(*) from pg_proc where proname in ('_pmh_url_ok','_pmh_check_slot','trg_profile_media_host_pin')` must be 0 on a clean database and 3 after 0062; `select to_regclass('public.storefront_media_hosts')` must be non-null before 0062 (it comes from 0054).

**1.5 Host-pin preflight (0062; mandatory before applying it, read-only until the insert).** 0062 seeds no host and fails closed, so the order is fixed. The real `R2_PUBLIC_URL` is an Edge Function secret; this runbook never prints it.
1. Read the host from the environment's own evidence, not from memory: `supabase secrets list --project-ref <REF>` shows only that `R2_PUBLIC_URL` exists (digest, not value), so take the value from the Cloudflare dashboard (bucket → Public access: the `r2.dev` URL or the connected custom domain) and compare it with what existing rows actually use:
   ```sql
   -- hosts that real managed uploads were saved under (read-only). Expect exactly the host(s) you are about to register.
   select substring(avatar_url from '^https://([^/]+)/') as host, count(*) from public.profiles where avatar_public_id is not null group by 1
   union all
   select substring(logo_url from '^https://([^/]+)/'), count(*) from public.storefronts where logo_public_id is not null group by 1;
   ```
2. Verify the secret is a **bare origin**: `https://<host>` with no path, no port, no trailing path segment (presign builds `<base>/<key>`; the pin accepts exactly `https://<host>/<key>`). If it has a path or port, fix the secret or stop (decision needed: the pin cannot express it).
3. Register the host (lower-case, no scheme/port/path), then confirm: `insert into public.storefront_media_hosts(host) values ('<lower-case host>'); select host from public.storefront_media_hosts;`
4. Count rows that 0062 will leave untouched but that do not match (informational, nothing is changed): `select count(*) from public.profiles p where avatar_public_id is not null and not exists (select 1 from public.storefront_media_hosts h where p.avatar_url = 'https://' || h.host || '/' || p.avatar_public_id);`
5. Apply 0062. It raises a WARNING if the host list is empty (do not continue if you see it).
6. Evidence: upload one avatar, one logo and one banner from a real device and from the web (all three must save); then with a test JWT try `update profiles set avatar_url='https://example.invalid/avatars/<uid>/<uuid>.jpg', avatar_public_id='avatars/<uid>/<uuid>.jpg'` (must fail with hint `image_host_not_allowed`) and an unrelated edit on an account holding a legacy Google/Cloudinary avatar (must succeed).
7. Emergency exit if uploads are refused: first check step 3 (a wrong or missing host row is the usual cause); the rollback `supabase/rollback/0062_profile_media_host_pin_ROLLBACK.sql` removes only the pin and reopens the foreign-host gap.
Proven on PGlite only (`profile_media_host_pin.test.mjs`); not proven against a real project.

**1.6 URL-only block (0063; apply AFTER 0062, read-only preflight first).** 0063 needs no host row and cannot fail closed on a missing config, but it changes what old app builds may write, so check the evidence first. The repository holds NO record of the deployed app version or a minimum supported version (no tags, no `app.json` build numbers, `eas.json` uses a remote version counter, no forced-update mechanism), so take the facts from the EAS dashboard and the store consoles, not from the code.
1. Read-only: how many profiles hold a URL-only value today (informational; 0063 never rewrites them): `select count(*) filter (where avatar_url is not null and avatar_public_id is null) as av, count(*) filter (where business_logo_url is not null and business_logo_public_id is null) as lg, count(*) filter (where business_banner_url is not null and business_banner_public_id is null) as bn from public.profiles;` (logo/banner are cleared on profiles once mirrored to storefronts, so also count `storefronts` with a url and no key).
2. Ask EAS / the store consoles whether any build older than `d22fe4a` (the first R2-upload commit, 2026-09-05) was ever distributed, and which builds are still active. If one is active, decide before applying: it could not CHANGE its photo/logo/banner (other edits unaffected).
3. Apply 0063. Evidence with a test JWT: update a legacy-URL account's bio (must succeed); `update profiles set avatar_url='https://res.cloudinary.com/x/y.jpg', avatar_public_id=null` on a fresh account (must fail, hint `url_only_not_allowed`); upload one avatar, one logo and one banner from a real device and the web (all must save).
4. Emergency exit: `supabase/rollback/0063_profile_url_only_block_ROLLBACK.sql` removes only the block (no data changed) and reopens the URL-only carve-out. Rollback order stays strictly reverse: 0063, 0062, 0059, 0058, 0057, 0056.
Proven on PGlite only (`profile_url_only_block.test.mjs`); no real client build was run against it.

**1.3 Baseline data copy (optional but valuable).** Apply migrations to a fresh project, then load a small anonymised sample of profiles with legacy avatar/logo/banner URLs (Google, Cloudinary, picsum, own-key) so grandfathering and the freeze can be observed on realistic rows. Never copy real emails or photos.

---

## 2. Dedicated staging R2 buckets and access policy

Create **two** buckets in the Cloudflare account (names are examples):

| Purpose | Name | Public access |
|---|---|---|
| Private (originals, held derivatives) | `<STAGING_PRIVATE_BUCKET>` | **None.** No `r2.dev` URL, no custom domain |
| Public (scanned derivatives) | `<STAGING_PUBLIC_BUCKET>` | Public via `<STAGING_PUBLIC_URL>` only (r2.dev subdomain or custom domain) |

Access:
- Create a staging-only R2 API token scoped to those two buckets (Object Read & Write). It is used only by the `r2-presign` / `r2-delete` / `r2-verify-images` Edge Functions of the **staging** Supabase project. Never reuse the production token.
- The Worker reaches R2 through bindings (no S3 credentials).
- Evidence E-2: screenshot/CLI output of the bucket list and of "public access: disabled" on the private bucket (redact account id).

---

## 3. Vision / scanner Worker deployment and secret configuration

All commands run from `workers/image-scan`. **Always pass `--env staging`**; the top-level `wrangler.toml` values name production resources.

1. Fill the `[env.staging]` placeholders in `wrangler.toml` locally (do not commit real values if the owner prefers not to; the repo test only forbids production values there):
   `bucket_name` (private, public), `PUBLIC_BASE_URL = "https://<STAGING_PUBLIC_URL host>"`, `SUPABASE_URL = "https://<STAGING_PROJECT_REF>.supabase.co"`, `ALLOWED_ORIGINS = "https://<STAGING_WEB_ORIGIN>"`.
2. Dry run first: `npx wrangler deploy --env staging --dry-run` and confirm the printed bindings show the staging bucket names and **not** `fursad-media` / `suuqiye-private`. If wrangler is not installed: `npx wrangler@4` (needs network; this is the first network step of the runbook).
3. Secrets, per environment (typed into the prompt, never on the command line, never saved):
   `npx wrangler secret put SUPABASE_SERVICE_KEY --env staging` (staging project service-role key)
   `npx wrangler secret put SUPABASE_ANON_KEY --env staging`
   `npx wrangler secret put VISION_API_KEY --env staging` (Google Cloud Vision key restricted to the Vision API; set a low daily quota and a billing alert)
   Leave `BACKFILL_SECRET` **unset** until §7 step 11.
4. Deploy: `npx wrangler deploy --env staging`. Record the Worker URL `<STAGING_WORKER_URL>`.
5. Fail-closed checks on the deployed Worker (evidence E-3):
   - `GET <STAGING_WORKER_URL>/v1/business-media` → 404.
   - `POST` with no token → 401. With a token for another project → 401.
   - Set `PUBLIC_BASE_URL` to an empty/`http://` value in a throw-away deploy → every upload answers 500 `internal` and publishes nothing (`normalizePublicBase`). Restore the real value.
6. Cron / bulk: leave `[triggers]` commented and `BULK_ENABLED="false"`.

---

## 4. Environment variables

| Where | Name | Staging value |
|---|---|---|
| Staging Supabase Edge Function secrets | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (= `<STAGING_PUBLIC_BUCKET>`), `R2_PUBLIC_URL` (= `<STAGING_PUBLIC_URL>`), `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | staging only |
| Mobile staging build (EAS env, not `.env`) | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_IMAGE_SCAN_URL=<STAGING_WORKER_URL>` | staging only; `eas env:create` — a value in `.env` is not inside store builds |
| Web staging deployment (separate Vercel project/preview, never the production project) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_IMAGE_SCAN_URL=<STAGING_WORKER_URL>`, plus the R2 public host in `next.config.mjs` `images.remotePatterns` if required | staging only |
| Worker | see §3 | staging only |

Verify before testing (evidence E-4): mobile/web bundles contain `<STAGING_PROJECT_REF>` and no production ref; `EXPO_PUBLIC_IMAGE_SCAN_URL` unset ⇒ uploads must fail with the "image service unavailable" message (that is the fail-closed test, G-3 below).

---

## 5. Safe migration order and preflight

Preflight (all must hold, evidence E-5): §1.2 clean; project ref is staging; `storefront_media_hosts` plan known; Worker deployed (§3) before the app tests.

Apply, in this order, in a **single transaction per file**, to **staging only**, with a person watching:

| Step | File | Stop if |
|---|---|---|
| 1 | `0001`–`0053` (or the staging project's existing baseline) | any error |
| 2 | `0054_storefronts.sql` — **held by owner decisions B1–B3** (`STOREFRONTS_0054_OWNER_DECISIONS.md`). Staging may apply it for testing; production may not until approved | error; 0057 cannot be applied without it |
| 3 | `0055_account_deletion_ledger.sql` | error |
| 4 | `0056_profile_content_guard.sql` | error |
| 5 | **Before 0057:** `insert into public.storefront_media_hosts(host) values ('<STAGING_PUBLIC_URL host>');` (host only, lower-case, no scheme). Empty list = every new image is refused (fail closed) | — |
| 6 | `0057_business_media_scans.sql` then verify `select id, enforce from business_media_config` = exactly one row, `enforce = false` (direct-upload release; the explicit seeded OFF). For the scanned-path rehearsal only: then `update ... set enforce = true` and re-check | no row, more than one row, or a value other than the chosen mode |
| 7 | `0058_business_media_backfill.sql` | error |
| 8 | `0059_avatar_media_scans.sql` | error |

After step 8 run the §1.2 query (b)–(d) again: scan tables present, `handle_new_user` no longer reads user metadata, **no** `profile_media_freeze` / `storefront_media_freeze` function referenced by a trigger. Then run the SQL regression tests once against the real engine if possible: the suites in `supabase/tests/*.test.mjs` are PGlite-only; for a real project replay the key assertions manually (gate O in the checklist).

Deploy order of components for the **scanned path** (do not reorder; not the direct-upload release): Worker → clients (mobile build + web staging) live → `r2-presign` with the unconditional refusal → migrations 0057/0059 enforcement confirmed. For staging the "clients live in stores" wait is not needed; in production it is (`MEDIA_LAUNCH_POLICY.md` gate 11).

---

## 6. Test matrix (staging; every row needs evidence)

Use two disposable accounts, `A` and `B`, and one staff account. Evidence = request/response (redacted), the `business_media_scans` row (`select id,user_id,kind,status,issues,public_key from business_media_scans order by created_at desc limit 5`), and the R2 object listing.

### 6.1 Avatar, logo, banner (kinds `avatar`, `logo`, `banner`; do each kind)
| ID | Test | Expected |
|---|---|---|
| U-1 Upload (safe) | Upload a clean generated image from mobile and from web | Worker 200 `approved`; scan row `approved`; the profile/storefront save succeeds; public URL serves a JPEG ≤ 1600 px with no EXIF/GPS (`exiftool`); the response URL host equals `<STAGING_PUBLIC_URL host>` |
| U-2 Rejection | Upload a test image Vision rejects (explicit-content test image from the generated set); a logo with the word "Marketplace" (held) | `rejected` / `held`; **no object** under `avatars/` or `business/` in the public bucket; scan row not `approved`; UI keeps the old image and shows the rejected/held message |
| U-3 Timeout | Throttle to ~2G or set the client abort low; upload 5 MiB | Completes < 90 s or fails with the "check your connection" message; nothing published; old image kept |
| U-4 Scanner unavailable | (a) revoke/invalidate the Vision key; (b) unset `EXPO_PUBLIC_IMAGE_SCAN_URL` in a throw-away build; (c) stop the Worker (disable route) | (a) 503 `unavailable`, row `unavailable`; (b) `notConfigured` message; (c) `offline`/`unavailable`. **No case ends in a public object or a saved row.** Old image unchanged |
| U-5 Cross-user key | As A, `update profiles set business_logo_url=…, business_logo_public_id='business/<B_uid>/logo/<uuid>.jpg'` via PostgREST with A's JWT; same for `avatars/<B_uid>/…` | 22023 / 42501; nothing saved. Also try B's *approved* key |
| U-6 Direct-endpoint bypass | `POST /functions/v1/r2-presign` with folders `avatars/<A_uid>`, `Avatars/<A_uid>`, `AVATARS/<A_uid>`, `business/<A_uid>/logo`, `BUSINESS/<A_uid>/banner` | 426 `media_scan_required`; **no `uploadUrl`**; no R2 call. Direct `PUT` to the public bucket with A's own key shape without a presigned URL → 403 |
| U-7 Direct DB bypass | With A's JWT: set `avatar_url`/`avatar_public_id` to (i) an own key never scanned on the managed host, (ii) an approved key on `https://evil.example/…`, (iii) a Google/Cloudinary/picsum URL only, (iv) `http://` | all refused `image_not_verified`; re-saving the held value and clearing still work |
| U-8 Public exposure | Without credentials fetch: the `orig-media/<uid>/…` key via the public host; the private bucket via any URL; a `rejected`/`held` scan's would-be key; `pending/…` | 403/404 for all. `list` of the public bucket under `avatars/`, `business/` shows only approved keys |
| U-9 Existing image survives failure | With a held image, run U-2/U-3/U-4 | profile row, UI and R2 object for the old image are unchanged; the old key is deleted **only** after a successful new save |
| U-10 Signup | New Google and email sign-ups; also `auth.updateUser({data:{avatar_url:'https://evil.example/x.png', picture:'https://lh3.googleusercontent.com/a/x'}})` | `profiles.avatar_url` is NULL for all; app shows initials; first-login client insert with a Google photo succeeds with NULL avatar |
| U-11 Empty host list | `delete from storefront_media_hosts;` then upload an *approved* image | save refused (`image_not_verified`); restore the host afterwards |
| U-12 Trusted result | Call the Worker with a forged body (`status=approved`, `key=…`) and a modified response in a proxy | the Worker ignores client-supplied status; the DB accepts only a row written by the service role; a client cannot insert into `business_media_scans` (`42501`) |
| U-13 Account deletion | Delete a test account holding avatar, logo, banner and a storefront | public derivatives removed (ledger drained); scan rows cascade-deleted; **private `orig-media/` objects remain** (known gap P1/P2/B1 — record it, do not mark PASSED) |
| U-14 Cleanup consistency | Remove a photo in the app | row cleared first, then the R2 object deleted via `r2-delete`; deleting another user's key is refused |

### 6.2 Listing photos (regression; must still be enforced)
Follow `IMAGE_PARITY_STAGING_RUNBOOK.md`. Minimum: L-1 `r2-presign` for `listings/<uid>` while `legacy_presign_closed=true` → 426 `update_required`; L-2 publish a listing with photos on mobile and web → watermark present (`wm/listings/…`), original private; L-3 flagged photo is held/rejected and never public; L-4 `Listings/<uid>` (case) is gated like `listings/`; L-5 mode ladder (`shadow` → `enforce`) switched with `admin_set_image_scan_mode` and recorded; L-6 with the flag **open** (default until the ladder is closed) confirm which clients can still PUT — listing enforcement depends on that database flag, not on code alone, so record the flag value used.

### 6.3 Real devices and browsers
| ID | Device/browser | Do |
|---|---|---|
| D-1 | Physical iPhone (TestFlight/dev build with `EXPO_PUBLIC_IMAGE_SCAN_URL`) | U-1, U-2, U-4(b), U-9, U-10, listing publish, remove photo, airplane-mode mid-upload |
| D-2 | Physical Android (mid-range) | same as D-1 plus the empty-body ETag case (large photo on weak network) |
| D-3 | Safari (macOS/iOS), Chrome, Firefox — staging web | U-1, U-2, U-4, CORS from the real origin and from a non-allowed origin (no `access-control-allow-origin`), listing publish |
| D-4 | Old app build (pre-change) against staging | image change shows "update the app", never uploads |
Record device model, OS/browser version, build id, tester, timestamp, screenshot.

---

## 7. Backfill (only after §6.1 passes)
`BUSINESS_MEDIA_STAGING_CHECKLIST.md` gates H–J. Set `BACKFILL_SECRET` (staging) only for the run and unset it afterwards; run `node scripts/business-media-backfill.js --expect-host <STAGING_PUBLIC_URL host>` read-only first. The old unscanned objects are **not deleted** and stay reachable at their old URL (open gate, deletion lifecycle). Avatars have no backfill (owner decision).

---

## 8. Rollback decision points and safe recovery

Rollback scripts (all changed 2026-10-19): `supabase/rollback/0059_…`, `0058_…`, `0057_…`, `0056_…ROLLBACK.sql`. **Order is strictly reverse: 0059 → 0058 → 0057 (→ 0056).** Run each as one transaction. Every rollback of 0056/0057/0059 installs an unconditional *media freeze* (client writes of a NEW avatar/logo/banner/storefront image are refused; clearing and re-saving the held value still work) — it **does not** fall back to the weaker 0056 rule. Re-applying the forward migration (0057 then 0059) replaces the freeze with the scan check.

| Symptom | Decision | Action |
|---|---|---|
| Legitimate uploads fail but nothing unsafe is published | Do **not** roll back the database first. Fix Worker/hosts/secret | check Worker logs, `storefront_media_hosts`, `PUBLIC_BASE_URL`, Vision quota |
| Scanner outage is prolonged (scanned path only) | Users keep their images; new images wait | status page note; no flag change. (`enforce=false` relaxes the 0057/0059 database checks for logo, banner AND avatar while those migrations are live; in a rolled-back database the freeze ignores the flag. Use only with owner sign-off and record who/why) |
| A migration fails mid-way | The file is one transaction; nothing partial | fix and re-run; do not edit applied files |
| Defect in 0057/0059 logic after apply | Roll back 0059 → 0058 → 0057 | export first: `select * from business_media_backfill where status='applied'` (if 0058 ran). Result: no scan tables, freeze active, images untouched |
| Need to roll back the **Worker** | Redeploy the previous version for the staging env | clients then show "could not check"; nothing publishes |
| Need to roll back **r2-presign** | **Never redeploy an older version.** Roll *forward* or stop the function instead (§8.1) | a rolled-back presign can issue a PUT into the public bucket; the database freeze/scan stops the object being attached to a profile, but the object is reachable by anyone who has its URL |
| Need to roll back **0055** (ledger) | **Prefer to leave it in place** (additive, service-role only, inert). If it must go: redeploy the pre-ledger `delete-account` first, export the ledger, then run `supabase/rollback/0055_account_deletion_ledger_ROLLBACK.sql` | the script refuses while any job is open (open-job guard, tested by `account_deletion_rollback.test.mjs`). Without the function redeploy, every deletion request answers 500 "Nothing was deleted" (fail-closed, but users cannot delete accounts) |

### 8.1 Presign emergency stop (replaces "roll back r2-presign")

The goal is that no recovery step can publish an unscanned image. A function rollback can; stopping the function cannot.

1. **Stop uploads, keep the current code:** set the dedicated switch: `supabase secrets set R2_PRESIGN_DISABLED=true --project-ref <STAGING_REF>` (checked first in `r2-presign`; every presign answers 503 `uploads_paused`; any value except empty/false/0/off/no pauses). Do NOT stop uploads by unsetting `R2_ACCESS_KEY_ID`: `r2-delete` and the R2 cleanup in `delete-account` use the same credential, so deletes would fail and account deletion would skip R2 cleanup silently (`r2_skipped` log) and orphan objects. This stops the Edge Function path only; the scanner Worker writes through R2 bindings and is stopped separately (unset `VISION_API_KEY` on the Worker so every scan fails closed, or undeploy it).
2. **Fix forward:** correct the defect in the current code, redeploy, re-set the secret.
3. **If an old version was already deployed by mistake:** unset the secret at once (step 1), then redeploy the current code.
4. **Rehearse on staging (gate G-7):** with `R2_PRESIGN_DISABLED=true`, request a presign for `avatars/<uid>`, `business/<uid>/logo` and `listings/<uid>` with a test JWT; all three must fail. Remove the switch, confirm the first two are still refused (403 gate) and listings follow `legacy_presign_closed`. Save as evidence E-8.

Verified 2026-10-19 from the downloaded production source (Edge Function v10, read-only): the deployed `r2-presign` is OLDER than the committed one and has none of the listing, business or avatar gates, so redeploying any older version does reopen direct public-bucket uploads. Still to rehearse on staging: the switch itself (step 4 with `R2_PRESIGN_DISABLED=true` instead of unsetting the key).
| Need to roll back the **clients** | Store rollback is slow; the server stays closed | old clients get 426 |

Post-rollback verification (evidence E-8): `media_rollback.test.mjs` shapes replayed by hand with a test JWT — a new avatar/logo/banner on a foreign host, an own key unscanned, and a Google URL are all refused; unrelated profile edits and clearing still work.

---

## 9. Evidence to collect per gate
For each gate write: date/time (UTC), environment (project ref, Worker name, bucket names — redacted as agreed), exact command or action, raw output (redacted), expected vs actual, tester, result `PASSED` / `FAILED` / `BLOCKED`. Store in `docs/evidence/<date>/` outside git if it contains anything sensitive. The minimal set: E-1 migration history (§1.2), E-2 buckets/policy, E-3 Worker fail-closed checks, E-4 env verification, E-5 preflight, E-6 each §6 row, E-7 device matrix, E-8 rollback verification, E-9 cost/quota (Vision usage, R2 operations) for the test period.

## 10. Mandatory gates (all must be PASSED)
G-1 staging isolated from production (§1.1, §3.2, §4) · G-2 migration history clean (§1.2) · G-3 fail-closed when the scanner is unreachable/unconfigured (U-4) · G-4 U-1…U-14 · G-5 listing-photo regression (6.2) · G-6 devices/browsers (6.3) · G-7 rollback rehearsal on staging (§8, including re-apply) · G-8 backfill rehearsal if the owner wants legacy images scanned (§7).

## 11. Approvals required before any production step
(M) read-only production migration-history check recorded · owner decisions B1–B3 for 0054 · P1/P2/B1 retention periods (private originals, rejected objects, deletion lifecycle) · legacy avatar remediation decision · moderation staffing / counsel items (`COUNSEL_BRIEFING_IMAGE_SAFETY.md`) · explicit written authorisation to apply 0054–0059 and to deploy the Worker/Edge Functions to production, with a rollback owner on call.

## 12. Next action to begin staging
Create the staging Supabase project and the two staging R2 buckets (§1.1, §2), then run the read-only inspection in §1.2 on it and save the output as E-1.
