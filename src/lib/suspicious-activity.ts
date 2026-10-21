import type { EvmTransfer } from "@/lib/chains/history.functions";

/** Advisory only: never changes balances, stored history, or spending permissions. */
export function suspiciousActivityReason(t: EvmTransfer, history: EvmTransfer[]): string | null {
  // Keep sends visible, including failed/zero-value interactions.
  if (t.outgoing) return null;
  if (t.spam) return t.spamReason ?? "Suspicious token transfer";
  const amount = Number(t.value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (amount === 0) return "Zero-value incoming transfer";
  // Dust alone is not proof of phishing. Require a lookalike of a recipient
  // the wallet has actually paid. Only native currency is covered here.
  if (t.category !== "external" && t.category !== "internal") return null;
  if (amount > 0.000001) return null;
  const sender = t.from.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(sender)) return null;
  const lookalike = history.some((previous) => {
    const recipient = previous.outgoing ? previous.to?.toLowerCase() : null;
    return recipient && recipient !== sender &&
      /^0x[0-9a-f]{40}$/.test(recipient) &&
      recipient.slice(0, 6) === sender.slice(0, 6) &&
      recipient.slice(-4) === sender.slice(-4);
  });
  return lookalike ? "Tiny transfer from a lookalike address" : null;
}

export function filterSuspiciousActivity(history: EvmTransfer[], hide: boolean): EvmTransfer[] {
  return hide ? history.filter((t) => !suspiciousActivityReason(t, history)) : history;
}

/** Don't turn a nonzero payment into an apparent zero through rounding. */
export function formatActivityAmount(value: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  if (amount !== 0 && Math.abs(amount) < 0.000001) {
    return amount.toLocaleString(undefined, { maximumSignificantDigits: 6 });
  }
  return amount.toLocaleString(undefined, { maximumFractionDigits: 6 });
}