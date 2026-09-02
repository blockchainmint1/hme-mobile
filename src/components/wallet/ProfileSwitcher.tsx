/**
 * Profile (vault) switcher.
 *
 * Each profile is a full, independent wallet environment — its own seed, WIF
 * keys, watch-only entries, chain prefs and labels. This is the single control
 * for moving between them. One password unlocks every profile, so switching is
 * silent while the session is alive; after an auto-lock we ask for it once.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, Download, Eye, Key, Loader2, Pencil, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useWallet } from "@/lib/txc/wallet-context";
import { renameStoredWallet } from "@/lib/txc/storage";

export function ProfileSwitcher() {
  const { profiles, activeProfileId, switchProfile, refreshProfiles, rename, unlocked } =
    useWallet();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [needPassword, setNeedPassword] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  useEffect(() => {
    if (open) refreshProfiles();
    else setEditingId(null);
  }, [open, refreshProfiles]);

  const activeLabel =
    profiles.find((p) => p.id === activeProfileId)?.label ?? unlocked?.label ?? "Wallet";

  async function go(id: string, pw?: string) {
    if (id === activeProfileId) {
      setOpen(false);
      return;
    }
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
      setOpen(false);
      toast.success("Switched wallet");
    } finally {
      setBusyId(null);
    }
  }

  function startRename(id: string, current: string) {
    setEditingId(id);
    setDraftLabel(current);
  }

  function saveRename(id: string) {
    const next = draftLabel.trim();
    const current = profiles.find((p) => p.id === id)?.label ?? "";
    setEditingId(null);
    if (!next || next === current) return;
    if (id === activeProfileId) {
      rename(next); // keeps the live session label in sync too
    } else {
      renameStoredWallet(next, id);
      refreshProfiles();
    }
    toast.success("Wallet renamed");
  }

  // A single profile is the common case — still show the name, but there's
  // nothing to switch between until a second seed is added.
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="sm" className="max-w-[9rem] px-2" title="Switch wallet">
          <Wallet className="h-4 w-4 shrink-0" />
          <span className="truncate text-xs font-medium">{activeLabel}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </Button>
      </SheetTrigger>
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col gap-0 rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <SheetHeader className="shrink-0 text-left">
          <SheetTitle>Your wallets</SheetTitle>
          <SheetDescription>
            Each wallet is a separate seed with its own chains, keys and contacts. One password
            unlocks them all.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="grid gap-2">
          {profiles.map((p) =>
            editingId === p.id ? (
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
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditingId(null)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div
                key={p.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/40 px-4 py-3 transition-colors hover:border-primary/60"
              >
                <button
                  onClick={() => go(p.id)}
                  disabled={busyId !== null}
                  className="min-w-0 flex-1 text-left disabled:opacity-60"
                >
                  <span className="block truncate font-medium">{p.label}</span>
                  <span className="block text-xs text-muted-foreground">
                    {p.mode === "keyonly" ? "Imported keys" : "Seed phrase wallet"}
                  </span>
                </button>
                <button
                  onClick={() => startRename(p.id, p.label)}
                  className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title={`Rename ${p.label}`}
                  aria-label={`Rename ${p.label}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                {busyId === p.id ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                ) : p.isActive ? (
                  <Check className="h-4 w-4 shrink-0 text-primary" />
                ) : null}
              </div>
            ),
          )}
        </div>

        {needPassword && (
          <form
            className="mt-4 space-y-2"
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
        </div>

        <div className="mt-5 grid shrink-0 gap-2 sm:grid-cols-2">
          <Button asChild variant="secondary" onClick={() => setOpen(false)}>
            <Link to="/create" search={{ add: true }}>
              <Sparkles className="h-4 w-4 mr-2" /> Add new seed
            </Link>
          </Button>
          <Button asChild variant="outline" onClick={() => setOpen(false)}>
            <Link to="/import" search={{ add: true }}>
              <Download className="h-4 w-4 mr-2" /> Import a seed
            </Link>
          </Button>
          <Button asChild variant="outline" onClick={() => setOpen(false)}>
            <Link to="/wallet/wif-add">
              <Key className="h-4 w-4 mr-2" /> Import private key
            </Link>
          </Button>
          <Button asChild variant="outline" onClick={() => setOpen(false)}>
            <Link to="/wallet/watch-add">
              <Eye className="h-4 w-4 mr-2" /> Watch-only address
            </Link>
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Private keys and watch-only addresses are added to{" "}
          <span className="font-medium text-foreground">{activeLabel}</span> as their own tiles.
        </p>

      </SheetContent>
    </Sheet>
  );
}
