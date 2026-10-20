/** Free-form signatures must not bypass the dedicated authorization flows. */
export function assertFreeformMessage(message: string): void {
  if (/wants you to sign in|honest money\s*-\s*(link wallet|revoke)|hm-card\||hm-link-delegate|honest money\s*-\s*(approve|decline).*trade/i.test(message)) {
    throw new Error("This is a sign-in or spending authorization. Use the site's QR approval flow instead.");
  }
}

/** Emergency policy: EVM signatures are limited to domain-bound SIWE. */
export function validateSiwe(message: string, origin: string, address: string, chainId: string, now = Date.now()): void {
  const lines = message.split("\n");
  const site = new URL(origin);
  if (lines[0] !== `${site.host} wants you to sign in with your Ethereum account:` || lines[1]?.toLowerCase() !== address.toLowerCase() || lines[2] !== "") {
    throw new Error("Only sign-in messages for the requesting site can be signed.");
  }
  const uriIndex = lines.findIndex((line) => line.startsWith("URI: "));
  if (uriIndex < 3 || lines[uriIndex - 1] !== "") throw new Error("Invalid sign-in message.");
  const fields = lines.slice(uriIndex);
  if (!fields[0] || new URL(fields[0].slice(5)).origin !== site.origin || fields[1] !== "Version: 1" || fields[2] !== `Chain ID: ${BigInt(chainId)}` || !/^Nonce: [A-Za-z0-9]{8,}$/.test(fields[3] ?? "")) {
    throw new Error("Sign-in domain, network or nonce doesn't match this request.");
  }
  const issued = Date.parse((fields[4] ?? "").replace(/^Issued At: /, ""));
  if (!fields[4]?.startsWith("Issued At: ") || !Number.isFinite(issued) || issued > now + 60_000 || now - issued > 600_000) throw new Error("Sign-in message expired or has an invalid time.");
  let previous = 0;
  for (const line of fields.slice(5)) {
    const key = line.split(": ")[0];
    const order = ["Expiration Time", "Not Before", "Request ID"].indexOf(key ?? "") + 1;
    if (!order || order <= previous) throw new Error("Unsupported sign-in fields; spending authorizations cannot be signed here.");
    previous = order;
    if (key === "Expiration Time" || key === "Not Before") {
      const time = Date.parse(line.slice(line.indexOf(": ") + 2));
      if (!Number.isFinite(time) || (key === "Expiration Time" ? time <= now : time > now)) throw new Error("Sign-in is not currently valid.");
    }
  }
}