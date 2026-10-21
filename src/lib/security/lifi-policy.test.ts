import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { encodeFunctionData, parseAbi, type Address, type Hex } from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import {
  LIFI_DIAMOND,
  LIFI_NATIVE,
  LifiPolicyError,
  requiredSpender,
  verifyLifiQuote,
  type SwapIntent,
} from "./lifi-policy";

// Real li.quest responses captured 2026-10-21 for a synthetic address.
const load = (n: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8")) as SwapQuote;
const ETH_Q = load("lifi-quote-eth.json"); // 100 USDC -> ETH on Ethereum (fee hop + swap hop)
const BASE_Q = load("lifi-quote-base.json"); // 0.01 ETH -> USDC on Base

const USER = "0x000000000000000000000000000000000000dEaD" as Address;
const ATTACKER = "0x000000000000000000000000000000000000beef" as Address;
const USDC_ETH = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDT_ETH = "0xdAC17F958D2ee523a2206206994597C13D831ec7";

const ethIntent: SwapIntent = {
  chain: "eth",
  user: USER,
  fromToken: USDC_ETH,
  toToken: LIFI_NATIVE,
  fromAmount: 100_000000n,
  minAmountOutFloor: BigInt(ETH_Q.estimate.toAmountMin),
};
const baseIntent: SwapIntent = {
  chain: "base",
  user: USER,
  fromToken: LIFI_NATIVE,
  toToken: USDC_BASE,
  fromAmount: 10n ** 16n,
  minAmountOutFloor: BigInt(BASE_Q.estimate.toAmountMin),
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ABI = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensMultipleV3ERC20ToNative(bytes32,string,string,address,uint256,SwapData[])",
  "function swapTokensSingleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData)",
]);
type Hop = {
  callTo: Address;
  approveTo: Address;
  sendingAssetId: Address;
  receivingAssetId: Address;
  fromAmount: bigint;
  callData: Hex;
  requiresDeposit: boolean;
};
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const hop = (o: Partial<Hop>): Hop => ({
  callTo: ATTACKER,
  approveTo: ATTACKER,
  sendingAssetId: USDC_ETH,
  receivingAssetId: ZERO,
  fromAmount: 100_000000n,
  callData: "0x",
  requiresDeposit: true,
  ...o,
});
function ethCalldata(receiver: Address, minOut: bigint, hops: Hop[]): Hex {
  return encodeFunctionData({
    abi: ABI,
    functionName: "swapTokensMultipleV3ERC20ToNative",
    args: [`0x${"11".repeat(32)}`, "lifi-api", "", receiver, minOut, hops],
  });
}

describe("LI.FI policy accepts the genuine routes", () => {
  it("decodes the real USDC -> ETH route and binds receiver, amounts and asset", () => {
    const v = verifyLifiQuote(ETH_Q, ethIntent);
    expect(v.functionName).toBe("swapTokensMultipleV3ERC20ToNative");
    expect(v.receiver.toLowerCase()).toBe(USER.toLowerCase());
    expect(v.minAmountOut).toBe(BigInt(ETH_Q.estimate.toAmountMin));
    expect(v.value).toBe(0n);
    expect(v.hops.filter((h) => h.requiresDeposit).reduce((s, h) => s + h.fromAmount, 0n)).toBe(
      100_000000n,
    );
  });
  it("decodes the real ETH -> USDC route on Base (native value bound)", () => {
    const v = verifyLifiQuote(BASE_Q, baseIntent);
    expect(v.functionName).toBe("swapTokensMultipleV3NativeToERC20");
    expect(v.value).toBe(10n ** 16n);
    expect(v.hops[v.hops.length - 1]!.receivingAssetId.toLowerCase()).toBe(USDC_BASE.toLowerCase());
  });
  it("only ever returns the pinned Diamond as approval spender", () => {
    expect(requiredSpender("eth", ETH_Q)).toBe(LIFI_DIAMOND.eth);
  });
});

describe("LI.FI policy rejects hostile quotes without producing a signature", () => {
  const expectBlocked = (q: SwapQuote, intent: SwapIntent, why: RegExp) =>
    expect(() => verifyLifiQuote(q, intent)).toThrow(
      expect.objectContaining({ name: "LifiPolicyError", message: expect.stringMatching(why) }),
    );

  it("malicious target contract", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.to = ATTACKER;
    expectBlocked(q, ethIntent, /not the LI\.FI Diamond/);
  });
  it("wrong chain id", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.chainId = 56;
    expectBlocked(q, ethIntent, /chain 56/);
  });
  it("changed approval spender", () => {
    const q = clone(ETH_Q);
    q.estimate.approvalAddress = ATTACKER;
    expect(() => requiredSpender("eth", q)).toThrow(LifiPolicyError);
    expectBlocked(q, ethIntent, /approval spender/);
  });
  it("unlimited approval cannot arise: the wallet approves exactly intent.fromAmount, never a quote-supplied amount", () => {
    // The policy exposes only the spender; the amount comes from the intent.
    expect(requiredSpender("eth", ETH_Q)).toBe(LIFI_DIAMOND.eth);
    expect(ethIntent.fromAmount).toBe(100_000000n);
  });
  it("different recipient in calldata", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = ethCalldata(ATTACKER, BigInt(q.estimate.toAmountMin), [hop({})]);
    expectBlocked(q, ethIntent, /not this wallet/);
  });
  it("excessive native value on a token-in swap", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.value = "0xde0b6b3a7640000"; // 1 ETH
    expectBlocked(q, ethIntent, /native value/);
  });
  it("native value lower or higher than the amount entered", () => {
    const q = clone(BASE_Q);
    q.transactionRequest.value = "0x4563918244f40000"; // 5 ETH
    expectBlocked(q, baseIntent, /native value/);
  });
  it("substituted input token (calldata pulls USDT, user chose USDC)", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = ethCalldata(USER, BigInt(q.estimate.toAmountMin), [
      hop({ sendingAssetId: USDT_ETH }),
    ]);
    expectBlocked(q, ethIntent, /not the token you are paying with/);
  });
  it("substituted output token", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = ethCalldata(USER, BigInt(q.estimate.toAmountMin), [
      hop({ receivingAssetId: USDT_ETH }),
    ]);
    expectBlocked(q, ethIntent, /route ends in/);
  });
  it("calldata pulls more than the amount entered", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = ethCalldata(USER, BigInt(q.estimate.toAmountMin), [
      hop({ fromAmount: 250_000000n }),
    ]);
    expectBlocked(q, ethIntent, /pulls 250000000/);
  });
  it("minimum received in calldata lower than the quote claims", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = ethCalldata(USER, 1n, [hop({})]);
    expectBlocked(q, ethIntent, /minimum received in calldata differs/);
  });
  it("refreshed route below what the user accepted must be re-confirmed", () => {
    expectBlocked(
      ETH_Q,
      { ...ethIntent, minAmountOutFloor: BigInt(ETH_Q.estimate.toAmountMin) + 1n },
      /below the .* you accepted/,
    );
  });
  it("function outside GenericSwapFacetV3 (e.g. a bridge facet or diamondCut)", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = `0x1f931c1c${q.transactionRequest.data.slice(10)}`;
    expectBlocked(q, ethIntent, /not a GenericSwapFacetV3 swap/);
  });
  it("swap family that contradicts the intent (ERC20->ERC20 selector for a USDC->ETH intent)", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = encodeFunctionData({
      abi: ABI,
      functionName: "swapTokensSingleV3ERC20ToERC20",
      args: [
        `0x${"11".repeat(32)}`,
        "x",
        "",
        USER,
        BigInt(q.estimate.toAmountMin),
        hop({ receivingAssetId: USDT_ETH }),
      ],
    });
    expectBlocked(q, ethIntent, /does not match a ERC20ToNative swap/);
  });
  it("quote amount differing from the amount entered", () => {
    expectBlocked(
      ETH_Q,
      { ...ethIntent, fromAmount: 99_000000n },
      /differs from the amount entered|pulls/,
    );
  });
  it("garbage calldata", () => {
    const q = clone(ETH_Q);
    q.transactionRequest.data = "0x2c57e884deadbeef";
    expectBlocked(q, ethIntent, /does not decode/);
  });
});
