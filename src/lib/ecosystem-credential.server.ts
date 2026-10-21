/** Honest Money now issues a per-site key under the standard HME_ECOSYSTEM name.
 * This is not a fallback to the retired cross-partner key. Never use it to
 * silently migrate partner payment/notification authentication.
 */
export function ecosystemCredential(): { apiKey: string; site: string } {
  const apiKey = process.env["HME_ECOSYSTEM"];
  if (!apiKey) throw new Error("dedicated ecosystem site credential missing");
  return { apiKey, site: "wallet" };
}