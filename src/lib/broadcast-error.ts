/**
 * Translate raw Bitcoin/TXC/ISK node broadcast errors into a friendlier,
 * actionable message. The most common one we've been seeing is
 * `txn-mempool-conflict` — it means the inputs the wallet picked are already
 * being spent by a still-unconfirmed transaction (usually a send the user
 * kicked off ~30s earlier before the UTXO cache refreshed).
 */
export function friendlyBroadcastError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  const lower = msg.toLowerCase();
  // Keep the node's own words on the end — without them a repeat failure is
  // impossible to diagnose from a screenshot.
  const detail = msg ? ` (node said: ${msg.slice(0, 160)})` : "";

  if (lower.includes("txn-mempool-conflict") || lower.includes("mempool-conflict")) {
    return `Those coins are already committed to a transaction that hasn't confirmed yet. They've been set aside — pull to refresh and send again.${detail}`;
  }
  if (lower.includes("txn-already-in-mempool") || lower.includes("already in block chain")) {
    return "This transaction has already been broadcast — no action needed. Balances will update once it confirms.";
  }
  if (lower.includes("min relay fee not met") || lower.includes("min fee not met")) {
    return `The fee is too low for the network to relay this transaction. Bump the fee tier and try again.${detail}`;
  }
  if (lower.includes("dust")) {
    return `One of the outputs is below TEXITcoin's dust threshold. Increase the amount and try again.${detail}`;
  }
  if (lower.includes("bad-txns-inputs-missingorspent")) {
    return `One of the inputs was already spent. It's been set aside — refresh your balance and try again.${detail}`;
  }
  return msg || "Send failed";
}


/**
 * Upstream explorers sometimes answer with a full HTML page (Cloudflare block,
 * gateway error). Collapse that into something readable before it reaches the UI.
 */
export function cleanUpstreamBody(body: string, max = 300): string {
  const trimmed = body.trim();
  if (/^\s*<(!doctype|html)/i.test(trimmed)) return "explorer node unavailable (blocked upstream)";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}
