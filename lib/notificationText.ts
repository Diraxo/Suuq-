// Localizes the notification rows the DATABASE writes (migrations 0039 / 0047). Those rows carry English text because
// triggers cannot know the reader's language, so the notification center swaps in a translation keyed by the row's
// stable `type` + `data.kind` / `data.status`. Anything unknown keeps the server text, so a new server-side type can
// never render as a blank or a raw translation key. Pure (translator passed in) so it is unit-tested.
export type ServerNotificationRow = {
  title: string;
  body: string | null;
  type: string | null;
  data: Record<string, unknown> | null;
};

export type Translator = {
  t: (key: string) => string;
  exists: (key: string) => boolean;
};

function str(v: unknown): string | null {
  return typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : null;
}

export function localizeServerNotification(row: ServerNotificationRow, tr: Translator): { title: string; body: string } {
  const fallback = { title: row.title, body: row.body ?? '' };
  let base: string | null = null;
  switch (row.type) {
    case 'verification': {
      const kind = str(row.data?.kind);
      if (kind) base = `notifications.server.${kind}`;
      break;
    }
    case 'report_result': {
      const status = str(row.data?.status);
      if (status) base = `notifications.server.report_${status}`;
      break;
    }
    case 'moderation': {
      // The row title is the brand label "Suuqiye Support Team"; only the one-line body describes the event.
      const kind = str(row.data?.kind);
      if (kind && tr.exists(`notifications.server.moderation.${kind}`)) {
        return { title: row.title, body: tr.t(`notifications.server.moderation.${kind}`) };
      }
      return fallback;
    }
    default:
      return fallback;
  }
  if (base && tr.exists(`${base}.title`) && tr.exists(`${base}.body`)) {
    return { title: tr.t(`${base}.title`), body: tr.t(`${base}.body`) };
  }
  return fallback;
}
