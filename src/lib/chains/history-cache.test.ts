import { describe, expect, it } from "vitest";
import { syncHistoryPages, zeroValueTokenReason, transferIdentity, type HistoryPayload } from "./history-cache";
import { classifyToken } from "./token-classification";
import { filterSuspiciousActivity } from "../suspicious-activity";
import type { EvmTransfer } from "./history.functions";

const realHash = "0x197010b1b3724dedb7c02915efee5cd50f2ee4414f6a6f2cf152833e7690fffa";
const fakeHash = "0x845a6b9d0f2538234943511c4fb2c8c3e8cb76af3ac56354e86a8e3dd79be20c";
const row = (patch: Partial<EvmTransfer> = {}): EvmTransfer => ({ hash: realHash,
  from: "0xad72e04902d5b2b259eeb1337f0474bd86e6a386", to: "0x" + "a".repeat(40),
  value: "110000", asset: "USDC", category: "erc20", blockNum: 100,
  timestamp: null, outgoing: true, contractAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  spam: false, spamReason: null, ...patch });
const empty = (): HistoryPayload => ({ rows: [], streams: {} });

describe("protected EVM history", () => {
  it("keeps the real 110,000 USDC hash and hides the counterfeit hash", () => {
    const classified = classifyToken("eth", "erc20", "USDC", "0x0e7304658d142ac7557fa29fc5c67a1d73cc32b1", true, 110000);
    const fake = row({ hash: fakeHash, contractAddress: "0x0e7304658d142ac7557fa29fc5c67a1d73cc32b1", spam: classified.spam, spamReason: classified.reason });
    const history = [row(), fake];
    expect(filterSuspiciousActivity(history, true).map((t) => t.hash)).toEqual([realHash]);
    expect(filterSuspiciousActivity(history, false)).toBe(history);
  });
  it("a flood cannot evict the genuine protected token payment", async () => {
    const flood = Array.from({ length: 400 }, (_, i) => row({ eventId: `fake-${i}`, hash: fakeHash, blockNum: 200 + i, spam: true }));
    const result = await syncHistoryPages(empty(), 1000, async (stream) => ({ transfers: stream === "verified-from" ? [row()] : flood }));
    expect(result.rows.filter((r) => !r.spam).map((r) => r.hash)).toEqual([realHash]);
    expect(result.rows.filter((r) => r.spam)).toHaveLength(100);
  });
  it("retains page keys and fixed bounds instead of skipping a spam-filled page", async () => {
    let calls = 0;
    const partial = await syncHistoryPages(empty(), 1000, async () => ({ transfers: [], pageKey: `page-${++calls}` }));
    expect(partial.incomplete).toBe(true);
    expect(partial.streams.from.block).toBe(0);
    const bounds: unknown[][] = [];
    const completed = await syncHistoryPages(partial, 2000, async (stream, from, to, pageKey) => {
      bounds.push([stream, from, to, pageKey]);
      return { transfers: stream === "from" ? [row()] : [] };
    });
    expect(bounds.find((b) => b[0] === "from")).toEqual(["from", 0, 1000, partial.streams.from.pageKey]);
    expect(completed.streams.from.block).toBe(1000);
    expect(completed.incomplete).toBe(false);
    expect(completed.rows[0].hash).toBe(realHash);
  });
  it("failed pagination leaves the prior cache and cursor unchanged", async () => {
    const previous = { rows: [row()], streams: { from: { block: 100 } } };
    const before = JSON.stringify(previous);
    await expect(syncHistoryPages(previous, 200, async (stream) => {
      if (stream === "to") throw new Error("upstream failed");
      return { transfers: [row({ blockNum: 200 })] };
    })).rejects.toThrow("upstream failed");
    expect(JSON.stringify(previous)).toBe(before);
  });
  it("preserves multiple transfer events within one hash", () => {
    expect(transferIdentity(row({ eventId: "log-1" }))).not.toBe(transferIdentity(row({ eventId: "log-2" })));
  });
  it("zero-value genuine-contract poisoning is suspicious in either direction", () => {
    expect(zeroValueTokenReason(row({ value: "0" }))).toBeTruthy();
    expect(zeroValueTokenReason(row({ value: "0.000000", outgoing: false }))).toBeTruthy();
    expect(zeroValueTokenReason(row({ value: "0.000001" }))).toBeNull();
  });
  it("does not reject genuine service transfers for unknown signer/allowance", () => {
    expect(filterSuspiciousActivity([row()], true)).toHaveLength(1);
  });
  it("genuine zero-balance and ordinary custom tokens are not spam", () => {
    expect(classifyToken("eth", "erc20", "USDC", row().contractAddress, true, 0).spam).toBe(false);
    expect(classifyToken("eth", "erc20", "CUSTOM", "0x" + "b".repeat(40), true, 0).spam).toBe(false);
    expect(classifyToken("eth", "erc20", "claim.xyz", "0x" + "b".repeat(40), true, 10).spam).toBe(true);
  });
});