// Runs `mapper` over `items` with at most `concurrency` in flight at once.
// Results resolve in the same order as `items`, regardless of which finishes
// first — callers that align results back to their input array (e.g. image
// upload lists) don't need to track indices themselves.
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return results;
}
