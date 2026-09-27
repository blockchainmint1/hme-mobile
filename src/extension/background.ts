/**
 * Extension service worker: routes provider requests from web pages.
 *  - Read-only EVM calls go to our JSON-RPC proxy (which itself allowlists).
 *  - Anything that reveals an account or signs opens the approval window;
 *    the key only ever exists inside that window, after the user unlocks.
 * Connected sites (origin → public address) live in chrome.storage.local.
 */
declare const chrome: any;

const RPC_BASE = "https://mobile.honest.money/api/evm";
const CHAINS: Record<string, string> = {
  "0x1": "eth",
  "0x2105": "base",
  "0x38": "bsc",
  [`0x${(90031273).toString(16)}`]: "zcu",
};
const READ_METHODS = new Set([
  "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_getTransactionCount",
  "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getTransactionByHash", "eth_getTransactionReceipt",
  "eth_getLogs", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory",
]);
const APPROVAL_METHODS = new Set(["eth_requestAccounts", "wallet_requestPermissions", "personal_sign", "eth_signTypedData_v4", "txc_signIn"]);

type Resp = { result?: unknown; error?: { code: number; message: string } };
type Site = { address: string; chainId: string };
type PendingReq = { id: string; origin: string; method: string; params: unknown; windowId?: number; reply: (r: Resp) => void };

const pending = new Map<string, PendingReq>();
const err = (code: number, message: string): Resp => ({ error: { code, message } });

async function getSites(): Promise<Record<string, Site>> {
  const { hmSites } = await chrome.storage.local.get("hmSites");
  return (hmSites as Record<string, Site>) ?? {};
}
async function setSite(origin: string, site: Site | null) {
  const sites = await getSites();
  if (site) sites[origin] = site;
  else delete sites[origin];
  await chrome.storage.local.set({ hmSites: sites });
}

async function broadcast(origin: string, event: string, data: unknown) {
  const tabs = await chrome.tabs.query({});
  for (const t of tabs) {
    try {
      if (t.id != null && t.url && new URL(t.url).origin === origin) chrome.tabs.sendMessage(t.id, { type: "hm:event", event, data });
    } catch { /* ignore */ }
  }
}

function originOf(sender: { origin?: string; url?: string }): string | null {
  try {
    const o = sender.origin ?? new URL(sender.url ?? "").origin;
    const u = new URL(o);
    if (u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"))) return u.origin;
  } catch { /* fall through */ }
  return null;
}

async function openApproval(req: PendingReq) {
  pending.set(req.id, req);
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`popup.html?req=${encodeURIComponent(req.id)}`),
    type: "popup",
    width: 380,
    height: 640,
  });
  req.windowId = win?.id;
}

async function handleRpc(origin: string, method: string, params: unknown): Promise<Resp | "approval"> {
  const site = (await getSites())[origin];
  const chainId = site?.chainId ?? "0x1";
  switch (method) {
    case "eth_chainId": return { result: chainId };
    case "net_version": return { result: String(parseInt(chainId, 16)) };
    case "eth_accounts": return { result: site ? [site.address] : [] };
    case "eth_requestAccounts":
      return site ? { result: [site.address] } : "approval";
    case "wallet_requestPermissions":
      return site ? { result: [{ parentCapability: "eth_accounts" }] } : "approval";
    case "wallet_getPermissions":
      return { result: site ? [{ parentCapability: "eth_accounts" }] : [] };
    case "wallet_revokePermissions":
      await setSite(origin, null);
      void broadcast(origin, "accountsChanged", []);
      return { result: null };
    case "wallet_switchEthereumChain": {
      const target = String((Array.isArray(params) ? params[0]?.chainId : undefined) ?? "").toLowerCase();
      if (!CHAINS[target]) return err(4902, "honest.money doesn't support that network.");
      if (site) await setSite(origin, { ...site, chainId: target });
      void broadcast(origin, "chainChanged", target);
      return { result: null };
    }
    case "personal_sign":
    case "eth_signTypedData_v4":
      return site ? "approval" : err(4100, "Connect to honest.money first.");
    case "txc_signIn":
      return "approval";
    case "eth_sendTransaction":
      return err(4200, "Sending from websites isn't supported yet — use the wallet's Send screen.");
  }
  if (READ_METHODS.has(method)) {
    try {
      const r = await fetch(`${RPC_BASE}/${CHAINS[chainId]}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await r.json();
      if (body.error) return err(body.error.code ?? -32603, body.error.message ?? "RPC error");
      return { result: body.result };
    } catch {
      return err(-32603, "Network request failed.");
    }
  }
  return err(4200, `honest.money doesn't support ${method}.`);
}

chrome.runtime.onMessage.addListener((msg: any, sender: any, sendResponse: (r: unknown) => void) => {
  // From web pages (via content script)
  if (msg?.type === "hm:rpc") {
    const origin = originOf(sender);
    if (!origin) { sendResponse(err(4100, "This page can't use the wallet.")); return false; }
    const method = String(msg.method);
    handleRpc(origin, method, msg.params).then((r) => {
      if (r !== "approval") return sendResponse(r);
      if (!APPROVAL_METHODS.has(method)) return sendResponse(err(4200, "Unsupported"));
      void openApproval({ id: crypto.randomUUID(), origin, method, params: msg.params, reply: sendResponse });
    });
    return true;
  }

  // From the approval window (extension pages only)
  if (sender.id !== chrome.runtime.id || sender.tab) return false;
  if (msg?.type === "hm:get") {
    const p = pending.get(msg.id);
    sendResponse(p ? { origin: p.origin, method: p.method, params: p.params } : null);
    return false;
  }
  if (msg?.type === "hm:resolve") {
    const p = pending.get(msg.id);
    if (!p) { sendResponse(false); return false; }
    pending.delete(msg.id);
    (async () => {
      if (msg.connect?.address) {
        const prev = (await getSites())[p.origin];
        await setSite(p.origin, { address: msg.connect.address, chainId: prev?.chainId ?? "0x1" });
        void broadcast(p.origin, "connect", { chainId: prev?.chainId ?? "0x1" });
        void broadcast(p.origin, "accountsChanged", [msg.connect.address]);
      }
      p.reply(msg.error ? err(4001, String(msg.error)) : { result: msg.result });
      sendResponse(true);
    })();
    return true;
  }
  return false;
});

chrome.windows.onRemoved.addListener((windowId: number) => {
  for (const [id, p] of pending) {
    if (p.windowId === windowId) {
      pending.delete(id);
      p.reply(err(4001, "User rejected the request."));
    }
  }
});
