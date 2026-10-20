import { describe, expect, it } from "vitest";
import { validateCardAmount } from "./payment-policy";
describe("tap-card amount authorization", () => {
  it("uses actual TSD units for limits", () => expect(validateCardAmount(100_000_000n, 1.005)).toBe(1));
  it("refuses 50000 TSD represented as $1", () => expect(() => validateCardAmount(5_000_000_000_000n, 1)).toThrow());
  for (const fiat of [0, -1, NaN, Infinity]) it(`refuses invalid fiat ${fiat}`, () => expect(() => validateCardAmount(100_000_000n, fiat)).toThrow());
  it("refuses zero TSD", () => expect(() => validateCardAmount(0n, 1)).toThrow());
  it("refuses amounts outside lossless number serialization", () => expect(() => validateCardAmount(9_007_199_254_740_992n, 90_071_992.54740992)).toThrow());
});