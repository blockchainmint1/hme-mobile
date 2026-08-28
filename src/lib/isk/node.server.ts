/**
 * IskanderCoin full-node JSON-RPC helper (server only).
 *
 * The explorer at mempool.iskandercoin.com handles reads, but broadcasts go
 * through it too — and when it lags or rate-limits, sends fail. This gives us
 * a direct node fallback using the ISK_RPC_* credentials.
 */

function rpcUrl(): string {
  const url = process.env.ISK_RPC_URL ?? process.env.ISK_RPC_ADDRESS;
  if (!url) throw new Error("ISK_RPC_URL not configured");
  return url.startsWith("http") ? url : `https://${url}`;
}

function rpcAuth(): string {
  const user = process.env.ISK_RPC_USER;
  const pass = process.env.ISK_RPC_PASS ?? process.env.ISK_RPC_PASSWORD;
  if (!user || !pass) throw new Error("ISK_RPC_USER / ISK_RPC_PASS not configured");
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

export async function iskRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(rpcUrl(), {
    method: "POST",
    headers: { "content-type": "text/plain", authorization: rpcAuth() },
    body: JSON.stringify({ jsonrpc: "1.0", id: "hme", method, params }),
  });
  if (!res.ok) throw new Error(`isk rpc ${method}: http ${res.status}`);
  const json = (await res.json()) as { result: T; error: { message: string } | null };
  if (json.error) throw new Error(`isk rpc ${method}: ${json.error.message}`);
  return json.result;
}

export async function sendRawIsk(hex: string): Promise<string> {
  return iskRpc<string>("sendrawtransaction", [hex]);
}

export async function iskFeeRate(): Promise<number | null> {
  try {
    const r = await iskRpc<{ feerate?: number }>("estimatesmartfee", [2]);
    if (!r?.feerate || r.feerate <= 0) return null;
    // BTC/kvB -> sat/vB
    return Math.max(1, Math.ceil((r.feerate * 1e8) / 1000));
  } catch {
    return null;
  }
}
