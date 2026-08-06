/**
 * "Cash out to USDC" panel shown under the recipient card on the TSD send
 * screen. Collapsed by default so the normal send flow is untouched.
 *
 * The panel only *creates the order*. Once created, the parent pre-fills the
 * ordinary TSD send with the order's deposit address and exact amount, so the
 * broadcast path (coin reservations, dust handling, holder top-up) is the same
 * battle-tested code as any other token payment.
 *
 * Exchange/off-ramp feature — gated by `useExchangeFeaturesAllowed()` and
 * therefore absent from the iOS build. See AGENTS.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, Check, ChevronDown, Loader2, Ticket, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { QrScanButton, parseWalletUri } from "@/components/wallet/QrScanButton";
import { AddressBookButton } from "@/components/wallet/AddressBookButton";
import {
  getCashoutSettings,
  previewCashoutCoupon,
  createCashoutOrder,
} from "@/lib/cashout/tsd.functions";
import {
  CASHOUT_PAYOUT_LABEL,
  ETH_ADDRESS_RE,
  feeLabel,
  formatUsd,
  payoutFor,
  type CashoutCouponPreview,
  type CashoutOrder,
} from "@/lib/cashout/tsd";

interface Props {
  /** TSD amount currently typed into the send form. */
  amount: string;
  /** Own TXC address refunds should be returned to (legacy T… preferred). */
  refundAddress: string | null;
  onOrder: (order: CashoutOrder) => void;
}

export function TsdCashoutPanel({ amount, refundAddress, onOrder }: Props) {
  const [open, setOpen] = useState(false);
  const [payout, setPayout] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [coupon, setCoupon] = useState<CashoutCouponPreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useServerFn(getCashoutSettings);
  const checkCoupon = useServerFn(previewCashoutCoupon);
  const createOrder = useServerFn(createCashoutOrder);

  const settings = useQuery({
    queryKey: ["tsd-cashout-settings"],
    queryFn: () => fetchSettings(),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const baseBps = settings.data?.redeemFeeBps ?? 100;
  const effectiveBps =
    coupon?.valid && coupon.redeemFeeBps != null ? Math.min(coupon.redeemFeeBps, baseBps) : baseBps;

  const numeric = useMemo(() => Number(amount), [amount]);
  const receive = payoutFor(numeric, effectiveBps);

  // A changed amount invalidates any order the user already created.
  useEffect(() => {
    setError(null);
  }, [amount, payout]);

  async function applyCode() {
    const code = codeInput.trim().toUpperCase();
    if (!code) return;
    setChecking(true);
    try {
      setCoupon(await checkCoupon({ data: { code } }));
    } catch (e) {
      setCoupon({
        valid: false,
        code,
        redeemFeeBps: null,
        reason: e instanceof Error ? e.message : "Check failed",
      });
    } finally {
      setChecking(false);
    }
  }

  async function create() {
    setError(null);
    const to = payout.trim();
    if (!ETH_ADDRESS_RE.test(to)) {
      setError("Enter the Ethereum address that should receive the USDC (0x…).");
      return;
    }
    if (!Number.isFinite(numeric) || numeric <= 0) {
      setError("Enter the amount of TSD to cash out first.");
      return;
    }
    if (!refundAddress) {
      setError("Couldn't determine a refund address for your wallet. Try again in a moment.");
      return;
    }
    const s = settings.data;
    if (s && !s.live) {
      setError("Cash-out is paused right now. Please check back soon.");
      return;
    }
    if (s && numeric < s.minAmount) {
      setError(`Minimum cash-out is ${s.minAmount} TSD.`);
      return;
    }
    if (s && numeric > s.maxAmount) {
      setError(`Maximum cash-out is ${s.maxAmount} TSD.`);
      return;
    }

    setCreating(true);
    try {
      const order = await createOrder({
        data: {
          amount: numeric,
          payoutAddress: to,
          refundAddress,
          couponCode: coupon?.valid ? coupon.code : null,
        },
      });
      onOrder(order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the cash-out order.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border/70 bg-card/40"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-3 text-left text-sm">
        <ArrowDownUp className="h-4 w-4 shrink-0 text-primary" />
        <span className="flex-1">
          <span className="font-medium">Cash out to {CASHOUT_PAYOUT_LABEL}</span>
          <span className="block text-xs text-muted-foreground">
            1:1, minus a {feeLabel(baseBps)} fee — less with a code
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-4 border-t border-border/60 px-3 pb-4 pt-4">
        {settings.isError && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {settings.error instanceof Error
              ? settings.error.message
              : "Cash-out is unavailable right now."}
          </p>
        )}

        <div>
          <Label htmlFor="cashout-payout">USDC payout address (Ethereum)</Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="cashout-payout"
              value={payout}
              onChange={(e) => setPayout(e.target.value)}
              placeholder="0x…"
              className="flex-1 font-mono"
              autoComplete="off"
              spellCheck={false}
            />
            <QrScanButton onScan={(raw) => setPayout(parseWalletUri(raw).address)} />
            <AddressBookButton chain="eth" onPick={(a) => setPayout(a)} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Must be a wallet you control on Ethereum mainnet. Exchange deposit addresses can reject
            third-party transfers.
          </p>
        </div>

        <div>
          <Label htmlFor="cashout-code" className="flex items-center gap-1.5">
            <Ticket className="h-3.5 w-3.5" /> Discount or account code (optional)
          </Label>
          <div className="mt-1 flex gap-2">
            <Input
              id="cashout-code"
              value={codeInput}
              onChange={(e) => {
                setCodeInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""));
                setCoupon(null);
              }}
              placeholder="TEXIT100"
              className="flex-1 font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!codeInput || checking}
              onClick={applyCode}
            >
              {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Apply"}
            </Button>
          </div>
          {coupon?.valid && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-primary">
              <Check className="h-3.5 w-3.5" />
              {coupon.redeemFeeBps === 0
                ? `${coupon.code} applied — fee waived`
                : `${coupon.code} applied — fee reduced to ${feeLabel(coupon.redeemFeeBps ?? 0)}`}
            </p>
          )}
          {coupon && !coupon.valid && (
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
              <TriangleAlert className="h-3.5 w-3.5" /> {coupon.reason ?? "Invalid code"}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            A TSD account code gives you the discount permanently — grab yours at tsd.honest.money.
          </p>
        </div>

        <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <Row label="You send">{numeric > 0 ? `${numeric} TSD` : "—"}</Row>
          <Row label={`Fee (${feeLabel(effectiveBps)})`}>
            {numeric > 0 ? `${formatUsd(numeric - receive)} TSD` : "—"}
          </Row>
          <Row label="You receive">
            <span className="font-semibold">
              {receive > 0 ? `${formatUsd(receive)} USDC` : "—"}
            </span>
          </Row>
        </div>

        <p className="text-xs text-muted-foreground">
          If anything goes wrong — wrong amount, expired order, failed payout — the TSD is returned
          to this wallet automatically.
        </p>

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={create}
          disabled={creating || settings.isLoading}
        >
          {creating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating order…
            </>
          ) : (
            "Create cash-out order"
          )}
        </Button>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
