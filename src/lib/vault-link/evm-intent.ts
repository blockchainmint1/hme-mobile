/**
 * EVM signing intents for Vault (format "hm-evm-tx", v1).
 *
 * Vault accepts ONLY native transfers and ERC-20 transfers — no arbitrary
 * calldata, approvals, or message signing. All amounts/fees are canonical
 * unsigned decimal strings. See Vault's docs/offline-signing-handoff.md.
 */
import type { VaultPairing } from "./pairing";

export interface EvmNativeIntent {
  format: "hm-evm-tx";
  v: 1;
  kind: "native-transfer";
  fp: string;
  path: string;
  chainId: number;
  from: string;
  to: string;
  value: string;
  nonce: number;
  gas: string;
  type: "eip1559" | "legacy";
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export interface EvmErc20Intent {
  format: "hm-evm-tx";
  v: 1;
  kind: "erc20-transfer";
  fp: string;
  path: string;
  chainId: number;
  from: string;
  to: string;
  token: string;
  amount: string;
  nonce: number;
  gas: string;
  type: "eip1559" | "legacy";
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  gasPrice?: string;
}

export type EvmIntent = EvmNativeIntent | EvmErc20Intent;

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const DEC = /^(0|[1-9]\d*)$/;

function checkCommon(i: EvmIntent): void {
  if (!ADDR.test(i.from) || !ADDR.test(i.to)) throw new Error("Invalid EVM address.");
  if (!ADDR.test(i.from) || /^0x0{40}$/i.test(i.to)) throw new Error("Invalid recipient address.");
  if (!Number.isInteger(i.chainId) || i.chainId < 1 || !Number.isSafeInteger(i.chainId))
    throw new Error("Invalid chain id.");
  if (!Number.isInteger(i.nonce) || i.nonce < 0 || i.nonce > 0xffffffff) throw new Error("Invalid nonce.");
  const gas = BigInt(i.gas);
  if (gas < 21_000n || gas > 100_000_000n) throw new Error("Invalid gas limit.");
  if (i.type === "eip1559") {
    if (!i.maxFeePerGas || !i.maxPriorityFeePerGas || !DEC.test(i.maxFeePerGas) || !DEC.test(i.maxPriorityFeePerGas))
      throw new Error("Invalid EIP-1559 fee fields.");
  } else {
    if (!i.gasPrice || !DEC.test(i.gasPrice)) throw new Error("Invalid gas price.");
  }
}

/** Build + validate a native-transfer intent. Returns the JSON string for the QR. */
export function buildNativeIntent(args: {
  pairing: VaultPairing;
  chainId: number;
  to: string;
  valueWei: bigint;
  nonce: number;
  gas: bigint;
  fees: { type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { type: "legacy"; gasPrice: bigint };
}): string {
  const evm = args.pairing.evm;
  if (!evm) throw new Error("This Vault pairing has no Ethereum key.");
  if (args.valueWei <= 0n) throw new Error("Amount must be positive.");
  const base = {
    format: "hm-evm-tx" as const,
    v: 1 as const,
    kind: "native-transfer" as const,
    fp: args.pairing.fp,
    path: evm.path,
    chainId: args.chainId,
    from: evm.address,
    to: args.to,
    value: args.valueWei.toString(),
    nonce: args.nonce,
    gas: args.gas.toString(),
  };
  const intent: EvmNativeIntent =
    args.fees.type === "eip1559"
      ? { ...base, type: "eip1559", maxFeePerGas: args.fees.maxFeePerGas.toString(), maxPriorityFeePerGas: args.fees.maxPriorityFeePerGas.toString() }
      : { ...base, type: "legacy", gasPrice: args.fees.gasPrice.toString() };
  checkCommon(intent);
  const json = JSON.stringify(intent);
  if (json.length > 8192) throw new Error("Intent too large.");
  return json;
}

/** Build + validate an ERC-20 transfer intent. */
export function buildErc20Intent(args: {
  pairing: VaultPairing;
  chainId: number;
  token: string;
  to: string;
  amountRaw: bigint;
  nonce: number;
  gas: bigint;
  fees: { type: "eip1559"; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } | { type: "legacy"; gasPrice: bigint };
}): string {
  const evm = args.pairing.evm;
  if (!evm) throw new Error("This Vault pairing has no Ethereum key.");
  if (args.amountRaw <= 0n) throw new Error("Amount must be positive.");
  if (!ADDR.test(args.token) || /^0x0{40}$/i.test(args.token)) throw new Error("Invalid token contract.");
  const base = {
    format: "hm-evm-tx" as const,
    v: 1 as const,
    kind: "erc20-transfer" as const,
    fp: args.pairing.fp,
    path: evm.path,
    chainId: args.chainId,
    from: evm.address,
    to: args.to,
    token: args.token,
    amount: args.amountRaw.toString(),
    nonce: args.nonce,
    gas: args.gas.toString(),
  };
  const intent: EvmErc20Intent =
    args.fees.type === "eip1559"
      ? { ...base, type: "eip1559", maxFeePerGas: args.fees.maxFeePerGas.toString(), maxPriorityFeePerGas: args.fees.maxPriorityFeePerGas.toString() }
      : { ...base, type: "legacy", gasPrice: args.fees.gasPrice.toString() };
  checkCommon(intent);
  const json = JSON.stringify(intent);
  if (json.length > 8192) throw new Error("Intent too large.");
  return json;
}
