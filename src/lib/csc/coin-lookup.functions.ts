/**
 * Cold Storage Coin lookup.
 *
 * The six-character Asset ID printed on a Cold Storage Coin sticker resolves to
 * the coin's public address through the Cold Storage Coins registry. We proxy
 * the call through a server function so the browser never hits a cross-origin
 * endpoint (and so the registry sees one predictable caller).
 *
 * Public, manufacturing facts only — no keys, no owner data.
 */
import { createServerFn } from "@tanstack/react-start";

const REGISTRY_URL = "https://admin.coldstoragecoins.com/api/public/v5/coin-details";

export interface CoinLookupResult {
  found: boolean;
  message?: string;
  assetId?: string;
  address?: string;
  blockchainCode?: string | null;
  blockchainName?: string | null;
  productName?: string | null;
}

export const lookupColdStorageCoin = createServerFn({ method: "POST" })
  .inputValidator((input: { coinId: string }) => {
    const id = String(input?.coinId ?? "").trim().replace(/\s+/g, "");
    if (!/^[0-9A-Za-z]{6}$/.test(id)) {
      throw new Error("Coin ID must be the six characters printed on the sticker.");
    }
    return { coinId: id };
  })
  .handler(async ({ data }): Promise<CoinLookupResult> => {
    let res: Response;
    try {
      res = await fetch(REGISTRY_URL, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ publicKey: data.coinId }),
      });
    } catch {
      return { found: false, message: "Couldn't reach the Cold Storage Coins registry. Try again." };
    }

    if (res.status === 404) {
      return { found: false, message: "No coin with that ID. Check the six characters on the sticker." };
    }
    if (!res.ok) {
      return { found: false, message: `Lookup failed (${res.status}). Try again in a moment.` };
    }

    const body = (await res.json().catch(() => null)) as
      | {
          coin?: {
            assetId?: string;
            publicKey?: string;
            blockchainCode?: string | null;
            blockchainName?: string | null;
          };
          displayValues?: { fieldTitle: string; fieldValue: string }[];
        }
      | null;

    const address = body?.coin?.publicKey?.trim();
    if (!address) {
      return { found: false, message: "The registry didn't return an address for that coin." };
    }

    const product =
      body?.displayValues?.find((d) => d.fieldTitle === "Product")?.fieldValue ?? null;

    return {
      found: true,
      assetId: body?.coin?.assetId ?? data.coinId,
      address,
      blockchainCode: body?.coin?.blockchainCode ?? null,
      blockchainName: body?.coin?.blockchainName ?? null,
      productName: product,
    };
  });
