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
  it("keeps native sends visible even if the provider flags them", () => {
    const sent = transfer({ outgoing: true, value: "0", spam: true });
    expect(filterSuspiciousActivity([sent], true)).toEqual([sent]);
  });
  it("hides Bobby's counterfeit outgoing 110,000 USDC event", () => {
    const fake = transfer({
      hash: "0x845a6b9d0f2538234943511c4fb2c8c3e8cb76af3ac56354e86a8e3dd79be20c",
      from: "0xad72e04902d5b2b259eeb1337f0474bd86e6a386",
      to: "0xe5133dfa39f7280e743adc7d57548957554fd707",
      outgoing: true, value: "110000", asset: "USDC", category: "erc20",
      contractAddress: "0x0e7304658d142ac7557fa29fc5c67a1d73cc32b1",
      spam: true, spamReason: "imposter USDC",
    });
    expect(filterSuspiciousActivity([fake], true)).toEqual([]);
    expect(suspiciousActivityReason(fake, [fake])).toBe("Counterfeit USDC token — unverified contract");
    expect(filterSuspiciousActivity([fake], false)).toEqual([fake]);
  });
  it("keeps genuine outgoing USDC from the verified Ethereum contract visible", () => {
    const real = transfer({ outgoing: true, value: "110000", asset: "USDC", category: "erc20",
      contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" });
    expect(filterSuspiciousActivity([real], true)).toEqual([real]);
  });
  it("does not hide unfamiliar outgoing tokens solely because they are unfamiliar", () => {
    const custom = transfer({ outgoing: true, asset: "CUSTOM", category: "erc20",
      contractAddress: "0x" + "c".repeat(40) });
    expect(filterSuspiciousActivity([custom], true)).toEqual([custom]);
  });
  it("hides phishing-token outgoing announcements without deleting raw history", () => {
    const phishing = transfer({ outgoing: true, category: "erc20", spam: true, spamReason: "phishing symbol" });
    const history = [phishing];
    expect(filterSuspiciousActivity(history, true)).toEqual([]);
    expect(history).toEqual([phishing]);
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