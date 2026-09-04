/**
 * TSD rewards: link a watch-only TEXITcoin account key to a TSD Swap account.
 *
 * Omni pins a token balance to whichever address received it, so a wallet's
 * TSD can sit across several derived addresses. Rather than sweeping user
 * funds (which costs fees and moves coins for our accounting convenience),
 * the user hands TSD Swap the *watch-only* account key for the TEXITcoin
 * legacy branch. TSD Swap derives the same addresses and sums the balance on
 * its own schedule, so average daily holdings are accurate across every
 * address — even while the app is closed.
 *
 * What leaves the device: the account xpub (public only, watch-only), the
 * identity address, and a BIP-137 signature proving ownership. No seed, no
 * private key, no spending authority.
 */
import { canonicalJson } from "@/lib/nectar/link";
import { scopedKey } from "@/lib/profiles";
import { signMessageWithSeed } from "@/lib/txc/message-sign";
import { DERIVATION_PATHS, TXC_NETWORK } from "@/lib/txc/network";
import { deriveAddress, rootFromSeed, seedFromMnemonic } from "@/lib/txc/wallet";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";

const bip32 = BIP32Factory(ecc);

export interface RewardsLinkPayload {
  v: 1;
  type: "tsd-rewards-xpub";
  /** TEXITcoin account key for m/44'/696969'/0' — watch-only. */
  xpub: string;
  /** Derivation path the xpub is rooted at, so the server derives correctly. */
  path: string;
  /** Stable wallet id: legacy P2PKH at m/44'/696969'/0'/0/0. */
  identity: string;
  issued_at: string;
}

export interface SignedRewardsLink {
  payload: RewardsLinkPayload;
  message: string;
  signature: string;
  address: string;
}

/** Derive the watch-only TXC account key and sign it with the identity key. */
export async function buildRewardsLink(
  mnemonic: string,
  passphrase = "",
): Promise<SignedRewardsLink> {
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const path = DERIVATION_PATHS.bip44;
  const xpub = bip32.fromSeed(seed, TXC_NETWORK).derivePath(path).neutered().toBase58();

  const identity = deriveAddress(rootFromSeed(seed), "bip44", 0, 0).address;

  const payload: RewardsLinkPayload = {
    v: 1,
    type: "tsd-rewards-xpub",
    xpub,
    path,
    identity,
    issued_at: new Date().toISOString(),
  };

  const message = canonicalJson(payload as unknown as Parameters<typeof canonicalJson>[0]);
  const signed = await signMessageWithSeed({
    mnemonic,
    passphrase,
    kind: "bip44",
    change: 0,
    index: 0,
    message,
  });

  return { payload, message, signature: signed.signature, address: signed.address };
}

/* ------------------------------------------------------------------ */
/* Local record (per vault)                                            */
/* ------------------------------------------------------------------ */

export interface RewardsLinkRecord {
  identity: string;
  xpub: string;
  linkedAt: string;
}

const STORE_BASE = "hme:tsd-rewards-link";

export function getRewardsLink(): RewardsLinkRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(scopedKey(STORE_BASE));
    return raw ? (JSON.parse(raw) as RewardsLinkRecord) : null;
  } catch {
    return null;
  }
}

export function saveRewardsLink(record: RewardsLinkRecord) {
  try {
    window.localStorage.setItem(scopedKey(STORE_BASE), JSON.stringify(record));
  } catch {
    /* noop */
  }
}

export function clearRewardsLink() {
  try {
    window.localStorage.removeItem(scopedKey(STORE_BASE));
  } catch {
    /* noop */
  }
}

/** `xpub…abcd` — short form for display. */
export function maskXpub(xpub: string): string {
  return xpub.length > 18 ? `${xpub.slice(0, 10)}…${xpub.slice(-6)}` : xpub;
}
