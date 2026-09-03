/**
 * Stub for `rpc-websockets`.
 *
 * `@solana/web3.js` imports it only for its websocket subscription client.
 * This wallet talks to Solana exclusively over HTTP JSON-RPC via the
 * same-origin `/api/solana` proxy, and the real package has no Worker-safe
 * export condition, which breaks the Cloudflare build. Aliasing it here keeps
 * the HTTP paths working and makes subscriptions fail loudly if ever used.
 */
export class CommonClient {
  constructor() {
    throw new Error("Solana websocket subscriptions are not supported in this wallet");
  }
}

export const WebSocket = CommonClient;
export default CommonClient;
