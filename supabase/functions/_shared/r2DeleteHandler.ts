// Request handling for r2-delete, with every side effect injected so it is
// unit-tested in node (tests/r2Delete.test.ts) without Deno, Supabase or R2.
// Pure TypeScript — no Deno APIs.
//
// Authorization is decided entirely by key SHAPE + the verified user id
// (uploadPaths.isOwnedKey): the app's object keys already embed the owner's
// uid as a fixed path position (listings/{uid}/..., avatars/{uid}/...,
// business/{uid}/..., legacy chat/{conv}/{uid}/...), so no database lookup is
// involved. Nothing is signed or sent until EVERY key has passed.

export const MAX_KEYS_PER_REQUEST = 50;

export type R2DeleteDeps = {
  /** Returns the verified user id for a bearer JWT, or null. May throw (treated as unauthenticated). */
  verifyJwt: (jwt: string) => Promise<string | null>;
  /** userId set → uploadPaths.isOwnedKey(key, userId); null (trusted webhook, no user to compare against) → must return false: the webhook may not delete anything. */
  isAuthorizedKey: (key: string, userId: string | null) => boolean;
  /** Constant-time check of the Postgres webhook secret header. */
  isTrustedWebhook: (headerValue: string | null) => boolean;
  /** Signs + sends the R2 DELETE for an already-authorized key; true on success. */
  deleteObject: (key: string) => Promise<boolean>;
  log?: (event: string, data?: Record<string, unknown>) => void;
};

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleR2Delete(req: Request, deps: R2DeleteDeps): Promise<Response> {
  const log = deps.log ?? (() => {});
  try {
    let userId: string | null = null;
    const trusted = deps.isTrustedWebhook(req.headers.get('X-R2-Delete-Webhook-Secret'));
    if (!trusted) {
      const authHeader = req.headers.get('Authorization');
      if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header' }, 401);
      try {
        userId = await deps.verifyJwt(authHeader.slice('Bearer '.length));
      } catch {
        userId = null;
      }
      if (!userId) return json({ error: 'Not authenticated' }, 401);
    }

    let body: { keys?: unknown };
    try {
      body = await req.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }
    const rawKeys = body?.keys;
    if (!Array.isArray(rawKeys) || rawKeys.length === 0) return json({ error: 'keys must be a non-empty array' }, 400);
    if (rawKeys.length > MAX_KEYS_PER_REQUEST) return json({ error: 'Too many keys' }, 400);
    // Any non-string entry is malformed input, not something to silently skip.
    if (!rawKeys.every((k) => typeof k === 'string')) return json({ error: 'keys must be strings' }, 400);
    const keys = [...new Set((rawKeys as string[]).filter(Boolean))];
    if (keys.length === 0) return json({ error: 'keys must be a non-empty array' }, 400);

    // All-or-nothing: one bad key rejects the whole request before anything is deleted.
    const allowed = keys.every((key) => deps.isAuthorizedKey(key, userId));
    if (!allowed) return json({ error: 'One or more assets are not owned by this user' }, 403);

    log('deleting', { count: keys.length, userId: userId ?? 'webhook:delete_message' });
    const succeeded: string[] = [];
    const failed: string[] = [];
    await Promise.all(
      keys.map(async (key) => {
        let ok = false;
        try {
          ok = await deps.deleteObject(key);
        } catch {
          ok = false;
        }
        (ok ? succeeded : failed).push(key);
      })
    );
    log('result', { succeeded: succeeded.length, failed: failed.length });
    return json({ succeeded, failed }, 200);
  } catch (err) {
    log('error', { message: String(err) });
    // Raw error can name secrets/config — logged above, never returned.
    return json({ error: 'Could not delete images. Try again.' }, 500);
  }
}
