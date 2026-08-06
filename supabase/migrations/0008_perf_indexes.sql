-- Suuq+ follow-up schema: performance indexes for query patterns introduced by
-- chat, offers, reports, notifications, and search history that weren't
-- covered by their own migrations (0002-0007). Run once in the Supabase SQL
-- Editor after 0001-0007. Purely additive (CREATE INDEX IF NOT EXISTS) — safe
-- to run even if some of these already exist.

-- notifications: store/notifications.ts's load() does
-- `.eq('user_id', ...).order('created_at', desc)` on every screen open and
-- every realtime event — this table had no index at all until now (0001
-- only gave it a primary key).
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- conversations: store/chat.ts's loadConversations() does
-- `.or('buyer_id.eq.<me>,seller_id.eq.<me>')` on every Chats screen load —
-- lets Postgres satisfy the OR with a bitmap-or over two indexes instead of
-- a sequential scan.
create index if not exists conversations_buyer_idx on public.conversations (buyer_id);
create index if not exists conversations_seller_idx on public.conversations (seller_id);

-- search_history: store/searchHistory.ts's load() does
-- `.eq('user_id', ...).order('created_at', desc).limit(10)` — the existing
-- unique (user_id, query) index doesn't help an ORDER BY created_at.
create index if not exists search_history_user_created_idx
  on public.search_history (user_id, created_at desc);
