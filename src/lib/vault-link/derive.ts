/**
 * Address derivation from Vault account xpubs.
 *
 * Vault exports account-level xpubs (m/<purpose>'/<coin>'/0') with standard
 * xpub version bytes on every coin. We derive /change/index from the neutered
 * key and apply each chain's own address encoding. No private key material is
 * ever involved — these nodes are already neutered.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory, type BIP32Interface } from "bip32";
import { payments, type Network } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { ISK_NETWORK } from "@/lib/isk/network";
import { BTC_NETWORK } from "@/lib/btc/network";
import { LTC_NETWORK } from "@/lib/ltc/network";
import { DOGE_NETWORK } from "@/lib/doge/network";
import type { VaultPairing, VaultUtxoChain } from "./pairing";

const bip32 = BIP32Factory(ecc);

export interface VaultChainMeta {
  id: VaultUtxoChain;
  name: string;
  unit: string;
  coinType: number;
  network: Network;
  purposes: Array<44 | 49 | 84>;
}

export const VAULT_CHAIN_META: Record<VaultUtxoChain, VaultChainMeta> = {
  txc: { id: "txc", name: "TEXITcoin", unit: "TXC", coinType: 696969, network: TXC_NETWORK, purposes: [44, 49, 84] },
  isk: { id: "isk", name: "IskanderCoin", unit: "ISK", coinType: 969696, network: ISK_NETWORK, purposes: [44, 49, 84] },
  btc: { id: "btc", name: "Bitcoin", unit: "BTC", coinType: 0, network: BTC_NETWORK, purposes: [44, 49, 84] },
  ltc: { id: "ltc", name: "Litecoin", unit: "LTC", coinType: 2, network: LTC_NETWORK, purposes: [44, 49, 84] },
  doge: { id: "doge", name: "Dogecoin", unit: "DOGE", coinType: 3, network: DOGE_NETWORK, purposes: [44] },
};

/** Parse an account xpub. TXC network carries the standard xpub version bytes. */
function accountNode(xpub: string): BIP32Interface {
  return bip32.fromBase58(xpub, TXC_NETWORK).neutered();
}

export interface VaultAddress {
  chain: VaultUtxoChain;
  purpose: 44 | 49 | 84;
  change: 0 | 1;
  index: number;
  /** Full BIP32 path, e.g. m/84'/696969'/0'/0/3 — Vault checks this when signing. */
  path: string;
  address: string;
  pubkey: Uint8Array;
}

function encodeAddress(pubkey: Uint8Array, purpose: 44 | 49 | 84, network: Network): string {
  if (purpose === 84) {
    const p = payments.p2wpkh({ pubkey, network });
    if (!p.address) throw new Error("Failed to derive bech32 address");
    return p.address;
  }
  if (purpose === 49) {
    const inner = payments.p2wpkh({ pubkey, network });
    const p = payments.p2sh({ redeem: inner, network });
    if (!p.address) throw new Error("Failed to derive wrapped-segwit address");
    return p.address;
  }
  const p = payments.p2pkh({ pubkey, network });
  if (!p.address) throw new Error("Failed to derive legacy address");
  return p.address;
}

/** Derive one address from a pairing. Throws if the chain/purpose isn't paired. */
export function deriveVaultAddress(
  pairing: VaultPairing,
  chain: VaultUtxoChain,
  purpose: 44 | 49 | 84,
  change: 0 | 1,
  index: number,
): VaultAddress {
  const xpub = pairing.chains[chain]?.[String(purpose) as "44" | "49" | "84"];
  if (!xpub) throw new Error(`This Vault pairing has no ${chain.toUpperCase()} key for that address type.`);
  const meta = VAULT_CHAIN_META[chain];
  const node = accountNode(xpub).derive(change).derive(index);
  return {
    chain,
    purpose,
    change,
    index,
    path: `m/${purpose}'/${meta.coinType}'/0'/${change}/${index}`,
    address: encodeAddress(node.publicKey, purpose, meta.network),
    pubkey: node.publicKey,
  };
}

/** First receive address per paired chain/purpose — shown for confirmation during pairing. */
export function pairingPreviewAddresses(pairing: VaultPairing): { chain: VaultUtxoChain; purpose: 44 | 49 | 84; address: string }[] {
  const out: { chain: VaultUtxoChain; purpose: 44 | 49 | 84; address: string }[] = [];
  for (const chain of Object.keys(pairing.chains) as VaultUtxoChain[]) {
    for (const purpose of VAULT_CHAIN_META[chain].purposes) {
      if (!pairing.chains[chain]?.[String(purpose) as "44" | "49" | "84"]) continue;
      out.push({ chain, purpose, address: deriveVaultAddress(pairing, chain, purpose, 0, 0).address });
    }
  }
  return out;
}
