/**
 * "Your wallets" card for the settings page.
 *
 * An inline, always-visible version of the header ProfileSwitcher sheet: lists
 * every seed/vault stored on this device, with rename, switch and remove
 * actions, plus the entry points for adding seeds, private keys and watch-only
 * addresses. One shared password unlocks every profile, so switching is silent
 * while the session is alive — we only ask for it as a fallback.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Check,
  Download,
  Eye,
  Key,
  Loader2,
  Pencil,
  Sparkles,
  Trash2,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useWallet } from "@/lib/txc/wallet-context";
import { deleteProfileWallet, renameStoredWallet } from "@/lib/txc/storage";

export function ProfilesCard({ compact }: { compact?: boolean }) {
  const { profiles, activeProfileId, switchProfile, refreshProfiles, rename, unlocked } =
    useWallet();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  useEffect(() => {
    refreshProfiles();
  }, [refreshProfiles]);

  async function go(id: string, pw?: string) {
    if (id === activeProfileId) return;
    setBusyId(id);
    try {
      const ok = await switchProfile(id, pw);
      if (!ok) {
        if (!pw) {
          setNeedPassword(id);
        } else {
          toast.error("Wrong password for that wallet.");
        }
        return;
      }
      setNeedPassword(null);
      setPassword("");
      toast.success("Switched wallet");
    } finally {
      setBusyId(null);
    }
  }

  function saveRename(id: string) {
    const next = draftLabel.trim();
    const current = profiles.find((p) => p.id === id)?.label ?? "";
    setEditingId(null);
    if (!next || next === current) return;
    if (id === activeProfileId) {
      rename(next);
    } else {
      renameStoredWallet(next, id);
      refreshProfiles();
    }
    toast.success("Wallet renamed");
  }

  function remove(id: string) {
    setPendingRemove(null);
    deleteProfileWallet(id);
    refreshProfiles();
    toast.success("Wallet removed from this device");
  }

  const pendingLabel = profiles.find((p) => p.id === pendingRemove)?.label ?? "This wallet";

  return (
    <Card className={compact ? undefined : "mt-5"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" /> Your wallets
        </CardTitle>
        <CardDescription>
          Each wallet is a separate seed with its own chains, keys and contacts. One password
          unlocks them all.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {profiles.map((p) => {
          const isActive = p.id === activeProfileId;
          return editingId === p.id ? (
            <form
              key={p.id}
              className="flex items-center gap-2 rounded-xl border border-primary/60 bg-card/40 px-4 py-2.5"
              onSubmit={(e) => {
                e.preventDefault();
                saveRename(p.id);
              }}
            >
              <Input
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                maxLength={40}
                autoFocus
                className="h-8"
              />
              <Button type="submit" size="sm" disabled={!draftLabel.trim()}>
                Save
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <div
              key={p.id}
              className="flex items-center justify-between gap-2 rounded-xl border border-border/60 bg-card/40 px-4 py-3 transition-colors hover:border-primary/60"
            >
              <button
                onClick={() => go(p.id)}
                disabled={busyId !== null}
                className="min-w-0 flex-1 text-left disabled:opacity-60"
                title={isActive ? p.label : `Switch to ${p.label}`}
              >
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.label}</span>
                  {isActive && <Badge className="h-4 shrink-0 px-1.5 text-[10px]">Active</Badge>}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {p.mode === "keyonly" ? "Imported keys" : "Seed phrase wallet"}
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5">
                {busyId === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
                <button
                  onClick={() => {
                    setEditingId(p.id);
                    setDraftLabel(p.label);
                  }}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={`Rename ${p.label}`}
                  aria-label={`Rename ${p.label}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {!isActive && (
                  <button
                    onClick={() => setPendingRemove(p.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive"
                    title={`Remove ${p.label} from this device`}
                    aria-label={`Remove ${p.label} from this device`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {isActive && <Check className="ml-1 h-4 w-4 text-primary" />}
              </div>
            </div>
          );
        })}

        {needPassword && (
          <form
            className="space-y-2 rounded-xl border border-border/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void go(needPassword, password);
            }}
          >
            <p className="text-sm text-muted-foreground">
              Enter your wallet password to switch.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Wallet password"
                autoFocus
              />
              <Button type="submit" disabled={!password || busyId !== null}>
                Unlock
              </Button>
            </div>
          </form>
        )}

        <div className="grid gap-2 pt-3 sm:grid-cols-2">
          <Button asChild variant="secondary">
            <Link to="/create" search={{ add: true }}>
              <Sparkles className="h-4 w-4 mr-2" /> Add new seed
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/import" search={{ add: true }}>
              <Download className="h-4 w-4 mr-2" /> Import a seed
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/wallet/wif-add">
              <Key className="h-4 w-4 mr-2" /> Import private key
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/wallet/watch-add">
              <Eye className="h-4 w-4 mr-2" /> Watch-only address
            </Link>
          </Button>
        </div>
        <p className="pt-1 text-xs text-muted-foreground">
          Private keys and watch-only addresses are added to{" "}
          <span className="font-medium text-foreground">
            {profiles.find((p) => p.id === activeProfileId)?.label ?? unlocked?.label ?? "the active wallet"}
          </span>{" "}
          as their own tiles. Removing a wallet here only forgets it on this device — your seed
          phrase is still the backup.
        </p>

        <AlertDialog open={!!pendingRemove} onOpenChange={(o) => !o && setPendingRemove(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove wallet from this device?</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="font-medium text-foreground">{pendingLabel}</span> will be removed
                from this device. Your funds stay on the blockchain and you can re-add it any time
                with its seed phrase.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className={buttonVariants({ variant: "destructive" })}
                onClick={() => pendingRemove && remove(pendingRemove)}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
