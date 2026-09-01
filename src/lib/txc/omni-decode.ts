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
  if (!payload || payload.length < 32) return null;

  const type = parseInt(payload.slice(4, 8), 16);
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
    // Send To Many: property(4) then per-receiver output-index(1) + amount(8).
    // We render the first receiver entry (single-recipient is the norm for
    // wallet-to-wallet payments); the reference address is resolved below.
    const body = payload.slice(8);
    if (body.length < 26) return null;
    propertyId = parseInt(body.slice(0, 8), 16);
    try {
      amount = BigInt("0x" + body.slice(10, 26));
    } catch {
      return null;
    }
  } else {
    return null;
  }
  if (!Number.isFinite(propertyId) || propertyId <= 0) return null;


  const sender = tx.vin[0]?.prevout?.scriptpubkey_address ?? null;
  // Omni Class C: the reference address is the last output with an address
  // that isn't the sender (the sender's own output is BTC/TXC change).
  let reference: string | null = null;
  for (let i = tx.vout.length - 1; i >= 0; i--) {
    const a = tx.vout[i]?.scriptpubkey_address;
    if (a && a !== sender) {
      reference = a;
      break;
    }
  }
  return { propertyId, amount, sender, reference };
}
