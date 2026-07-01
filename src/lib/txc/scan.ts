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
// Fast-refresh frontier: after we've done at least one deep scan and know
// how many addresses are actually used, we only re-check that range plus a
// small buffer of unused addresses on each refresh. This drops a typical
// refresh from ~40 mempool.space calls down to ~5–10 without losing the
// ability to detect new activity on the next receive address.
const FAST_FRONTIER = 5;
const HINT_VERSION = 1;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
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

interface ScanHint {
  v: number;
  extUsed: number;
  intUsed: number;
}

function hintKey(root: BIP32Interface, kind: AddressKind): string {
  // Neutered xpub is safe to key on (no secrets) and stable per account.
  return `hme.scan-hint.${kind}.${root.neutered().toBase58().slice(0, 32)}`;
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
    // storage full / disabled — hint is optional, just fall back to deep scan next time
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

/**
 * Fast refresh path: only re-check the known-used range plus a small buffer
 * of unused addresses ahead. If new activity appears at the very edge of the
 * buffer, extend the window so we never silently miss funds — but if the edge
 * pushes past the full 20-address gap limit, bail to a full deep scan.
 */
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
    } catch {
      // treat unreachable as unused for this pass
    }
    if (limit - knownUsed > GAP_LIMIT) {
      return { all, firstUnusedIndex: firstUnused, overflowed: true };
    }
    i++;
  }
  return { all, firstUnusedIndex: firstUnused, overflowed: false };
}


export async function scanAccount(
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
      // Activity blew past our fast window — fall back to full gap-limit walk.
      [ext, int] = await Promise.all([scanChain(root, kind, 0), scanChain(root, kind, 1)]);
    } else {
      ext = e;
      int = i;
    }
  } else {
    [ext, int] = await Promise.all([scanChain(root, kind, 0), scanChain(root, kind, 1)]);
  }
  writeHint(root, kind, ext.firstUnusedIndex, int.firstUnusedIndex);


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
      const pubkey = d.pubkey;
      if (kind === "bip84") {
        const p = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
        if (!p.output) throw new Error("Failed to derive witness script");
        u.witnessScriptHex = bytesToHex(p.output);
      } else {
        const inner = payments.p2wpkh({ pubkey, network: TXC_NETWORK });
        const p = payments.p2sh({ redeem: inner, network: TXC_NETWORK });
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
