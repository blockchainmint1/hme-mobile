/**
 * Server-side client for the TSD Swap rewards-tracking endpoint.
 *
 * Same host and auth model as the cash-out API (docs/tsd-cashout-api.md):
 * the user's own TSD Swap API key travels from the device, is forwarded as
 * `x-api-key`, and is never stored. Kept off the device so the endpoint host
 * can move server-side and the strict CSP `connect-src` stays closed.
 *
 * Contract lives in docs/tsd-rewards-xpub.md.
 */
const DEFAULT_BASE = "https://tsd.honest.money";

function baseUrl(): string {
  return (process.env["TSD_SWAP_URL"] || DEFAULT_BASE).replace(/\/+$/, "");
}

export interface RewardsLinkResponse {
  ok: boolean;
  linkedAt?: string;
  message?: string;
}

export async function postRewardsXpub(args: {
  apiKey: string;
  payload: unknown;
  signature: string;
  address: string;
}): Promise<RewardsLinkResponse> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/api/public/v1/rewards/xpub`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-api-key": args.apiKey,
      },
      body: JSON.stringify({
        payload: args.payload,
        signature: args.signature,
        address: args.address,
      }),
    });
  } catch {
    throw new Error("Couldn't reach TSD Swap. Try again in a moment.");
  }

  const text = await res.text();
  if (!res.ok) {
    let msg = `TSD Swap error (${res.status})`;
    try {
      const j = JSON.parse(text) as { error?: string; message?: string };
      if (j.error || j.message) msg = String(j.error ?? j.message);
    } catch {
      /* keep the status message */
    }
    if (res.status === 401 || res.status === 403) {
      msg = "Your TSD Swap API key was rejected. Check it in Settings.";
    }
    if (res.status === 404) {
      msg = "Rewards tracking isn't available on your TSD Swap account yet.";
    }
    throw new Error(msg);
  }

  try {
    const body = JSON.parse(text) as RewardsLinkResponse;
    return { ok: true, linkedAt: body.linkedAt, message: body.message };
  } catch {
    return { ok: true };
  }
}

export async function deleteRewardsXpub(apiKey: string): Promise<void> {
  try {
    await fetch(`${baseUrl()}/api/public/v1/rewards/xpub`, {
      method: "DELETE",
      headers: { accept: "application/json", "x-api-key": apiKey },
    });
  } catch {
    /* unlinking locally always succeeds; the server copy expires on its own */
  }
}
