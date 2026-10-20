/** Quote APIs are not signing authorities. Re-enable only after calldata/contract verification. */
export function assertReviewedExecution(provider: "lifi" | "relay-tron"): never {
  throw new Error(`${provider === "lifi" ? "EVM swaps" : "Tron bridging"} are temporarily paused while spending-contract verification is completed. Sending and receiving still work.`);
}