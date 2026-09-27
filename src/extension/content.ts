/**
 * Isolated-world bridge between the page provider (inpage.ts) and the
 * extension background worker. Passes messages only — never sees keys.
 */
declare const chrome: any;

window.addEventListener("message", (e) => {
  if (e.source !== window) return;
  const d = e.data as { target?: string; id?: string; method?: string; params?: unknown };
  if (!d || d.target !== "hm-content" || typeof d.id !== "string" || typeof d.method !== "string") return;
  const id = d.id;
  try {
    chrome.runtime.sendMessage({ type: "hm:rpc", method: d.method, params: d.params }, (resp: unknown) => {
      const failed = chrome.runtime.lastError || !resp;
      window.postMessage(
        { target: "hm-inpage", id, ...(failed ? { error: { code: 4900, message: "honest.money wallet is unavailable." } } : (resp as object)) },
        window.location.origin,
      );
    });
  } catch {
    window.postMessage({ target: "hm-inpage", id, error: { code: 4900, message: "honest.money wallet is unavailable." } }, window.location.origin);
  }
});

chrome.runtime.onMessage.addListener((m: { type?: string; event?: string; data?: unknown }) => {
  if (m?.type === "hm:event" && typeof m.event === "string") {
    window.postMessage({ target: "hm-inpage", event: m.event, data: m.data }, window.location.origin);
  }
});
