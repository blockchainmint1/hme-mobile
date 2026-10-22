import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixedfloatQuote } from "./fixedfloat.server";

const request = {
  coin: "doge" as const,
  dest: { asset: "ETH.USDC", symbol: "USDC", chain: "eth" as const, label: "USDC on Ethereum" },
  amountSats: 50_000_000_000_000,
  destination: "0x0000000000000000000000000000000000000001",
  refundAddress: "DQuoteOnlyTestRefundAddress",
};

describe("FixedFloat response handling", () => {
  beforeEach(() => {
    vi.stubEnv("FIXEDFLOAT_API_KEY", "test-only-key");
    vi.stubEnv("FIXEDFLOAT_API_SECRET", "test-only-secret");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("classifies an HTML 403 as access refusal without exposing its body", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>private gateway details</html>", { status: 403, headers: { "cf-mitigated": "challenge" } })));
    await expect(fixedfloatQuote(request)).rejects.toThrow("FixedFloat is refusing access from our swap service (403)");
    expect(warning).toHaveBeenCalledWith("[fixedfloat] upstream refusal", {
      operation: "quote", status: 403, responseKind: "non-json", challenge: true, redirected: false,
    });
  });

  it("preserves a JSON API rejection instead of blaming the gateway", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 403, msg: "API access denied" }, { status: 403 })));
    await expect(fixedfloatQuote(request)).rejects.toThrow("FixedFloat: API access denied");
  });

  it("classifies rate limiting separately from malformed responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>rate limited</html>", { status: 429 })));
    await expect(fixedfloatQuote(request)).rejects.toThrow("too many requests");
  });

  it("still accepts a valid quote for 500,000 DOGE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 0, data: {
      from: { amount: "500000", min: "100", max: "2000000" },
      to: { amount: "39315.5664" },
    } }));
    vi.stubGlobal("fetch", fetchMock);
    const quote = await fixedfloatQuote(request);
    expect(quote.amountOut).toBe(39315.5664);
    expect(quote.provider).toBe("fixedfloat");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body).amount).toBe("500000");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});