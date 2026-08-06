// Minimal imperative pub/sub so any module (services, hooks, screens) can
// surface a message without threading state through props — mirrors the
// module-level subscribe pattern already used by the realtime stores
// (e.g. store/follow.ts). <SnackbarHost /> (components/Snackbar.tsx) is the
// one subscriber, mounted once in app/_layout.tsx.
type Listener = (message: string | null) => void;

let listeners: Listener[] = [];
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showSnackbar(message: string, durationMs = 3200) {
  listeners.forEach((l) => l(message));
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => listeners.forEach((l) => l(null)), durationMs);
}

export function subscribeSnackbar(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
