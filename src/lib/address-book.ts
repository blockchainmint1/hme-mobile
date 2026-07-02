/**
 * Local address book. Stored unencrypted in localStorage — these are
 * public addresses + user-chosen names, no secret material.
 */
import { isAddress } from "viem";
import { address as addrLib } from "bitcoinjs-lib";
import { TXC_NETWORK } from "./txc/network";

export type ContactChain = "txc" | "isk" | "eth" | "base" | "bsc";

export interface Contact {
  id: string;
  name: string;
  chain: ContactChain;
  address: string;
  createdAt: number;
}

export const CHAIN_LABELS: Record<ContactChain, string> = {
  txc: "TEXITcoin (TXC)",
  isk: "IskanderCoin (ISK)",
  eth: "Ethereum (ETH)",
  base: "Base",
  bsc: "BNB Smart Chain",
};

/** EVM chains share an address format; group them when filtering by chain. */
export const EVM_CHAINS: ContactChain[] = ["eth", "base", "bsc"];

const KEY = "hme:address-book:v1";

export function validateAddress(chain: ContactChain, addr: string): string | null {
  const a = addr.trim();
  if (!a) return "Address is required.";
  if (chain === "txc") {
    try {
      addrLib.toOutputScript(a, TXC_NETWORK);
      return null;
    } catch {
      return "Not a valid TEXITcoin address.";
    }
  }
  if (chain === "isk") {
    try {
      // Lazy import to avoid loading ISK network on all pages.
      const { ISK_NETWORK } = require("./isk/network") as typeof import("./isk/network");
      addrLib.toOutputScript(a, ISK_NETWORK);
      return null;
    } catch {
      return "Not a valid IskanderCoin address.";
    }
  }
  return isAddress(a) ? null : "Not a valid EVM address.";
}

export function listContacts(): Contact[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Contact[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(items: Contact[]) {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("hme:contacts-changed"));
}

export function addContact(input: Omit<Contact, "id" | "createdAt">): Contact {
  const item: Contact = {
    ...input,
    name: input.name.trim(),
    address: input.address.trim(),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  writeAll([...listContacts(), item]);
  return item;
}

export function updateContact(id: string, patch: Partial<Omit<Contact, "id" | "createdAt">>): void {
  const items = listContacts().map((c) =>
    c.id === id
      ? {
          ...c,
          ...patch,
          name: (patch.name ?? c.name).trim(),
          address: (patch.address ?? c.address).trim(),
        }
      : c,
  );
  writeAll(items);
}

export function deleteContact(id: string): void {
  writeAll(listContacts().filter((c) => c.id !== id));
}

/** Filter contacts to those usable for a given chain (EVM shares addresses). */
export function contactsForChain(chain: ContactChain): Contact[] {
  const isEvm = EVM_CHAINS.includes(chain);
  return listContacts().filter((c) =>
    isEvm ? EVM_CHAINS.includes(c.chain) : c.chain === chain,
  );
}
