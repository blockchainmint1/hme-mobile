/**
 * The six-line hm-login sign-in message template shared by the phone app
 * (QR / tap-to-sign-in) and the browser extension (one-click sign-in).
 * Every line is fixed except the site's display name, so a site can never
 * smuggle extra terms into what the wallet signs.
 */
export function checkLoginMessageShape(message: string, domain: string): { ok: boolean; siteLabel?: string } {
  const lines = message.split("\n");
  if (lines.length !== 6) return { ok: false };
  const label = /^By signing, you authorize a sign-in session for ([A-Za-z0-9 ._-]{1,40})\.$/.exec(lines[4] ?? "");
  const ok =
    lines[0] === `${domain} wants you to sign in with your TXC wallet.` &&
    lines[1] === "" &&
    /^Nonce: [A-Za-z0-9_-]{16,128}$/.test(lines[2] ?? "") &&
    /^Issued At: \S{10,40}$/.test(lines[3] ?? "") &&
    !!label &&
    lines[5] === "This signature does not authorize any payment.";
  return ok ? { ok, siteLabel: label![1] } : { ok: false };
}
