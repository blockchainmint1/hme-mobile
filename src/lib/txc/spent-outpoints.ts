/**
 * Locally-reserved outpoints.
 *
 * The explorer's `/address/:a/utxo` view is not always instantaneous about
 * mempool spends, and this wallet has more than one thing that can spend a
 * coin (a payment, the background token-holder top-up, another device). When
 * a stale coin gets picked again the node answers `txn-mempool-conflict` or
 * `bad-txns-inputs-missingorspent`, which is exactly the failure users have
 * been hitting at the register — sometimes hours after the tx that actually
 * spent the coin.
 *
 * So: every time we successfully broadcast, we write down the outpoints that
 * transaction consumed and refuse to select them again. The record is
 * self-healing — entries expire, and the scanner releases any outpoint the
 * node still reports as unspent after a short grace period (which is what
 * happens if our transaction was dropped or replaced).
 */

const KEY = "hme.txc.spent-outpoints.v1";
/** Hard expiry. A TXC block is minutes, so anything older is stale bookkeeping. */
const TTL_MS = 60 * 60_000;
/** Don't re-verify against the node until the mempool has had time to settle. */
export const VERIFY_AFTER_MS = 3 * 60_000;

type Store = Record<string, number>;

export function outpointKey(txid: string, vout: number): string {
  return `${txid}:${vout}`;
}

function read(): Store {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    if (!parsed || typeof parsed !== "object") return {};
    const now = Date.now();
    let changed = false;
    for (const [k, ts] of Object.entries(parsed)) {
      if (typeof ts !== "number" || now - ts > TTL_MS) {
        delete parsed[k];
        changed = true;
      }
    }
    if (changed) write(parsed);
    return parsed;
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* storage disabled — reservations are best-effort */
  }
}

/** Record the coins a just-broadcast transaction consumed. */
export function reserveOutpoints(inputs: { txid: string; vout: number }[]): void {
  if (inputs.length === 0) return;
  const store = read();
  const now = Date.now();
  for (const i of inputs) store[outpointKey(i.txid, i.vout)] = now;
  write(store);
}

/** Free coins we previously reserved (our transaction never made it). */
export function releaseOutpoints(keys: string[]): void {
  if (keys.length === 0) return;
  const store = read();
  let changed = false;
  for (const k of keys) {
    if (k in store) {
      delete store[k];
      changed = true;
    }
  }
  if (changed) write(store);
}

/** Reserved outpoints as a map of key -> reservation timestamp. */
export function reservedEntries(): Store {
  return read();
}

export function isReserved(txid: string, vout: number): boolean {
  return outpointKey(txid, vout) in read();
}

/** Drop every locally-reserved coin from a candidate UTXO set. */
export function filterReserved<T extends { txid: string; vout: number }>(utxos: T[]): T[] {
  const store = read();
  if (Object.keys(store).length === 0) return utxos;
  return utxos.filter((u) => !(outpointKey(u.txid, u.vout) in store));
}

export function clearReservations(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
