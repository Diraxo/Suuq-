# Moderation, reports, verification & notification repair

Status: implemented locally, **nothing committed, deployed or applied to a live database**.
New migration: `supabase/migrations/0047_report_review_workspace.sql` (UNAPPLIED). Rollback: `supabase/rollback/0047_report_review_workspace_ROLLBACK.sql` (not run).

## 1. Audit — root cause of each problem

| Symptom | Root cause (verified in code) |
|---|---|
| Report queue/detail show a name only | `web/src/services/admin.ts` read the raw `reports` table and only resolved `reporter_id → name`. The target was read from `listings`/`profiles` through the *public* RLS policy, so a removed/disabled listing was invisible ("no longer available") and images were never selected or rendered. There was no reported-user panel, history, or evidence. |
| Verified user can't see their own tick | Two causes. (a) `app/(tabs)/profile.tsx` and `web/src/app/profile/page.tsx` hard-coded a "New Seller" badge and never rendered `verified`; the tick only existed on *other* people's views (seller page, listing, dealer). (b) The web app had no Realtime/visibility refresh of the signed-in user's own `profiles` row, so a session opened before verification kept the stale profile (mobile already had the Realtime refresh). |
| Admin actions "succeed" but the user hears nothing | (a) `admin_set_verified()` (0038) updated `verified_at` + audit log and **never wrote a notification** — verification had no notification at all. (b) Warn/suspend/ban/listing actions do write a notice + notification in `_moderation_record()` (0039), but the live database does not have 0038–0046 applied (probed 2026-10-16, see memory), so those actions either do not exist there or run the old 0027 RPCs with no notice. (c) The web notification center ignored `type`/`data` and had no click navigation, so even delivered rows were dead ends. (d) Nothing recorded whether push was ever attempted. |
| Reporter told "dismissed" wrongly / twice | `notify_on_report_status_change()` (0021) used `else 'dismissed'`, so moving a report to **reviewing** (or reopening) sent "Your report was dismissed", and every re-close sent another copy. |
| Notifications forgeable | `"users manage their own notifications"` was `FOR ALL`: any signed-in user could INSERT a notification for themselves (e.g. a fake "You are now verified") and rewrite the text/type of ones they received. |
| Push could be silently skipped | The edge function skipped any type whose category (`system`) the user had switched off — including a ban/suspension notice — and never recorded the outcome. |

Not broken (verified, left alone): 0039 server-side enforcement (suspended/banned writes are rejected by triggers), 0044 block enforcement, 0046 chat blocking, public listing policy.

## 2. What changed

**Database (0047, unapplied)**
- `notifications`: `dedupe_key` (unique per user), `push_status` / `push_attempted_at` / `push_error`; client INSERT removed; UPDATE limited to the `read` flag by a trigger; moderation rows are keyed `moderation:<event id>` and carry `noticeId`.
- `report_admin` (assignee, reviewer, resolution note, small evidence snapshot) and `report_notes` — **staff-only tables**, kept out of `reports` because the reporter can read their own report row.
- `admin_report_queue(...)` / `admin_report_detail(id)` — SECURITY DEFINER, `search_path` pinned, gated by `staff_can('report_status')` (admin + moderator). Read removed/deleted listings without touching the public policy; explicit column list (no phone/email).
- `admin_update_report_status` — requires a reason to dismiss, rejects no-op transitions, records reviewer/resolution, audits `from → to`.
- `admin_add_report_note` — internal notes (never copied into any notification).
- `admin_set_verified` — same signature; now also writes one `verification` notification (deduped by event id; the internal reason is not copied).
- `notify_on_report_status_change` — only `reviewed`/`dismissed`, once per outcome.
- Evidence snapshot at report time + `purge_report_evidence()` retention function (not scheduled; call it from a cron/Dashboard).

**Edge function** `send-push-notification`: records `sent / no_devices / disabled / failed` per notification; moderation and verification pushes bypass the optional "system" opt-out. (**Needs redeploying; not type-checked here** — `deno check` could not resolve npm deps in this environment.)

**Web admin** — `admin/reports/page.tsx` (queue: reporter + reported avatars/names, reason, type, listing thumbnail/title, status, reviewer, report #, search, status/type/date filters, server pagination, skeleton/empty/error+retry), `admin/reports/[id]/page.tsx` (full workspace: reporter & reported panels with ids and history, full listing evidence with every image + lightbox + deleted/removed explanations, other reports on the same target, internal notes, decisions with confirmation, outcome + notification/push status, audit trail), `AdminActionModal` (+ typed `BAN` confirmation, double-submit guard), `AdminAvatar`, `lib/reportUi.ts`, `services/admin.ts`.

**Verification consistency** — one source (`profiles.verified_at`, set only by `admin_set_verified`). Own-profile badge on mobile + web; web now live-refreshes the profile (Realtime + tab visibility); mobile also refreshes when a `verification` notification arrives.

**Notifications UI** — web notification center: icons for new types, click marks read and navigates (`lib/notificationRoute.ts`, uuid-validated); mobile `navigateForPush` handles `verification`; `lib/notificationText.ts` localizes server-written rows (en/so/am) in the mobile notification center.

## 3. Admin report workflow
Queue → open report → read reporter explanation, both profiles, listing evidence (images/description/price/condition, or deleted/removed notice) → optional internal note → **Start review** (assigns you) → decide: warn / suspend (end date required) / permanent ban (type `BAN`) / lift / disable / remove / restore listing, each with an internal reason and an optional user-visible message → dismiss (reason required) or mark resolved. After each action the page re-reads and shows the persisted status plus "user notification: in-app saved · push …".

## 4. Notifications users receive
Verified · Verification removed · Listing removed / deactivated / restored · Warning · Suspension (end date in the notice) · Suspension lifted / expired · Ban · Ban lifted · Appeal approved / rejected · Reporter: report reviewed / dismissed. Each is one in-app row per event, opens `/support` (notice detail with the staff message) or the verification/profile screen. Rejected *verification requests* are **not** covered: the product has no verification-request workflow (only staff grant/revoke).

## 5. Tests actually run (local)
- `npm test` → 376 / 376 pass (7 new: notification routing incl. hostile ids; localization completeness en/so/am).
- Database suites on real Postgres (PGlite) via `supabase/tests/run-all.mjs`: **all 11 suites pass**, including the new `report_workspace` (13 checks: queue enrichment, filters, pagination, authorization incl. anon/reporter/support, removed + hard-deleted listing evidence, review workflow, one notification per outcome, verification owner/other-viewer consistency and forgery attempts, warn/suspend/lift/ban notifications + enforcement, notification forgery, push-failure record, migration idempotency, rollback) and the existing block/chat/moderation/discovery suites (no regressions).
- `web`: `tsc --noEmit` clean; `next build` succeeds. Mobile `tsc` has no errors under app/lib/store/components/hooks.

**Not verified (cannot be from here):** anything against the real Supabase project, a browser session, a device, or real FCM delivery; the edge function type-check; Somali/Amharic wording by a native speaker; mobile UI on a device.

## 6. Risks / requirements
1. Live DB lacks 0038–0046: apply in order **0038 → 0047** (read-only probe first; back up). 0047 needs 0039.
2. Redeploy `send-push-notification`.
3. Repeating the *same* warning twice creates two warnings (state-transition actions reject repeats; warn is intentionally repeatable) — the UI blocks double clicks.
4. Push text is English (server-generated); in-app rows are localized on mobile only. The web app has no runtime i18n by design.
5. Listing cards do not show a seller tick (existing design; the tick appears on listing detail, seller and own profile).
6. R2 images of removed listings remain stored (reversible disable) and publicly addressable by URL, as before.

## 7. Live test plan (three test accounts: Reporter **R**, Reported **S**, Unrelated **U**; one admin **A**)
1. R reports S's listing (reason + explanation). A: Reports → the row shows R and S avatars, reason, listing thumbnail.
2. A opens it: both panels, all images (open viewer), description/price. Add an internal note. **Start review** (reviewer = A).
3. S: confirm nothing changed. U: confirm U sees nothing and `/admin/reports` is a 404.
4. A **Sends a warning** with a message. S: notification arrives (push if device registered), opens Notices & support, shows the message but not A's internal reason. R and U: nothing.
5. A **Removes** the listing. S: removal notice; listing absent for U/anon; A can still open the evidence. **Restore** → S told; listing back.
6. A **Suspends** S (3 days). S: cannot post/message (server error), can open notices/appeal. **Lift** → notice.
7. A **Dismisses** (reason). R gets exactly one "dismissed" notification; reopen + re-dismiss sends no second one.
8. Admin → Users → S → **Verify**. S: notification "You are now verified"; S's own Profile (mobile + web) shows the tick without restarting; U sees the tick on S's seller page and listing. **Unverify** → S notified, tick gone for everyone.
9. Direct-API checks as R/U: `rpc admin_report_queue`, `admin_set_verified`, `insert into notifications` must all fail.
10. Turn S's "system" push category off; repeat a warning → push still arrives; check `notifications.push_status`.
