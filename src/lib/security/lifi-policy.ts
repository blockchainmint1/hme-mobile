/**
 * LI.FI execution policy: the quote API is not a signing authority.
 *
 * Every field the wallet signs is checked against (a) contract facts verified
 * independently of the quote, and (b) the intent the user confirmed on screen.
 * Anything the quote could have changed to steal funds is bound here:
 *
 *   - `to` and `approvalAddress` must be the LiFiDiamond pinned per chain.
 *   - calldata must be one of GenericSwapFacetV3's six swap functions and is
 *     fully decoded; `_receiver` must be the user and `_minAmountOut` must be
 *     at least what the user accepted.
 *   - the money in (token + amount, or native `value`) must equal the intent.
 *   - the money out (last hop's receiving asset) must be the token the user
 *     picked.
 *
 * Deployment facts below were verified 2026-10-21 against
 * github.com/lifinance/contracts `deployments/{mainnet,base,bsc}.json` and
 * on-chain (`owner()` of the Diamond == the chain's LiFiTimelockController,
 * `getMinDelay()` == 10800 s on all three). `verifyLifiDeployment` re-checks
 * the on-chain part at runtime so a stale pin fails closed.
 */
import {
  decodeFunctionData,
  getAddress,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import type { SwapQuote } from "@/lib/chains/swap.functions";
import type { EvmChainId } from "@/lib/chains/evm";

export type LifiChain = Extract<EvmChainId, "eth" | "base" | "bsc">;

/** LI.FI's native-token sentinel in quotes; on-chain the facet uses address(0). */
export const LIFI_NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO = "0x0000000000000000000000000000000000000000";

export const LIFI_CHAIN_IDS: Record<LifiChain, number> = { eth: 1, base: 8453, bsc: 56 };

/** LiFiDiamond (EIP-2535) per chain. Same address on these three chains. */
export const LIFI_DIAMOND: Record<LifiChain, Address> = {
  eth: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  base: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
  bsc: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE",
};

/** `owner()` of the Diamond: the LiFiTimelockController that gates diamondCut. */
export const LIFI_TIMELOCK: Record<LifiChain, Address> = {
  eth: "0x55117ECcC867Db72aEb25f728CCf57C3C3B4faEe",
  base: "0x5604A94A3438C3074EFFF803fab14B7244fe4E29",
  bsc: "0x55117ECcC867Db72aEb25f728CCf57C3C3B4faEe",
};

/** GenericSwapFacetV3 — the only functions a same-chain swap may call. */
const FACET_ABI = parseAbi([
  "struct SwapData { address callTo; address approveTo; address sendingAssetId; address receivingAssetId; uint256 fromAmount; bytes callData; bool requiresDeposit; }",
  "function swapTokensSingleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensSingleV3ERC20ToNative(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensSingleV3NativeToERC20(bytes32,string,string,address,uint256,SwapData)",
  "function swapTokensMultipleV3ERC20ToERC20(bytes32,string,string,address,uint256,SwapData[])",
  "function swapTokensMultipleV3ERC20ToNative(bytes32,string,string,address,uint256,SwapData[])",
  "function swapTokensMultipleV3NativeToERC20(bytes32,string,string,address,uint256,SwapData[])",
]);

/** Selector → function, for the report and for tests. */
export const LIFI_ALLOWED_SELECTORS: Record<string, string> = {
  "0x4666fc80": "swapTokensSingleV3ERC20ToERC20",
  "0x733214a3": "swapTokensSingleV3ERC20ToNative",
  "0xaf7060fd": "swapTokensSingleV3NativeToERC20",
  "0x5fd9ae2e": "swapTokensMultipleV3ERC20ToERC20",
  "0x2c57e884": "swapTokensMultipleV3ERC20ToNative",
  "0x736eac0b": "swapTokensMultipleV3NativeToERC20",
};

export interface SwapIntent {
  chain: LifiChain;
  /** The account that signs and must receive the output. */
  user: Address;
  /** Token address the user is paying with, or LIFI_NATIVE. */
  fromToken: string;
  /** Token address the user wants, or LIFI_NATIVE. */
  toToken: string;
  /** Exact raw amount the user typed. */
  fromAmount: bigint;
  /**
   * Smallest output the user agreed to (the toAmountMin shown when they
   * pressed the button, less an allowed drift). A refreshed route that
   * promises less than this must be re-confirmed, not signed.
   */
  minAmountOutFloor: bigint;
}

export interface VerifiedSwap {
  functionName: string;
  receiver: Address;
  minAmountOut: bigint;
  value: bigint;
  hops: {
    sendingAssetId: Address;
    receivingAssetId: Address;
    fromAmount: bigint;
    requiresDeposit: boolean;
  }[];
}

const low = (s: string) => s.toLowerCase();
const same = (a: string, b: string) => low(a) === low(b);
/** Quote sentinel → on-chain representation. */
const onChainAsset = (t: string) => (same(t, LIFI_NATIVE) ? ZERO : low(t));

export class LifiPolicyError extends Error {
  constructor(message: string) {
    super(`Swap blocked: ${message}`);
    this.name = "LifiPolicyError";
  }
}
const fail = (m: string): never => {
  throw new LifiPolicyError(m);
};

/** The spender an ERC-20 approval may name. Only the pinned Diamond. */
export function requiredSpender(chain: LifiChain, quote: Pick<SwapQuote, "estimate">): Address {
  const spender = quote.estimate.approvalAddress;
  if (!spender || !same(spender, LIFI_DIAMOND[chain])) {
    fail(`approval spender ${spender ?? "(none)"} is not the LI.FI Diamond on ${chain}`);
  }
  return LIFI_DIAMOND[chain];
}

/**
 * Decode and bind a quote's transaction to the user's intent. Throws
 * LifiPolicyError on any mismatch; returns the decoded facts for display.
 */
export function verifyLifiQuote(quote: SwapQuote, intent: SwapIntent): VerifiedSwap {
  const tx = quote.transactionRequest;
  if (!tx || typeof tx.data !== "string" || typeof tx.to !== "string")
    fail("quote has no transaction");

  if (Number(tx.chainId) !== LIFI_CHAIN_IDS[intent.chain]) {
    fail(`transaction is for chain ${tx.chainId}, not ${intent.chain}`);
  }
  if (!same(tx.to, LIFI_DIAMOND[intent.chain])) fail(`target ${tx.to} is not the LI.FI Diamond`);

  const nativeIn = same(intent.fromToken, LIFI_NATIVE);
  const nativeOut = same(intent.toToken, LIFI_NATIVE);
  if (nativeIn && nativeOut) fail("native to native is not a swap");
  if (same(onChainAsset(intent.fromToken), onChainAsset(intent.toToken)))
    fail("input and output are the same asset");
  if (intent.fromAmount <= 0n) fail("amount must be positive");
  if (!nativeIn) requiredSpender(intent.chain, quote);

  const value = BigInt(tx.value ?? "0x0");
  if (nativeIn ? value !== intent.fromAmount : value !== 0n) {
    fail(`native value ${value} does not match the ${nativeIn ? "amount" : "zero"} expected`);
  }

  const selector = low(tx.data.slice(0, 10));
  if (!LIFI_ALLOWED_SELECTORS[selector])
    fail(`function ${selector} is not a GenericSwapFacetV3 swap`);
  const expectedFamily = nativeIn ? "NativeToERC20" : nativeOut ? "ERC20ToNative" : "ERC20ToERC20";
  if (!LIFI_ALLOWED_SELECTORS[selector]!.endsWith(expectedFamily)) {
    fail(`${LIFI_ALLOWED_SELECTORS[selector]} does not match a ${expectedFamily} swap`);
  }

  let decoded: ReturnType<typeof decodeFunctionData<typeof FACET_ABI>>;
  try {
    decoded = decodeFunctionData({ abi: FACET_ABI, data: tx.data as Hex });
  } catch {
    return fail("calldata does not decode as a GenericSwapFacetV3 call");
  }
  const [, , , receiverRaw, minAmountOut, swaps] = decoded.args as unknown as [
    Hex,
    string,
    string,
    Address,
    bigint,
    (
      | {
          callTo: Address;
          approveTo: Address;
          sendingAssetId: Address;
          receivingAssetId: Address;
          fromAmount: bigint;
          callData: Hex;
          requiresDeposit: boolean;
        }
      | {
          callTo: Address;
          approveTo: Address;
          sendingAssetId: Address;
          receivingAssetId: Address;
          fromAmount: bigint;
          callData: Hex;
          requiresDeposit: boolean;
        }[]
    ),
  ];
  const hops = Array.isArray(swaps) ? swaps : [swaps];
  if (hops.length === 0 || hops.length > 4) fail(`unexpected number of hops (${hops.length})`);

  const receiver = getAddress(receiverRaw);
  if (!same(receiver, intent.user)) fail(`output would go to ${receiver}, not this wallet`);

  if (minAmountOut !== BigInt(quote.estimate.toAmountMin)) {
    fail("minimum received in calldata differs from the quote");
  }
  if (minAmountOut < intent.minAmountOutFloor) {
    fail(
      `route now guarantees only ${minAmountOut}, below the ${intent.minAmountOutFloor} you accepted`,
    );
  }
  if (BigInt(quote.estimate.fromAmount) !== intent.fromAmount)
    fail("quote amount differs from the amount entered");

  // Money in: every hop that pulls from the user must pull the intent's token,
  // and together they must pull exactly the intent's amount (a fee-collection
  // hop is a deposit of the full amount followed by a non-deposit swap of the
  // remainder, so sums over deposits, not over all hops).
  const inAsset = onChainAsset(intent.fromToken);
  const outAsset = onChainAsset(intent.toToken);
  let deposited = 0n;
  for (const h of hops) {
    if (h.requiresDeposit) {
      if (!same(h.sendingAssetId, inAsset))
        fail(`a hop pulls ${h.sendingAssetId}, not the token you are paying with`);
      deposited += h.fromAmount;
    }
  }
  if (nativeIn) {
    // Native hops never "deposit" (the facet reads msg.value); the first hop's amount is the spend.
    if (!same(hops[0]!.sendingAssetId, ZERO) || hops[0]!.fromAmount !== intent.fromAmount) {
      fail("native amount in calldata differs from the amount entered");
    }
  } else if (deposited !== intent.fromAmount) {
    fail(`calldata pulls ${deposited}, not the ${intent.fromAmount} entered`);
  }
  if (!same(hops[hops.length - 1]!.receivingAssetId, outAsset)) {
    fail(`route ends in ${hops[hops.length - 1]!.receivingAssetId}, not the token you chose`);
  }

  return {
    functionName: decoded.functionName,
    receiver,
    minAmountOut,
    value,
    hops: hops.map((h) => ({
      sendingAssetId: h.sendingAssetId,
      receivingAssetId: h.receivingAssetId,
      fromAmount: h.fromAmount,
      requiresDeposit: h.requiresDeposit,
    })),
  };
}

/**
 * Runtime check that the pinned Diamond is still what we verified: code is
 * present and `owner()` is the pinned timelock. Run once per session before
 * the first swap; a failure means LI.FI changed governance (or our pin is
 * stale) and execution must stay off until re-reviewed.
 */
export async function verifyLifiDeployment(chain: LifiChain, client: PublicClient): Promise<void> {
  const diamond = LIFI_DIAMOND[chain];
  const code = await client.getCode({ address: diamond });
  if (!code || code === "0x") fail(`no contract at the LI.FI Diamond address on ${chain}`);
  const owner = (await client.readContract({
    address: diamond,
    abi: parseAbi(["function owner() view returns (address)"]),
    functionName: "owner",
  })) as Address;
  if (!same(owner, LIFI_TIMELOCK[chain])) {
    fail(`LI.FI Diamond owner changed to ${owner}; execution needs re-review`);
  }
}
