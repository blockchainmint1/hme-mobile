export function isSafeProxyPath(path: string): boolean {
  return !/[\\%?#]/.test(path) && !path.split("/").some((part) => part === "." || part === "..");
}
export function validRpcBatch(body: unknown): boolean {
  const calls = Array.isArray(body) ? body : [body];
  return calls.length > 0 && calls.length <= 50 && calls.every((call) => typeof call === "object" && call !== null);
}