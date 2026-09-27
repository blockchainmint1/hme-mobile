/**
 * Runs in the page's own JavaScript world. Exposes the honest.money provider:
 *  - EIP-6963 announcement (appears alongside MetaMask etc., never fights it)
 *  - window.ethereum only when no other wallet already claimed it
 *  - window.honestMoney with `txc_signIn` for one-click hm-login sign-in
 * It holds no keys — every request is relayed to the extension, and anything
 * that signs opens an approval window.
 */
(() => {
  const w = window as unknown as Record<string, unknown>;
  if (w.honestMoney) return;

  const ICON =
    "data:image/svg+xml;base64," +
    btoa(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#14100b"/><text x="32" y="44" font-family="Arial" font-weight="700" font-size="34" text-anchor="middle" fill="#e8a33d">h</text></svg>',
    );

  type Pending = { res: (v: unknown) => void; rej: (e: unknown) => void };
  const pending = new Map<string, Pending>();
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  let seq = 0;

  function emit(event: string, data: unknown) {
    listeners.get(event)?.forEach((fn) => {
      try { fn(data); } catch { /* listener errors are the page's problem */ }
    });
  }

  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data as { target?: string; id?: string; event?: string; data?: unknown; result?: unknown; error?: { code: number; message: string } };
    if (!d || d.target !== "hm-inpage") return;
    if (d.event) return emit(d.event, d.data);
    const p = d.id ? pending.get(d.id) : undefined;
    if (!p) return;
    pending.delete(d.id!);
    if (d.error) p.rej(Object.assign(new Error(d.error.message), { code: d.error.code }));
    else p.res(d.result);
  });

  function request(args: { method: string; params?: unknown }): Promise<unknown> {
    if (!args || typeof args.method !== "string") return Promise.reject(Object.assign(new Error("Invalid request"), { code: -32600 }));
    return new Promise((res, rej) => {
      const id = `hm-${Date.now()}-${++seq}`;
      pending.set(id, { res, rej });
      window.postMessage({ target: "hm-content", id, method: args.method, params: args.params ?? [] }, window.location.origin);
    });
  }

  const provider = {
    isHonestMoney: true,
    request,
    enable: () => request({ method: "eth_requestAccounts" }),
    on(event: string, fn: (...a: unknown[]) => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return provider;
    },
    removeListener(event: string, fn: (...a: unknown[]) => void) {
      listeners.get(event)?.delete(fn);
      return provider;
    },
    /** One-click TXC sign-in for hm-login sites. */
    signIn: (message: string) => request({ method: "txc_signIn", params: { message } }),
  };

  Object.defineProperty(window, "honestMoney", { value: provider, writable: false, configurable: false });
  if (!w.ethereum) {
    try { Object.defineProperty(window, "ethereum", { value: provider, writable: true, configurable: true }); } catch { /* another wallet won */ }
  }

  const info = Object.freeze({
    uuid: crypto.randomUUID(),
    name: "honest.money",
    icon: ICON,
    rdns: "money.honest.wallet",
  });
  const announce = () =>
    window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
  window.dispatchEvent(new Event("honestmoney#initialized"));
})();
