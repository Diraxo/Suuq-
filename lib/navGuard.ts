import { router } from 'expo-router';

// expo-router's useRouter() returns this exact singleton, so patching it once
// here guards every router.push/replace/navigate call in the app — no need to
// touch each of the 50+ call sites individually. Without this, a rapid double
// tap on a card/tab/button (very common on touch devices) fires the onPress
// handler twice before the first navigation has changed the screen, pushing
// the same route onto the stack twice; back then has to be pressed twice to
// leave, which reads as a broken back button.
const DUPLICATE_WINDOW_MS = 600;

let lastKey: string | null = null;
let lastAt = 0;

function shouldSkip(key: string): boolean {
  const now = Date.now();
  const skip = key === lastKey && now - lastAt < DUPLICATE_WINDOW_MS;
  lastKey = key;
  lastAt = now;
  return skip;
}

/** For navigation paths that don't go through the expo-router singleton above
 *  (e.g. a tab bar's `navigation.navigate`) — shares the same duplicate-tap window. */
export function guardCall(key: string, fn: () => void): void {
  if (shouldSkip(`manual:${key}`)) return;
  fn();
}

// Loosely typed on purpose: this wraps whatever methods exist on the
// expo-router singleton without fighting its overloaded `Router` type.
const untypedRouter = router as unknown as Record<string, (...args: unknown[]) => unknown>;

(['push', 'replace', 'navigate', 'back'] as const).forEach((method) => {
  const original = untypedRouter[method].bind(router);
  untypedRouter[method] = (...args: unknown[]) => {
    const key = `${method}:${args.length ? JSON.stringify(args[0]) : ''}`;
    if (shouldSkip(key)) return undefined;
    return original(...args);
  };
});
