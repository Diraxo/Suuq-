// Development-only stopwatch for "time to first visible image". Logs `[img] <label>: <ms>` once per label per start, so a
// before/after comparison on a real device only needs the Metro console. Does nothing (and keeps no state) in release builds.

const started = new Map<string, number>();

// Gallery taps: starting any `viewer: tap to ...` label restarts its clock, so a mark left unfinished by an earlier tap (a layer
// that never rendered, a photo that never reported) can never be measured against a later one.
const TAP_PREFIX = 'viewer: tap to ';
const TAP_ORIGIN = `${TAP_PREFIX}mount`;
let tapOrigin: number | undefined;
let tapLogged = new Set<string>();

export function imageTimingStart(label: string): void {
  if (!__DEV__) return;
  if (label.startsWith(TAP_PREFIX)) {
    const now = Date.now();
    started.set(label, now);
    if (label === TAP_ORIGIN) {
      tapOrigin = now;
      tapLogged = new Set();
    }
    return;
  }
  if (started.has(label)) return;
  started.set(label, Date.now());
}

/** `detail` is a short fixed token (e.g. a cache type), never a URL or user data. */
export function imageTimingDone(label: string, detail?: string): void {
  if (!__DEV__) return;
  const t0 = started.get(label);
  if (t0 === undefined) return;
  started.delete(label);
  console.log(`[img] ${label}: ${Date.now() - t0} ms${detail ? ` (${detail})` : ''}`);
}

/** Logs an event that has no start of its own as time since the current gallery tap, once per tap. Silent without a tap. */
export function imageTimingSinceTap(label: string): void {
  if (!__DEV__ || tapOrigin === undefined || tapLogged.has(label)) return;
  tapLogged.add(label);
  console.log(`[img] ${label}: ${Date.now() - tapOrigin} ms`);
}

// ── Per-tap diagnostics ────────────────────────────────────────────────────────────────────────────────────────────
// One line per event, all carrying the id of the tap that started this opening, so a single opening can be read top to bottom.
// What each event proves differs; read them accordingly:
//   decoded/loaded  = expo-image has the pixels (onLoad).        handed-to-native = the native view was given them (onDisplay).
//   committed       = React committed the tree (a JS-side fact).  None of these is a screen paint: iOS exposes no paint callback to
//   React Native, so "visible" is only ever inferred. If these lines are all early and the screen is still black, the time is
//   being spent below React Native (UI-thread layout/draw, e.g. the SVG overlay), which JS clocks cannot see.
// Values are short fixed tokens or numbers; photo addresses go through redactImageUrl and never include a query string.

let tapCounter = 0;
let diagId = '';

/** Starts a new diagnostic id (call on the tap itself). */
export function imageDiagTap(): void {
  if (!__DEV__) return;
  diagId = `t${++tapCounter}`;
}

export function imageDiag(event: string, fields?: Record<string, string | number | boolean | null | undefined>): void {
  if (!__DEV__ || tapOrigin === undefined) return;
  const detail = fields ? Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(' ') : '';
  console.log(`[img-diag] #${diagId || '-'} +${Date.now() - tapOrigin}ms ${event}${detail ? ` ${detail}` : ''}`);
}
