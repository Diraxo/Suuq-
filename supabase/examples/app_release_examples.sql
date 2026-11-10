-- ILLUSTRATIVE ONLY. Not a migration; nothing runs this automatically. Run one block by hand (service role / SQL editor) when you really publish.
--
-- Rules of thumb before you run any of these:
--   * Run migration 0090 first. The versions, text and store URLs below are examples: replace them with the real release.
--   * Publish only AFTER the target version is downloadable from that platform's store. Never require a version that is not live yet.
--   * Each block links the release to ONE platform's policy row; the other platform is untouched. Repeat with 'ios' / the iOS URL for iOS.
--   * Undo any of them instantly:  update public.app_update_policy set enabled = false where platform = 'android';
--     (or unlink:  update public.app_update_policy set current_release_id = null where platform = 'android';)
--   * No UUIDs are hard-coded: the release id is taken from the INSERT itself.

-- ───────────────────────── 1) NORMAL release: optional reminder, every 72 hours ─────────────────────────
with r as (
  insert into public.app_releases (platform, version, version_code, release_type, title, description, changelog, mandatory, target_version, android_store_url, published)
  values (
    'android', '1.1.0', 2, 'normal', 'Performance improvements and bug fixes',
    'Performance improvements and bug fixes.',
    '{"items":[{"title":"Smoother scrolling","description":"Listings load faster.","icon":"zap"}]}'::jsonb,
    false, '1.1.0', 'https://play.google.com/store/apps/details?id=suuqiye.com', true
  ) returning id
)
update public.app_update_policy
   set enabled = true, current_release_id = (select id from r),
       recommended_version = '1.1.0', reminder_interval_hours = 72, first_reminder_delay_hours = 0, show_whats_new = true
 where platform = 'android';

-- ───────────────────────── 2) IMPORTANT feature release: optional announcement, every 24 hours ─────────────────────────
with r as (
  insert into public.app_releases (platform, version, version_code, release_type, title, description, changelog, translations, mandatory, target_version, android_store_url, published)
  values (
    'android', '1.2.0', 3, 'important', 'New marketplace features',
    'New marketplace features and improvements.',
    '{"items":[
       {"title":"Faster image loading","description":"Photos now load more smoothly.","icon":"image"},
       {"title":"Improved messaging","description":"Messaging performance has been improved.","icon":"message-circle"}
     ]}'::jsonb,
    '{"so":{"title":"Astaamo cusub oo suuq ah","description":"Astaamo cusub iyo hagaajinno.","items":[{"title":"Sawirro dhaqso ah"},{"title":"Fariin hagaagsan"}]}}'::jsonb,
    false, '1.2.0', 'https://play.google.com/store/apps/details?id=suuqiye.com', true
  ) returning id
)
update public.app_update_policy
   set enabled = true, current_release_id = (select id from r),
       recommended_version = '1.2.0', reminder_interval_hours = 24, first_reminder_delay_hours = 0, show_whats_new = true
 where platform = 'android';

-- ───────────────────────── 3) CRITICAL mandatory release: blocks every version below 1.2.0 ─────────────────────────
-- (A critical release is always mandatory; the database refuses mandatory = false for it.)
with r as (
  insert into public.app_releases (platform, version, version_code, release_type, title, description, mandatory, minimum_supported_version, target_version, android_store_url, support_url, published)
  values (
    'android', '1.3.0', 4, 'critical', 'Security update required',
    'A critical security or compatibility update is required to keep using SUUQIYE.',
    true, '1.2.0', '1.3.0', 'https://play.google.com/store/apps/details?id=suuqiye.com', 'mailto:support@suuqiye.com', true
  ) returning id
)
update public.app_update_policy
   set enabled = true, current_release_id = (select id from r), support_url = 'mailto:support@suuqiye.com'
 where platform = 'android';
