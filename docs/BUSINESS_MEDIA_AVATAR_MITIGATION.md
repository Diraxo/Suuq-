> **HISTORICAL ANALYSIS (2026-10-19), status line superseded 2026-10-21.** The status line below ('inside the fail-closed policy', 'presign refused, Worker-only') describes the *target* scanned path, not what ships. What ships: direct upload, enforcement OFF, so 0059's host/key/scan pin is inert and only 0056 applies. This file's *option 2 (interim)* is now built locally as **0062 (host pin) + 0063 (no new URL-only values)**; the 'Tests to add' list is covered by `profile_media_host_pin`, `profile_url_only_block`, `avatar_media`. The original analysis is kept unedited below.
>
> **Current facts (2026-10-21), authoritative text in `MEDIA_LAUNCH_POLICY.md`; nothing below was applied, deployed or committed.**
> - Shipped policy is **direct upload with scan enforcement explicitly OFF** (0057 seeds `business_media_config.enforce=false`; missing/NULL still reads ON). Avatars, logos and banners are **NOT scanned**: this is an accepted, time-limited risk, never a control. `r2-presign` does not refuse `avatars/` or `business/`, and neither client has a Worker path.
> - **0062** (local, unapplied): host pin for any CHANGED avatar/logo/banner that carries a key: the URL must be exactly `https://<host in storefront_media_hosts>/<key>`. **Apply order (hard):** insert the `R2_PUBLIC_URL` host into `storefront_media_hosts` first (0062 seeds none; empty list = every avatar/logo/banner save fails, fail closed), needs 0054 and 0056. Works in both enforcement modes.
> - **0063** (local, unapplied): refuses a NEW URL-only (no key) avatar/logo/banner on update; on first-login INSERT only an avatar on `lh3.googleusercontent.com` is tolerated. Unchanged legacy URLs keep passing. Needs 0038 and 0056 only (no host list). Cost: a hypothetical pre-R2 (Cloudinary-era) build could not CHANGE its photo; the repository holds **no evidence** of the deployed or minimum supported app version, so none is assumed. Owner decision still open.
> - **Apply order:** 0054 -> 0055 -> 0056 -> 0057 -> 0058 -> 0059 -> insert host row -> 0062 -> 0063. **Rollback strictly reverse** (0063, 0062, 0059, 0058, 0057, 0056); the 0062 and 0063 rollbacks drop only their own trigger/functions and change no data; the 0056/0057/0059 rollbacks install the media freeze.
> - **Still open:** unscanned bytes in our own bucket (no content check), a Google photo kept on first-login INSERT while OFF, existing rows never rewritten (no backfill), owner decisions P1/P2/B1 and the URL-only decision, no staging run.

# Avatars: residual bypass and mitigation plan

Written 2026-10-19. **Status (updated 2026-10-19): avatars are now inside the fail-closed policy — see `MEDIA_LAUNCH_POLICY.md` (presign refused, Worker-only, 0059 pins host/key/scan, signup injection closed). Below is the historical analysis; legacy-avatar remediation remains an owner decision.** Original status: OPEN, not fixed. Avatars are outside the approved business-media scope, so no code was changed. Platform-wide media security must not be described as complete.

## Verified current state (read from code)
- Mobile `hooks/useAvatarActions.ts` and web `web/src/services/profileMedia.ts` (`avatar` entry) presign `avatars/{uid}` via `r2-presign` and PUT straight into the **public** bucket. No scan, no EXIF stripping guarantee beyond client-side prep.
- `0056_profile_content_guard.sql`, avatar branch: with a key, the URL need only *end with* `avatars/{uid}/{uuid}.jpg` and start with `https://`, so any host is accepted. Without a key, `lh3.googleusercontent.com`, `res.cloudinary.com`, `picsum.photos` are allowed; the first two host arbitrary user content.
- Consequence: an unscanned image can be published as an avatar, and an avatar URL can point at any host (the same class as findings 1 and 2 of the business-media pass).

## Mitigation options
1. **Full fix (recommended, separate release):** add kind `avatar` to the Worker `/v1/business-media` route (key `avatars/{uid}/{uuid}.jpg`, square crop already done client-side), record approvals in `business_media_scans`, extend the 0057 trigger to `profiles.avatar_*`, then add the `avatars` refusal to `r2-presign`. Needs the same ordering as business media: Worker, then clients live in both stores, then presign refusal, then enforcement. Cost: one Vision call per avatar change.
2. **Interim, no client change:** a migration pinning the avatar URL to `https://<managed host>/<key>` and dropping Cloudinary/Google URL-only values for *new* client writes (same grandfathering as 0057). Removes the any-host risk; does not scan content.
3. **Accept and disclose:** keep as is until option 1, listed as a known risk.

## Decision AV
Owner picks 1, 1 after 2, or 3. Option 2 depends on `storefront_media_hosts` being populated (0054), so it inherits the 0054 hold. Until decided: unchanged, disclosed here and in the acceptance report.

## Tests to add with the fix
Presign refuses `Avatars/<uid>` in any case; URL on a foreign host with an approved key is refused; Cloudinary URL-only refused for new values and grandfathered when unchanged; rejected/held/outage publish nothing.
