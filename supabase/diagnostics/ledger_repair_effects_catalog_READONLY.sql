-- READ-ONLY catalog snapshot. One SELECT statement; no DDL, no DML, no function with side effects.
-- Scope: every object created/altered by migrations 0046, 0047, 0052, 0056, 0060 plus the tables they touch.
with
t(sch, tbl) as (values
  ('public','notifications'),('public','profiles'),('public','report_admin'),('public','report_notes'),
  ('public','web_push_subscriptions'),('public','block_events'),('public','messages'),('public','conversation_participants'),
  ('public','message_reactions'),('public','blocked_users'),('public','reports'),('public','listings'),('public','reviews'),
  ('public','favorites'),('private','suppressed_messages')),
f(sch, fn) as (values
  ('private','message_is_suppressed'),('private','message_hidden_from_me'),('private','guard_message_block'),
  ('public','get_conversation_unread_counts'),('public','handle_new_message'),('public','edit_message'),('public','delete_message'),
  ('private','guard_reaction_block'),('private','log_block_event'),
  ('public','trg_notifications_normalize'),('public','trg_notifications_guard_update'),('public','_report_evidence'),
  ('public','trg_reports_capture_evidence'),('public','purge_report_evidence'),('public','admin_update_report_status'),
  ('public','admin_add_report_note'),('public','notify_on_report_status_change'),('public','admin_set_verified'),
  ('public','admin_report_queue'),('public','admin_report_detail'),
  ('public','trg_listings_notify_staff'),('public','trg_profiles_notify_staff'),('public','register_web_push'),
  ('public','profile_social_ok'),('public','guard_profile_content'),
  ('public','_staff_alert'),('public','_staff_name'),('public','trg_listings_edit_notify_staff'),
  ('public','trg_listings_delete_notify_staff'),('public','trg_profiles_edit_notify_staff'),('public','trg_profiles_delete_notify_staff'),
  ('public','trg_reviews_notify_staff'),('public','trg_blocks_notify_staff'),('public','staff_alert_health')),
rel as (select c.oid, n.nspname sch, c.relname tbl, c.relrowsecurity rls, c.relforcerowsecurity frls, c.relacl::text acl
          from pg_class c join pg_namespace n on n.oid = c.relnamespace join t on t.sch = n.nspname and t.tbl = c.relname),
fn as (select p.oid, n.nspname sch, p.proname, pg_get_function_identity_arguments(p.oid) args, p.prosecdef, p.proconfig::text cfg, p.proacl::text acl,
              md5(pg_get_functiondef(p.oid)) def_md5
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace join f on f.sch = n.nspname and f.fn = p.proname)
select kind, name, detail from (
  select 'meta' kind, 'snapshot' name, current_database() || ' | ' || now()::text || ' | ' || current_setting('server_version') detail
  union all select 'table', r.sch||'.'||r.tbl, 'rls='||r.rls||' force='||r.frls||' acl='||coalesce(r.acl,'') from rel r
  union all select 'column', r.sch||'.'||r.tbl||'.'||a.attname,
                   format_type(a.atttypid, a.atttypmod)||' notnull='||a.attnotnull||' default='||coalesce(pg_get_expr(d.adbin, d.adrelid),'')
              from rel r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
              left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all select 'constraint', r.sch||'.'||r.tbl||'.'||c.conname, pg_get_constraintdef(c.oid)||' validated='||c.convalidated
              from rel r join pg_constraint c on c.conrelid = r.oid
  union all select 'index', r.sch||'.'||r.tbl||'.'||i.indexname, i.indexdef
              from rel r join pg_indexes i on i.schemaname = r.sch and i.tablename = r.tbl
  union all select 'policy', p.schemaname||'.'||p.tablename||'.'||p.policyname,
                   p.cmd||' roles='||p.roles::text||' using='||coalesce(p.qual,'')||' check='||coalesce(p.with_check,'')
              from pg_policies p join rel r on r.sch = p.schemaname and r.tbl = p.tablename
  union all select 'trigger', r.sch||'.'||r.tbl||'.'||g.tgname, 'enabled='||g.tgenabled::text||' '||pg_get_triggerdef(g.oid)
              from rel r join pg_trigger g on g.tgrelid = r.oid where not g.tgisinternal
  union all select 'trigger_elsewhere', g.tgrelid::regclass::text||'.'||g.tgname, pg_get_triggerdef(g.oid)
              from pg_trigger g join fn on fn.oid = g.tgfoid where not g.tgisinternal and g.tgrelid not in (select oid from rel)
  union all select 'function', fn.sch||'.'||fn.proname||'('||fn.args||')', 'secdef='||fn.prosecdef||' cfg='||coalesce(fn.cfg,'')||' acl='||coalesce(fn.acl,'')||' def_md5='||fn.def_md5 from fn
  union all select 'function_missing', f.sch||'.'||f.fn, 'NOT FOUND' from f where not exists (select 1 from fn where fn.sch = f.sch and fn.proname = f.fn)
  union all select 'publication', pt.schemaname||'.'||pt.tablename, pt.pubname from pg_publication_tables pt join rel r on r.sch = pt.schemaname and r.tbl = pt.tablename
  union all select 'data', 'reports_total', count(*)::text from public.reports
  union all select 'data', 'report_admin_total', count(*)::text from public.report_admin
  union all select 'data', 'reports_without_report_admin', count(*)::text from public.reports r where not exists (select 1 from public.report_admin a where a.report_id = r.id)
  union all select 'data', 'report_notes_total', count(*)::text from public.report_notes
  union all select 'data', 'web_push_subscriptions_total', count(*)::text from public.web_push_subscriptions
  union all select 'data', 'block_events_total', count(*)::text from public.block_events
  union all select 'data', 'suppressed_messages_total', count(*)::text from private.suppressed_messages
  union all select 'data', 'notifications_with_dedupe_key', count(*)::text from public.notifications where dedupe_key is not null
  union all select 'data', 'profiles_violating_0056_length_checks',
                   count(*)::text from public.profiles where char_length(business_description) > 1000 or char_length(business_address) > 250 or char_length(business_website) > 250 or char_length(city) > 80
) x order by kind, name
