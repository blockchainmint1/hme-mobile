/**
 * Client-safe types + config for the Tron → EVM stablecoin bridge.
 *
 * We use Relay Protocol (api.relay.link) rather than THORChain: for Tron
 * stablecoins Relay is an intent/solver network, so the cost is a small
 * relayer fee (~0.1–0.2%) instead of THORChain's slip + outbound fee, and
 * it supports Tron as a first-class origin chain.
 *
 * Flow: quote (server-side) → sign 1–2 Tron TriggerSmartContract txs on
 * device → poll Relay for the fill on the destination chain.
 */

/** Relay's chain id for Tron. */
export const RELAY_TRON_CHAIN_ID = 728126428;

export interface BridgeSource {
  symbol: string;
  name: string;
  /** Base58 TRC-20 contract on Tron. */
  contract: string;
  decimals: number;
}

export const BRIDGE_SOURCES: BridgeSource[] = [
  { symbol: "USDT", name: "Tether USD", contract: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", decimals: 6 },
  { symbol: "USDC", name: "USD Coin", contract: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", decimals: 6 },
];

export interface BridgeDestination {
  /** Stable key used in the picker. */
  id: string;
  label: string;
  chainId: number;
  /** Our internal EVM chain key, for explorer links. */
  chainKey: "eth" | "base" | "bsc";
  symbol: string;
  address: string;
  decimals: number;
}

export const BRIDGE_DESTINATIONS: BridgeDestination[] = [
  {
    id: "base-usdc",
    label: "USDC on Base",
    chainId: 8453,
    chainKey: "base",
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  {
    id: "eth-usdc",
    label: "USDC on Ethereum",
    chainId: 1,
    chainKey: "eth",
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  {
    id: "eth-usdt",
    label: "USDT on Ethereum",
    chainId: 1,
    chainKey: "eth",
    symbol: "USDT",
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6,
  },
  {
    id: "bsc-usdt",
    label: "USDT on BNB Chain",
    chainId: 56,
    chainKey: "bsc",
    symbol: "USDT",
    address: "0x55d398326f99059fF775485246999027B3197955",
    decimals: 18,
  },
];

/** One on-chain action the user must sign on Tron. */
export interface BridgeStep {
  id: string;
  description: string;
  /** Hex (41…) contract address to call. */
  contractHex: string;
  /** Raw call data, hex, no 0x prefix. */
  data: string;
  callValue: number;
}

export interface BridgeQuote {
  requestId: string;
  steps: BridgeStep[];
  /** Raw base units in / out. */
  amountIn: string;
  amountOut: string;
  amountOutMin: string;
  amountInUsd: string | null;
  amountOutUsd: string | null;
  /** Total relayer fee in the source token's base units. */
  relayerFee: string;
  /** Estimated TRX burned for energy/bandwidth, in sun. */
  tronGasSun: string;
  /** Seconds, Relay's estimate. */
  etaSeconds: number | null;
  impactPercent: string | null;
}

export type BridgeStatus = {
  status: "pending" | "success" | "failure" | "refund" | "unknown";
  destinationTxHash: string | null;
  originTxHash: string | null;
  details: string | null;
};

export function formatUnitsStr(raw: string | bigint, decimals: number, maxFrac = 6): string {
  const n = Number(BigInt(raw)) / 10 ** decimals;
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
