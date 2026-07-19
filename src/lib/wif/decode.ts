/**
 * WIF (Wallet Import Format) decoding for TXC and ISK.
 *
 * A WIF is base58check(version || 32-byte scalar || 0x01?).
 *  - TXC version byte: 0xc1
 *  - ISK version byte: 0xad
 * Trailing 0x01 indicates a compressed pubkey. We derive all three address
 * types (P2WPKH bech32, P2SH-P2WPKH, P2PKH) so the user can pick.
 */
import bs58check from "bs58check";
import * as ecc from "@bitcoinerlab/secp256k1";
import { payments, type Network } from "bitcoinjs-lib";
import { TXC_NETWORK } from "@/lib/txc/network";
import { ISK_NETWORK } from "@/lib/isk/network";
import { LTC_NETWORK } from "@/lib/ltc/network";
import { DOGE_NETWORK } from "@/lib/doge/network";

export type WifChain = "txc" | "isk" | "ltc" | "doge";
export type WifAddressKind = "bip84" | "bip49" | "bip44";

export interface DecodedWif {
  chain: WifChain;
  privateKey: Uint8Array; // 32 bytes
  compressed: boolean;
  publicKey: Uint8Array;
  network: Network;
  addresses: Record<WifAddressKind, string | null>;
}

function networkFor(chain: WifChain): Network {
  switch (chain) {
    case "txc": return TXC_NETWORK;
    case "isk": return ISK_NETWORK;
    case "ltc": return LTC_NETWORK;
    case "doge": return DOGE_NETWORK;
  }
}

function detectChain(versionByte: number): WifChain | null {
  if (versionByte === TXC_NETWORK.wif) return "txc";
  if (versionByte === ISK_NETWORK.wif) return "isk";
  if (versionByte === LTC_NETWORK.wif) return "ltc";
  if (versionByte === DOGE_NETWORK.wif) return "doge";
  return null;
}

function deriveAddressesFor(
  pubkey: Uint8Array,
  compressed: boolean,
  network: Network,
): Record<WifAddressKind, string | null> {
  const out: Record<WifAddressKind, string | null> = { bip84: null, bip49: null, bip44: null };
  try {
    const p = payments.p2pkh({ pubkey, network });
    out.bip44 = p.address ?? null;
  } catch {
    /* noop */
  }
  // Segwit only supported for compressed keys.
  if (compressed) {
    try {
      const p = payments.p2wpkh({ pubkey, network });
      out.bip84 = p.address ?? null;
    } catch {
      /* noop */
    }
    try {
      const inner = payments.p2wpkh({ pubkey, network });
      const p = payments.p2sh({ redeem: inner, network });
      out.bip49 = p.address ?? null;
    } catch {
      /* noop */
    }
  }
  return out;
}

export function decodeWif(wif: string): DecodedWif {
  const trimmed = wif.trim();
  let raw: Uint8Array;
  try {
    raw = bs58check.decode(trimmed);
  } catch {
    throw new Error("Not a valid WIF (bad base58check checksum).");
  }
  if (raw.length !== 33 && raw.length !== 34) {
    throw new Error("Not a valid WIF (unexpected length).");
  }
  const version = raw[0];
  const chain = detectChain(version);
  if (!chain) {
    throw new Error(
      "This WIF isn't a supported private key. Expected TEXITcoin, IskanderCoin, Litecoin, or Dogecoin.",
    );
  }
  const compressed = raw.length === 34 && raw[33] === 0x01;
  if (raw.length === 34 && !compressed) {
    throw new Error("Not a valid WIF (bad compression flag).");
  }
  const priv = raw.slice(1, 33);
  const pub = ecc.pointFromScalar(priv, compressed);
  if (!pub) throw new Error("Invalid private key.");
  const network = networkFor(chain);
  return {
    chain,
    privateKey: new Uint8Array(priv),
    compressed,
    publicKey: new Uint8Array(pub),
    network,
    addresses: deriveAddressesFor(new Uint8Array(pub), compressed, network),
  };
}

/** Choose a sensible default: bech32 if available, else legacy. */
export function defaultKindFor(d: DecodedWif): WifAddressKind {
  if (d.addresses.bip84) return "bip84";
  if (d.addresses.bip49) return "bip49";
  return "bip44";
}
