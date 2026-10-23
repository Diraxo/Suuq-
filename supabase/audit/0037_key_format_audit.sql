-- READ-ONLY production audit run before migration 0037 (chat text-only) and the stricter
-- r2-delete / delete-account key validators. Every statement is a SELECT; nothing here
-- writes, deletes or rewrites data. Run Q0 first, then Q1-Q5 (Q2b and Q3 are drill-downs), and save results.
-- Column names come from migrations 0018 (profiles.*_public_id, listings.image_public_ids)
-- and 0023/0025 (messages.*). Q0 confirms they match production before you trust Q1-Q5.
-- Rows returned are NOT automatically bugs: classify each (valid legacy asset vs.
-- key the new validator would reject). Do not delete/rewrite rows to "zero" the audit.

-- ---------------------------------------------------------------------------
-- Q0: schema reality check (types, trigger list, policies, live delete_message)
-- ---------------------------------------------------------------------------
select table_name, column_name, data_type, udt_name, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'messages'  and column_name in ('id','conversation_id','sender_id','images','image_keys','deleted_at'))
    or (table_name = 'listings'  and column_name in ('id','user_id','images','image_public_ids'))
    or (table_name = 'profiles'  and column_name in ('id','avatar_url','avatar_public_id','business_logo_public_id','business_banner_public_id')))
order by table_name, column_name;

select tgname, pg_get_triggerdef(oid) as def
from pg_trigger where tgrelid = 'public.messages'::regclass and not tgisinternal;

select policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'messages';

select pg_get_functiondef('public.delete_message(uuid)'::regprocedure) as live_delete_message;
-- Compare live_delete_message to 0025 before applying 0037 (0037 replaces it with a
-- version that never calls r2-delete).

-- ---------------------------------------------------------------------------
-- Q1: messages.image_keys overview
-- ---------------------------------------------------------------------------
select
  count(*) filter (where cardinality(image_keys) > 0)                       as msgs_with_keys,
  count(*) filter (where cardinality(image_keys) > 0 and deleted_at is null) as live_msgs_with_keys,
  count(*) filter (where cardinality(image_keys) > 10)                       as over_10_keys,
  count(*) filter (where cardinality(images) > 0 and cardinality(image_keys) = 0) as images_without_keys_legacy
from public.messages;

-- ---------------------------------------------------------------------------
-- Q2: legacy message keys, classified (0037 itself no longer validates keys: chat is
--     text-only and delete_message ignores them; this just sizes the orphaned legacy objects)
--     (own namespace vs. foreign namespace vs. malformed)
-- ---------------------------------------------------------------------------
with k as (
  select m.id, m.conversation_id, m.sender_id, m.deleted_at, key
  from public.messages m, unnest(m.image_keys) as key
)
select
  case
    when key ~* ('^chat/' || conversation_id || '/' || sender_id || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') then 'valid_for_this_message'
    when key ~* '^chat/[A-Za-z0-9_-]{1,64}/[0-9a-f-]{36}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$' then 'chat_shape_but_other_conv_or_sender'
    when key = '' then 'empty_string'
    else 'malformed_or_non_chat'
  end as verdict,
  count(*) as n,
  count(*) filter (where deleted_at is null) as live_n,
  min(key) as example_key
from k
group by 1
order by 1;

-- Q2b: the actual rows for 'chat_shape_but_other_conv_or_sender' (forged or migrated?)
select m.id, m.conversation_id, m.sender_id, m.created_at, m.deleted_at, key
from public.messages m, unnest(m.image_keys) as key
where not (key ~* ('^chat/' || m.conversation_id || '/' || m.sender_id || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$'))
order by m.created_at desc
limit 200;

-- ---------------------------------------------------------------------------
-- Q3: the same key attached to messages by DIFFERENT senders (forgery signature)
-- ---------------------------------------------------------------------------
select key, count(distinct sender_id) as senders, count(*) as msgs
from public.messages m, unnest(m.image_keys) as key
group by key
having count(distinct sender_id) > 1
limit 200;

-- ---------------------------------------------------------------------------
-- Q4: listings.image_public_ids formats (delete-account deletes these with R2
--     admin creds; r2-delete requires listings/{user_id}[/{draft}]/{uuid}.jpg)
-- ---------------------------------------------------------------------------
with k as (select l.id, l.user_id, key from public.listings l, unnest(l.image_public_ids) as key)
select
  case
    when key ~* ('^listings/' || user_id || '(/[A-Za-z0-9_-]{1,64})?/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') then 'valid_owned_r2_key'
    when key ~* '^listings/' then 'listings_prefix_other_user_or_odd_shape'
    when key ~ '^https?://' then 'full_url'
    when key like '%..%' or key like '%\%%' or key like '%\\%' then 'traversal_or_encoded'
    when key = '' then 'empty_string'
    else 'legacy_cloudinary_or_other'
  end as verdict,
  count(*) as n,
  min(key) as example_key
from k
group by 1
order by 1;

-- ---------------------------------------------------------------------------
-- Q5: profile avatar / business logo / banner key formats
-- ---------------------------------------------------------------------------
with k as (
  select id, 'avatar' as kind, avatar_public_id as key from public.profiles where avatar_public_id is not null
  union all select id, 'logo',   business_logo_public_id   from public.profiles where business_logo_public_id   is not null
  union all select id, 'banner', business_banner_public_id from public.profiles where business_banner_public_id is not null
)
select
  kind,
  case
    when kind = 'avatar' and key ~* ('^avatars/' || id || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') then 'valid_owned_r2_key'
    when kind in ('logo','banner') and key ~* ('^business/' || id || '/(logo|banner)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]jpg$') then 'valid_owned_r2_key'
    when key ~ '^https?://' then 'full_url'
    when key like '%..%' then 'traversal'
    when key = '' then 'empty_string'
    else 'legacy_cloudinary_or_other_or_foreign'
  end as verdict,
  count(*) as n,
  min(key) as example_key
from k
group by 1, 2
order by 1, 2;
