import { afterEach, describe, expect, it, vi } from "vitest";
import { ecosystemCredential } from "./ecosystem-credential.server";

afterEach(() => vi.unstubAllEnvs());

describe("wallet ecosystem credential", () => {
  it("uses the issued site credential with site code wallet", () => {
    vi.stubEnv("HME_ECOSYSTEM", "synthetic-test-credential");
    const credential = ecosystemCredential();
    expect(credential.site).toBe("wallet");
    expect(credential.apiKey === "synthetic-test-credential").toBe(true);
  });
  it("fails closed without the site credential", () => {
    vi.stubEnv("HME_ECOSYSTEM", "");
    expect(() => ecosystemCredential()).toThrow("dedicated ecosystem site credential missing");
  });
});