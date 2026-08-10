// Minimal imperative pub/sub so any module (services, hooks, screens) can
// surface a message without threading state through props — mirrors the
// module-level subscribe pattern already used by the realtime stores
// (e.g. store/follow.ts). <SnackbarHost /> (components/Snackbar.tsx) is the
// one subscriber, mounted once in app/_layout.tsx.
export type SnackbarPayload = { message: string; tone: 'default' | 'success' } | null;
type Listener = (payload: SnackbarPayload) => void;

let listeners: Listener[] = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showSnackbar(message: string, opts?: { tone?: 'default' | 'success'; durationMs?: number }) {
  const payload = { message, tone: opts?.tone ?? ('default' as const) };
  listeners.forEach((l) => l(payload));
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => listeners.forEach((l) => l(null)), opts?.durationMs ?? 3200);
}

export function subscribeSnackbar(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
