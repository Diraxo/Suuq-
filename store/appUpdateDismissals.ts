import { supabase } from '@/lib/supabase';
import { UpdatePlatform } from '@/lib/appUpdate';

/**
 * Best-effort server-side copy of a "Remind me later" (table app_update_dismissals, migration 0090), only for a signed-in user.
 * The local record (store/appUpdate.ts) is what actually schedules reminders; this is history, so every failure is swallowed
 * (offline, signed out, migration not applied yet). It writes only the caller's own row: RLS enforces user_id = auth.uid().
 */
export async function recordUpdateDismissal(d: { releaseId: string; platform: UpdatePlatform; dismissedAt: number; remindAfter: number }): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) return;
    await supabase.from('app_update_dismissals').upsert(
      { user_id: userId, release_id: d.releaseId, platform: d.platform, dismissed_at: new Date(d.dismissedAt).toISOString(), remind_after: new Date(d.remindAfter).toISOString() },
      { onConflict: 'user_id,release_id,platform' },
    );
  } catch {
    /* history only */
  }
}
