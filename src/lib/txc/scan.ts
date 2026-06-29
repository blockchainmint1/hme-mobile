/**
 * Scan an HD account for used addresses and aggregate its balance / UTXOs.
 * Uses the BIP44 gap-limit convention (stop after 20 consecutive unused
 * addresses on each chain) which matches BlueWallet behavior.
 */
import type { BIP32Interface } from "bip32";
import {
  deriveAddress,
  type AddressKind,
  type DerivedAddress,
  type UtxoInput,
} from "./wallet";
import {
  getAddressStats,
  getAddressUtxos,
  getTxHex,
  type MempoolUtxo,
} from "./mempool";

const GAP_LIMIT = 20;

export interface AccountUtxo extends UtxoInput {
  address: string;
}

export interface AccountSnapshot {
  external: DerivedAddress[];
  internal: DerivedAddress[];
  nextReceiveAddress: string;
  nextChangeAddress: string;
  nextChangeIndex: number;
  balanceSats: number;
  utxos: AccountUtxo[];
}

async function scanChain(
  root: BIP32Interface,
  kind: AddressKind,
  change: 0 | 1,
): Promise<{ all: DerivedAddress[]; firstUnusedIndex: number }> {
  const all: DerivedAddress[] = [];
  let firstUnused = 0;
  let gap = 0;
  let i = 0;
  // Keep deriving until we hit GAP_LIMIT consecutive unused addresses.
  while (gap < GAP_LIMIT) {
    const d = deriveAddress(root, kind, change, i);
    all.push(d);
    let used = false;
    try {
      const stats = await getAddressStats(d.address);
      used = stats.chain_stats.tx_count > 0 || stats.mempool_stats.tx_count > 0;
    } catch {
      // Network error — treat as unused to avoid infinite loops; UI will surface the error.
    }
    if (used) {
      firstUnused = i + 1;
      gap = 0;
    } else {
      gap++;
    }
    i++;
  }
  return { all, firstUnusedIndex: firstUnused };
}

export async function scanAccount(
  root: BIP32Interface,
  kind: AddressKind,
): Promise<AccountSnapshot> {
  const [ext, int] = await Promise.all([scanChain(root, kind, 0), scanChain(root, kind, 1)]);

  // Pull UTXOs only from addresses up to firstUnusedIndex on each chain.
  const usedExt = ext.all.slice(0, Math.max(ext.firstUnusedIndex, 1));
  const usedInt = int.all.slice(0, Math.max(int.firstUnusedIndex, 1));

  const utxos: AccountUtxo[] = [];
  let balance = 0;

  const collect = async (addrs: DerivedAddress[]) => {
    for (const d of addrs) {
      let raw: MempoolUtxo[] = [];
      try {
        raw = await getAddressUtxos(d.address);
      } catch {
        continue;
      }
      for (const u of raw) {
        balance += u.value;
        const utxo: AccountUtxo = {
          address: d.address,
          txid: u.txid,
          vout: u.vout,
          value: u.value,
          change: d.change,
          index: d.index,
        };
        // For legacy inputs we need the previous full tx hex; for segwit we
        // only need the scriptPubKey, which we'll fill below.
        if (kind === "bip44") {
          try {
            utxo.nonWitnessUtxoHex = await getTxHex(u.txid);
          } catch {
            // skip this UTXO — cannot sign without prevtx
            balance -= u.value;
            continue;
          }
        }
        utxos.push(utxo);
      }
    }
  };

  await collect(usedExt);
  await collect(usedInt);

  // For segwit inputs we need scriptPubKey for each UTXO's address.
  // mempool.space exposes it on the tx; cheapest is to re-derive from address type.
  if (kind === "bip84" || kind === "bip49") {
    const { payments } = await import("bitcoinjs-lib");
    const { TXC_NETWORK } = await import("./network");
    for (const u of utxos) {
      const d = (u.change === 0 ? ext.all : int.all)[u.index];
      const pubkey = Buffer.from(d.pubkey);
      if (kind === "bip84") {
        const p = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
        u.witnessScriptHex = (p.output as Buffer).toString("hex");
      } else {
        const inner = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
        const p = payments.p2sh({ redeem: inner, network: TXC_NETWORK });
        u.witnessScriptHex = (p.output as Buffer).toString("hex");
      }
    }
  }

  const nextRecvIdx = ext.firstUnusedIndex;
  const nextChangeIdx = int.firstUnusedIndex;
  const nextReceive = deriveAddress(root, kind, 0, nextRecvIdx);
  const nextChange = deriveAddress(root, kind, 1, nextChangeIdx);

  return {
    external: usedExt,
    internal: usedInt,
    nextReceiveAddress: nextReceive.address,
    nextChangeAddress: nextChange.address,
    nextChangeIndex: nextChangeIdx,
    balanceSats: balance,
    utxos,
  };
}
