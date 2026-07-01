import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { BookUser, ChevronRight, Fingerprint, Palette } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChainsCard } from "@/components/wallet/ChainsCard";
import { RotationPolicyCard } from "@/components/wallet/RotationPolicyCard";
import { HideBalancesToggle } from "@/components/wallet/WalletDetailSheet";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MEMPOOL_BASE, DERIVATION_PATHS } from "@/lib/txc/network";
import { unlockWallet } from "@/lib/txc/storage";
import {
  disableBiometric,
  enableBiometric,
  getBiometricStatus,
} from "@/lib/native/biometric";

export const Route = createFileRoute("/wallet/settings")({
  head: () => ({ meta: [{ title: "Settings — HME Wallet" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { unlocked, forget } = useWallet();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");
  const [bio, setBio] = useState({ available: false, enabled: false });
  const [bioBusy, setBioBusy] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [bioPassword, setBioPassword] = useState("");
  const [showBioPassword, setShowBioPassword] = useState(false);

  useEffect(() => {
    getBiometricStatus().then(setBio).catch(() => undefined);
  }, []);

  async function onToggleBiometric(next: boolean) {
    setBioError(null);
    if (!next) {
      setBioBusy(true);
      await disableBiometric();
      setBio((s) => ({ ...s, enabled: false }));
      setBioBusy(false);
      return;
    }
    setShowBioPassword(true);
  }

  async function confirmEnableBiometric(e: React.FormEvent) {
    e.preventDefault();
    setBioError(null);
    setBioBusy(true);
    try {
      const w = await unlockWallet(bioPassword);
      if (!w) {
        setBioError("Wrong password.");
        return;
      }
      await enableBiometric(bioPassword);
      setBio((s) => ({ ...s, enabled: true }));
      setShowBioPassword(false);
      setBioPassword("");
    } catch (err) {
      setBioError(err instanceof Error ? err.message : "Could not enable biometrics.");
    } finally {
      setBioBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Settings</h1>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" /> Appearance
          </CardTitle>
          <CardDescription>Light, dark, or follow your system setting.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>

      <div className="mt-5">
        <ChainsCard />
      </div>

      <div className="mt-5">
        <HideBalancesToggle />
      </div>





      <Card className="mt-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5" /> Biometric unlock
          </CardTitle>
          <CardDescription>
            {bio.available
              ? "Unlock with Face ID / fingerprint instead of typing your password. Your password is still required to reveal your seed phrase or delete the wallet."
              : "Face ID / fingerprint unlock is only available in the installed iOS or Android app."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="bio-toggle" className="text-sm">
              Enable biometric unlock
            </Label>
            <Switch
              id="bio-toggle"
              checked={bio.enabled}
              disabled={!bio.available || bioBusy}
              onCheckedChange={onToggleBiometric}
            />
          </div>
          {showBioPassword && (
            <form onSubmit={confirmEnableBiometric} className="space-y-2 pt-2 border-t border-border/40">
              <Label htmlFor="bio-pw" className="text-sm">
                Confirm your wallet password
              </Label>
              <Input
                id="bio-pw"
                type="password"
                value={bioPassword}
                autoFocus
                onChange={(e) => setBioPassword(e.target.value)}
                placeholder="Wallet password"
              />
              {bioError && <p className="text-sm text-destructive">{bioError}</p>}
              <div className="flex gap-2">
                <Button type="submit" disabled={bioBusy || !bioPassword}>
                  {bioBusy ? "Verifying..." : "Enable"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowBioPassword(false);
                    setBioPassword("");
                    setBioError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Link to="/wallet/contacts" className="mt-5 block">
        <Card className="hover:bg-accent/30 transition-colors">
          <CardContent className="py-4 flex items-center gap-3">
            <BookUser className="h-5 w-5 text-muted-foreground" />
            <div className="flex-1">
              <div className="font-medium">Address book</div>
              <div className="text-xs text-muted-foreground">
                Save names for the addresses you send to most.
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      </Link>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Wallet info</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row k="Label" v={unlocked?.label ?? "—"} />
          <Row
            k="Address type"
            v={
              unlocked?.kind === "bip84"
                ? "Native segwit (txc1…)"
                : unlocked?.kind === "bip49"
                  ? "Wrapped segwit"
                  : "Legacy (T…)"
            }
          />
          <Row k="Derivation" v={unlocked ? DERIVATION_PATHS[unlocked.kind] : "—"} />
        </CardContent>
      </Card>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Backend</CardTitle>
          <CardDescription>Public TEXITcoin nodes used to read balances and broadcast.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row k="Explorer / REST" v={<code>{MEMPOOL_BASE}</code>} />
        </CardContent>
      </Card>

      <Card className="mt-5 border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Danger zone</CardTitle>
          <CardDescription>
            Removes the encrypted seed from this device. Make sure you have your seed phrase
            written down first — without it you cannot recover the wallet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Delete wallet from this device</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the encrypted wallet file from this browser. Your TXC stays on the
                  blockchain and can be restored on any device with the seed phrase. Type{" "}
                  <strong>DELETE</strong> to confirm.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <div>
                <Label htmlFor="confirm">Confirmation</Label>
                <Input
                  id="confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="Type DELETE"
                  className="mt-1"
                />
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmText !== "DELETE"}
                  onClick={async () => {
                    await disableBiometric();
                    forget();
                    navigate({ to: "/" });
                  }}
                >
                  Delete wallet
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </main>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border/40 pb-2 last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}
