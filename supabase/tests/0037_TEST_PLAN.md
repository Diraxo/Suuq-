# Migration 0037 — disposable-database test plan (NOT executed yet)

No Docker, psql or Postgres exists in the dev environment, so `supabase/tests/0037_chat_text_only.sql`
has never run. The Node tests only check a JavaScript model + source text.

## Environment (needs your approval)
Option A (preferred): a NEW, separate Supabase project (free tier), never linked to production secrets.
Option B: local `supabase start` (needs Docker Desktop) with `supabase db reset` applying `supabase/migrations`.

1. Apply `0001`…`0035` in order (0036 is only in `supabase/proposed/` and does not touch `messages`; it is not required).
   If a migration fails from scratch, record which — that is a finding, not something to patch around on prod.
2. Neutralise outbound calls on the DISPOSABLE db only (committed):
   `alter table public.notifications disable trigger on_notification_insert_push;`
   (The push webhook URL is hard-coded to the production project in 0012/0019. The test also disables it inside its own transaction.)
3. Seed: two users in `auth.users` + `profiles`, one `conversations` row, two `conversation_participants`
   (create them through the app/Auth API on the disposable project, or via SQL as the owner role).
4. Apply `supabase/migrations/0037_chat_text_only.sql`.
5. In ONE SQL-editor session: `set suuqiye.allow_test = 'yes';` then run `supabase/tests/0037_chat_text_only.sql`.
   Expected: `NOTICE: 0037 text-only checks passed`, then rollback (nothing persists).

## What it proves (real PostgreSQL)
- text-only inserts succeed (columns omitted, and explicit `'{}'`); attachment inserts/updates fail with 22023 for the `authenticated` role and the table owner
- `edit_message` still works; legacy rows (planted with the guard temporarily disabled) stay editable
- `delete_message`: soft-deletes + clears text/images/image_keys, definition contains no `net.http`/`r2-delete`/`private.settings`/`unnest`, and no pg_net row for `r2-delete` is queued
- EXECUTE: `authenticated` has it, `anon` does not; other participant / outsider / anon cannot delete
- the migration is re-runnable: run step 4 a second time, then the test again

## Manual extras after the test
- `select pg_get_functiondef('public.delete_message(uuid)'::regprocedure);` — eyeball it.
- `select grantee, privilege_type from information_schema.routine_privileges where routine_name='delete_message';`
- Using the app/PostgREST as a real user: send text (ok), try a message with `images`/`image_keys` (22023), delete own message (ok).

## Not covered
Live R2, the edge functions, realtime delivery, and production data (see `supabase/audit/`).
