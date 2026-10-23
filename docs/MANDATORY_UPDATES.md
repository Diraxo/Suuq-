# Mandatory app updates

The server decides which installed versions may keep using SUUQIYE. Changing the rule needs no app release.

## How it works

- Table `public.app_update_policy` (migration `0078`), one row per platform (`ios`, `android`): `enabled`, `minimum_version`, `recommended_version`, `store_url`, `message` (optional `{en, so, am}` override).
- The app reads only its own platform's row with the public anon key (SELECT only; RLS has no write policy). It never holds a service-role key.
- The installed version is the marketing version in `app.json` (`expo.version`, read via `expo-constants`), compared numerically per component with `major.minor.patch` (so `1.9.0 < 1.10.0`). The native build number (iOS `buildNumber`, Android `versionCode`) is never used and is not touched by this feature.
- If installed < `minimum_version` and `enabled` is true: a full-screen, non-dismissible "Update required" screen (native Modal, hardware back swallowed) with **Update now**, which opens `store_url`. Everything beneath it, plus the sign-in prompt, push banner and snackbars, is withheld.
- If installed < `recommended_version` only: nothing is shown (reserved for a future soft prompt).

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
