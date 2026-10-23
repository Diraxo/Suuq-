# Chat blocking (WhatsApp model) — migration 0046

Status: built and tested locally; **not applied to any real database**. Needs 0043 and 0044 first (0046 reuses `private.blocked_either_way()` and `private.users_blocked()`).

## Behaviour
| Situation | Blocker (A) | Blocked person (B) |
|---|---|---|
| Open the chat | Full history, centred "You blocked B" / "You unblocked B" lines, Unblock banner instead of the composer, no call / offer buttons | Chat looks completely normal |
| B sends a message | Never appears: no row, unread count, notification, push or list preview. Stays hidden after unblock | Sends fine, one tick, never a second tick |
| A tries to send | Refused (`unblock_to_send`); the app shows the banner instead | — |
| Presence / typing | A stops broadcasting and ignores B's | B sees A as offline, never "typing" |
| Read receipts | Peer's participant row hidden while blocked | Same — a suppressed message can't turn into a double tick |
| Profile page | B's name + photo, a note, Unblock, three-dots menu. No listings / stats / reviews | Normal profile; A's listings simply don't load (0044) |
| Chat list | Conversation stays | Conversation stays |
| Reactions | Dropped silently both ways | Dropped silently |

## Where it lives
- DB: `supabase/migrations/0046_whatsapp_style_blocking.sql` (+ `rollback/0046_…_ROLLBACK.sql`), tests `supabase/tests/chat_blocking.test.mjs` (12 checks, real Postgres via PGlite).
  - `private.suppressed_messages` (no grants) + `private.message_hidden_from_me()` (true only for the recipient, so a sender can never use it to learn they are blocked).
  - `public.block_events`: private "you blocked / unblocked" log, written only by a trigger on `blocked_users`, readable only by its author.
- Mobile: `app/chat/[id].tsx`, `components/chat/MessageList.tsx` + `SystemNotice.tsx`, `hooks/useConversationChannel.ts` (`quiet`), `app/seller/[id].tsx`, `app/(tabs)/chats.tsx`, `store/blockedUsers.ts` (`version`).
- Web: `web/src/app/chat/[id]/page.tsx`, `web/src/components/chat/MessageList.tsx`, `web/src/hooks/useConversationChannel.ts`, `web/src/app/seller/[id]/page.tsx`, `web/src/store/blockedUsers.ts`.
- App tests: `tests/chatBlocking.test.ts`.

## Deploy order
1. Apply 0043, 0044, 0046 in order on staging; run the manual checks below; then production. The app changes are safe before 0046 but the blocked sender will still see "Failed to send" until it is applied.
2. Rolling back 0046 releases nothing that was sent during the block *except* that those suppressed messages become visible to their recipients again (the suppression table is dropped).

## Manual checks (two real accounts, staging)
- A blocks B from the chat menu → A sees "You blocked B", banner, no composer. B sends "hi" → B sees one tick; A's chat list shows no unread / preview and no push arrives.
- A opens the chat with the app foregrounded and B types → A never sees "typing"; B never sees A online.
- A unblocks → "You unblocked B" line; B's earlier "hi" is still not shown to A; a new message from B arrives normally.
- A opens B's profile while blocked → name + photo + Unblock only.

## Known limits
- `profiles.last_seen_at` is still readable by anyone who can read profiles, so B can still see A's "last seen" text in the header / list. Hiding it needs a profile-read RPC (not done).
- The shared `conversations.last_message` preview is not updated by a suppressed message, so B's own chat-list preview can lag behind what B sent.
- Block / unblock lines appear only for events after 0046 is applied (earlier blocks have no log row).
- Web UI strings are English only (same as the rest of the web chat); mobile strings exist in en / so / am.
