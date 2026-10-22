/**
 * Merge per-address transaction lists into one deduped list.
 *
 * A full history-service outage must NOT look like "no transactions": when
 * every address fetch fails we throw, so React Query keeps the last
 * successful list (and the persisted cache) instead of overwriting it with
 * an empty one. Partial failures still return the addresses that answered.
 */
export async function fetchMergedAddressTxs<T extends { txid: string }>(
  addresses: string[],
  fetchOne: (address: string) => Promise<T[]>,
): Promise<T[]> {
  const settled = await Promise.allSettled(addresses.map((a) => fetchOne(a)));
  const map = new Map<string, T>();
  let succeeded = 0;
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    succeeded++;
    for (const tx of r.value) map.set(tx.txid, tx);
  }
  if (addresses.length > 0 && succeeded === 0) {
    throw new Error("history service unavailable");
  }
  return [...map.values()];
}
