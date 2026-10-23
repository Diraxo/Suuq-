// Orchestration for the account-deletion ledger (migration 0055). Pure: the RPC caller and the Storage remover are injected, so
// this is unit-tested without Deno, Supabase or a network. Used by delete-account and account-deletion-drain.

export const VERIFICATION_BUCKET = 'storefront-verification';
export const REMOVE_BATCH_SIZE = 100;
export const MAX_ATTEMPTS = 5; // PROPOSED default (owner decision B1.2 still open)

export type RpcResult = { data: unknown; error: { message: string } | null };
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
/** Removes objects from one Supabase Storage bucket. A missing object is NOT an error (remove is idempotent). */
export type Remover = (bucket: string, names: string[]) => Promise<{ error: { message: string } | null }>;
export type LedgerObject = { bucket: string; name: string };

async function call(rpc: Rpc, fn: string, args: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

/** Capture every verification object the user has and register it in the ledger. Throws if it cannot (caller must abort BEFORE deleting anything). */
export async function recordVerificationObjects(rpc: Rpc, userId: string): Promise<string> {
  const paths = (await call(rpc, 'account_deletion_collect_verification_paths', { p_user: userId })) as string[] | null;
  const objects: LedgerObject[] = (paths ?? []).map((name) => ({ bucket: VERIFICATION_BUCKET, name }));
  const jobId = await call(rpc, 'account_deletion_begin', { p_user: userId, p_objects: objects });
  if (typeof jobId !== 'string') throw new Error('account_deletion_begin returned no job id');
  return jobId;
}

export type DrainOutcome = 'completed' | 'pending' | 'escalated' | 'not_claimed';

/** Claim one job (or every due job when jobId is null), remove its objects, record per-object results, settle. Never throws for storage failures. */
export async function drainClaimed(
  rpc: Rpc,
  remove: Remover,
  jobId: string | null,
  opts: { limit?: number; maxAttempts?: number } = {},
): Promise<{ jobId: string; outcome: DrainOutcome }[]> {
  const rows = ((await call(rpc, 'account_deletion_claim', { p_job: jobId, p_limit: opts.limit ?? 10 })) as { job_id: string; bucket: string; name: string }[] | null) ?? [];
  const byJob = new Map<string, LedgerObject[]>();
  for (const r of rows) byJob.set(r.job_id, [...(byJob.get(r.job_id) ?? []), { bucket: r.bucket, name: r.name }]);
  // A claimed job whose objects are all already deleted has no rows here; make sure it is still settled.
  if (jobId && byJob.size === 0) {
    try {
      return [{ jobId, outcome: (await call(rpc, 'account_deletion_finish', { p_job: jobId, p_max_attempts: opts.maxAttempts ?? MAX_ATTEMPTS })) as DrainOutcome }];
    } catch {
      return [{ jobId, outcome: 'not_claimed' }];
    }
  }
  const out: { jobId: string; outcome: DrainOutcome }[] = [];
  for (const [id, objects] of byJob) {
    const results: { bucket: string; name: string; ok: boolean; error?: string }[] = [];
    const byBucket = new Map<string, string[]>();
    for (const o of objects) byBucket.set(o.bucket, [...(byBucket.get(o.bucket) ?? []), o.name]);
    for (const [bucket, names] of byBucket) {
      for (let i = 0; i < names.length; i += REMOVE_BATCH_SIZE) {
        const batch = names.slice(i, i + REMOVE_BATCH_SIZE);
        let err: string | null = null;
        try {
          err = (await remove(bucket, batch)).error?.message ?? null;
        } catch (e) {
          err = String(e);
        }
        for (const name of batch) results.push(err ? { bucket, name, ok: false, error: err } : { bucket, name, ok: true });
      }
    }
    try {
      await call(rpc, 'account_deletion_record', { p_job: id, p_results: results });
      out.push({ jobId: id, outcome: (await call(rpc, 'account_deletion_finish', { p_job: id, p_max_attempts: opts.maxAttempts ?? MAX_ATTEMPTS })) as DrainOutcome });
    } catch {
      // Could not record: the lease expires and the job is reclaimed. Never reported as completed.
      out.push({ jobId: id, outcome: 'pending' });
    }
  }
  return out;
}
