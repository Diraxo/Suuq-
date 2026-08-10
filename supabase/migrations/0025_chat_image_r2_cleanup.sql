-- Chat images uploaded to R2 (see supabase/functions/r2-presign) were never
-- getting their R2 object cleaned up: messages.images only ever stored the
-- public delivery URL, never the R2 object key needed to issue a DELETE, so
-- deleting a chat-image message (or the whole account) left the underlying
-- R2 object orphaned forever. listings already solved this for listing
-- photos with a parallel images/image_public_ids array pair
-- (0018_cloudinary_public_ids.sql) — this does the same for messages.
--
-- MANUAL STEP REQUIRED after this migration runs — delete_message()'s R2
-- cleanup call is fail-closed (silently skipped) until you complete it:
--   1. In the Supabase SQL editor, run:
--        select value from private.settings where key = 'r2_delete_webhook_secret';
--   2. supabase secrets set R2_DELETE_WEBHOOK_SECRET=<that value>
--   3. Redeploy r2-delete (the code change lives in this same commit).

-- ============================================================================
-- 1. messages.image_keys — parallel array to messages.images (same index ==
--    same photo), holding the R2 object key for each image so it can later
--    be deleted. Nullable-by-default-empty and purely additive: existing
--    rows keep displaying via `images` unchanged, they just have no key to
--    clean up (legacy/unmanaged — see message_image_keys_to_delete below).
-- ============================================================================
alter table public.messages
  add column if not exists image_keys text[] not null default '{}';

-- ============================================================================
-- 2. Shared secret so the delete_message() SECURITY DEFINER function (running
--    as Postgres, with no user JWT to present) can prove to r2-delete that
--    the request genuinely originates from this trigger/RPC and not a
--    forged client call — identical pattern to push_webhook_secret in
--    0019_security_hardening.sql.
-- ============================================================================
insert into private.settings (key, value)
values (
  'r2_delete_webhook_secret',
  replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
)
on conflict (key) do nothing;

-- ============================================================================
-- 3. delete_message — now also deletes the message's R2 image objects (if
--    any) before soft-deleting the row. The R2 keys deleted are always the
--    ones already stored on the message being deleted (never client-
--    supplied), and that row can only be reached by its own sender via the
--    `sender_id = auth.uid()` guard below — so this can never be used to
--    delete another user's R2 object, and there's no "foreign key" path a
--    client could smuggle in since no key is ever accepted as an argument.
--    net.http_post is fire-and-forget (queues the request and returns
--    immediately), so a slow/unreachable r2-delete never blocks the delete.
-- ============================================================================
create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
  v_secret text;
begin
  select * into v_msg
  from public.messages
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  for update;

  if not found then
    raise exception 'Message not found or not deletable';
  end if;

  if coalesce(array_length(v_msg.image_keys, 1), 0) > 0 then
    select value into v_secret from private.settings where key = 'r2_delete_webhook_secret';
    perform net.http_post(
      url := 'https://waksddinkjbrggxkfofk.functions.supabase.co/r2-delete',
      body := jsonb_build_object('keys', to_jsonb(v_msg.image_keys)),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-R2-Delete-Webhook-Secret', coalesce(v_secret, '')
      ),
      timeout_milliseconds := 5000
    );
  end if;

  update public.messages
  set deleted_at = now(), text = null, images = '{}', image_keys = '{}'
  where id = v_msg.id
  returning * into v_msg;

  select (m.id = v_msg.id) into v_is_latest
  from public.messages m
  where m.conversation_id = v_msg.conversation_id
  order by m.created_at desc, m.id desc
  limit 1;

  if v_is_latest then
    update public.conversations
    set last_message = public.message_preview(v_msg.text, v_msg.images, v_msg.deleted_at)
    where id = v_msg.conversation_id;
  end if;
end;
$$;

grant execute on function public.delete_message(uuid) to authenticated;
