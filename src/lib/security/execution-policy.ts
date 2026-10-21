/** Quote APIs are not signing authorities. Re-enable only after calldata/contract verification. */
export function assertReviewedExecution(_provider: "lifi"): void {
  throw new Error("EVM swaps are temporarily paused while spending-contract verification is completed. Sending and receiving still work.");
}
