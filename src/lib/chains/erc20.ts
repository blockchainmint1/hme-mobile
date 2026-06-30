/**
 * Minimal ERC20 helpers — currently only USDC across the three EVM chains
 * we support. Decimals are hard-coded per chain (USDC is 6 on Ethereum/Base,
 * 18 on BSC — easy gotcha) so we never accidentally truncate or 1e12 a
 * decimal.
 */
import { encodeFunctionData, erc20Abi, parseUnits, formatUnits, type Address } from "viem";
import { evmClient, type EvmChainId } from "./evm";

export interface Erc20TokenMeta {
  symbol: string;
  address: Address;
  decimals: number;
}

/** Canonical USDC contracts. Decimals vary by chain — see header note. */
export const USDC_BY_CHAIN: Record<EvmChainId, Erc20TokenMeta> = {
  eth: {
    symbol: "USDC",
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6,
  },
  base: {
    symbol: "USDC",
    address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals: 6,
  },
  bsc: {
    symbol: "USDC",
    address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    decimals: 18,
  },
};

/** Read an ERC20 balance. Returns the raw integer (units of `decimals`). */
export async function readErc20Balance(
  chain: EvmChainId,
  token: Erc20TokenMeta,
  owner: Address,
): Promise<bigint> {
  const client = evmClient(chain);
  return client.readContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [owner],
  });
}

/** Encode `transfer(to, amount)` call data. */
export function encodeTransfer(to: Address, amount: bigint): `0x${string}` {
  return encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [to, amount],
  });
}

/** Convert a decimal string (e.g. "9.000123") to raw token units. */
export function tokenAmountToRaw(amount: string | number, decimals: number): bigint {
  return parseUnits(String(amount), decimals);
}

/** Pretty-print a raw token amount as a decimal string. */
export function tokenAmountFromRaw(raw: bigint, decimals: number): string {
  return formatUnits(raw, decimals);
}
