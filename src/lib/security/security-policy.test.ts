import { afterEach, describe, expect, it, vi } from "vitest";
import { assertFreeformMessage, validateSiwe } from "./signing-policy";
import { classifyLoginHost, isSpendingSite, setEcosystemSites } from "../web-login-hosts";
import { forwardJson, readBoundedText } from "./json-proxy.server";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); setEcosystemSites([], true); });
describe("spending registry", () => {
  it("never trusts an attacker-named Lovable app or an unlisted honest.money subdomain for spending", () => {
    expect(classifyLoginHost("honest-seeds.lovable.app").tier).toBe("unknown");
    expect(isSpendingSite("honest-seeds.lovable.app")).toBe(false);
    expect(isSpendingSite("unlisted.honest.money")).toBe(false);
  });
  it("offline labels cannot authorize spending", () => {
    setEcosystemSites([{ host: "seeds.honest.money", label: "Seeds" }]);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
  it("only exact fresh entries authorize spending and an empty list revokes them", () => {
    setEcosystemSites([{ host: "seeds.honest.money", label: "Seeds" }], true);
    expect(isSpendingSite("seeds.honest.money")).toBe(true);
    expect(isSpendingSite("other.seeds.honest.money")).toBe(false);
    setEcosystemSites([], true);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
  it("spending trust expires after five minutes", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    setEcosystemSites([{ host: "seeds.honest.money", label: "Seeds" }], true);
    vi.spyOn(Date, "now").mockReturnValue(1_300_000);
    expect(isSpendingSite("seeds.honest.money")).toBe(false);
  });
});
describe("signature policy", () => {
  for (const text of ["example.com wants you to sign in", "Honest Money - Link wallet", "Honest Money - Revoke link", "hm-card|pay|1|{}"])
    it(`blocks authorization template ${text.split(" ")[0]}`, () => expect(() => assertFreeformMessage(text)).toThrow());
  it("allows an ordinary proof-of-ownership message", () => expect(() => assertFreeformMessage("I control this address.")).not.toThrow());
  const address = "0x" + "ab".repeat(20);
  const time = Date.parse("2026-10-20T11:40:00Z");
  const siwe = `example.com wants you to sign in with your Ethereum account:\n${address}\n\nSign in.\n\nURI: https://example.com/login\nVersion: 1\nChain ID: 1\nNonce: abc12345\nIssued At: 2026-10-20T11:40:00Z`;
  it("allows a matching current SIWE message", () => expect(() => validateSiwe(siwe, "https://example.com", address, "0x1", time)).not.toThrow());
  it("rejects other domains", () => expect(() => validateSiwe(siwe, "https://evil.com", address, "0x1", time)).toThrow());
  it("rejects other networks", () => expect(() => validateSiwe(siwe, "https://example.com", address, "0x38", time)).toThrow());
  it("rejects opaque hex payloads", () => expect(() => validateSiwe("0x" + "aa".repeat(32), "https://example.com", address, "0x1", time)).toThrow());
});
describe("JSON forwarding", () => {
  it("rejects HTML and redirects", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("<script>evil()</script>", { headers: { "content-type": "text/html" } })).mockResolvedValueOnce(new Response(null, { status: 302 }));
    vi.stubGlobal("fetch", fetch);
    expect((await forwardJson("https://example.com", {})).status).toBe(502);
    expect((await forwardJson("https://example.com", {})).status).toBe(502);
    expect(fetch.mock.calls[0]?.[1].redirect).toBe("manual");
  });
  it("rejects oversized streaming bodies", async () => {
    await expect(readBoundedText(new Response("x".repeat(32769)))).rejects.toThrow();
  });
  it("returns only parsed JSON with a fixed type", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"ok":true}', { headers: { "content-type": "application/problem+json" } })));
    const response = await forwardJson("https://example.com", {});
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });
});