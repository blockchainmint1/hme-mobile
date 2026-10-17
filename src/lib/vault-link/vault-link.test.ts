import { describe, expect, it } from "vitest";
import { toParts, PartCollector } from "./qr-parts";
import { parsePairing } from "./pairing";
import { buildNativeIntent, buildErc20Intent } from "./evm-intent";

describe("HMQR2 framing", () => {
  it("round-trips a short payload as a single frame", () => {
    const parts = toParts("hello");
    expect(parts).toEqual(["hello"]);
    const c = new PartCollector();
    expect(c.add(parts[0])).toBe("hello");
  });

  it("round-trips a long payload across labelled chunks, out of order", () => {
    const text = "x".repeat(600 * 5 + 123);
    const parts = toParts(text);
    expect(parts.length).toBe(6);
    expect(parts[0]).toMatch(/^HMQR2:[0-9a-f]{8}:1\/6:/);
    const c = new PartCollector();
    let out: string | null = null;
    for (const p of [...parts].reverse()) out = c.add(p);
    expect(out).toBe(text);
  });

  it("rejects mixing two different transfers", () => {
    const a = toParts("a".repeat(2000));
    const b = toParts("b".repeat(2000));
    const c = new PartCollector();
    c.add(a[0]);
    expect(() => c.add(b[0])).toThrow(/Different transfer/);
  });

  it("reads legacy HMQR frames", () => {
    const c = new PartCollector();
    expect(c.add("HMQR:1/2:foo")).toBeNull();
    expect(c.add("HMQR:2/2:bar")).toBe("foobar");
  });
});

const VALID_PAIRING = JSON.stringify({
  hmvault: 1,
  fp: "73C5DA0A",
  txc: { 84: "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz" },
  doge: { 44: "xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWKiKrhko4egpiMZbpiaQL2jkwSB1icqYh2cfDfVxdx4df189oLKnC5fSwqPfgyP3hooxujYzAu3fDVmz" },
  evm: { address: "0x9858EfFD232B4033E47d90003D41EC34EcaEda94", path: "m/44'/60'/0'/0/0" },
});

describe("pairing parse", () => {
  it("accepts a valid payload and lowercases the fingerprint", () => {
    const p = parsePairing(VALID_PAIRING);
    expect(p.fp).toBe("73c5da0a");
    expect(p.chains.txc?.["84"]).toMatch(/^xpub/);
    expect(p.chains.doge?.["44"]).toMatch(/^xpub/);
    expect(p.evm?.address).toMatch(/^0x/);
  });

  it("rejects non-pairing JSON", () => {
    expect(() => parsePairing("{}")).toThrow(/isn't a Vault pairing/);
    expect(() => parsePairing("not json")).toThrow(/isn't a Vault pairing/);
  });

  it("rejects a bad fingerprint", () => {
    expect(() => parsePairing(JSON.stringify({ hmvault: 1, fp: "xyz", txc: {} }))).toThrow(/fingerprint/);
  });

  it("rejects an invalid xpub", () => {
    expect(() =>
      parsePairing(JSON.stringify({ hmvault: 1, fp: "73c5da0a", txc: { 84: "xpub!!!bad" } })),
    ).toThrow(/invalid TXC key/);
  });

  it("rejects a payload with no keys at all", () => {
    expect(() => parsePairing(JSON.stringify({ hmvault: 1, fp: "73c5da0a" }))).toThrow(/no wallet keys/);
  });
});

const pairing = parsePairing(VALID_PAIRING);

describe("evm intent", () => {
  it("builds a valid native-transfer intent", () => {
    const json = buildNativeIntent({
      pairing,
      chainId: 1,
      to: "0x1111111111111111111111111111111111111111",
      valueWei: 10n ** 18n,
      nonce: 7,
      gas: 21_000n,
      fees: { type: "eip1559", maxFeePerGas: 30_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n },
    });
    const o = JSON.parse(json);
    expect(o.format).toBe("hm-evm-tx");
    expect(o.kind).toBe("native-transfer");
    expect(o.value).toBe("1000000000000000000");
    expect(o.fp).toBe("73c5da0a");
    expect(o.path).toBe("m/44'/60'/0'/0/0");
    expect(o.maxFeePerGas).toBe("30000000000");
  });

  it("builds a valid erc20 intent", () => {
    const json = buildErc20Intent({
      pairing,
      chainId: 1,
      token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      to: "0x1111111111111111111111111111111111111111",
      amountRaw: 100_000_000n,
      nonce: 8,
      gas: 65_000n,
      fees: { type: "legacy", gasPrice: 20_000_000_000n },
    });
    const o = JSON.parse(json);
    expect(o.kind).toBe("erc20-transfer");
    expect(o.amount).toBe("100000000");
    expect(o.gasPrice).toBe("20000000000");
    expect(o.value).toBeUndefined();
  });

  it("rejects a zero amount", () => {
    expect(() =>
      buildNativeIntent({
        pairing,
        chainId: 1,
        to: "0x1111111111111111111111111111111111111111",
        valueWei: 0n,
        nonce: 0,
        gas: 21_000n,
        fees: { type: "legacy", gasPrice: 1n },
      }),
    ).toThrow(/positive/);
  });

  it("rejects a zero recipient", () => {
    expect(() =>
      buildNativeIntent({
        pairing,
        chainId: 1,
        to: "0x0000000000000000000000000000000000000000",
        valueWei: 1n,
        nonce: 0,
        gas: 21_000n,
        fees: { type: "legacy", gasPrice: 1n },
      }),
    ).toThrow(/recipient/);
  });
});
