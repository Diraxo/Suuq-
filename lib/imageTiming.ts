// Development-only stopwatch for "time to first visible image". Logs `[img] <label>: <ms>` once per label per start, so a
// before/after comparison on a real device only needs the Metro console. Does nothing (and keeps no state) in release builds.

const started = new Map<string, number>();

export function imageTimingStart(label: string): void {
  if (!__DEV__ || started.has(label)) return;
  started.set(label, Date.now());
}

export function imageTimingDone(label: string): void {
  if (!__DEV__) return;
  const t0 = started.get(label);
  if (t0 === undefined) return;
  started.delete(label);
  console.log(`[img] ${label}: ${Date.now() - t0} ms`);
}
