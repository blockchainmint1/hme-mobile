import { expect, it } from "vitest";
import { assertReviewedExecution } from "./execution-policy";
it("blocks LI.FI execution before token approvals", () => expect(() => assertReviewedExecution("lifi")).toThrow());
it("blocks unverified Relay Tron contract signing", () => expect(() => assertReviewedExecution("relay-tron")).toThrow());