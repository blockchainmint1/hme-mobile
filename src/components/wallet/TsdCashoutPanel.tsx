/**
 * "Cash out to USDC" panel shown under the recipient card on the TSD send
 * screen. Collapsed by default so the normal send flow is untouched, and only
 * rendered at all when the user has saved a TSD Swap API key in Settings.
 *
 * The panel does not create per-order inboxes any more: TSD Swap gives each
 * account a *permanent* deposit address plus its fee tier, and remembers where
 * the USDC should go. So the panel just reads the account, saves the payout
 * address when it changes, and pre-fills the ordinary TSD send with the
 * deposit address — the broadcast path stays the same battle-tested code.
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
import { getCashoutAccount, setCashoutPayoutAddress } from "@/lib/cashout/tsd.functions";
import { useWallet } from "@/lib/txc/wallet-context";
import { deriveEvmAccount } from "@/lib/chains/evm";
import {
  CASHOUT_PAYOUT_LABEL,
  ETH_ADDRESS_RE,
  feeLabel,
  formatUsd,
  payoutFor,
  type CashoutAccount,
} from "@/lib/cashout/tsd";

export interface CashoutPlan {
  depositAddress: string;
  feeBps: number;
  payoutAddress: string;
  amount: number;
}

interface Props {
  /** TSD amount currently typed into the send form. */
  amount: string;
  /** The user's TSD Swap API key — the feature is unavailable without it. */
  apiKey: string;
  onReady: (plan: CashoutPlan) => void;
}

export function TsdCashoutPanel({ amount, apiKey, onReady }: Props) {
  const [open, setOpen] = useState(false);
  const { root } = useWallet();
  const ownEvmAddress = useMemo(() => (root ? deriveEvmAccount(root).address : null), [root]);
  const [useOwnWallet, setUseOwnWallet] = useState(true);
  const [payout, setPayout] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchAccount = useServerFn(getCashoutAccount);
  const savePayout = useServerFn(setCashoutPayoutAddress);

  const account = useQuery<CashoutAccount>({
    queryKey: ["tsd-cashout-account", apiKey],
    queryFn: () => fetchAccount({ data: { apiKey } }),
    enabled: open,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // If TSD Swap already has a payout address on file, prefer it and don't
  // silently redirect the money to a different wallet.
  useEffect(() => {
    const saved = account.data?.payoutAddress;
    if (saved && ETH_ADDRESS_RE.test(saved)) {
      setPayout(saved);
      setUseOwnWallet(saved.toLowerCase() === (ownEvmAddress ?? "").toLowerCase());
    }
  }, [account.data?.payoutAddress, ownEvmAddress]);

  // Only the service knows the account's fee tier — never guess a default,
  // or a 0%-fee account sees a phantom 1%.
  const knownFeeBps = account.data?.feeBps;
  const feeBps = knownFeeBps ?? 0;
  const feeKnown = typeof knownFeeBps === "number";

  const effectivePayout = useOwnWallet && ownEvmAddress ? ownEvmAddress : payout;

  const numeric = useMemo(() => Number(amount), [amount]);
  const receive = payoutFor(numeric, feeBps);

  useEffect(() => {
    setError(null);
  }, [amount, payout, useOwnWallet]);

  async function confirm() {
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
    const a = account.data;
    if (!a || !a.depositAddress) {
      setError("Couldn't get your TSD Swap deposit address. Try again in a moment.");
      return;
    }
    if (!a.live) {
      setError("Cash-out is paused right now. Please check back soon.");
      return;
    }
    if (a.minAmount !== null && numeric < a.minAmount) {
      setError(`Minimum cash-out is ${a.minAmount} TSD.`);
      return;
    }
    if (a.maxAmount !== null && numeric > a.maxAmount) {
      setError(`Maximum cash-out is ${a.maxAmount} TSD.`);
      return;
    }

    setSaving(true);
    try {
      let deposit = a.depositAddress;
      let bps = a.feeBps;
      if ((a.payoutAddress ?? "").toLowerCase() !== to.toLowerCase()) {
        const updated = await savePayout({ data: { apiKey, payoutAddress: to } });
        if (updated.depositAddress) deposit = updated.depositAddress;
        bps = updated.feeBps;
      }
      onReady({ depositAddress: deposit, feeBps: bps, payoutAddress: to, amount: numeric });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't set up the cash-out.");
    } finally {
      setSaving(false);
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
        {account.isError && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            {account.error instanceof Error
              ? account.error.message
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
          <Row label={`Your account fee${feeKnown ? ` (${feeLabel(feeBps)})` : ""}`}>
            {!feeKnown ? (
              <span className="text-muted-foreground">{account.isLoading ? "Checking…" : "—"}</span>
            ) : numeric > 0 ? (
              `${formatUsd(numeric - receive)} TSD`
            ) : (
              "—"
            )}
          </Row>
          <Row label="You receive">
            <span className="font-semibold">
              {feeKnown && receive > 0 ? `${formatUsd(receive)} USDC` : "—"}
            </span>
          </Row>
          <Row label="Deposit address">
            {account.data?.depositAddress ? (
              <span className="break-all font-mono text-xs">{account.data.depositAddress}</span>
            ) : (
              <span className="text-muted-foreground">{account.isLoading ? "Checking…" : "—"}</span>
            )}
          </Row>
        </div>

        <p className="text-xs text-muted-foreground">
          This is your account's permanent TSD deposit address. If anything goes wrong the TSD is
          returned to the wallet it came from.
        </p>

        {error && (
          <p className="flex items-start gap-2 text-sm text-destructive">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </p>
        )}

        <Button
          type="button"
          className="w-full"
          onClick={confirm}
          disabled={saving || account.isLoading}
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Setting up…
            </>
          ) : (
            "Use cash-out address"
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
