import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Fingerprint } from "lucide-react";
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
  head: () => ({ meta: [{ title: "Settings — TEXITcoin Wallet" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { unlocked, forget } = useWallet();
  const navigate = useNavigate();
  const [confirmText, setConfirmText] = useState("");

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Settings</h1>

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
                  onClick={() => {
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
