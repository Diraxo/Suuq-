// Reminder scheduling for dismissible updates (normal reminder / important announcement). Pure: storage and clock are injected,
// so tests/appUpdateReminder.test.ts covers the interval, first-reminder delay, once-per-session rule and clock-change safety.
// Mandatory updates never go through here: they have no "later".
import { OptionalUpdate, UpdatePlatform } from './appUpdate';

export type ReminderRecord = {
  /** When this update was first seen on this device (start of the first-reminder delay). */
  firstSeenAt: number;
  dismissedAt?: number;
  /** Do not remind again before this time. */
  remindAfter?: number;
};
export type ReminderState = Record<string, ReminderRecord>;

export type ReminderDeps = {
  load: () => Promise<ReminderState>;
  save: (state: ReminderState) => Promise<void>;
  now: () => number;
};

const HOUR_MS = 3_600_000;
const MAX_RECORDS = 20;

/** One reminder record per platform + release + target version, so a newer release starts a fresh reminder cycle. */
export function reminderKey(platform: UpdatePlatform, update: Pick<OptionalUpdate, 'release' | 'targetVersion'>): string {
  return `${platform}:${update.release?.id ?? 'recommended'}:${update.targetVersion}`;
}

/** Pure rule: may this update be shown now? */
export function isReminderDue(update: OptionalUpdate, record: ReminderRecord | undefined, now: number): boolean {
  const interval = update.reminderIntervalHours * HOUR_MS;
  if (!record) return update.firstReminderDelayHours === 0;
  if (record.remindAfter !== undefined) {
    // A remind-after further in the future than one full interval means the clock moved (or the value is corrupt): do not stay silent forever.
    if (record.remindAfter - now > interval) return true;
    return now >= record.remindAfter;
  }
  return now >= record.firstSeenAt + update.firstReminderDelayHours * HOUR_MS;
}

export function createReminderStore(deps: ReminderDeps) {
  let state: ReminderState | null = null;
  const shownThisSession = new Set<string>();

  async function ensure(): Promise<ReminderState> {
    if (state) return state;
    try {
      state = await deps.load();
    } catch {
      state = {};
    }
    return state;
  }

  async function persist(): Promise<void> {
    if (!state) return;
    const keys = Object.keys(state);
    if (keys.length > MAX_RECORDS) {
      const newest = keys.sort((a, b) => (state![b].dismissedAt ?? state![b].firstSeenAt) - (state![a].dismissedAt ?? state![a].firstSeenAt)).slice(0, MAX_RECORDS);
      state = Object.fromEntries(newest.map((k) => [k, state![k]]));
    }
    try {
      await deps.save(state);
    } catch {
      /* the reminder is best-effort; failing to save only means it may show once more */
    }
  }

  return {
    /**
     * Should this update be shown now? Records first sight, and marks it shown for this session so it never repeats before the app restarts.
     * Call once per (update, session); navigation events must not call it again (the session set also guards that).
     */
    async shouldShow(platform: UpdatePlatform, update: OptionalUpdate): Promise<boolean> {
      const key = reminderKey(platform, update);
      if (shownThisSession.has(key)) return false;
      const s = await ensure();
      const now = deps.now();
      let record = s[key];
      if (!record) {
        record = { firstSeenAt: now };
        s[key] = record;
        await persist();
      }
      if (!isReminderDue(update, record, now)) return false;
      shownThisSession.add(key);
      return true;
    },

    /** "Remind me later": the next reminder is one interval from now. */
    async dismiss(platform: UpdatePlatform, update: OptionalUpdate): Promise<{ dismissedAt: number; remindAfter: number }> {
      const key = reminderKey(platform, update);
      const s = await ensure();
      const now = deps.now();
      const remindAfter = now + update.reminderIntervalHours * HOUR_MS;
      s[key] = { firstSeenAt: s[key]?.firstSeenAt ?? now, dismissedAt: now, remindAfter };
      shownThisSession.add(key);
      await persist();
      return { dismissedAt: now, remindAfter };
    },
  };
}
