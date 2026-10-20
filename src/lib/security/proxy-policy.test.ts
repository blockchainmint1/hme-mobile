import { expect, it } from "vitest";
import { isSafeProxyPath, validRpcBatch } from "./proxy-policy";
it("rejects traversal and encoded path separators", () => {
  for (const path of ["address/../secret", "address/%2Fsecret", "address/%252e", "address/./secret", "address/\\secret"]) expect(isSafeProxyPath(path)).toBe(false);
  expect(isSafeProxyPath("address/Tabc")).toBe(true);
});
it("caps RPC batches at 50 calls", () => {
  expect(validRpcBatch(Array.from({ length: 50 }, () => ({ method: "eth_blockNumber" })))).toBe(true);
  expect(validRpcBatch(Array.from({ length: 51 }, () => ({ method: "eth_blockNumber" })))).toBe(false);
  expect(validRpcBatch([])).toBe(false);
});