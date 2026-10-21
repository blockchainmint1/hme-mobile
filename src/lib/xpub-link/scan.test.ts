import { describe, expect, it } from "vitest";
import { ecosystemLinkScanPayload } from "./scan";

describe("ecosystem camera routing", () => {
  const seeds = "https://seeds.honest.money/api/public/hme-link/manifest/test-challenge-123";

  it("recognizes Seeds' bare HTTPS manifest from the top camera", () => {
    expect(ecosystemLinkScanPayload(seeds)).toBe(seeds);
  });

  it("keeps hm-link watch-only codes supported", () => {
    expect(ecosystemLinkScanPayload(` hm-link:${seeds} `)).toBe(seeds);
  });

  it("keeps TSD deep links supported", () => {
    expect(ecosystemLinkScanPayload("tsd://tsd.honest.money/api/public/link/test")).toBe("https://tsd.honest.money/api/public/link/test");
  });

  it.each([
    "http://seeds.honest.money/api/public/hme-link/manifest/test",
    "https://localhost/api/public/hme-link/manifest/test",
    "https://127.0.0.1/api/public/hme-link/manifest/test",
    "https://user@seeds.honest.money/api/public/hme-link/manifest/test",
    "https://seeds.honest.money:8443/api/public/hme-link/manifest/test",
    "not a QR link",
  ])("rejects unsafe or non-link input: %s", (raw) => {
    expect(ecosystemLinkScanPayload(raw)).toBeNull();
  });
});