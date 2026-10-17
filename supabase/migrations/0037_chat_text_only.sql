-- 0037 — chat is text-only; messages can no longer carry attachments.
--
-- DECISION: Suuqiye chat supports text only (no photos, files or other
-- attachments). This replaces the earlier draft of 0037 (per-key ownership
-- validation), which is no longer needed because no key is ever accepted or
-- forwarded any more.
--
-- PROBLEM (B2) this closes: messages.image_keys (0025) is a free-form text[]
-- and the "participants can send messages" policy (0023) only checks sender and
-- membership, so a participant could insert ANY object key and then call
-- delete_message(), which forwarded image_keys verbatim to the trusted r2-delete
-- webhook — deleting another user's R2 object.
--
-- SCHEMA (inspected, 0023 + 0025): the only attachment-bearing columns are
--   messages.images      text[] NOT NULL DEFAULT '{}'   (public delivery URLs)
--   messages.image_keys  text[] NOT NULL DEFAULT '{}'   (R2 object keys)
-- Both are NOT NULL with an empty-array default, so "no attachment" is the empty
-- array '{}' (never NULL). The existing 0023 CHECK that a live message needs
-- text OR images keeps working: text-only messages satisfy it via text.
--
-- WHAT THIS DOES
--   1. BEFORE INSERT / UPDATE OF images, image_keys trigger (server-side, applies
--      to every role, so it also covers old app versions that still send images):
--        * INSERT: images and image_keys must both be empty -> else 22023.
--        * UPDATE: a non-empty images/image_keys value may not be introduced or
--          changed. Clearing to '{}' (delete_message) is allowed.
--      Clients have no UPDATE policy anyway; this also guards definer functions
--      and admin tooling.
--   2. delete_message() is rewritten WITHOUT any webhook call. It no longer reads
--      image_keys, never touches private.settings, never calls net.http_post.
--      It soft-deletes the sender's own message and clears text/images/image_keys
--      (so legacy forged keys are blanked and can never be used later).
--      Authorization is unchanged: sender_id = auth.uid() and deleted_at is null.
--      EXECUTE is additionally revoked from PUBLIC/anon (it already failed for
--      them because auth.uid() is NULL; now it fails earlier).
--
-- BACKWARD COMPATIBILITY
--   * Text messages (incl. those sent by old clients, which send images = '{}' and
--     image_keys = '{}') are unaffected. edit_message() only sets text/edited_at,
--     so it neither fires the trigger nor is changed.
--   * Existing rows are NOT rewritten. Legacy photo messages stay readable (the
--     apps show a "Photo" placeholder), can be edited if they have text, and can
--     be deleted. Deleting one no longer removes its R2 object (it is orphaned,
--     not deleted); clean those with scripts/cleanup-r2-images.mjs if wanted.
--   * An OLD app that tries to send a photo gets error 22023 -> its message shows
--     "failed to send". Text sending is unaffected.
--
-- NOT TOUCHED: private.settings 'r2_delete_webhook_secret' and the r2-delete
-- function's secret/JWT authentication stay as they are.

-- Clean up the earlier draft's objects if they were ever created somewhere.
drop trigger if exists validate_message_image_keys_trg on public.messages;
drop function if exists public.validate_message_image_keys();
drop function if exists public.is_chat_image_key_for(text, uuid, uuid);

-- ============================================================================
-- 1. Text-only guard
-- ============================================================================
create or replace function public.enforce_text_only_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Both columns are NOT NULL, so cardinality() is never NULL here.
  if tg_op = 'INSERT' then
    if cardinality(new.images) > 0 or cardinality(new.image_keys) > 0 then
      raise exception 'Chat is text-only: attachments are not allowed' using errcode = '22023';
    end if;
  else
    if (cardinality(new.images) > 0 and new.images is distinct from old.images)
       or (cardinality(new.image_keys) > 0 and new.image_keys is distinct from old.image_keys) then
      raise exception 'Chat is text-only: attachments are not allowed' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_text_only_trg on public.messages;
create trigger enforce_text_only_trg
  before insert or update of images, image_keys on public.messages
  for each row execute function public.enforce_text_only_message();

-- ============================================================================
-- 2. delete_message — no R2 / webhook involvement at all
-- ============================================================================
create or replace function public.delete_message(p_message_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_msg public.messages;
  v_is_latest boolean;
begin
  update public.messages
  set deleted_at = now(), text = null, images = '{}', image_keys = '{}'
  where id = p_message_id and sender_id = auth.uid() and deleted_at is null
  returning * into v_msg;

  if not found then
    raise exception 'Message not found or not deletable';
  end if;

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

revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;
