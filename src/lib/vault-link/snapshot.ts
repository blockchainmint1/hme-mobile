/**
 * Turn Vault xpub scans into the same AccountSnapshot shape the seed-wallet
 * home screen uses, so a Vault profile gets the identical tiles, history,
 * tokens and prices. Only the signing step differs (QR via HME Vault).
 */
import type { AccountSnapshot, AccountUtxo } from "@/lib/txc/scan";
import type { DerivedAddress } from "@/lib/txc/wallet";
import { deriveVaultAddress, VAULT_CHAIN_META } from "./derive";
import type { VaultPairing, VaultUtxoChain } from "./pairing";
import { scanVaultChain, type VaultChainScan } from "./scan";

export function pairedPurposes(pairing: VaultPairing, chain: VaultUtxoChain): Array<44 | 49 | 84> {
  return VAULT_CHAIN_META[chain].purposes.filter(
    (p) => !!pairing.chains[chain]?.[String(p) as "44" | "49" | "84"],
  );
}

export function vaultHasChain(pairing: VaultPairing, chain: VaultUtxoChain): boolean {
  return pairedPurposes(pairing, chain).length > 0;
}

export function snapshotFromScans(pairing: VaultPairing, chain: VaultUtxoChain, scans: VaultChainScan[]): AccountSnapshot {
  // Receive on legacy (44) when paired — same address type the seed wallet uses.
  const primary = scans.find((s) => s.purpose === 44) ?? scans[0];
  const toDerived = (a: { index: number; change: 0 | 1; path: string; address: string; pubkey: Uint8Array }): DerivedAddress => ({
    index: a.index, change: a.change, path: a.path, address: a.address, pubkey: a.pubkey,
  });
  const used = scans.flatMap((s) => s.used);
  const external = used.filter((a) => a.change === 0).map(toDerived);
  const internal = used.filter((a) => a.change === 1).map(toDerived);
  if (primary && !external.some((a) => a.address === primary.nextReceive)) {
    external.push(toDerived(deriveVaultAddress(pairing, chain, primary.purpose, 0, primary.nextReceiveIndex)));
  }
  const seen = new Map<string, AccountUtxo>();
  for (const s of scans) {
    for (const u of s.utxos) {
      seen.set(`${u.txid}:${u.vout}`, { txid: u.txid, vout: u.vout, value: u.value, change: u.change, index: u.index, address: u.address });
    }
  }
  const utxos = [...seen.values()];
  const statsTotal = scans.reduce((a, s) => a + s.balanceSats, 0);
  const utxoTotal = utxos.reduce((a, u) => a + u.value, 0);
  const balanceSats = utxos.length ? Math.min(utxoTotal, statsTotal) : statsTotal;
  const changeIdx = primary ? primary.used.filter((a) => a.change === 1).length : 0;
  const nextChange = primary ? deriveVaultAddress(pairing, chain, primary.purpose, 1, changeIdx).address : "";
  return {
    external,
    internal,
    nextReceiveAddress: primary?.nextReceive ?? "",
    nextReceiveIndex: primary?.nextReceiveIndex ?? 0,
    nextChangeAddress: nextChange,
    nextChangeIndex: changeIdx,
    balanceSats,
    utxos,
  };
}

export async function scanVaultChainAll(pairing: VaultPairing, chain: VaultUtxoChain): Promise<VaultChainScan[]> {
  return Promise.all(pairedPurposes(pairing, chain).map((p) => scanVaultChain(pairing, chain, p)));
}

export async function vaultAccountSnapshot(pairing: VaultPairing, chain: VaultUtxoChain): Promise<AccountSnapshot> {
  return snapshotFromScans(pairing, chain, await scanVaultChainAll(pairing, chain));
}
