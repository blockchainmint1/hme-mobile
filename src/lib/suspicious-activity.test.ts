import { describe, expect, it } from "vitest";
import { filterSuspiciousActivity, formatActivityAmount, suspiciousActivityReason } from "./suspicious-activity";
import type { EvmTransfer } from "./chains/history.functions";

const transfer = (patch: Partial<EvmTransfer> = {}): EvmTransfer => ({
  hash: "0x1", from: "0x1234" + "a".repeat(32) + "5678", to: "0x" + "b".repeat(40),
  value: "1", asset: "ETH", category: "external", blockNum: 1,
  timestamp: null, outgoing: false, contractAddress: null, spam: false, spamReason: null,
  ...patch,
});

describe("recoverable suspicious transaction filtering", () => {
  it("hides incoming zero-value activity when enabled", () => {
    expect(filterSuspiciousActivity([transfer({ value: "0" })], true)).toEqual([]);
  });
  it("shows every original entry when disabled without modifying history", () => {
    const history = [transfer({ value: "0" }), transfer({ spam: true })];
    expect(filterSuspiciousActivity(history, false)).toBe(history);
    filterSuspiciousActivity(history, true);
    expect(history).toHaveLength(2);
  });
  it("keeps sends visible even if the provider flags them", () => {
    const sent = transfer({ outgoing: true, value: "0", spam: true });
    expect(filterSuspiciousActivity([sent], true)).toEqual([sent]);
  });
  it("keeps ordinary tiny payments visible", () => {
    expect(suspiciousActivityReason(transfer({ value: "0.00000001" }), [])).toBeNull();
  });
  it("flags native dust only when the sender impersonates a paid recipient", () => {
    const dust = transfer({ value: "0.00000001" });
    const paid = transfer({ outgoing: true, to: "0x1234" + "c".repeat(32) + "5678" });
    expect(suspiciousActivityReason(dust, [paid, dust])).toBe("Tiny transfer from a lookalike address");
  });
  it("does not label an exact previously paid address as a lookalike", () => {
    const dust = transfer({ value: "0.00000001" });
    expect(suspiciousActivityReason(dust, [transfer({ outgoing: true, to: dust.from })])).toBeNull();
  });
  it("retains the provider's token-spam reason", () => {
    expect(suspiciousActivityReason(transfer({ spam: true, spamReason: "phishing symbol" }), [])).toBe("phishing symbol");
  });
  it("never rounds a tiny positive payment to zero", () => {
    expect(Number(formatActivityAmount("0.000000000000000001"))).toBe(1e-18);
  });
});