import type { EvmChainId } from "./history.functions";

export const VERIFIED_CONTRACTS: Record<EvmChainId, Set<string>> = {
  eth: new Set([
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // USDC
    "0xdac17f958d2ee523a2206206994597c13d831ec7", // USDT
    "0x6b175474e89094c44da98b954eedeac495271d0f", // DAI
    "0x6c3ea9036406852006290770bedfcaba0e23a0e8", // PYUSD
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", // WBTC
  ]),
  base: new Set([
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", // USDC
    "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", // USDT (USD₮0 bridge)
    "0x4200000000000000000000000000000000000006", // WETH
    "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", // DAI
  ]),
  bsc: new Set([
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", // USDC
    "0x55d398326f99059ff775485246999027b3197955", // USDT
    "0xe9e7cea3dedca5984780bafc599bd69add087d56", // BUSD
    "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
  ]),
  // No canonical token deployments on Zero Chill yet.
  zcu: new Set<string>(),
};

/** Well-known "real" symbols that spammers love to impersonate. */
const IMPERSONATED_SYMBOLS = new Set([
  "USDC", "USDT", "DAI", "WETH", "ETH", "WBTC", "BTC",
  "USD", "PYUSD", "BUSD", "WBNB", "USDC.E", "USDT.E",
]);

/** Regex fragments common in phishing token names/symbols. */
const PHISHING_PATTERNS = [
  /https?:/i,
  /\.(com|net|io|xyz|org|app|site|link|gift|claim)\b/i,
  /\b(visit|claim|reward|airdrop|bonus|winner|check|verify)\b/i,
  /[!$@#*]/,
  /\s/,
  // non-ASCII (emoji, cyrillic look-alikes)
  /[^\x20-\x7e]/,
];

export function classifyToken(
  chain: EvmChainId,
  category: string,
  asset: string | null,
  contract: string | null,
  outgoing: boolean,
  value: number | null,
): { spam: boolean; reason: string | null } {
  // Native ETH/BNB transfers are never spam.
  if (category !== "erc20") return { spam: false, reason: null };

  const sym = (asset ?? "").trim();
  const symUpper = sym.toUpperCase();
  const addr = (contract ?? "").toLowerCase();
  const verified = addr && VERIFIED_CONTRACTS[chain].has(addr);

  // Verified contract = never spam, regardless of symbol.
  if (verified) return { spam: false, reason: null };

  // No contract on an erc20 row shouldn't happen, but if it does, flag it.
  if (!addr) return { spam: true, reason: "missing contract" };

  // Symbol impersonation: claims to be USDC/USDT/etc but contract isn't the real one.
  if (IMPERSONATED_SYMBOLS.has(symUpper)) {
    return { spam: true, reason: `imposter ${symUpper}` };
  }

  // Phishing-looking name/symbol.
  for (const rx of PHISHING_PATTERNS) {
    if (rx.test(sym)) return { spam: true, reason: "phishing symbol" };
  }
  if (sym.length === 0 || sym.length > 12) {
    return { spam: true, reason: "bad symbol length" };
  }

  // Absurd airdrop amounts on unknown contracts are almost always spam.
  if (!outgoing && value != null && value > 1_000_000_000) {
    return { spam: true, reason: "dust airdrop" };
  }

  // Unknown contract, receive-only (never sent to it) → mark spam by default.
  if (!outgoing) return { spam: true, reason: "unknown contract" };

  return { spam: false, reason: null };
}
