/**
 * "Cash out to USDC" panel shown under the recipient card on the TSD send
 * screen. Collapsed by default so the normal send flow is untouched, and only
 * rendered at all when the user has saved a TSD Swap API key in Settings.
 *
 * The panel only *creates the order*. Once created, the parent pre-fills the
 * ordinary TSD send with the order's deposit address and exact amount, so the
 * broadcast path (coin reservations, dust handling, holder top-up) is the same
 * battle-tested code as any other token payment.
 *
 * Fees come from the user's TSD Swap account (their key decides 1% / 0.5% / 0%)
 * — the wallet quotes what the service reports and never applies coupons.
 *
 * Exchange/off-ramp feature — gated by `useExchangeFeaturesAllowed()` and
 * therefore absent from the iOS build. See AGENTS.md.
 */
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownUp, ChevronDown, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { QrScanButton, parseWalletUri } from "@/components/wallet/QrScanButton";
import { AddressBookButton } from "@/components/wallet/AddressBookButton";
import { getCashoutSettings, createCashoutOrder } from "@/lib/cashout/tsd.functions";
import { useWallet } from "@/lib/txc/wallet-context";
import { deriveEvmAccount } from "@/lib/chains/evm";
import {
  CASHOUT_PAYOUT_LABEL,
  ETH_ADDRESS_RE,
  feeLabel,
  formatUsd,
  payoutFor,
  type CashoutOrder,
} from "@/lib/cashout/tsd";

interface Props {
  /** TSD amount currently typed into the send form. */
  amount: string;
  /** Own TXC address refunds should be returned to (legacy T… preferred). */
  refundAddress: string | null;
  /** The user's TSD Swap API key — the feature is unavailable without it. */
  apiKey: string;
  onOrder: (order: CashoutOrder) => void;
}

export function TsdCashoutPanel({ amount, refundAddress, apiKey, onOrder }: Props) {
  const [open, setOpen] = useState(false);
  const { root } = useWallet();
  const ownEvmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  const [useOwnWallet, setUseOwnWallet] = useState(true);
  const [payout, setPayout] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useServerFn(getCashoutSettings);
  const createOrder = useServerFn(createCashoutOrder);

  const settings = useQuery({
    queryKey: ["tsd-cashout-settings", apiKey],
    queryFn: () => fetchSettings({ data: { apiKey } }),
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const feeBps = settings.data?.redeemFeeBps ?? 100;

  // When "my ETH wallet" is ticked we pay out to this wallet's own EVM address.
  const effectivePayout = useOwnWallet && ownEvmAddress ? ownEvmAddress : payout;

  const numeric = useMemo(() => Number(amount), [amount]);
  const receive = payoutFor(numeric, feeBps);

  useEffect(() => {
    setError(null);
  }, [amount, payout, useOwnWallet]);

  async function create() {
    setError(null);
    const to = effectivePayout.trim();
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
        data: { apiKey, amount: numeric, payoutAddress: to, refundAddress },
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
            1:1, minus your TSD Swap account fee
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

        <div className="space-y-3">
          <Label>USDC payout address (Ethereum)</Label>

          {ownEvmAddress && (
            <label className="flex items-start gap-3 rounded-md border border-border/60 bg-muted/30 p-3">
              <Checkbox
                checked={useOwnWallet}
                onCheckedChange={(v) => setUseOwnWallet(v === true)}
                className="mt-0.5"
              />
              <span className="min-w-0 flex-1 text-sm">
                <span className="font-medium">My ETH wallet</span>
                <span className="mt-0.5 block break-all font-mono text-xs text-muted-foreground">
                  {ownEvmAddress}
                </span>
              </span>
            </label>
          )}

          {!(useOwnWallet && ownEvmAddress) && (
            <>
              <div className="flex gap-2">
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
              <p className="text-xs text-muted-foreground">
                Must be a wallet you control on Ethereum mainnet. Exchange deposit addresses can
                reject third-party transfers.
              </p>
            </>
          )}
        </div>

        <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm">
          <Row label="You send">{numeric > 0 ? `${numeric} TSD` : "—"}</Row>
          <Row label={`Your account fee (${feeLabel(feeBps)})`}>
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
