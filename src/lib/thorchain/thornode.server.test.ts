import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchQuote } from "./thornode.server";

const input = {
  coin: "doge" as const,
  toAsset: "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48",
  amountSats: "50000000000000",
  destination: "0x14de43dc534c6911c46ca5ca44323e785f07e9ef",
};

afterEach(() => vi.unstubAllGlobals());

describe("THORChain after-fee price protection", () => {
  it("quotes 500,000 DOGE with a 3% limit on actual payout and preserves streaming and destination", async () => {
    let requested: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = new URL(url);
      if (requested.searchParams.has("tolerance_bps")) {
        return new Response(JSON.stringify({ code: 3, message: "emit asset less than price limit: invalid request" }), { status: 400 });
      }
      return new Response(JSON.stringify({ expected_amount_out: "4164690881400", memo: `=:ETH.USDC:${input.destination}:4039750154958/1/0` }));
    }));
    const quote = await fetchQuote(input);
    expect(requested?.searchParams.get("liquidity_tolerance_bps")).toBe("300");
    expect(requested?.searchParams.has("tolerance_bps")).toBe(false);
    expect(requested?.searchParams.get("amount")).toBe("50000000000000");
    expect(requested?.searchParams.get("destination")).toBe(input.destination);
    expect(requested?.searchParams.get("streaming_interval")).toBe("1");
    expect(requested?.searchParams.get("streaming_quantity")).toBe("0");
    expect(quote.expected_amount_out).toBe("4164690881400");
    expect(quote.memo).toContain(input.destination);
  });

  it("honors explicit protection without adding feeless tolerance", async () => {
    let requested: URL | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      requested = new URL(url);
      return new Response(JSON.stringify({ expected_amount_out: "100000000" }));
    }));
    await fetchQuote({ ...input, toleranceBps: 50, streamingInterval: 0 });
    expect(requested?.searchParams.get("liquidity_tolerance_bps")).toBe("50");
    expect(requested?.searchParams.has("tolerance_bps")).toBe(false);
    expect(requested?.searchParams.has("streaming_interval")).toBe(false);
  });
});