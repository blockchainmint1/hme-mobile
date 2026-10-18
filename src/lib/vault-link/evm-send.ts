import { encodeFunctionData, erc20Abi, parseEther, parseUnits, parseTransaction, recoverTransactionAddress, type Address, type Hex } from "viem";
import type { BIP32Interface } from "bip32";
import { deriveEvmAccount, evmClient, EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import type { Erc20TokenMeta } from "@/lib/chains/erc20";
import { buildErc20Intent, buildNativeIntent, type EvmIntent } from "./evm-intent";
import type { VaultPairing } from "./pairing";

/** Never derive an account from the random wrapping anchor of a Vault profile. */
export function evmSourceAddress(mode: string | undefined, root: BIP32Interface | null, pairing: VaultPairing | null): Address | null {
  if (mode === "vault") return pairing?.evm?.address as Address | undefined ?? null;
  if (mode === "keyonly" || !root) return null;
  return deriveEvmAccount(root).address;
}

export function intentTransaction(intent: EvmIntent) {
  return {
    to: (intent.kind === "erc20-transfer" ? intent.token : intent.to) as Address,
    value: intent.kind === "native-transfer" ? BigInt(intent.value) : 0n,
    data: intent.kind === "erc20-transfer"
      ? encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [intent.to as Address, BigInt(intent.amount)] })
      : "0x" as Hex,
  };
}

export async function prepareVaultEvmSend(pairing: VaultPairing, chain: EvmChainId, to: Address, amount: string, token?: Erc20TokenMeta): Promise<string> {
  const evm = pairing.evm;
  if (!evm) throw new Error("Pair this Vault's Ethereum address before sending.");
  const decimals = token?.decimals ?? 18;
  if (!/^\d+(\.\d+)?$/.test(amount) || (amount.split(".")[1]?.length ?? 0) > decimals)
    throw new Error(`Enter an amount with no more than ${decimals} decimal places.`);
  const raw = token ? parseUnits(amount, decimals) : parseEther(amount);
  if (raw <= 0n) throw new Error("Enter an amount greater than zero.");
  const pub = evmClient(chain);
  const from = evm.address as Address;
  const transaction = token
    ? { to: token.address, value: 0n, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [to, raw] }) }
    : { to, value: raw };
  const [nonce, estimate, feeEstimate, nativeBalance, tokenBalance] = await Promise.all([
    pub.getTransactionCount({ address: from, blockTag: "pending" }),
    pub.estimateGas({ account: from, ...transaction }),
    pub.estimateFeesPerGas(),
    pub.getBalance({ address: from }),
    token ? pub.readContract({ address: token.address, abi: erc20Abi, functionName: "balanceOf", args: [from] }) : Promise.resolve(null),
  ]);
  const gas = (estimate * 120n + 99n) / 100n;
  const fees = feeEstimate.maxFeePerGas != null
    ? { type: "eip1559" as const, maxFeePerGas: feeEstimate.maxFeePerGas * 2n, maxPriorityFeePerGas: feeEstimate.maxPriorityFeePerGas ?? 0n }
    : { type: "legacy" as const, gasPrice: feeEstimate.gasPrice ?? await pub.getGasPrice() };
  const maxGasPrice = fees.type === "eip1559" ? fees.maxFeePerGas : fees.gasPrice;
  if (tokenBalance != null && raw > tokenBalance) throw new Error(`Not enough ${token?.symbol} for this payment.`);
  if (nativeBalance < transaction.value + gas * maxGasPrice) throw new Error(`Not enough ${EVM_CHAINS[chain].nativeSymbol} for this payment and its network fee.`);
  const common = { pairing, chainId: EVM_CHAINS[chain].viemChain.id, to, nonce, gas, fees };
  return token ? buildErc20Intent({ ...common, token: token.address, amountRaw: raw }) : buildNativeIntent({ ...common, valueWei: raw });
}

/** A scanned signature must authorize exactly the request shown to Vault. */
export async function verifyVaultEvmSend(serialized: Hex, intent: EvmIntent): Promise<void> {
  const tx = parseTransaction(serialized);
  const from = await recoverTransactionAddress({ serializedTransaction: serialized });
  const expected = intentTransaction(intent);
  const same = (a: string | undefined, b: string) => a?.toLowerCase() === b.toLowerCase();
  if (!same(from, intent.from) || tx.chainId !== intent.chainId || tx.nonce !== intent.nonce ||
      !same(tx.to ?? undefined, expected.to) || (tx.value ?? 0n) !== expected.value ||
      !same(tx.data ?? "0x", expected.data) || tx.gas !== BigInt(intent.gas) || tx.type !== intent.type)
    throw new Error("The signed transaction does not match this Vault payment. Nothing was broadcast.");
  if (intent.type === "eip1559") {
    if (tx.maxFeePerGas !== BigInt(intent.maxFeePerGas ?? "0") || tx.maxPriorityFeePerGas !== BigInt(intent.maxPriorityFeePerGas ?? "0"))
      throw new Error("The signed network fee differs from the Vault request.");
  } else if (tx.gasPrice !== BigInt(intent.gasPrice ?? "0")) throw new Error("The signed network fee differs from the Vault request.");
  if (tx.accessList?.length || ("authorizationList" in tx && tx.authorizationList?.length))
    throw new Error("Unexpected permissions in the signed transaction.");
}