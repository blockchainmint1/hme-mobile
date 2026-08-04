/**
 * Tron transaction signing.
 *
 * TronGrid builds the transaction server-side and returns its `txID`
 * (the sha256 of raw_data). We sign that hash locally with the derived
 * secp256k1 key — the private key never leaves the device — and post the
 * signature back with the unmodified transaction.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "./address";

export function signTxId(txID: string, privateKey: Uint8Array): string {
  const sig = secp256k1.sign(hexToBytes(txID), privateKey, { lowS: true, prehash: false });
  const compact = sig.toCompactRawBytes();
  const out = new Uint8Array(65);
  out.set(compact, 0);
  out[64] = sig.recovery;
  return bytesToHex(out);
}
