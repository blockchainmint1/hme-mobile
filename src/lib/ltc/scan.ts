/**
 * LTC HD-account scan. Structurally identical to src/lib/isk/scan.ts —
 * BIP44 gap-limit (20) with a small persisted hint so refreshes are cheap
 * after the first deep scan.
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
const FAST_FRONTIER = 5;
const HINT_VERSION = 1;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface AccountUtxo extends UtxoInput {
  address: string;
}

export interface AccountSnapshot {
  external: DerivedAddress[];
  internal: DerivedAddress[];
  nextReceiveAddress: string;
  nextReceiveIndex: number;
  nextChangeAddress: string;
  nextChangeIndex: number;
  balanceSats: number;
  utxos: AccountUtxo[];
}

interface ScanHint { v: number; extUsed: number; intUsed: number }

function hintKey(root: BIP32Interface, kind: AddressKind): string {
  return `hme.ltc.scan-hint.${kind}.${root.neutered().toBase58().slice(0, 32)}`;
}

function readHint(root: BIP32Interface, kind: AddressKind): ScanHint | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(hintKey(root, kind));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ScanHint;
    if (parsed?.v !== HINT_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeHint(root: BIP32Interface, kind: AddressKind, extUsed: number, intUsed: number): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      hintKey(root, kind),
      JSON.stringify({ v: HINT_VERSION, extUsed, intUsed } satisfies ScanHint),
    );
  } catch {
    /* ignore */
  }
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
  while (gap < GAP_LIMIT) {
    const d = deriveAddress(root, kind, change, i);
    all.push(d);
    let used = false;
    try {
      const stats = await getAddressStats(d.address);
      used = stats.chain_stats.tx_count > 0 || stats.mempool_stats.tx_count > 0;
    } catch { /* treat as unused */ }
    if (used) { firstUnused = i + 1; gap = 0; } else { gap++; }
    i++;
  }
  return { all, firstUnusedIndex: firstUnused };
}

async function scanChainFast(
  root: BIP32Interface,
  kind: AddressKind,
  change: 0 | 1,
  knownUsed: number,
): Promise<{ all: DerivedAddress[]; firstUnusedIndex: number; overflowed: boolean }> {
  const all: DerivedAddress[] = [];
  let firstUnused = 0;
  let limit = knownUsed + FAST_FRONTIER;
  let i = 0;
  while (i < limit) {
    const d = deriveAddress(root, kind, change, i);
    all.push(d);
    try {
      const stats = await getAddressStats(d.address);
      if (stats.chain_stats.tx_count > 0 || stats.mempool_stats.tx_count > 0) {
        firstUnused = i + 1;
        limit = Math.max(limit, i + 1 + FAST_FRONTIER);
      }
    } catch { /* ignore */ }
    if (limit - knownUsed > GAP_LIMIT) return { all, firstUnusedIndex: firstUnused, overflowed: true };
    i++;
  }
  return { all, firstUnusedIndex: firstUnused, overflowed: false };
}

export async function scanLtcAccount(
  root: BIP32Interface,
  kind: AddressKind,
  opts?: { deep?: boolean },
): Promise<AccountSnapshot> {
  const hint = opts?.deep ? null : readHint(root, kind);
  let ext: { all: DerivedAddress[]; firstUnusedIndex: number };
  let int: { all: DerivedAddress[]; firstUnusedIndex: number };
  if (hint) {
    const [e, i] = await Promise.all([
      scanChainFast(root, kind, 0, hint.extUsed),
      scanChainFast(root, kind, 1, hint.intUsed),
    ]);
    if (e.overflowed || i.overflowed) {
      [ext, int] = await Promise.all([scanChain(root, kind, 0), scanChain(root, kind, 1)]);
    } else {
      ext = e; int = i;
    }
  } else {
    [ext, int] = await Promise.all([scanChain(root, kind, 0), scanChain(root, kind, 1)]);
  }
  writeHint(root, kind, ext.firstUnusedIndex, int.firstUnusedIndex);

  const usedExt = ext.all.slice(0, Math.max(ext.firstUnusedIndex, 1));
  const usedInt = int.all.slice(0, Math.max(int.firstUnusedIndex, 1));

  const utxos: AccountUtxo[] = [];
  let balance = 0;

  const collect = async (addrs: DerivedAddress[]) => {
    for (const d of addrs) {
      let raw: MempoolUtxo[] = [];
      try { raw = await getAddressUtxos(d.address); } catch { continue; }
      for (const u of raw) {
        balance += u.value;
        const utxo: AccountUtxo = {
          address: d.address,
          txid: u.txid, vout: u.vout, value: u.value,
          change: d.change, index: d.index,
        };
        if (kind === "bip44") {
          try { utxo.nonWitnessUtxoHex = await getTxHex(u.txid); }
          catch { balance -= u.value; continue; }
        }
        utxos.push(utxo);
      }
    }
  };

  await collect(usedExt);
  await collect(usedInt);

  if (kind === "bip84" || kind === "bip49") {
    const { payments } = await import("bitcoinjs-lib");
    const { LTC_NETWORK } = await import("./network");
    for (const u of utxos) {
      const d = (u.change === 0 ? ext.all : int.all)[u.index];
      const pubkey = d.pubkey;
      if (kind === "bip84") {
        const p = payments.p2wpkh({ pubkey, network: LTC_NETWORK });
        if (!p.output) throw new Error("Failed to derive witness script");
        u.witnessScriptHex = bytesToHex(p.output);
      } else {
        const inner = payments.p2wpkh({ pubkey, network: LTC_NETWORK });
        const p = payments.p2sh({ redeem: inner, network: LTC_NETWORK });
        if (!p.output) throw new Error("Failed to derive witness script");
        u.witnessScriptHex = bytesToHex(p.output);
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
    nextReceiveIndex: nextRecvIdx,
    nextChangeAddress: nextChange.address,
    nextChangeIndex: nextChangeIdx,
    balanceSats: balance,
    utxos,
  };
}
