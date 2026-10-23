# Media policy and release gate: avatars, business logos and banners (direct upload, enforcement OFF, 2026-10-21)

**Current policy (owner decision 2026-10-21, "allow direct upload for now"): profile photos, business logos and banners are uploaded directly with a presigned PUT, and database enforcement of the scan check is explicitly OFF.** This supersedes the 2026-10-19 fail-closed brief (kept below as the *target* policy for when the scan Worker exists). Listing photos are unchanged (existing scan ladder and watermark rules).

**These images are NOT scanned.** Clients crop, shrink and re-encode them, but nothing checks their content, and a hostile client can PUT arbitrary bytes. This is an accepted, time-limited risk, not a security control. Do not describe these uploads as scanned or safe.

## What actually runs today (verified in code 2026-10-21)
| Layer | Behaviour |
|---|---|
| `r2-presign` | `avatars/…` and `business/…` are presigned like any allowed folder. `businessMediaPresignGate` / `avatarPresignGate` / `mediaScanRequired` exist in `_shared/scanPolicy.ts` (default: allow) but **`index.ts` does not call them**. There is **no secret or flag** that makes presign refuse these folders; re-enabling that needs a code change + deploy. (An earlier note that `MEDIA_SCAN_REQUIRED=true` closes presign was wrong for the current code.) The deployed v10 predates all gates anyway. |
| Mobile (`lib/r2.ts`) and web (`web/src/services/r2.ts`) `uploadToR2` | Always presign + PUT. No Worker path in either client. Mobile and web crop/shrink/re-encode first (`PROFILE_IMAGE_PRESETS`, `prepareImage`). |
| Database 0056 | Guards the shape: an own key `avatars/{uid}/{uuid}.jpg` / `business/{uid}/(logo\|banner)/{uuid}.jpg`, and a URL that ENDS with that key on **any https host**; URL-only values only on Google / Cloudinary / picsum. |
| Database 0062 (built 2026-10-21, **local only, not applied**) | Host pin, independent of the scan switch: for a CHANGED avatar/logo/banner slot that carries a key, the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. Registered host list is **empty by default → every key-bearing save is refused until the `R2_PUBLIC_URL` host is inserted**. URL-only values are NOT touched (legacy carve-out, gap 2). See "Host pin (0062)" below. |
| Database 0063 (built 2026-10-21, **local only, not applied**) | URL-only block, independent of the scan switch and of `storefront_media_hosts`: a NEW URL-only (no key) avatar/logo/banner is refused on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated; an UNCHANGED legacy URL never blocks an unrelated edit. See "URL-only block (0063)" below. |
| Database 0057 / 0059 | `business_media_config` is seeded with an **explicit `enforce=false` row**. While OFF the scan triggers return immediately: **only 0056 applies.** The column default is `true` and `business_media_enforced()` reads a **missing row or NULL as ON**, so the only way to be OFF is that explicit row. Clients cannot read, write, delete or re-insert it (tested). |
| Signup (`handle_new_user`, 0059) | Unconditional, in either mode: no avatar is ever copied from `raw_user_meta_data`. |
| Client first-login insert | OFF: a Google photo sent by the client is **kept** (0056 allows that host). ON: URL-only avatars are dropped to NULL. |
| Storefronts (0054) | Logo/banner URLs are already pinned to `storefront_media_hosts` + the owner's key by `_sf_image_ok`, independent of the flag (empty list = refused). |
| Rollbacks (0056/0057/0059) | Unchanged: the media **freeze** replaces the scan triggers, ignores `enforce`, and no rollback falls back to the weaker 0056 rules. |

## Enforcement switch (single, explicit)
`business_media_config.enforce` — one row (`id=true`).
- Shipped: `false` (seeded by 0057). Visible with `select id, enforce from public.business_media_config;`.
- **ON means every avatar/logo/banner save fails** (clients never produce scan rows). Turn it ON only after the Worker route, `storefront_media_hosts`, a client that calls the Worker, and a presign gate that refuses `avatars/` + `business/` are deployed and staging-verified. Do not flip it as a "security hardening" step on its own.
- Anything that is not the explicit `false` row is ON: missing row, NULL, a row created without a value. Record who changes it and why. In a rolled-back database the freeze ignores it.
- Tested in `supabase/tests/business_media.test.mjs` (OFF mode, missing row, default row, NULL, explicit OFF, ON path, client write attempts), `avatar_media.test.mjs`, `media_rollback.test.mjs`.

## Known security gaps while OFF (open unless marked closed)
1. **Foreign-host URL — CLOSED IN CODE by 0062 (local only; open in every real database until 0062 is approved, applied and the host row exists).** Before 0062 a client could store `https://<any host>/avatars/<own-uid>/<uuid>.jpg` (or the business equivalent) on **profiles**: the URL only had to end with the user's own key. Storefront images were never affected (0054 pins the host).
2. **Third-party URL-only values — CLOSED IN CODE by 0063 (local only; open in every real database until 0063 is approved and applied; owner decision U pending).** Before 0063 a new URL-only avatar/logo/banner on `res.cloudinary.com`, `lh3.googleusercontent.com` or `picsum.photos` was accepted: any Cloudinary/Google account can serve anything from those hosts. 0062 deliberately does not touch this. Only the first-login INSERT of an avatar on `lh3.googleusercontent.com` is still tolerated (gap 4).
3. **Unscanned content in our own bucket.** Direct upload puts unchecked bytes under a public URL. 0062 does not change this; only scanning does.
4. **Google photo on first login** is still kept when a client INSERTS it while OFF (0063 tolerates exactly that one case so an old build's first-login fallback cannot fail; the working-copy client already sends null, and the signup trigger never copies one). An existing profile cannot use it to change a photo (upsert is refused at the UPDATE step; tested).
5. **No moderation signal for these images.** No scan rows, no held/rejected queue; only user reports and staff review of the profile.
6. **Existing rows are not rewritten.** A profile that already holds a foreign-host own-key URL keeps it (it is unchanged, so 0062 does not look at it) until the user changes that slot. There is no backfill; finding such rows is a read-only operator query (see the runbook preflight).

## Host pin (0062) — built and tested locally 2026-10-21, NOT applied anywhere
File: `supabase/migrations/0062_profile_media_host_pin.sql`, rollback `supabase/rollback/0062_profile_media_host_pin_ROLLBACK.sql`, tests `supabase/tests/profile_media_host_pin.test.mjs` (plus the flipped KNOWN-GAP assertions in `business_media` / `avatar_media`).

**Exact rules** (client writes only, `is_client_write()`; one BEFORE INSERT/UPDATE trigger `profiles_c_media_host_pin`, fires after the 0056 shape rules and after the 0057/0059 scan trigger; applies in BOTH enforcement modes). A slot is examined only if it is being changed (INSERT, or url/key differs from the old row):
| Changed value | Result |
|---|---|
| key present, URL exactly `https://<h>/<key>` and `lower(<h>)` is a row of `storefront_media_hosts` | accepted (the 0056 key-ownership rules still apply first; when enforcement is ON the scan row is still required) |
| key present, any other URL: other host, look-alike, userinfo, port, trailing dot, `http`, query/fragment, extra path, empty/malformed, > 2048 chars | refused: errcode 22023, hint `image_host_not_allowed`, message "This photo/logo/banner address is not allowed. Upload it again." |
| key absent, URL present | **not checked by 0062** — 0056 limits it to Google / Cloudinary / picsum; **0063** refuses a NEW such value (see below) |
| both null (clearing) | accepted |
| unchanged slot (any unrelated edit, re-saving the held pair) | not checked; nothing rewritten or deleted |
Only the host is case-insensitive (the table stores lower case); the key part is an exact match. `storefront_media_hosts` stays empty after the migration: **0062 seeds no host.** The real `R2_PUBLIC_URL` is an Edge Function secret and is not in the repo, so its host must be inserted by the operator (lower-case host only: no scheme, port or path). `r2-presign` builds `publicUrl` as `<R2_PUBLIC_URL minus one trailing slash>/<key>`, so the secret must be a bare origin (`https://host`); a base with a path or port can never match this rule.

**Compatibility, decided conservatively (DECISION REQUIRED to go further):**
- Unchanged legacy values (Google / Cloudinary / picsum URLs, or an old foreign-host own-key URL) never block an unrelated edit and are never removed. Proven in tests.
- A user holding a legacy foreign-host avatar can remove it or replace it with a managed upload, but cannot re-point it to another foreign host.
- (Superseded by 0063 for updates; kept for the 0062-only case.) Old app builds: first-login inserts that send a URL-only Google photo are NOT refused (carve-out); an old build that uploads through the presign flow already sends `<R2_PUBLIC_URL>/<key>` and passes once the host is registered. A very old Cloudinary-era build that writes a Cloudinary URL-only value also still passes. **Closing the URL-only carve-out (earlier proposal: refuse new URL-only values, null a Google photo on insert) was NOT done**: it would lock out old builds, and which builds are still in use is unknown. It needs an owner decision (and a minimum-supported-version fact) before it is built.
- **Fail-closed hazard (apply order):** if 0062 is applied while `storefront_media_hosts` is empty or holds the wrong host, EVERY avatar/logo/banner save fails (the migration raises a WARNING in that case). Insert the host first, then apply, then test one upload. Fix for a wrong host row is to correct the row; emergency exit is the 0062 rollback (touches no data, reopens gap 1).
- Hosts that serve the same bucket through a second domain (for example the Worker's `PUBLIC_BASE_URL`) must be registered too if their URLs are ever stored.
- Not solved by 0062: gap 3 (content), gap 2/4 (URL-only, handled by 0063), gap 6 (existing rows).

## URL-only block (0063) — built and tested locally 2026-10-21, NOT applied anywhere
File: `supabase/migrations/0063_profile_url_only_block.sql`, rollback `supabase/rollback/0063_profile_url_only_block_ROLLBACK.sql`, tests `supabase/tests/profile_url_only_block.test.mjs` (plus flipped carve-out assertions in `profile_guard`, `avatar_media`, `profile_media_host_pin`). Separate trigger `profiles_c_url_only_block`; fires after `profiles_c_media_host_pin`; both enforcement modes; no dependency on `storefront_media_hosts`, so **no host-row apply-order hazard** (needs 0038 and 0056 only).

**Evidence behind the policy (read from the repository, 2026-10-21):** every client at HEAD uploads through `r2-presign` and writes `url + key` for avatar, logo and banner (`hooks/useAvatarActions.ts`, `app/settings/business-profile.tsx`). The only URL-only writer at HEAD is the first-login fallback upsert in `store/auth.ts` (and `web/src/services/auth.ts`), which copied the Google photo; the working copy now sends `null`. No client writes a URL-only logo/banner or a Cloudinary/picsum URL after commit `d22fe4a` (R2 uploads, 2026-09-05); commit `3975369` (2026-08-06) had Cloudinary unsigned-preset uploads. **There is no reliable evidence of the currently deployed app version or of the oldest build still in use** (no tags besides a local checkpoint, no build numbers in `app.json`, `eas.json` uses `appVersionSource: remote`, no version header, no forced-update mechanism). No minimum supported version is assumed.

**Exact rules** (client writes only, `is_client_write()`; a slot is examined only when its URL is NEW and no key is sent):
| Value written | Result |
|---|---|
| key present | not this layer (0056 shape, 0062 host, 0057/0059 scan) |
| URL null (clearing) | accepted |
| URL-only, URL **unchanged** (unrelated edit, old-client full-row payload, re-save, dropping only a stale key) | accepted; nothing rewritten or deleted |
| URL-only, URL **new**, on UPDATE (any slot, any host) | refused: errcode 22023, hint `url_only_not_allowed`, "This photo/logo/banner must be uploaded again." |
| URL-only on INSERT: avatar on `https://lh3.googleusercontent.com/...` | accepted (first-login fallback of an old build) |
| URL-only on INSERT: anything else (logo/banner, Cloudinary, picsum, other Google subdomains, http) | refused |
An existing user cannot use the INSERT exception: a supabase upsert fires the BEFORE INSERT trigger and then, on conflict, the BEFORE UPDATE trigger, which refuses the changed URL-only value (tested). With enforcement ON, 0059 nulls the first-login external avatar before this trigger looks at it (tested).

**Compatibility cost, stated:** a pre-R2 (Cloudinary-era) build that is still installed could not CHANGE its photo/logo/banner (it gets a refusal; its other edits and its existing images are unaffected). Whether such a build exists cannot be determined from the repository. **Decision U (owner):** approve as built; or keep the carve-out (leave 0063 unapplied); or supply the EAS/store facts first. Alternatives considered and rejected: allow Cloudinary only for a known cloud name (needs a config table and the account name, not in the repo); allow Google on UPDATE when the old avatar is empty (reopens the hole for every user once); a version-gated rule (no version signal exists in any request).
Not solved: content of our own uploads (gap 3), existing rows (gap 6), the first-login Google INSERT while OFF (gap 4).

## Target policy (NOT shipped): fail closed through the scan Worker
Applies only once the Worker exists and the clients/presign are changed to use it.
| Layer | Target behaviour |
|---|---|
| `r2-presign` | `avatars/…` and `business/…` get 426 `media_scan_required` (any letter case) before any R2 secret is read — i.e. the existing gates **wired in**, with no flag able to reopen it |
| Clients | Only the Worker `/v1/business-media`; no scan URL configured → nothing uploaded, current image kept |
| Worker | Private original in `orig-media/`; public object only after `approved`; rejected/held/unavailable publish nothing |
| Database | `enforce=true`: a NEW avatar/logo/banner needs an `approved` scan row of that user+kind+key and the URL exactly `https://<managed host>/<key>` |
Image checks there are Cloud Vision moderation plus re-encode — image moderation, not malware scanning.

## Migration order (verified on PGlite only; NOT applied anywhere)
0054 (held, B1–B3) → 0055 → 0056 → 0057 → 0058 → 0059 → **insert the `R2_PUBLIC_URL` host into `storefront_media_hosts`** → 0062 (needs 0054 and 0056; 0062 is independent of 0057/0059 and has its own rollback) → 0063 (needs 0038 and 0056; no host row; own rollback; both 0060/0061 sit between 0059 and 0062 in file order and are unrelated). Rollback strictly reverse: `0063`, `0062`, `0059`, `0058`, `0057` (and `0056_profile_content_guard_ROLLBACK.sql`). The 0062 rollback removes only its own trigger/functions; it does not affect the freeze installed by the other rollbacks (a freeze plus the pin are both just refusals; the pin never loosens anything). A rollback installs the unconditional *media freeze* (`profile_media_freeze`, `storefront_media_freeze`, same trigger names): a client cannot set a NEW avatar, logo or banner (profile or storefront) to any value; clearing and re-saving the held value still work; nothing existing is rewritten; non-client writers are unaffected; the freeze ignores `business_media_config.enforce`. Re-applying 0057 then 0059 replaces the freeze and **re-seeds the explicit OFF row** (the table was dropped), so an operator who had set ON must set it again. Proven on PGlite in `supabase/tests/media_rollback.test.mjs`; **not** proven on Supabase. A rolled-back `r2-presign` is a separate risk, and with direct upload there is no longer an unconditional refusal to preserve.

## Behaviour changes to know about
- With 0057 live and enforcement OFF, avatar/logo/banner saves work with a direct upload (as before 0056/0057), subject to 0056 shape rules; **with 0062 applied they also need the `R2_PUBLIC_URL` host in `storefront_media_hosts`** (otherwise every managed upload is refused).
- New Google sign-ups start with no avatar from the signup trigger (unconditional); a client-inserted Google photo is kept while OFF.
- Legacy external avatar URLs keep displaying and are grandfathered; remediation is **not built**.

## Release gate table (status as of 2026-10-21, direct-upload release)
| # | Gate | Type | Status | Needed to close |
|---|---|---|---|---|
| 1 | Local unit, DB (PGlite, 27 suites), tsc mobile/web, deno check, scan-policy/presign tests | code | re-run 2026-10-21 with 0062 + 0063: 27 DB suites pass, `npm test` 617 pass, tsc mobile + web exit 0, `deno check --no-lock --node-modules-dir=none` passes for 6 of 7 functions (`send-push-notification` has supabase-js typing errors in a file this change did not touch), `deno test _shared/presign.test.ts` 2 pass | re-run before release |
| 2 | Owner accepts "unscanned, direct upload" for avatars/logos/banners and gaps 1–6 above | owner | **RECORDED 2026-10-21 (policy); gap 1 closed in code (0062, local), gap 2 closed in code (0063, local); gap 4 reduced to the first-login INSERT** | decision U: approve 0063 as built (see its section), keep the carve-out, or supply EAS/store version facts |
| 3 | Host pin built and tested locally (done); `storefront_media_hosts` filled with the `R2_PUBLIC_URL` host and one real upload verified on staging | code + ops | **BUILT + PGlite-tested; host row and staging run NOT DONE** | owner approves 0062 for staging; operator inserts host; runbook §1.5 |
| 4 | Real device/browser acceptance of avatar/logo/banner upload and save (iOS, Android, web) | staging check | **NOT RUN** | tester + builds |
| 5 | Apply 0054–0059, 0062 and 0063 to staging then production | owner approval | **NOT APPROVED** | explicit authorization |
| 6 | 0054 owner decisions B1–B3 | owner | OPEN | `STOREFRONTS_0054_OWNER_DECISIONS.md` |
| 7 | Retention/cleanup of private originals and rejected objects (P1/P2) and R2 deletion lifecycle | owner + code | OPEN, unbuilt | owner states periods; then build on 0055 ledger |
| 8 | Moderation staffing, CSAM service, counsel questions (now covers unscanned profile images too) | owner/legal | OPEN | `COUNSEL_BRIEFING_IMAGE_SAFETY.md` |
| 9 | Scanned path (Worker + client + presign wiring + `enforce=true`) | future | NOT STARTED | the Worker, then `BUSINESS_MEDIA_STAGING_CHECKLIST.md` gates A–K |

## Decision
**RELEASE NOT APPROVED.** Nothing was applied, deployed, committed or pushed. The database layer is now internally consistent with the direct-upload policy; the host pin (0062) and the URL-only block (0063) exist locally but are unapplied (0062 needs its host row first); the remaining blockers are decision U on 0063, real-device acceptance, the production migration approvals and the open owner/legal items above.
