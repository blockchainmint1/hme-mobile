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
import { ALL_DERIVATION_KINDS, scriptKindOf } from "./network";
import {
  getAddressStats,
  getAddressUtxos,
  getOutspend,
  getTxHexCached,
  type MempoolUtxo,
} from "./mempool";
import {
  outpointKey,
  releaseOutpoints,
  reservedEntries,
  VERIFY_AFTER_MS,
} from "./spent-outpoints";


const GAP_LIMIT = 20;
// Fast-refresh frontier: after we've done at least one deep scan and know
// how many addresses are actually used, we only re-check that range plus a
// small buffer of unused addresses on each refresh. This drops a typical
// refresh from ~40 mempool.space calls down to ~5–10 without losing the
// ability to detect new activity on the next receive address.
const FAST_FRONTIER = 5;
// How many receive addresses to probe on a *secondary* derivation branch
// before concluding it has never been used. Index 0 alone is not enough —
// funds can land at any index within the gap window.
const PROBE_WINDOW = 10;
const HINT_VERSION = 1;


function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AccountUtxo extends UtxoInput {
  address: string;
}

export interface AccountSnapshot {
  /** Per-derivation-path breakdown (only paths with activity are listed). */
  branches?: { kind: AddressKind; balanceSats: number; usedAddresses: number }[];
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

/** How many address lookups we allow in flight at once. */
const BATCH = 8;

async function isUsed(address: string): Promise<boolean> {
  try {
    const stats = await getAddressStats(address);
    return stats.chain_stats.tx_count > 0 || stats.mempool_stats.tx_count > 0;
  } catch {
    // Network error — treat as unused to avoid infinite loops; UI surfaces the error.
    return false;
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
  // Keep deriving until we hit GAP_LIMIT consecutive unused addresses, but
  // probe a whole batch of indices concurrently on each pass.
  while (gap < GAP_LIMIT) {
    const batch = Array.from({ length: BATCH }, (_, n) =>
      deriveAddress(root, kind, change, i + n),
    );
    const used = await Promise.all(batch.map((d) => isUsed(d.address)));
    for (let n = 0; n < batch.length && gap < GAP_LIMIT; n++) {
      all.push(batch[n]);
      if (used[n]) {
        firstUnused = i + n + 1;
        gap = 0;
      } else {
        gap++;
      }
    }
    i += BATCH;
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
    const count = Math.min(BATCH, limit - i);
    const batch = Array.from({ length: count }, (_, n) =>
      deriveAddress(root, kind, change, i + n),
    );
    const used = await Promise.all(batch.map((d) => isUsed(d.address)));
    for (let n = 0; n < batch.length; n++) {
      all.push(batch[n]);
      if (used[n]) {
        firstUnused = i + n + 1;
        limit = Math.max(limit, i + n + 1 + FAST_FRONTIER);
      }
    }
    if (limit - knownUsed > GAP_LIMIT) {
      return { all, firstUnusedIndex: firstUnused, overflowed: true };
    }
    i += count;
  }
  return { all, firstUnusedIndex: firstUnused, overflowed: false };
}


async function scanSingleKind(
  root: BIP32Interface,
  kind: AddressKind,
  opts?: { deep?: boolean },
): Promise<AccountSnapshot> {
  const scriptKind = scriptKindOf(kind);
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
    // Fetch every address's UTXO set concurrently (bounded), then resolve any
    // legacy prev-tx hex in parallel from the cache-backed fetcher.
    const perAddress: { d: DerivedAddress; raw: MempoolUtxo[] }[] = [];
    for (let i = 0; i < addrs.length; i += BATCH) {
      const slice = addrs.slice(i, i + BATCH);
      const results = await Promise.all(
        slice.map(async (d) => {
          try {
            return { d, raw: await getAddressUtxos(d.address) };
          } catch {
            return { d, raw: [] as MempoolUtxo[] };
          }
        }),
      );
      perAddress.push(...results);
    }

    const pending: { utxo: AccountUtxo; value: number }[] = [];
    for (const { d, raw } of perAddress) {
      for (const u of raw) {
        pending.push({
          value: u.value,
          utxo: {
            address: d.address,
            txid: u.txid,
            vout: u.vout,
            value: u.value,
            change: d.change,
            index: d.index,
            kind,
          },
        });
      }
    }

    // For legacy inputs we need the previous full tx hex; for segwit we only
    // need the scriptPubKey, which we fill in below.
    if (scriptKind === "bip44") {
      for (let i = 0; i < pending.length; i += BATCH) {
        const slice = pending.slice(i, i + BATCH);
        await Promise.all(
          slice.map(async (p) => {
            try {
              p.utxo.nonWitnessUtxoHex = await getTxHexCached(p.utxo.txid);
            } catch {
              p.utxo.nonWitnessUtxoHex = undefined;
            }
          }),
        );
      }
    }

    for (const p of pending) {
      // Skip UTXOs we couldn't fetch a prev-tx for — they aren't signable.
      if (scriptKind === "bip44" && !p.utxo.nonWitnessUtxoHex) continue;
      balance += p.value;
      utxos.push(p.utxo);
    }
  };

  await Promise.all([collect(usedExt), collect(usedInt)]);

  // For segwit inputs we need scriptPubKey for each UTXO's address.
  // mempool.space exposes it on the tx; cheapest is to re-derive from address type.
  if (scriptKind === "bip84" || scriptKind === "bip49") {
    const { payments } = await import("bitcoinjs-lib");
    const { TXC_NETWORK } = await import("./network");
    for (const u of utxos) {
      const d = (u.change === 0 ? ext.all : int.all)[u.index];
      const pubkey = d.pubkey;
      if (scriptKind === "bip84") {
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


/**
 * Scan a full TXC account across every derivation path we support.
 *
 * TXC's registered SLIP-0044 coin type is 696969', but the original mobile
 * wallet (a BlueWallet fork) shipped on Bitcoin's 0'. Real funds exist on
 * both, so a correct balance is the union of them. The wallet's own `kind`
 * stays authoritative for new receive/change addresses.
 *
 * Cost control: the primary path always gets a full scan. Secondary paths are
 * probed at external index 0 first and only fully scanned if that address has
 * ever been used or a previous scan recorded activity — so a normal refresh
 * costs ~5 extra requests, not ~200. A deep rescan scans everything.
 */
export async function scanAccount(
  root: BIP32Interface,
  kind: AddressKind,
  opts?: { deep?: boolean },
): Promise<AccountSnapshot> {
  const primary = await scanSingleKind(root, kind, opts);
  const others = ALL_DERIVATION_KINDS.filter((k) => k !== kind);

  const extras = await Promise.all(
    others.map(async (k) => {
      if (!opts?.deep) {
        const hint = readHint(root, k);
        const known = hint ? hint.extUsed + hint.intUsed : 0;
        if (known === 0) {
          // Cheap probe window: an unused index 0 does NOT mean the branch is
          // empty — funds can land at any index (e.g. bridge deposits at /0/4).
          // Probe the first PROBE_WINDOW receive addresses plus change index 0
          // in parallel before deciding to skip the branch.
          const candidates = [
            ...Array.from({ length: PROBE_WINDOW }, (_, i) => deriveAddress(root, k, 0, i)),
            deriveAddress(root, k, 1, 0),
          ];
          let anyUsed = false;
          try {
            const results = await Promise.all(
              candidates.map(async (d) => {
                const stats = await getAddressStats(d.address);
                return stats.chain_stats.tx_count > 0 || stats.mempool_stats.tx_count > 0;
              }),
            );
            anyUsed = results.some(Boolean);
          } catch {
            return null;
          }
          if (!anyUsed) return null;
        }
      }

      try {
        return { kind: k, snap: await scanSingleKind(root, k, opts) };
      } catch {
        return null;
      }
    }),
  );

  const branches: NonNullable<AccountSnapshot["branches"]> = [
    {
      kind,
      balanceSats: primary.balanceSats,
      usedAddresses: primary.nextReceiveIndex + primary.nextChangeIndex,
    },
  ];
  let balanceSats = primary.balanceSats;
  const utxos: AccountUtxo[] = [...primary.utxos];
  const external = [...primary.external];
  const internal = [...primary.internal];

  for (const e of extras) {
    if (!e) continue;
    const used = e.snap.nextReceiveIndex + e.snap.nextChangeIndex;
    if (e.snap.balanceSats === 0 && used === 0) continue;
    balanceSats += e.snap.balanceSats;
    utxos.push(...e.snap.utxos);
    external.push(...e.snap.external);
    internal.push(...e.snap.internal);
    branches.push({ kind: e.kind, balanceSats: e.snap.balanceSats, usedAddresses: used });
  }

  // The explorer occasionally lists an output that has already been spent
  // (its UTXO index lags behind the chain tip). When the spend was a move
  // between two of our own addresses, the same money gets counted twice — the
  // consumed input and the new output — which is exactly what makes an old
  // derivation path show a phantom, often doubled, balance. Drop duplicates
  // and confirm every old-path coin is genuinely unspent before counting it.
  const deduped = dedupeOutpoints(utxos);
  const verified = await withoutSpentCoins(deduped, kind);

  // Coins consumed by a transaction this device already broadcast can still
  // show up as unspent for a while. Spending them again is what produces
  // `txn-mempool-conflict`, so drop them here — after giving the node a
  // chance to tell us the reservation is obsolete.
  const spendable = await withoutReservedCoins(verified);

  const spendableBalance = spendable.reduce((s, u) => s + u.value, 0);
  const spendableByKind = new Map<AddressKind, number>();
  for (const u of spendable) {
    const utxoKind = u.kind ?? kind;
    spendableByKind.set(utxoKind, (spendableByKind.get(utxoKind) ?? 0) + u.value);
  }
  // Keep branch balances consistent with the account's spendable balance.
  // Immediately after a broadcast, an explorer can briefly keep returning the
  // consumed inputs as UTXOs; without this adjustment the old-path warning
  // reappears even though those coins are already reserved by the accepted tx.
  const spendableBranches = branches.map((branch) => ({
    ...branch,
    balanceSats: spendableByKind.get(branch.kind) ?? 0,
  }));

  return {
    ...primary,
    external,
    internal,
    balanceSats: spendableBalance,
    utxos: spendable,
    branches: spendableBranches,
  };
}

/**
 * Remove locally-reserved outpoints from a UTXO set. Reservations older than
 * VERIFY_AFTER_MS are checked against the node first: if the coin is genuinely
 * still unspent (our transaction was dropped, never relayed, or replaced) the
 * reservation is released so the money isn't stranded.
 */
async function withoutReservedCoins(utxos: AccountUtxo[]): Promise<AccountUtxo[]> {
  const entries = reservedEntries();
  if (Object.keys(entries).length === 0) return utxos;

  const now = Date.now();
  const stale = utxos.filter((u) => {
    const ts = entries[outpointKey(u.txid, u.vout)];
    return ts !== undefined && now - ts > VERIFY_AFTER_MS;
  });

  if (stale.length > 0) {
    const release: string[] = [];
    await Promise.all(
      stale.map(async (u) => {
        try {
          const out = await getOutspend(u.txid, u.vout);
          if (!out.spent) release.push(outpointKey(u.txid, u.vout));
        } catch {
          // Explorer hiccup — keep the reservation, it expires on its own.
        }
      }),
    );
    releaseOutpoints(release);
  }

  const live = reservedEntries();
  return utxos.filter((u) => !(outpointKey(u.txid, u.vout) in live));
}


/** Collapse repeated outpoints (same txid:vout) to a single coin. */
function dedupeOutpoints(utxos: AccountUtxo[]): AccountUtxo[] {
  const seen = new Set<string>();
  const out: AccountUtxo[] = [];
  for (const u of utxos) {
    const key = outpointKey(u.txid, u.vout);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(u);
  }
  return out;
}

/** Max outputs we're willing to double-check per refresh. */
const VERIFY_LIMIT = 60;

/**
 * Ask the node whether each coin on a *secondary* derivation path is really
 * unspent. A stale explorer UTXO index otherwise resurrects money that was
 * already swept, and a self-transfer inside the old branch shows up twice.
 * The primary path is left alone — it refreshes constantly and this would
 * double the request count for no benefit.
 */
async function withoutSpentCoins(
  utxos: AccountUtxo[],
  primaryKind: AddressKind,
): Promise<AccountUtxo[]> {
  const suspects = utxos.filter((u) => (u.kind ?? primaryKind) !== primaryKind);
  if (suspects.length === 0 || suspects.length > VERIFY_LIMIT) return utxos;

  const spent = new Set<string>();
  for (let i = 0; i < suspects.length; i += BATCH) {
    const slice = suspects.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (u) => {
        try {
          const out = await getOutspend(u.txid, u.vout);
          if (out.spent) spent.add(outpointKey(u.txid, u.vout));
        } catch {
          // Explorer hiccup — keep the coin; a real spend will be caught later.
        }
      }),
    );
  }
  if (spent.size === 0) return utxos;
  return utxos.filter((u) => !spent.has(outpointKey(u.txid, u.vout)));
}
