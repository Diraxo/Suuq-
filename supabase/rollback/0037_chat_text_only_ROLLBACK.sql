-- ROLLBACK for 0037_chat_text_only.sql.  NOT APPLIED ANYWHERE. Review before use.
--
-- WHAT IT DOES
--   1. Drops the text-only guard (trigger enforce_text_only_trg + function
--      enforce_text_only_message). Chat photo inserts are accepted by the database again.
--   2. Restores delete_message() to its pre-0037 definition (verbatim from
--      0025_chat_image_r2_cleanup.sql): it reads the message's image_keys and POSTs them to
--      the r2-delete webhook with the X-R2-Delete-Webhook-Secret header.
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * It does NOT restore EXECUTE for PUBLIC/anon on delete_message(). 0037 revoked it; anon
--     could never call it successfully anyway (auth.uid() is NULL), so keeping the revoke
--     re-opens nothing. `authenticated` keeps EXECUTE.
--   * It does NOT touch private.settings 'r2_delete_webhook_secret' (0037 never changed it).
--   * It does NOT touch r2-delete / r2-presign (edge functions are deployed separately).
--
-- IRREVERSIBLE LOSS (cannot be fixed by this script)
--   Since 0037, delete_message() clears images AND image_keys on the deleted message. Those
--   keys are gone: rolling back does not bring them back, so the R2 objects behind messages
--   deleted while 0037 was live remain orphaned (they are not referenced from anywhere).
--
-- SECURITY WARNING — read before running
--   Rolling back re-opens finding B2: a participant can again insert arbitrary image_keys and
--   delete_message() will forward them to r2-delete. This is only harmless while the NEW
--   r2-delete is deployed: it authorizes the trusted webhook for NO keys (isAuthorizedKey
--   returns false without a user id), so the forwarded request is rejected. If you roll back
--   the database, keep the new r2-delete. Consequence: legacy chat photos deleted after the
--   rollback are NOT removed from R2 (orphaned, not exposed) until r2-delete is also changed.
--
-- Re-runnable (idempotent).

begin;

drop trigger if exists enforce_text_only_trg on public.messages;
drop function if exists public.enforce_text_only_message();

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

-- Same grant as 0025; PUBLIC/anon stay revoked (see above).
revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;

commit;
