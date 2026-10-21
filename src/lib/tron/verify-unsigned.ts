/**
 * Verify an unsigned Tron transaction BEFORE signing its txID.
 *
 * Why: `signTxId` signs whatever `txID` TronGrid (through our /api/tron
 * proxy) returned. The wallet never looked inside. A hostile or compromised
 * node/proxy could return a txID for a different transaction — e.g.
 * `transfer(attacker, balance)` — and the wallet would sign it. This module
 * recomputes the txID from `raw_data_hex`, decodes the protobuf, and checks
 * that the single contract inside is exactly the call the wallet asked for.
 *
 * Protobuf layout (protocol/core/Tron.proto):
 *   Transaction.raw: 1 ref_block_bytes, 4 ref_block_hash, 8 expiration,
 *     11 contract (repeated), 14 timestamp, 18 fee_limit
 *   Transaction.Contract: 1 type (enum), 2 parameter (google.protobuf.Any)
 *   Any: 1 type_url, 2 value
 *   TransferContract (type 1): 1 owner_address, 2 to_address, 3 amount
 *   TriggerSmartContract (type 31): 1 owner_address, 2 contract_address,
 *     3 call_value, 4 data, 5 call_token_value, 6 token_id
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes, toHexAddress } from "./address";

type Field = { num: number; wire: number; value: bigint | Uint8Array };

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error("truncated varint");
    const b = buf[pos++]!;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return [result, pos];
    shift += 7n;
    if (shift > 70n) throw new Error("varint too long");
  }
}

/** Minimal protobuf wire decoder (varint + length-delimited only, which is all Tron uses here). */
export function decodeFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [tag, p1] = readVarint(buf, pos);
    const num = Number(tag >> 3n);
    const wire = Number(tag & 7n);
    pos = p1;
    if (wire === 0) {
      const [v, p2] = readVarint(buf, pos);
      out.push({ num, wire, value: v });
      pos = p2;
    } else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      const end = p2 + Number(len);
      if (end > buf.length) throw new Error("truncated field");
      out.push({ num, wire, value: buf.slice(p2, end) });
      pos = end;
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

const bytesOf = (f: Field | undefined): Uint8Array | null =>
  f && f.value instanceof Uint8Array ? f.value : null;
const intOf = (f: Field | undefined): bigint => (f && typeof f.value === "bigint" ? f.value : 0n);

export type ExpectedTronCall =
  | { type: "TransferContract"; owner: string; to: string; amountSun: bigint }
  | {
      type: "TriggerSmartContract";
      owner: string;
      contract: string;
      data: string;
      callValue: bigint;
      feeLimitSun: bigint;
    };

export class TronTxMismatch extends Error {
  constructor(message: string) {
    super(`Refusing to sign: ${message}`);
    this.name = "TronTxMismatch";
  }
}
const fail = (m: string): never => {
  throw new TronTxMismatch(m);
};

const CONTRACT_TYPE = { TransferContract: 1n, TriggerSmartContract: 31n } as const;

/**
 * Throws TronTxMismatch unless `tx` is exactly the single call described by
 * `expected`. Addresses may be given in T… or 41… form.
 */
export function verifyUnsignedTronTx(
  tx: { txID: string; raw_data_hex: string },
  expected: ExpectedTronCall,
): void {
  if (!/^[0-9a-fA-F]{64}$/.test(tx.txID) || !/^[0-9a-fA-F]+$/.test(tx.raw_data_hex))
    fail("malformed transaction");
  const raw = hexToBytes(tx.raw_data_hex);
  if (bytesToHex(sha256(raw)) !== tx.txID.toLowerCase())
    fail("txID does not match the transaction body");

  const top = decodeFields(raw);
  const contracts = top.filter((f) => f.num === 11);
  if (contracts.length !== 1) fail(`transaction carries ${contracts.length} contracts, expected 1`);
  const unknown = top.filter((f) => ![1, 4, 8, 11, 14, 18].includes(f.num));
  if (unknown.length) fail("transaction has unexpected fields");

  const c = decodeFields(bytesOf(contracts[0])!);
  const type = intOf(c.find((f) => f.num === 1));
  if (type !== CONTRACT_TYPE[expected.type]) fail(`contract type ${type} is not ${expected.type}`);
  if (c.some((f) => f.num === 5 && intOf(f) !== 0n)) fail("non-default permission id");
  const any = decodeFields(bytesOf(c.find((f) => f.num === 2)) ?? fail("missing parameter"));
  const typeUrl = new TextDecoder().decode(
    bytesOf(any.find((f) => f.num === 1)) ?? new Uint8Array(),
  );
  if (!typeUrl.endsWith(`.${expected.type}`))
    fail(`parameter type ${typeUrl} is not ${expected.type}`);
  const p = decodeFields(bytesOf(any.find((f) => f.num === 2)) ?? fail("missing parameter value"));

  const addr = (f: Field | undefined) => bytesToHex(bytesOf(f) ?? new Uint8Array()).toLowerCase();
  const normAddr = (a: string) =>
    (a.startsWith("T") ? toHexAddress(a) : a.replace(/^0x/, "")).toLowerCase();

  if (addr(p.find((f) => f.num === 1)) !== normAddr(expected.owner))
    fail("owner differs from this wallet");

  if (expected.type === "TransferContract") {
    if (addr(p.find((f) => f.num === 2)) !== normAddr(expected.to)) fail("recipient differs");
    if (intOf(p.find((f) => f.num === 3)) !== expected.amountSun) fail("amount differs");
    if (p.some((f) => ![1, 2, 3].includes(f.num))) fail("unexpected transfer fields");
    return;
  }

  if (addr(p.find((f) => f.num === 2)) !== normAddr(expected.contract))
    fail("contract address differs");
  const data = bytesToHex(bytesOf(p.find((f) => f.num === 4)) ?? new Uint8Array()).toLowerCase();
  if (data !== expected.data.replace(/^0x/, "").toLowerCase()) fail("call data differs");
  if (intOf(p.find((f) => f.num === 3)) !== expected.callValue) fail("call value (TRX) differs");
  if (intOf(p.find((f) => f.num === 5)) !== 0n || intOf(p.find((f) => f.num === 6)) !== 0n)
    fail("unexpected TRC-10 value");
  if (p.some((f) => ![1, 2, 3, 4, 5, 6].includes(f.num))) fail("unexpected contract fields");
  const feeLimit = intOf(top.find((f) => f.num === 18));
  if (feeLimit > expected.feeLimitSun)
    fail(`fee limit ${feeLimit} exceeds the ${expected.feeLimitSun} requested`);
}
