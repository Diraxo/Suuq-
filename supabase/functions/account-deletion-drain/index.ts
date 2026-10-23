// Retries account-deletion ledger jobs (migration 0055). NOT scheduled and NOT deployed: scheduling cadence and the escalation
// recipient are owner decisions B1.2/B1.3. Call it with POST and header `x-drain-secret: $DRAIN_SECRET` (a secret only operators and
// the scheduler hold). It uses the service role to remove Storage objects; the secret is never sent to a user client.
// AUTH: the shared secret is the ONLY credential. The scheduler sends no user JWT, so this function must be deployed with
// `supabase functions deploy account-deletion-drain --no-verify-jwt`; with the default gateway JWT check every scheduled call is
// rejected before this code runs and the ledger never drains. Staging gate: POST without the secret -> 401 from this code,
// POST with it -> 200 (a gateway 401 with a different body means verify_jwt is still on).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { drainClaimed, type Rpc } from '../_shared/deletionLedger.ts';

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const expected = Deno.env.get('DRAIN_SECRET') ?? '';
  const given = req.headers.get('x-drain-secret') ?? '';
  if (!expected || !sameSecret(given, expected)) return json(401, { error: 'Unauthorized' });

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const rpc: Rpc = (fn, args) => admin.rpc(fn, args) as unknown as ReturnType<Rpc>;
  try {
    const results = await drainClaimed(
      rpc,
      async (bucket, names) => {
        const { error } = await admin.storage.from(bucket).remove(names);
        return { error: error ? { message: error.message } : null };
      },
      null,
      { limit: 10 },
    );
    const escalated = results.filter((r) => r.outcome === 'escalated').length;
    console.log(JSON.stringify({ scope: 'account-deletion-drain', jobs: results.length, escalated }));
    return json(200, { jobs: results.length, completed: results.filter((r) => r.outcome === 'completed').length, escalated });
  } catch (err) {
    console.log(JSON.stringify({ scope: 'account-deletion-drain', event: 'error', message: String(err) }));
    return json(500, { error: 'drain failed' });
  }
});
