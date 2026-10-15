/**
 * Browser-side tap-card helpers. Card pockets live on HME-reserved branch 1107':
 *   card N pocket = m/44'/696969'/1107'/0/N   (key handed to our card service)
 *   owner key     = m/44'/696969'/1107'/1/0   (signs settings requests; never shared)
 */
import { chainRoot, addressFor, mainReceiveAddress, bytesToHex } from "@/lib/seeds/pocket";
import { signMessageWithKey } from "@/lib/txc/message-sign";
import { scopedKey } from "@/lib/profiles";

export const CARD_BRANCH = 1107;
const BASE = `m/44'/696969'/${CARD_BRANCH}'`;
const NEXT_KEY = "hme:card-pocket-next";

export function nextPocketIndex(): number {
  const n = Number(localStorage.getItem(scopedKey(NEXT_KEY)));
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export function bumpPocketIndex(used: number) {
  localStorage.setItem(scopedKey(NEXT_KEY), String(Math.max(nextPocketIndex(), used + 1)));
}

export function cardPocket(seed: Uint8Array, index: number) {
  const node = chainRoot(seed, "TXC").derivePath(`${BASE}/0/${index}`);
  return { address: addressFor("TXC", node.publicKey), keyHex: bytesToHex(node.privateKey!) };
}

export function returnAddress(seed: Uint8Array): string {
  return mainReceiveAddress(seed, "TXC");
}

export interface Envelope {
  owner: string;
  ts: number;
  action: string;
  body: unknown;
  sig: string;
}

export function signEnvelope(seed: Uint8Array, action: string, body: unknown): Envelope {
  const node = chainRoot(seed, "TXC").derivePath(`${BASE}/1/0`);
  const owner = addressFor("TXC", node.publicKey);
  const ts = Math.floor(Date.now() / 1000);
  const message = `hm-card|${action}|${ts}|${JSON.stringify(body)}`;
  const { signature } = signMessageWithKey({ privateKey: node.privateKey!, kind: "bip44", address: owner, message });
  return { owner, ts, action, body, sig: signature };
}
