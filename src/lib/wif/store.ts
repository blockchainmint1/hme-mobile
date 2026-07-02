/**
 * Persistence for imported single-key (WIF) wallets.
 *
 * Each entry stores the address it presents on the carousel plus the WIF
 * encrypted with a key derived from the currently-unlocked seed's BIP32 root.
 * If the app is locked or the seed changes, the WIF ciphertext is opaque.
 * The address itself is not sensitive — kept plaintext for tile display.
 */
import type { BIP32Interface } from "bip32";
import type { WifAddressKind, WifChain } from "./decode";

export interface WifWalletEntry {
  id: string;
  label: string;
  chain: WifChain;
  kind: WifAddressKind;
  address: string;
  compressed: boolean;
  createdAt: number;
  /** base64 AES-GCM ciphertext of the WIF string */
  ct: string;
  /** base64 IV */
  iv: string;
  /** last 4 hex chars of the wrapping key fingerprint, for sanity check on unwrap */
  fp: string;
}

const STORAGE_KEY = "hme.wif.v1";
export const WIF_CHANGED_EVENT = "hme:wif-changed";

function b64enc(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s);
}
function b64dec(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function toAB(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

async function wrapKeyFromRoot(root: BIP32Interface): Promise<{ key: CryptoKey; fp: string }> {
  if (!root.privateKey) throw new Error("Wallet must be unlocked to store WIF wallets.");
  const material = await crypto.subtle.digest("SHA-256", toAB(root.privateKey));
  const key = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  const fpBuf = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  const fp = Array.from(fpBuf.slice(0, 2), (b) => b.toString(16).padStart(2, "0")).join("");
  return { key, fp };
}

function safeParse(raw: string | null): WifWalletEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (w): w is WifWalletEntry =>
        !!w &&
        typeof w.id === "string" &&
        typeof w.address === "string" &&
        (w.chain === "txc" || w.chain === "isk") &&
        typeof w.ct === "string",
    );
  } catch {
    return [];
  }
}

export function listWifWallets(): WifWalletEntry[] {
  if (typeof localStorage === "undefined") return [];
  return safeParse(localStorage.getItem(STORAGE_KEY));
}

function persist(list: WifWalletEntry[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new CustomEvent(WIF_CHANGED_EVENT));
  } catch {
    /* quota — non-fatal */
  }
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `wif_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function addWifWallet(
  input: {
    label: string;
    chain: WifChain;
    kind: WifAddressKind;
    address: string;
    compressed: boolean;
    wif: string;
  },
  root: BIP32Interface,
): Promise<WifWalletEntry> {
  const list = listWifWallets();
  const dupe = list.find((w) => w.address === input.address && w.chain === input.chain);
  if (dupe) return dupe;
  const { key, fp } = await wrapKeyFromRoot(root);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(input.wif);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toAB(iv) }, key, toAB(pt)),
  );
  const entry: WifWalletEntry = {
    id: newId(),
    label: input.label.trim() || defaultLabel(input.chain, input.address),
    chain: input.chain,
    kind: input.kind,
    address: input.address,
    compressed: input.compressed,
    createdAt: Date.now(),
    ct: b64enc(ct),
    iv: b64enc(iv),
    fp,
  };
  persist([...list, entry]);
  return entry;
}

export async function revealWif(entry: WifWalletEntry, root: BIP32Interface): Promise<string> {
  const { key, fp } = await wrapKeyFromRoot(root);
  if (entry.fp && entry.fp !== fp) {
    throw new Error("This imported key was saved with a different seed. Unlock that seed to use it.");
  }
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toAB(b64dec(entry.iv)) },
    key,
    toAB(b64dec(entry.ct)),
  );
  return new TextDecoder().decode(pt);
}

export function renameWifWallet(id: string, label: string) {
  persist(listWifWallets().map((w) => (w.id === id ? { ...w, label: label.trim() || w.label } : w)));
}

export function removeWifWallet(id: string) {
  persist(listWifWallets().filter((w) => w.id !== id));
}

export function getWifWallet(id: string): WifWalletEntry | null {
  return listWifWallets().find((w) => w.id === id) ?? null;
}

function defaultLabel(chain: WifChain, address: string): string {
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return `${chain.toUpperCase()} · ${short}`;
}
