/**
 * Client-side Omni Layer (Class C / OP_RETURN) transaction decoding.
 *
 * The mempool REST API returns raw scriptPubKeys for every output, which is
 * everything we need to spot a token transfer — no node RPC, and it works for
 * *unconfirmed* transactions too (the node's `omni_listtransactions` only
 * covers wallet-owned addresses, so it can't be used here).
 *
 * Class C Simple Send payload (after the "omni" magic):
 *   version   2 bytes BE
 *   type      2 bytes BE  (0 = Simple Send)
 *   property  4 bytes BE
 *   amount    8 bytes BE  (willets for divisible, whole units otherwise)
 */
import type { MempoolTx } from "./mempool";

export interface OmniSend {
  propertyId: number;
  /** Raw units: 10^8 fixed point for divisible tokens, whole count otherwise. */
  amount: bigint;
  /** Address that owns the first input (Omni's sending address). */
  sender: string | null;
  /** Omni reference (recipient) address. */
  reference: string | null;
  /**
   * Every addressed output that isn't the sender, in output order. A
   * multi-send (e.g. the TSD distributor paying many people in one tx) has
   * several recipients; `reference` stays the last one for back-compat.
   */
  references: string[];
  /** Send To Many (type 7) only: exact amount per recipient address. */
  allocations?: { address: string; amount: bigint }[];
}

const MAGIC = "6f6d6e69"; // "omni"

/** Extract the Omni payload hex from an OP_RETURN scriptPubKey, if present. */
function omniPayload(scriptHex: string): string | null {
  const s = scriptHex.toLowerCase();
  if (!s.startsWith("6a")) return null; // OP_RETURN
  const at = s.indexOf(MAGIC);
  if (at < 0) return null;
  return s.slice(at + MAGIC.length);
}

/**
 * Decode a Simple Send from a mempool transaction. Returns null when the tx
 * carries no Omni payload or uses a message type we don't render.
 */
export function decodeOmniSend(tx: MempoolTx): OmniSend | null {
  let payload: string | null = null;
  for (const v of tx.vout) {
    const p = omniPayload(v.scriptpubkey ?? "");
    if (p) {
      payload = p;
      break;
    }
  }
  if (!payload || payload.length < 16) return null;

  const type = parseInt(payload.slice(4, 8), 16);
  const sender = tx.vin[0]?.prevout?.scriptpubkey_address ?? null;

  if (type === 7) {
    // Send To Many: property(4) + count(1) + count × [vout index(1) + amount(8)].
    // Each entry names its recipient by output position, so amounts differ
    // per recipient — never show the batch total as one person's receipt.
    const propertyId = parseInt(payload.slice(8, 16), 16);
    const count = parseInt(payload.slice(16, 18), 16);
    if (!Number.isFinite(propertyId) || propertyId <= 0 || !count) return null;
    const allocations: { address: string; amount: bigint }[] = [];
    let total = 0n;
    for (let i = 0; i < count; i++) {
      const at = 18 + i * 18;
      const chunk = payload.slice(at, at + 18);
      if (chunk.length < 18) return null;
      const idx = parseInt(chunk.slice(0, 2), 16);
      let amt: bigint;
      try {
        amt = BigInt("0x" + chunk.slice(2));
      } catch {
        return null;
      }
      const address = tx.vout[idx]?.scriptpubkey_address;
      if (!address) continue;
      allocations.push({ address, amount: amt });
      total += amt;
    }
    const references = allocations.map((a) => a.address);
    return {
      propertyId,
      amount: total,
      sender,
      reference: references[references.length - 1] ?? null,
      references,
      allocations,
    };
  }

  if (payload.length < 32) return null;
  let propertyId: number;
  let amount: bigint;
  if (type === 0) {
    // Simple Send: property(4) + amount(8)
    propertyId = parseInt(payload.slice(8, 16), 16);
    try {
      amount = BigInt("0x" + payload.slice(16, 32));
    } catch {
      return null;
    }
  } else if (type === 55) {
    // The TSD distributor's type-55 payload keeps the same property + amount
    // field boundaries as Simple Send, followed by one trailing control byte.
    // Do not treat the first amount byte as an output index: doing so shifts
    // the uint64 left by one byte and inflates the displayed token amount.
    const body = payload.slice(8);
    if (body.length < 24) return null;
    propertyId = parseInt(body.slice(0, 8), 16);
    try {
      amount = BigInt("0x" + body.slice(8, 24));
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (!Number.isFinite(propertyId) || propertyId <= 0) return null;

  // Omni Class C: reference addresses are the outputs that aren't the sender
  // (the sender's own output is BTC/TXC change). A multi-send has several.
  const references: string[] = [];
  for (const v of tx.vout) {
    const a = v.scriptpubkey_address;
    if (a && a !== sender) references.push(a);
  }
  const reference = references.length > 0 ? references[references.length - 1]! : null;
  return { propertyId, amount, sender, reference, references };
}

/**
 * Amount to show for this wallet: on an incoming Send To Many, only the
 * share paid to our own addresses; otherwise the transfer amount.
 */
export function omniAmountFor(o: OmniSend, own: Set<string>, incoming: boolean): bigint {
  if (!incoming || !o.allocations) return o.amount;
  return o.allocations.reduce((s, a) => (own.has(a.address) ? s + a.amount : s), 0n);
}
