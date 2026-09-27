/**
 * "Requested paths" dialect of hm-link-xpubs (Bonfire and any site that
 * asks for specific account keys instead of the whole NectarPay bundle).
 *
 * QR: `hm-link:<https manifest url>` (or the bare URL).
 * Manifest: { type:"hm-link-xpubs", challenge_id, challenge, request:[{chain,path}],
 *             message_template, submit_url, expires_at, app:{name} }
 * Submit:  POST submit_url { token, identity_address, xpub, path, signature, app_name }
 *
 * Only hardened account-level keys under TXC/ISK coin types are ever handed
 * out, and the signed message is rebuilt locally from a fixed template shape,
 * so a site can't trick the wallet into signing anything else.
 */
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { TXC_NETWORK } from "@/lib/txc/network";
import { ISK_NETWORK, ISK_COIN_TYPE } from "@/lib/isk/network";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { signMessageWithSeed } from "@/lib/txc/message-sign";

const bip32 = BIP32Factory(ecc);
const PROXY = "/api/nectar/link";
const TXC_COIN_TYPE = 696969;

const COINS: Record<string, { coin: number; net: unknown }> = {
  TXC: { coin: TXC_COIN_TYPE, net: TXC_NETWORK },
  ISK: { coin: ISK_COIN_TYPE, net: ISK_NETWORK },
};

export interface RequestedKey {
  chain: string;
  path: string;
  label?: string;
}

export interface RequestedManifest {
  kind: "requested";
  host: string;
  appName: string;
  purpose?: string;
  token: string;
  challenge: string;
  keys: RequestedKey[];
  template: string;
  submitUrl: string;
  manifestUrl: string;
}

export function isRequestedDialect(raw: Record<string, unknown>): boolean {
  return Array.isArray(raw["request"]) && typeof raw["submit_url"] === "string";
}

/** m/44'/<coin>'/<account>' — hardened, account level only, never account 0'. */
function validPath(chain: string, path: string): boolean {
  const c = COINS[chain];
  if (!c) return false;
  const m = /^m\/44'\/(\d+)'\/(\d+)'$/.exec(path);
  if (!m) return false;
  return Number(m[1]) === c.coin && Number(m[2]) < 2 ** 31;
}

const TEMPLATE_RE =
  /^Honest Money - Link wallet\n\nDomain: \{domain\}\nChallenge: \{challenge\}\nPath: \{path\}\nXpub: \{xpub\}\n\n[^\n{}]{10,300}$/;

export function validateRequested(raw: Record<string, unknown>, manifestUrl: string): RequestedManifest {
  const fail = (m: string): never => {
    throw new Error(m);
  };
  if (raw["type"] !== "hm-link-xpubs") fail("That code isn't a wallet link.");
  const origin = new URL(manifestUrl).origin;
  const host = new URL(manifestUrl).hostname;
  const submitUrl = String(raw["submit_url"]);
  try {
    if (new URL(submitUrl).origin !== origin) fail("Link sends keys to a different server.");
  } catch {
    fail("Link is malformed.");
  }
  const token = raw["challenge_id"];
  const challenge = raw["challenge"];
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) fail("Link is malformed.");
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(challenge)) fail("Link is malformed.");
  const exp = Date.parse(String(raw["expires_at"] ?? ""));
  if (Number.isFinite(exp) && exp <= Date.now()) fail("This link has expired.");
  // Some servers double-escape the newlines in the template; normalise.
  const template = String(raw["message_template"] ?? "").replace(/\\n/g, "\n");
  if (!TEMPLATE_RE.test(template)) fail("Link asks to sign an unexpected message.");
  const keys = (raw["request"] as unknown[])
    .map((r) => r as Record<string, unknown>)
    .map((r) => ({
      chain: String(r["chain"] ?? "").toUpperCase(),
      path: String(r["path"] ?? ""),
      label: typeof r["label"] === "string" ? (r["label"] as string).slice(0, 60) : undefined,
    }));
  if (keys.length !== 1) fail("Link must request exactly one key.");
  for (const k of keys) if (!validPath(k.chain, k.path)) fail(`Unsupported key request: ${k.chain} ${k.path}`);
  const app = (raw["app"] ?? {}) as Record<string, unknown>;
  return {
    kind: "requested",
    host,
    appName: typeof app["name"] === "string" ? (app["name"] as string).slice(0, 40) : host,
    purpose: typeof raw["purpose"] === "string" ? (raw["purpose"] as string).slice(0, 300) : undefined,
    token: token as string,
    challenge: challenge as string,
    keys,
    template,
    submitUrl,
    manifestUrl,
  };
}

export async function submitRequested(args: {
  manifest: RequestedManifest;
  mnemonic: string;
  passphrase?: string;
}): Promise<{ appName: string }> {
  const { manifest, mnemonic, passphrase = "" } = args;
  const key = manifest.keys[0]!;
  const seed = await seedFromMnemonic(mnemonic, passphrase);
  const xpub = bip32
    .fromSeed(seed, COINS[key.chain]!.net as never)
    .derivePath(key.path)
    .neutered()
    .toBase58();
  const message = manifest.template
    .replace("{domain}", manifest.host)
    .replace("{challenge}", manifest.challenge)
    .replace("{path}", key.path)
    .replace("{xpub}", xpub);
  const signed = await signMessageWithSeed({ mnemonic, passphrase, kind: "bip44", change: 0, index: 0, message });
  const res = await fetch(`${PROXY}?url=${encodeURIComponent(manifest.submitUrl)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      token: manifest.token,
      identity_address: signed.address,
      xpub,
      path: key.path,
      signature: signed.signature,
      app_name: "honest.money wallet",
    }),
  });
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) throw new Error((body?.["error"] as string) ?? `Link failed (${res.status})`);
  return { appName: (body?.["linked_to"] as string) ?? manifest.appName };
}
