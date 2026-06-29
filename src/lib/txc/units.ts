import { SATS_PER_TXC, TXC_DECIMALS } from "./network";

export function satsToTxc(sats: number | bigint): number {
  return Number(sats) / SATS_PER_TXC;
}

export function txcToSats(txc: number | string): number {
  const n = typeof txc === "string" ? parseFloat(txc) : txc;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * SATS_PER_TXC);
}

export function formatTxc(sats: number | bigint, opts: { withUnit?: boolean } = {}): string {
  const txc = satsToTxc(sats);
  const str = txc.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: TXC_DECIMALS,
  });
  return opts.withUnit === false ? str : `${str} TXC`;
}

export function formatFiat(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return "—";
  return usd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
