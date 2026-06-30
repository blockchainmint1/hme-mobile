/**
 * Pick the best payment option for the customer based on:
 *  (1) the merchant's `options[]` from the invoice,
 *  (2) the wallet's actual balances across supported chains, and
 *  (3) the spec's priority order (USDC on cheap chains first, native last).
 *
 * This is intentionally dumb on purpose: zero UI chooser. If a single
 * candidate covers the invoice, we proceed automatically. If none does, the
 * caller shows "Add funds to pay" without consuming the nonce.
 */
import type { NectarPayOption } from "./api";
import type { EvmChainId } from "@/lib/chains/evm";

/** What this wallet can actually sign + broadcast today. */
export type SupportedAsset =
  | { kind: "evm-native"; chain: EvmChainId; symbol: string }
  | { kind: "evm-erc20"; chain: EvmChainId; symbol: "USDC" }
  | { kind: "txc"; symbol: "TXC" };

/** Map a server option key to a *set* of assets this wallet can pay with.
 *
 * Some keys (notably `eth:USDC`) represent USDC across multiple EVM chains
 * — the server picks the actual settle chain in the POST response. We list
 * every chain we can pay from so the balance check can succeed if any
 * single chain holds enough.
 */
export function assetsForOption(opt: NectarPayOption): SupportedAsset[] {
  const chain = opt.chain.toLowerCase();
  const token = (opt.tokenSymbol ?? "").toUpperCase();

  if (token === "USDC") {
    if (chain === "eth") {
      // `eth:USDC` is the umbrella key — settles on whichever EVM chain
      // the server chooses for this merchant.
      return [
        { kind: "evm-erc20", chain: "base", symbol: "USDC" },
        { kind: "evm-erc20", chain: "bsc", symbol: "USDC" },
        { kind: "evm-erc20", chain: "eth", symbol: "USDC" },
      ];
    }
    if (chain === "base") return [{ kind: "evm-erc20", chain: "base", symbol: "USDC" }];
    if (chain === "bsc") return [{ kind: "evm-erc20", chain: "bsc", symbol: "USDC" }];
  }

  // Native assets we support today.
  if (token === "") {
    if (chain === "eth") return [{ kind: "evm-native", chain: "eth", symbol: "ETH" }];
    if (chain === "base") return [{ kind: "evm-native", chain: "base", symbol: "ETH" }];
    if (chain === "bsc") return [{ kind: "evm-native", chain: "bsc", symbol: "BNB" }];
    if (chain === "txc") return [{ kind: "txc", symbol: "TXC" }];
  }

  // btc / sol / tron / unknown — not supported in this build.
  return [];
}

/** Priority weight per option key (lower = better). Matches spec §3. */
export function priorityRank(opt: NectarPayOption): number {
  const chain = opt.chain.toLowerCase();
  const token = (opt.tokenSymbol ?? "").toUpperCase();
  // 1. USDC umbrella (server will pick Base/BSC where possible).
  if (chain === "eth" && token === "USDC") return 10;
  // 2. Stables on cheap chains.
  if (chain === "base" && token === "USDC") return 20;
  if (chain === "tron" && token === "USDT") return 21;
  if (chain === "sol" && token === "USDC") return 22;
  if (chain === "bsc" && token === "USDC") return 23;
  // 3. Native on cheap chains.
  if (chain === "base") return 40;
  if (chain === "sol") return 41;
  if (chain === "tron") return 42;
  if (chain === "txc") return 43;
  if (chain === "bsc") return 44;
  // 4. Native on expensive chains.
  if (chain === "eth") return 60;
  if (chain === "btc") return 61;
  return 99;
}

export interface BalanceSnapshot {
  /** Asset that has at least `fiat_amount` of headroom. */
  asset: SupportedAsset;
  /** Display string for the UI ("12.34 USDC", "0.0021 ETH"). */
  display: string;
  /** Estimated USD value of the balance. Used for "covers invoice" check. */
  approxUsd: number;
}

export interface SelectionInput {
  options: NectarPayOption[];
  /** Customer's available balances we just polled. */
  balances: BalanceSnapshot[];
  /** Invoice fiat amount, assumed USD-ish. */
  fiatAmount: number;
}

export interface SelectionResult {
  option: NectarPayOption;
  asset: SupportedAsset;
  balance: BalanceSnapshot;
  /** Human label like "USDC on Base". */
  display: string;
}

function sameAsset(a: SupportedAsset, b: SupportedAsset): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "txc") return b.kind === "txc";
  return a.chain === (b as typeof a).chain && a.symbol === (b as typeof a).symbol;
}

function chainLabel(chain: EvmChainId): string {
  return chain === "eth" ? "Ethereum" : chain === "base" ? "Base" : "BNB Smart Chain";
}

function displayFor(asset: SupportedAsset): string {
  if (asset.kind === "txc") return "TXC";
  if (asset.kind === "evm-native") return `${asset.symbol} on ${chainLabel(asset.chain)}`;
  return `${asset.symbol} on ${chainLabel(asset.chain)}`;
}

/** Choose the best option the wallet can actually pay. Returns null if none. */
export function pickBestOption(input: SelectionInput): SelectionResult | null {
  const ranked = [...input.options].sort((a, b) => priorityRank(a) - priorityRank(b));
  for (const opt of ranked) {
    const candidates = assetsForOption(opt);
    if (candidates.length === 0) continue;
    // Walk candidates in declared order — assetsForOption already encodes
    // "prefer the cheap chain first" for the umbrella USDC key.
    for (const cand of candidates) {
      const bal = input.balances.find((b) => sameAsset(b.asset, cand));
      if (!bal) continue;
      // Need at least the invoice amount in USD-equivalent. We don't yet
      // know exact gas — the server's `crypto_amount` covers the token
      // side, and we'll re-validate after POST.
      if (bal.approxUsd + 1e-6 < input.fiatAmount) continue;
      return { option: opt, asset: cand, balance: bal, display: displayFor(cand) };
    }
  }
  return null;
}
