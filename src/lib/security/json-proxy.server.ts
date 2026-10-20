/** Bounded JSON forwarding: upstream documents can never execute at wallet origin. */
export const MAX_JSON_BYTES = 32 * 1024;

export async function readBoundedText(source: Request | Response, limit = MAX_JSON_BYTES): Promise<string> {
  const size = Number(source.headers.get("content-length"));
  if (Number.isFinite(size) && size > limit) throw new Error("payload_too_large");
  if (!source.body) return "";
  const reader = source.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > limit) throw new Error("payload_too_large");
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function forwardJson(target: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(target, { ...init, redirect: "manual", signal: controller.signal });
    if (response.status >= 300 && response.status < 400) throw new Error("redirect_not_allowed");
    if (!/^application\/(?:json|[\w.+-]+\+json)(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) throw new Error("unexpected_response_type");
    const text = await readBoundedText(response);
    const value: unknown = JSON.parse(text);
    return Response.json(value, { status: response.status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "Invalid or unavailable partner response" }, { status: 502, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } finally {
    clearTimeout(timer);
  }
}