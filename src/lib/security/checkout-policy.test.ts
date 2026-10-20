import { expect, it } from "vitest";
import { validateCheckoutAmount } from "./checkout-policy";
it("refuses a different token masquerading as USDC", () => expect(() => validateCheckoutAmount(10, 10, 1, "USDT")).toThrow());
it("refuses a large crypto debit for a small fiat invoice", () => expect(() => validateCheckoutAmount(1000, 1, 1, "USDC")).toThrow());
it("allows a matching USDC invoice", () => expect(() => validateCheckoutAmount(10, 10, 1, "USDC")).not.toThrow());