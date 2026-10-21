import { readFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import { describe, expect, it } from "vitest";
import { TronTxMismatch, verifyUnsignedTronTx, type ExpectedTronCall } from "./verify-unsigned";

// Unsigned TriggerSmartContract built by TronGrid on 2026-10-21 for a
// synthetic request: USDT transfer(0xd1e7…, 1 USDT) from a public address.
// Nothing here was ever signed.
const fx = JSON.parse(
  readFileSync(
    new URL("../security/fixtures/tron-unsigned-trc20-transfer.json", import.meta.url),
    "utf8",
  ),
) as {
  txID: string;
  raw_data_hex: string;
  raw_data: {
    contract: {
      parameter: { value: { owner_address: string; contract_address: string; data: string } };
    }[];
    fee_limit: number;
  };
};
const v = fx.raw_data.contract[0]!.parameter.value;
const expected: ExpectedTronCall = {
  type: "TriggerSmartContract",
  owner: v.owner_address,
  contract: v.contract_address,
  data: v.data,
  callValue: 0n,
  feeLimitSun: BigInt(fx.raw_data.fee_limit),
};
const flip = (hex: string, at: number) =>
  hex.slice(0, at) + (hex[at] === "0" ? "1" : "0") + hex.slice(at + 1);
const blocked = (tx: { txID: string; raw_data_hex: string }, e: ExpectedTronCall, why: RegExp) =>
  expect(() => verifyUnsignedTronTx(tx, e)).toThrow(
    expect.objectContaining({ name: "TronTxMismatch", message: expect.stringMatching(why) }),
  );

describe("Tron unsigned-transaction verification", () => {
  it("accepts the node-built transaction that matches the request", () => {
    expect(() => verifyUnsignedTronTx(fx, expected)).not.toThrow();
  });
  it("refuses a txID that is not the hash of the body (node returned a different tx to sign)", () => {
    blocked({ ...fx, txID: flip(fx.txID, 10) }, expected, /txID does not match/);
  });
  it("refuses a body whose data was altered even though the node recomputed txID", () => {
    // Simulate a hostile node: flip a byte in the calldata region and give the matching hash.
    const i = fx.raw_data_hex.indexOf(v.data);
    const raw = flip(fx.raw_data_hex, i + 20);
    const txID = Buffer.from(sha256(Buffer.from(raw, "hex"))).toString("hex");
    blocked({ txID, raw_data_hex: raw }, expected, /call data differs/);
  });
  it("binds owner, contract, data, call value and fee limit", () => {
    blocked(fx, { ...expected, owner: "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7" }, /owner differs/);
    blocked(
      fx,
      { ...expected, contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8" },
      /contract address differs/,
    );
    blocked(fx, { ...expected, data: v.data.slice(0, -2) + "00" }, /call data differs/);
    blocked(fx, { ...expected, callValue: 1n }, /call value/);
    blocked(fx, { ...expected, feeLimitSun: 1_000_000n }, /fee limit/);
  });
  it("refuses a different contract type", () => {
    blocked(
      fx,
      { type: "TransferContract", owner: v.owner_address, to: v.contract_address, amountSun: 1n },
      /contract type/,
    );
  });
  it("throws TronTxMismatch, not a generic error", () => {
    try {
      verifyUnsignedTronTx({ txID: "00", raw_data_hex: "zz" }, expected);
    } catch (e) {
      expect(e).toBeInstanceOf(TronTxMismatch);
    }
  });
});
