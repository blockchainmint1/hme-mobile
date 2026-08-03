import { describe, expect, it } from "vitest";
import { extractEntropy, healthCheckRandom } from "@/lib/txc/entropy";
import { generateMnemonic, generateMnemonicFromUserEntropy, validateMnemonic } from "@/lib/txc/wallet";

describe("entropy health checks", () => {
  it("rejects degenerate output", () => {
    expect(healthCheckRandom(new Uint8Array(32))).toBeTruthy();
    expect(healthCheckRandom(new Uint8Array(32).fill(0xff))).toBeTruthy();
    const run = crypto.getRandomValues(new Uint8Array(32));
    run.fill(7, 0, 8);
    expect(healthCheckRandom(run)).toBeTruthy();
  });

  it("accepts real CSPRNG output", () => {
    for (let i = 0; i < 200; i++) {
      expect(healthCheckRandom(crypto.getRandomValues(new Uint8Array(32)))).toBeNull();
    }
  });
});

describe("extractEntropy", () => {
  it("never repeats and is well distributed", () => {
    const seen = new Set<string>();
    const bitCount = new Array(256).fill(0);
    const N = 300;
    for (let i = 0; i < N; i++) {
      const e = extractEntropy(32);
      expect(e).toHaveLength(32);
      const hex = Array.from(e, (b) => b.toString(16).padStart(2, "0")).join("");
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
      for (let bit = 0; bit < 256; bit++) {
        if ((e[bit >> 3] >> (7 - (bit % 8))) & 1) bitCount[bit]++;
      }
    }
    // Each bit should be ~50% ones. 3.5 sigma bound for N=300.
    const sigma = Math.sqrt(N) / 2;
    for (const c of bitCount) expect(Math.abs(c - N / 2)).toBeLessThan(3.5 * sigma);
  });

  it("stays random even with constant user entropy", () => {
    const constant = new Uint8Array(64); // worst case: fully predictable input
    const a = extractEntropy(32, constant);
    const b = extractEntropy(32, constant);
    expect(a).not.toEqual(b);
    expect(healthCheckRandom(a)).toBeNull();
  });
});

describe("mnemonic generation", () => {
  it("produces valid, unique 24-word phrases", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const m = generateMnemonic(256);
      expect(m.split(" ")).toHaveLength(24);
      expect(validateMnemonic(m)).toBe(true);
      expect(seen.has(m)).toBe(false);
      seen.add(m);
    }
  });

  it("produces valid 12-word phrases", () => {
    const m = generateMnemonic(128);
    expect(m.split(" ")).toHaveLength(12);
    expect(validateMnemonic(m)).toBe(true);
  });

  it("mixes user entropy without weakening the result", () => {
    const scribble = crypto.getRandomValues(new Uint8Array(128));
    const a = generateMnemonicFromUserEntropy(scribble, 256);
    const b = generateMnemonicFromUserEntropy(scribble, 256);
    expect(a).not.toBe(b);
    expect(validateMnemonic(a)).toBe(true);
    expect(validateMnemonic(b)).toBe(true);
  });
});
