/**
 * OP_RETURN script builder shared by the UTXO chains. Used to attach
 * THORChain swap memos to LTC / DOGE transactions.
 *
 * Both networks enforce an 80-byte standardness limit on the data push.
 */
import { payments } from "bitcoinjs-lib";

export const OP_RETURN_MAX_BYTES = 80;

export function opReturnScript(memo: string): Uint8Array {
  const data = new TextEncoder().encode(memo);
  if (data.length === 0) throw new Error("Empty OP_RETURN memo");
  if (data.length > OP_RETURN_MAX_BYTES) {
    throw new Error(`Memo too long (${data.length} bytes, max ${OP_RETURN_MAX_BYTES})`);
  }
  const p = payments.embed({ data: [data] });
  if (!p.output) throw new Error("Failed to build OP_RETURN script");
  return p.output;
}
