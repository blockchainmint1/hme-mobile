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
import { deriveVaultAddress, VAULT_CHAIN_META, type VaultAddress } from "./derive";
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
  /** Every address on this branch that has ever had activity (receive + change). */
  used: VaultAddress[];
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
  const used: VaultAddress[] = [];
  let balanceSats = 0;
  let scanned = 0;
  let nextReceive = "";
  let nextReceiveIndex = 0;

  // Check addresses in parallel windows of GAP_LIMIT instead of one at a
  // time — same gap-limit result, a few round trips instead of 40+.
  const scanBranch = async (change: 0 | 1) => {
    const hits: { derived: VaultAddress; index: number; addrUtxos: { txid: string; vout: number; value: number }[]; bal: number }[] = [];
    let firstUnused = -1;
    let lastUsed = -1;
    let start = 0;
    let count = 0;
    while (true) {
      const window = Array.from({ length: GAP_LIMIT }, (_, k) => start + k);
      const results = await Promise.all(
        window.map(async (index) => {
          const derived = deriveVaultAddress(pairing, chain, purpose, change, index);
          try {
            const stats = await io.stats(derived.address);
            return { index, derived, stats };
          } catch {
            return { index, derived, stats: null };
          }
        }),
      );
      for (const r of results) {
        if (r.stats) count++;
        const txCount = r.stats ? r.stats.chain_stats.tx_count + r.stats.mempool_stats.tx_count : 0;
        if (txCount === 0) {
          if (firstUnused < 0) firstUnused = r.index;
          continue;
        }
        lastUsed = r.index;
        const s = r.stats!;
        const bal =
          s.chain_stats.funded_txo_sum - s.chain_stats.spent_txo_sum +
          s.mempool_stats.funded_txo_sum - s.mempool_stats.spent_txo_sum;
        hits.push({ derived: r.derived, index: r.index, addrUtxos: [], bal });
      }
      start += GAP_LIMIT;
      if (start - 1 - lastUsed >= GAP_LIMIT) break;
    }
    await Promise.all(
      hits.map(async (h) => {
        try { h.addrUtxos = await io.utxos(h.derived.address); } catch { /* send re-checks */ }
      }),
    );
    return { hits, firstUnused: firstUnused < 0 ? start : firstUnused, count };
  };

  const branches = await Promise.all([scanBranch(0), scanBranch(1)]);
  branches.forEach((b, change) => {
    scanned += b.count;
    if (change === 0) {
      nextReceiveIndex = b.firstUnused;
      nextReceive = deriveVaultAddress(pairing, chain, purpose, 0, b.firstUnused).address;
    }
    for (const h of b.hits.sort((a, c) => a.index - c.index)) {
      used.push(h.derived);
      balanceSats += h.bal;
      for (const u of h.addrUtxos) {
        utxos.push({
          txid: u.txid, vout: u.vout, value: u.value, purpose,
          change: change as 0 | 1, index: h.index, path: h.derived.path,
          address: h.derived.address, pubkey: h.derived.pubkey,
        });
      }
    }
  });

  if (!nextReceive) {
    const derived = deriveVaultAddress(pairing, chain, purpose, 0, nextReceiveIndex);
    nextReceive = derived.address;
  }

  return { chain, purpose, balanceSats, nextReceive, nextReceiveIndex, utxos, used, scanned };
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
