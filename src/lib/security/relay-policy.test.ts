import { describe, expect, it } from "vitest";
import { validateRelayPost } from "./relay-policy";
describe("partner relay schema", () => {
  const target = new URL("https://example.com/api/login");
  it("rejects arbitrary exfiltration bodies", () => expect(() => validateRelayPost({ seed: "secret" }, target)).toThrow());
  it("rejects unexpected additional fields", () => expect(() => validateRelayPost({ id: "a", address: "T".repeat(34), signature: "A".repeat(88), message: "fake", password: "secret" }, target)).toThrow());
  it("preserves domain-bound TXC sign-in protocol", () => {
    const input = { id: "abc", address: "T".repeat(34), signature: "A".repeat(88), message: "example.com wants you to sign in with your TXC wallet.\n\nNonce: abcdefghijklmnop\nIssued At: 2026-10-20T11:40:00Z\nBy signing, you authorize a sign-in session for Example.\nThis signature does not authorize any payment." };
    expect(validateRelayPost(input, target)).toEqual(input);
  });
});