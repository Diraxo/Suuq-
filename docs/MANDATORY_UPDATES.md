# App updates (mandatory gate + release announcements)

The server decides which installed versions may keep using SUUQIYE. Changing the rule needs no app release.

## How it works

- Table `public.app_update_policy` (migration `0078`), one row per platform (`ios`, `android`): `enabled`, `minimum_version`, `recommended_version`, `store_url`, `message` (optional `{en, so, am}` override).
- The app reads only its own platform's row with the public anon key (SELECT only; RLS has no write policy). It never holds a service-role key.
- The installed version is the marketing version in `app.json` (`expo.version`, read via `expo-constants`), compared numerically per component with `major.minor.patch` (so `1.9.0 < 1.10.0`). The native build number (iOS `buildNumber`, Android `versionCode`) is never used and is not touched by this feature.
- If installed < `minimum_version` and `enabled` is true: a full-screen, non-dismissible "Update required" screen (native Modal, hardware back swallowed) with **Update now**, which opens `store_url`. Everything beneath it, plus the sign-in prompt, push banner and snackbars, is withheld.
- If installed < `recommended_version` only (no release linked): a dismissible **normal** reminder (see "Release types" below).

## When it checks

| Moment | Behaviour |
|---|---|
| Cold start, policy cached | Decides immediately from the cache, fetches in the background and applies the answer when it arrives. |
| Cold start, nothing cached | The splash redirect waits for the answer, at most 3.5 s, then continues as `unverified`. |
| App returns to foreground | Re-reads the installed version. Fetches if blocked (always) or if the last successful fetch is older than 30 min. This is how coming back from the store lifts the block. |
| After a failed fetch | Retries after 15 s, 30 s, 1 m, 2 m, then every 5 m, and on every foreground. |
| **Update now** failing to open | Shows a message telling the user to open the store app and search for SUUQIYE. |

## Failure policy

A failed request is never treated as "up to date".

| Situation | Result |
|---|---|
| Fetched policy, installed below minimum | **Blocked** |
| Fetch fails or returns an invalid row, a policy is cached | Decided from the cache; a block stays a block (the Retry button is shown) |
| Fetch fails, nothing cached | Allowed, state `unverified`, retried with back-off (a temporary outage never locks out a user who was never blocked) |
| Row malformed (bad version, non-official store URL) | Treated as a failed fetch, never cached |
| Table missing / `enabled = false` / installed version unreadable | Allowed |

A blocked user who is offline stays blocked until they either update (the installed version is re-read on foreground) or reconnect and the server lowers the minimum.

## Operating it (service role / SQL editor only)

```sql
-- 1) Make sure the store URL is right (iOS: the real App Store listing once the app exists).
update public.app_update_policy
   set store_url = 'https://apps.apple.com/app/idXXXXXXXXXX'
 where platform = 'ios';

-- 2) Require 1.1.0 or newer on iOS only. Do this AFTER 1.1.0 is live in the store.
update public.app_update_policy
   set enabled = true, minimum_version = '1.1.0', updated_at = now()
 where platform = 'ios';

-- Optional per-language text (falls back to the app's translated default):
update public.app_update_policy
   set message = '{"en":"Please update to keep buying and selling.","so":"Fadlan cusboonaysii si aad u sii wadato."}'
 where platform = 'ios';

-- Emergency off switch for a platform:
update public.app_update_policy set enabled = false where platform = 'ios';
```

Rules of thumb:

- Never raise `minimum_version` above a version that is not yet downloadable on that platform's store; users would be locked out with nothing to install. Staged rollouts and review delays mean the store listing can lag the build.
- Store URLs accepted: `https://apps.apple.com/…`, `https://itunes.apple.com/…`, `itms-apps://apps.apple.com/…` (iOS); `https://play.google.com/…`, `market://details…` (Android). The database and the app both reject anything else.
- Android store URL is pre-filled for `suuqiye.com`. The iOS URL is **empty** until the App Store listing exists (the app id is unknown to the repo); until then the button falls back to opening the App Store app.
- Both platforms ship **disabled** (`enabled = false`). Applying the migration enforces nothing.

## Applying / reverting

- Apply `supabase/migrations/0078_app_update_policy.sql` by hand like the other migrations (not applied by this change).
- Revert with `supabase/rollback/0078_app_update_policy_ROLLBACK.sql`. Apps then fall back to `unverified`, which allows normal use.
- Enforcement reaches only builds that contain this code. Any build installed earlier (including any Android build already distributed) cannot be forced to update.

## Files

`lib/appUpdate.ts` (version parsing, row validation, decision) · `lib/appUpdateController.ts` (startup / foreground / cache / retry) · `store/appUpdate.ts` (Supabase + AsyncStorage + `AppState` wiring) · `components/UpdateRequiredGate.tsx` (screen) · `app/_layout.tsx`, `app/index.tsx` (mount + splash handoff) · `locales/*/translation.json` `appUpdate.*` · tests `tests/appUpdate*.test.ts`, `supabase/tests/app_update_policy.test.mjs`.

## Limits

- Somali and Amharic strings were written without a native-speaker review.
- The blocking screen has not been seen on a device or simulator (see the final report); it is covered by unit tests, type-check and structural tests only.

## Release types (migration `0090`, extends `0078`)

One row of `public.app_releases` is one published release; `app_update_policy.current_release_id` (per platform) points at the active one. Nothing in 0078 was changed or dropped.

| Type | Screen | Dismissible | Default reminder | Blocks? |
|---|---|---|---|---|
| `normal` | compact card: logo, versions, short description, optional What's new, **Update now** / **Remind me later** | yes | 72 h | no |
| `important` | tall sheet with brand header, feature list with icons, same two buttons | yes | 24 h | only if `mandatory = true` |
| `critical` | the full-screen gate: warning badge, release title, reason, installed / minimum / required version, **Update now**, **Check again**, support link | **no** | none | always (a critical row cannot be saved with `mandatory = false`; the app also treats it as mandatory) |

How the app decides (`lib/appUpdate.ts`, `decideUpdate`): effective minimum = the policy's `minimum_version`, raised (never lowered) by an active mandatory/critical release's `minimum_supported_version` (or its `target_version` when that is empty). Installed below it -> blocked. Otherwise installed below the release's `target_version` (or `recommended_version` with no release) -> optional reminder/announcement. Android: an equal version with an older `versionCode` also counts as optional, never as a block.

Decision names: `ok` (none), `optional` with `tier` normal/important (normal_reminder / important_announcement), `required` (mandatory_update), `unverified` (temporarily_unavailable).

Columns reused rather than duplicated: `minimum_version` = minimum supported version, `recommended_version`, `store_url`. There is intentionally **no** second `mandatory` / `release_type` column on the policy: those live on the release, so a policy cannot contradict it. `enabled = false` on a platform turns off both the gate and the announcements for that platform.

Policy columns added by 0090: `current_release_id`, `reminder_interval_hours` (null = type default), `first_reminder_delay_hours` (default 0), `show_whats_new`, `support_url` (https or mailto only).

Release columns: `platform` (android/ios/all), `version`, `version_code`, `release_type`, `title`, `description`, `changelog` (`{"items":[{"title","description","icon"}]}`, max 20), `translations` (`{"so":{"title","description","items":[{"title","description"}]}}`, items align by index), `mandatory`, `minimum_supported_version`, `target_version`, `android_store_url`, `ios_store_url`, `support_url`, `published`, `published_at`, `expires_at`.

Database guarantees (all tested on real Postgres): critical => mandatory; a mandatory release needs a description of at least 20 characters (shown as the reason); versions are strict `x.y.z`; minimum <= target; a published release needs the store link(s) of its platform(s); store URLs must be the platform's own store; changelog must be an object with an `items` array; drafts and expired releases are invisible to the app (anon read policy); a release cannot be linked from the other platform's policy row.

Icons are chosen from a fixed list (`image, message-circle, shield, zap, search, bell, heart, tag, map-pin, star, user, lock, camera, settings, bug, rocket, sparkles, store, share, wallet`); anything else shows a default sparkle. Database text is rendered only as plain text.

Text language: the app's own copy is English/Somali/Amharic. A release's title, description and What's new are operator-written; give Somali/Amharic through `translations` or the user sees the base (English) text.

### Reminders

Normal and important prompts are held back while the splash is showing, shown at most once per app session, and "Remind me later" silences that release for its interval (also across restarts). A newer release or target version starts a new cycle; iOS and Android are tracked separately. Stored locally (works signed-out); a signed-in dismissal is also written to `app_update_dismissals` (best effort, private by RLS). A system clock moved far back cannot silence a reminder forever. The prompt disappears as soon as the installed version reaches the target.

### Publishing safely

`supabase/examples/app_release_examples.sql` has one block per release type (normal 72 h, important 24 h, critical mandatory with minimum 1.2.0). They are illustrative, hard-code no UUIDs, and are run by the test suite against a real Postgres, but nothing applies them. Publish only after the target version is downloadable from that platform's store, and use the test-device checklist below first.

### Compatibility and rollback

- An app build containing this code works before 0090 is applied: if the server rejects the new columns it re-reads the 0078 columns, so the 0078 minimum keeps being enforced (it does not fail open). Releases and reminders simply do not exist until 0090 is applied.
- Builds from before this change (including the already-committed gate) ignore releases entirely and only honour `minimum_version`.
- Roll back with `supabase/rollback/0090_app_release_management_ROLLBACK.sql`; 0078's table, columns and rows remain.

### Checklist before the first real publish (not yet done)

- Apply 0090 to a non-production database first; confirm the three examples there.
- On an Android and an iOS device or simulator: see the normal card, the important sheet and the critical gate; confirm hardware Back / swipe cannot dismiss the gate, a notification tap or deep link lands behind it, sign-out leaves it up, force-quit + reopen shows it again, and the store opens.
- Review the Somali and Amharic strings with a native speaker (written without review).
- Confirm the iOS store URL is the real listing.

### Limits of what was verified

Unit tests (decision table, reminders, parsing, cache round-trip, structural wiring), `tsc` on the whole project and real-Postgres (PGlite) tests of 0090 pass. **Not verified:** how any of the three screens looks or behaves on a device, Android back / iOS gestures on the gate, PostgREST embedding of `release:app_releases!current_release_id(...)`, live store opening, and the signed-in dismissal upsert against Supabase.
