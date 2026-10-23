-- Verification for migration 0037 (chat is text-only). REAL database test: it
-- executes the migration's trigger and delete_message() inside one transaction
-- that is ROLLED BACK. NOT RUN YET (no Postgres in the repo's dev environment).
--
-- SAFETY
--   * Run ONLY on a disposable/staging database that has 0001..0037 applied and
--     at least one conversation with two participants. Do NOT run on production.
--   * Opt-in guard: the script aborts unless you first run
--         set suuqiye.allow_test = 'yes';
--     in the same session (a deliberate speed bump against pasting into prod).
--   * delete_message() (0037) makes no HTTP/webhook call. NOTE: inserting a message
--     fires on_message_insert -> notifications -> the PUSH webhook trigger
--     (on_notification_insert_push, hard-coded to the production push URL). Inside
--     this transaction that trigger is DISABLED, and even if it were not, pg_net only
--     sends committed queue rows and this transaction is rolled back. The script
--     asserts that no pg_net request to r2-delete is queued (push requests are not
--     what is being checked and are disabled anyway).
--   * Temporarily disables TWO triggers inside the transaction (enforce_text_only_trg
--     to plant legacy rows; on_notification_insert_push to avoid any push HTTP);
--     the rollback restores both.
-- Any failed assertion raises and aborts.

begin;

alter table public.notifications disable trigger on_notification_insert_push;

do $$
declare
  c uuid; s uuid; o uuid;                     -- conversation, sender, other participant
  outsider uuid := gen_random_uuid();         -- not a participant of c
  mid uuid; legacy uuid; legacy_text uuid;
  q0 bigint := 0; q1 bigint := 0;
  failed boolean; msg public.messages; k text;
  forged text[] := array[
    'chat/' || gen_random_uuid() || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg',
    'listings/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg',
    'avatars/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg'
  ];
begin
  if coalesce(current_setting('suuqiye.allow_test', true), '') <> 'yes' then
    raise exception 'Refusing to run: set suuqiye.allow_test = ''yes'' first, and only on a disposable database';
  end if;

  select a.conversation_id, a.user_id, b.user_id into c, s, o
  from public.conversation_participants a
  join public.conversation_participants b on b.conversation_id = a.conversation_id and b.user_id <> a.user_id
  limit 1;
  if c is null then raise exception 'need one conversation with two participants to run this test'; end if;

  -- 0. delete_message no longer references the webhook or R2 ---------------------
  assert pg_get_functiondef('public.delete_message(uuid)'::regprocedure) !~* 'net\.http|r2-delete|r2_delete|private\.settings',
    'delete_message still references the webhook';
  assert pg_get_functiondef('public.delete_message(uuid)'::regprocedure) !~* 'unnest',
    'delete_message still iterates image keys';
  assert has_function_privilege('authenticated', 'public.delete_message(uuid)', 'execute'), 'authenticated lost EXECUTE on delete_message';
  assert not has_function_privilege('anon', 'public.delete_message(uuid)', 'execute'), 'anon still has EXECUTE on delete_message';
  assert has_function_privilege('authenticated', 'public.edit_message(uuid,text)', 'execute'), 'authenticated lost EXECUTE on edit_message';
  if to_regclass('net.http_request_queue') is not null then
    execute $q$select count(*) from net.http_request_queue where url ilike '%r2-delete%'$q$ into q0;
  end if;

  -- act as participant s (RLS + triggers apply) ---------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', s::text, true);
  set local role authenticated;

  -- 1. text-only insert succeeds (columns omitted, and explicit empty arrays) ----
  insert into public.messages (conversation_id, sender_id, text) values (c, s, 'hello') returning id into mid;
  insert into public.messages (conversation_id, sender_id, text, images, image_keys) values (c, s, 'hello 2', '{}', '{}');

  -- 2. inserts with ANY attachment data are rejected (22023) --------------------
  foreach k in array forged || array['https://x/1.jpg'] loop
    failed := false;
    begin
      insert into public.messages (conversation_id, sender_id, text, image_keys) values (c, s, 'x', array[k]);
    exception when sqlstate '22023' then failed := true; end;
    assert failed, 'image_keys insert accepted: ' || k;

    failed := false;
    begin
      insert into public.messages (conversation_id, sender_id, text, images) values (c, s, 'x', array[k]);
    exception when sqlstate '22023' then failed := true; end;
    assert failed, 'images insert accepted: ' || k;

    failed := false;  -- photo-only message (what an old client would send)
    begin
      insert into public.messages (conversation_id, sender_id, text, images, image_keys) values (c, s, null, array[k], array[k]);
    exception when sqlstate '22023' then failed := true; end;
    assert failed, 'photo-only insert accepted: ' || k;
  end loop;

  -- 3. edit_message on a text message still works ---------------------------------
  select * into msg from public.edit_message(mid, 'hello edited');
  assert msg.text = 'hello edited' and msg.edited_at is not null, 'edit_message broken';

  reset role;

  -- 4. UPDATE can't attach (even as table owner; clients have no UPDATE policy) ---
  failed := false;
  begin
    update public.messages set image_keys = array[forged[1]] where id = mid;
  exception when sqlstate '22023' then failed := true; end;
  assert failed, 'update attached image_keys';
  failed := false;
  begin
    update public.messages set images = array['https://x/1.jpg'] where id = mid;
  exception when sqlstate '22023' then failed := true; end;
  assert failed, 'update attached images';

  -- 5. plant LEGACY rows (guard disabled for this transaction only) ---------------
  alter table public.messages disable trigger enforce_text_only_trg;
  insert into public.messages (conversation_id, sender_id, text, images, image_keys)
    values (c, s, null, array['https://x/legacy.jpg'], array[forged[1]]) returning id into legacy;
  insert into public.messages (conversation_id, sender_id, text, images, image_keys)
    values (c, s, 'caption', array['https://x/legacy2.jpg'], array[forged[2]]) returning id into legacy_text;
  alter table public.messages enable trigger enforce_text_only_trg;

  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', s::text, true);
  set local role authenticated;

  -- 6. legacy message WITH text stays editable (edit doesn't fire the guard) ------
  select * into msg from public.edit_message(legacy_text, 'caption edited');
  assert msg.text = 'caption edited', 'legacy text message not editable';

  -- 7. deleting legacy messages works, blanks forged keys, forwards nothing --------
  perform public.delete_message(legacy);
  perform public.delete_message(legacy_text);
  perform public.delete_message(mid);
  reset role;
  for msg in select * from public.messages where id in (legacy, legacy_text, mid) loop
    assert msg.deleted_at is not null and msg.text is null, 'message not soft-deleted';
    assert cardinality(msg.images) = 0 and cardinality(msg.image_keys) = 0, 'attachment data not cleared on delete';
  end loop;
  if to_regclass('net.http_request_queue') is not null then
    execute $q$select count(*) from net.http_request_queue where url ilike '%r2-delete%'$q$ into q1;
  end if;
  assert q1 = q0, 'delete_message queued an r2-delete request (R2 deletion path still active)';

  -- 8. only the sender can delete: other participant, outsider, anonymous ----------
  insert into public.messages (conversation_id, sender_id, text) values (c, s, 'protected') returning id into mid;

  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', o::text, true);
  set local role authenticated;
  failed := false;
  begin
    perform public.delete_message(mid);
  exception when others then failed := true; end;
  assert failed, 'other participant deleted the sender''s message';
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', outsider, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  set local role authenticated;
  failed := false;
  begin
    perform public.delete_message(mid);
  exception when others then failed := true; end;
  assert failed, 'non-participant deleted a message';
  reset role;

  perform set_config('request.jwt.claims', '{}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  failed := false;
  begin
    perform public.delete_message(mid);
  exception when others then failed := true; end;
  assert failed, 'unauthenticated user deleted a message';
  reset role;

  assert (select deleted_at from public.messages where id = mid) is null, 'protected message was deleted';

  raise notice '0037 text-only checks passed';
end $$;

rollback;
