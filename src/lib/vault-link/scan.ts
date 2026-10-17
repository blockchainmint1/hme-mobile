/**
 * Balance / UTXO scanning for Vault-paired profiles.
 *
 * Everything is derived from the paired account xpubs (watch-only). For each
 * paired chain + address type we walk the receive chain with a gap limit of
 * 20 unused addresses, same convention as the seed-wallet scans. Change
 * addresses are discovered lazily: any UTXO/address found on the change
 * chain is tracked when it appears in a transaction we can see.
 */
import * as txcMempool from "@/lib/txc/mempool";
import * as iskMempool from "@/lib/isk/mempool";
import * as btcMempool from "@/lib/btc/mempool";
import * as ltcMempool from "@/lib/ltc/mempool";
import * as dogeMempool from "@/lib/doge/mempool";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing, VaultUtxoChain } from "./pairing";

const GAP_LIMIT = 20;

interface ChainIo {
  stats: (address: string) => Promise<{
    chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
    mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  }>;
  utxos: (address: string) => Promise<{ txid: string; vout: number; value: number }[]>;
  txHex: (txid: string) => Promise<string>;
  broadcast: (hex: string) => Promise<string>;
}

const IO: Record<VaultUtxoChain, ChainIo> = {
  txc: { stats: txcMempool.getAddressStats, utxos: txcMempool.getAddressUtxos, txHex: txcMempool.getTxHexCached, broadcast: txcMempool.broadcastTx },
  isk: { stats: iskMempool.getAddressStats, utxos: iskMempool.getAddressUtxos, txHex: iskMempool.getTxHex, broadcast: iskMempool.broadcastTx },
  btc: { stats: btcMempool.getAddressStats, utxos: btcMempool.getAddressUtxos, txHex: btcMempool.getTxHex, broadcast: btcMempool.broadcastTx },
  ltc: { stats: ltcMempool.getAddressStats, utxos: ltcMempool.getAddressUtxos, txHex: ltcMempool.getTxHex, broadcast: ltcMempool.broadcastTx },
  doge: { stats: dogeMempool.getAddressStats, utxos: dogeMempool.getAddressUtxos, txHex: dogeMempool.getTxHex, broadcast: dogeMempool.broadcastTx },
};

export interface VaultUtxo {
  txid: string;
  vout: number;
  value: number; // sats
  purpose: 44 | 49 | 84;
  change: 0 | 1;
  index: number;
  path: string;
  address: string;
  pubkey: Uint8Array;
}

export interface VaultChainScan {
  chain: VaultUtxoChain;
  purpose: 44 | 49 | 84;
  balanceSats: number;
  /** First unused receive address — what Receive shows. */
  nextReceive: string;
  nextReceiveIndex: number;
  utxos: VaultUtxo[];
  /** Total addresses checked (used + gap). */
  scanned: number;
}

/**
 * Scan one chain/purpose branch. Change chain (1) is scanned with the same
 * gap limit so change outputs from previous sends are found.
 */
export async function scanVaultChain(
  pairing: VaultPairing,
  chain: VaultUtxoChain,
  purpose: 44 | 49 | 84,
): Promise<VaultChainScan> {
  const io = IO[chain];
  const utxos: VaultUtxo[] = [];
  let balanceSats = 0;
  let scanned = 0;
  let nextReceive = "";
  let nextReceiveIndex = 0;

  for (const change of [0, 1] as const) {
    let gap = 0;
    let index = 0;
    while (gap < GAP_LIMIT) {
      const derived = deriveVaultAddress(pairing, chain, purpose, change, index);
      let stats;
      try {
        stats = await io.stats(derived.address);
      } catch {
        // A failed lookup must not abort the whole scan — treat as unused.
        gap++;
        index++;
        continue;
      }
      scanned++;
      const txCount = stats.chain_stats.tx_count + stats.mempool_stats.tx_count;
      if (txCount === 0) {
        gap++;
        if (change === 0 && !nextReceive) {
          nextReceive = derived.address;
          nextReceiveIndex = index;
        }
        index++;
        continue;
      }
      gap = 0;
      balanceSats +=
        stats.chain_stats.funded_txo_sum -
        stats.chain_stats.spent_txo_sum +
        stats.mempool_stats.funded_txo_sum -
        stats.mempool_stats.spent_txo_sum;
      try {
        const addrUtxos = await io.utxos(derived.address);
        for (const u of addrUtxos) {
          utxos.push({
            txid: u.txid,
            vout: u.vout,
            value: u.value,
            purpose,
            change,
            index,
            path: derived.path,
            address: derived.address,
            pubkey: derived.pubkey,
          });
        }
      } catch {
        /* UTXO fetch failure — balance still shown, send will re-check */
      }
      index++;
    }
  }

  if (!nextReceive) {
    const derived = deriveVaultAddress(pairing, chain, purpose, 0, nextReceiveIndex);
    nextReceive = derived.address;
  }

  return { chain, purpose, balanceSats, nextReceive, nextReceiveIndex, utxos, scanned };
}

/** Every paired chain/purpose branch, scanned in parallel. */
export async function scanVaultWallet(pairing: VaultPairing): Promise<VaultChainScan[]> {
  const jobs: Promise<VaultChainScan>[] = [];
  for (const chain of Object.keys(pairing.chains) as VaultUtxoChain[]) {
    for (const purpose of VAULT_CHAIN_META[chain].purposes) {
      if (pairing.chains[chain]?.[String(purpose) as "44" | "49" | "84"]) {
        jobs.push(scanVaultChain(pairing, chain, purpose));
      }
    }
  }
  return Promise.all(jobs);
}

export function chainIo(chain: VaultUtxoChain): ChainIo {
  return IO[chain];
}
