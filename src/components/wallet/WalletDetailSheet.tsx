/**
 * Wallet tile detail sheet. Opens when a chain tile is tapped and shows:
 * - editable label (TXC wallet only — the label is stored with the seed)
 * - chain / derivation info
 * - current receive address
 * - balance with an inline show/hide toggle (global preference)
 */
import { useState } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Check, Copy, Eye, EyeOff, Pencil, X } from "lucide-react";
import { copyToClipboard } from "@/lib/clipboard";
import { useHideBalances, maskAmount } from "@/lib/hide-balances";
import { useWallet } from "@/lib/txc/wallet-context";
import { CHAIN_META, type ChainId } from "@/lib/chain-prefs";
import { useChainLabel } from "@/lib/chain-labels";
import { EVM_CHAINS, type EvmChainId } from "@/lib/chains/evm";
import { DERIVATION_PATHS } from "@/lib/txc/network";
import { ISK_DERIVATION_BASE, ISK_DEFAULT_KIND } from "@/lib/isk/network";

type Common = {
  open: boolean;
  onClose: () => void;
};

export type WalletDetailProps =
  | (Common & {
      kind: "txc";
      balanceText: string;
      fiatText: string | null;
      receiveAddress: string | null;
      txCount: number | null;
    })
  | (Common & {
      kind: "isk";
      balanceText: string;
      fiatText: string | null;
      receiveAddress: string | null;
      txCount: number | null;
    })
  | (Common & {
      kind: "evm";
      chainId: EvmChainId;
      address: string | null;
      balanceText: string;
      fiatText: string | null;
    });

export function WalletDetailSheet(props: WalletDetailProps) {
  return (
    <Drawer open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      <DrawerContent className="max-h-[90vh]">
        <DrawerHeader className="text-left">
          <DrawerTitle>Wallet details</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 overflow-y-auto space-y-4">
          {props.kind === "txc" ? (
            <TxcDetails {...props} />
          ) : props.kind === "isk" ? (
            <IskDetails {...props} />
          ) : (
            <EvmDetails {...props} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

function BalanceRow({ balance, fiat }: { balance: string; fiat: string | null }) {
  const [hidden, setHidden] = useHideBalances();
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Balance</p>
        <button
          type="button"
          onClick={() => setHidden(!hidden)}
          className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {hidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
          {hidden ? "Show" : "Hide"} balances
        </button>
      </div>
      <p className="mt-1 text-lg font-semibold">{hidden ? maskAmount(balance) : balance}</p>
      {fiat && (
        <p className="text-xs text-muted-foreground">{hidden ? maskAmount(fiat) : fiat}</p>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  copy,
}: {
  label: string;
  value: string;
  mono?: boolean;
  copy?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {copy && (
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            onClick={async () => {
              await copyToClipboard(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      <p className={`mt-1 text-sm break-all ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  bip84: "Native SegWit (bech32)",
  bip49: "Wrapped SegWit (P2SH)",
  bip44: "Legacy (P2PKH)",
};

function TxcDetails(
  props: Extract<WalletDetailProps, { kind: "txc" }>,
) {
  const { unlocked, rename } = useWallet();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(unlocked?.label ?? "");

  if (!unlocked) return null;
  const meta = CHAIN_META.txc;
  const path = DERIVATION_PATHS[unlocked.kind];

  return (
    <>
      {/* Name */}
      <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
          {!editing && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              onClick={() => {
                setDraft(unlocked.label);
                setEditing(true);
              }}
            >
              <Pencil className="h-3 w-3" /> Rename
            </button>
          )}
        </div>
        {editing ? (
          <div className="mt-2 flex items-center gap-2">
            <Input
              autoFocus
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              className="h-9"
            />
            <Button
              size="sm"
              onClick={() => {
                const label = draft.trim() || unlocked.label;
                rename(label);
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="mt-1 text-sm font-medium">{unlocked.label}</p>
        )}
      </div>

      <BalanceRow balance={props.balanceText} fiat={props.fiatText} />

      <Field label="Chain" value={meta.name} />
      <Field label="Address type" value={KIND_LABEL[unlocked.kind] ?? unlocked.kind} />
      <Field label="Derivation path" value={`${path}/0/0`} mono />
      {props.receiveAddress && (
        <Field label="Current receive address" value={props.receiveAddress} mono copy />
      )}
      {props.txCount != null && (
        <Field label="Transactions" value={String(props.txCount)} />
      )}
    </>
  );
}

function EvmDetails(
  props: Extract<WalletDetailProps, { kind: "evm" }>,
) {
  const meta = EVM_CHAINS[props.chainId];
  return (
    <>
      <div className="rounded-lg border border-border/60 bg-card/40 px-4 py-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Name</p>
        <p className="mt-1 text-sm font-medium">{meta.name}</p>
      </div>

      <BalanceRow balance={props.balanceText} fiat={props.fiatText} />

      <Field label="Native asset" value={meta.nativeSymbol} />
      <Field label="Chain ID" value={String(meta.viemChain.id)} />
      <Field label="Derivation path" value="m/44'/60'/0'/0/0" mono />
      {props.address && (
        <Field label="Address" value={props.address} mono copy />
      )}
    </>
  );
}

/** Reusable global toggle for use in Settings. */
export function HideBalancesToggle() {
  const [hidden, setHidden] = useHideBalances();
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/40 px-4 py-3">
      <div>
        <p className="text-sm font-medium">Hide balances</p>
        <p className="text-xs text-muted-foreground">Mask amounts across the app.</p>
      </div>
      <Switch checked={hidden} onCheckedChange={setHidden} />
    </div>
  );
}
