/**
 * Universal payment URI parser used by the global QR scanner and the send
 * screens. Returns a discriminated union describing what the wallet should
 * do next: open TXC send, open EVM send on a specific chain, open a hosted
 * checkout, or fall back to a plain address the user can route manually.
 *
 * Supported inputs:
 *   - `texitcoin:<addr>?amount=<txc>`
 *   - `bitcoin:<addr>?amount=<btc>`   (legacy TXC "T..." addresses)
 *   - `ethereum:<addr>@<chainId>?value=<wei>`                    (EIP-681 native)
 *   - `ethereum:<token>@<chainId>/transfer?address=<to>&uint256=<raw>` (EIP-681 ERC-20)
 *   - `https://nectar-pay.com/i/<id>` or `/pay/<id>`             (hosted checkout)
 *   - bare `0x...` (EVM address, chain unknown)
 *   - bare TXC addresses (bech32 `txc1...` / legacy `T...`)
 */

import { TOKENS_BY_CHAIN, tokenAmountFromRaw } from "@/lib/chains/erc20";
import type { EvmChainId } from "@/lib/chains/evm";

export type PaymentIntent =
  | { kind: "txc"; address: string; amount?: string }
  | { kind: "isk"; address: string; amount?: string }
  | {
      kind: "evm";
      chain?: EvmChainId; // undefined => user must pick
      address: string;
      assetSymbol?: string; // "USDC" | "USDT" | native symbol
      amount?: string; // decimal string
    }
  | { kind: "nectar-invoice"; url: string; invoiceId: string }
  | { kind: "unknown"; raw: string };

const EVM_CHAIN_BY_ID: Record<number, EvmChainId> = {
  1: "eth",
  8453: "base",
  56: "bsc",
};

function isEvmAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

function isTxcAddress(s: string): boolean {
  // bech32 txc1..., legacy T..., or wrapped M...
  return /^(txc1|T|M)[0-9a-zA-Z]{20,}$/.test(s);
}

function isIskAddress(s: string): boolean {
  // bech32 isk1..., legacy K...
  return /^(isk1|K)[0-9a-zA-Z]{20,}$/.test(s);
}

function safeAmountFromWei(raw: string, decimals: number): string | undefined {
  try {
    const big = /^[0-9]+$/.test(raw) ? BigInt(raw) : BigInt(Math.trunc(Number(raw)));
    return tokenAmountFromRaw(big, decimals);
  } catch {
    return undefined;
  }
}

export function parsePaymentUri(input: string): PaymentIntent {
  const raw = input.trim();
  if (!raw) return { kind: "unknown", raw };

  // Nectar-Pay hosted checkout URLs
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (/(^|\.)nectar-pay\.com$/i.test(u.hostname)) {
        const m = u.pathname.match(/^\/(?:i|pay)\/([A-Za-z0-9_-]+)/);
        if (m) return { kind: "nectar-invoice", url: raw, invoiceId: m[1] };
      }
    } catch {
      /* fall through */
    }
    return { kind: "unknown", raw };
  }

  // Bare addresses
  if (isEvmAddress(raw)) return { kind: "evm", address: raw };
  if (isTxcAddress(raw)) return { kind: "txc", address: raw };

  // Scheme URIs
  const scheme = raw.match(/^([a-z]+):(.+)$/i);
  if (!scheme) return { kind: "unknown", raw };
  const proto = scheme[1].toLowerCase();
  const rest = scheme[2];

  if (proto === "texitcoin" || proto === "txc" || proto === "bitcoin") {
    const m = rest.match(/^([^?]+)(?:\?(.*))?$/);
    if (!m) return { kind: "unknown", raw };
    const address = m[1];
    const params = new URLSearchParams(m[2] ?? "");
    const amount = params.get("amount") ?? undefined;
    return { kind: "txc", address, amount };
  }

  if (proto === "ethereum") {
    // target@chainId/fn?params
    const m = rest.match(/^([^@?/]+)(?:@([0-9]+))?(?:\/([a-zA-Z0-9_]+))?(?:\?(.*))?$/);
    if (!m) return { kind: "unknown", raw };
    const target = m[1];
    const chainIdNum = m[2] ? Number(m[2]) : undefined;
    const fn = m[3];
    const params = new URLSearchParams(m[4] ?? "");
    const chain = chainIdNum != null ? EVM_CHAIN_BY_ID[chainIdNum] : undefined;

    // ERC-20 transfer form
    if (fn === "transfer" && isEvmAddress(target)) {
      const to = params.get("address") ?? "";
      const rawAmt = params.get("uint256") ?? params.get("value") ?? "";
      // If we know the chain, look up the token to decode decimals + symbol.
      let assetSymbol: string | undefined;
      let amount: string | undefined;
      if (chain) {
        const known = TOKENS_BY_CHAIN[chain].find(
          (t) => t.address.toLowerCase() === target.toLowerCase(),
        );
        if (known) {
          assetSymbol = known.symbol;
          if (rawAmt) amount = safeAmountFromWei(rawAmt, known.decimals);
        }
      } else {
        // No chainId: check every EVM chain we know; if the token contract is
        // unambiguous (USDC/USDT often share addresses across chains), leave
        // chain undefined so the user picks, but still surface the symbol.
        for (const [cid, list] of Object.entries(TOKENS_BY_CHAIN)) {
          const hit = list.find((t) => t.address.toLowerCase() === target.toLowerCase());
          if (hit) {
            assetSymbol = hit.symbol;
            if (rawAmt) amount = safeAmountFromWei(rawAmt, hit.decimals);
            // Don't set chain — multiple chains may match; let user choose.
            void cid;
            break;
          }
        }
      }
      return {
        kind: "evm",
        chain,
        address: isEvmAddress(to) ? to : "",
        assetSymbol,
        amount,
      };
    }

    // Native payment
    if (isEvmAddress(target)) {
      const rawAmt = params.get("value") ?? "";
      const amount = rawAmt ? safeAmountFromWei(rawAmt, 18) : undefined;
      return { kind: "evm", chain, address: target, amount };
    }
  }

  return { kind: "unknown", raw };
}
