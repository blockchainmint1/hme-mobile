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

  if (lower.includes("txn-mempool-conflict") || lower.includes("mempool-conflict")) {
    return "This transaction would spend coins that are already committed to a pending transaction. Wait ~30 seconds for balances to refresh, then try again. If it keeps happening, the previous send may need to confirm first.";
  }
  if (lower.includes("txn-already-in-mempool") || lower.includes("already in block chain")) {
    return "This transaction has already been broadcast — no action needed. Balances will update once it confirms.";
  }
  if (lower.includes("min relay fee not met") || lower.includes("min fee not met")) {
    return "The fee is too low for the network to relay this transaction. Bump the fee tier and try again.";
  }
  if (lower.includes("dust")) {
    return "Amount is below the network's dust threshold. Increase the amount and try again.";
  }
  if (lower.includes("bad-txns-inputs-missingorspent")) {
    return "One of the inputs was already spent. Refresh your balance and try again.";
  }
  return msg || "Send failed";
}
