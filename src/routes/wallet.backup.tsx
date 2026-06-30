import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { unlockWallet } from "@/lib/txc/storage";
import { AlertTriangle, EyeOff, Eye } from "lucide-react";

export const Route = createFileRoute("/wallet/backup")({
  head: () => ({ meta: [{ title: "Backup — HME Wallet" }] }),
  component: BackupPage,
});

function BackupPage() {
  const { unlocked } = useWallet();
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const w = await unlockWallet(password);
    if (!w) {
      setError("Wrong password.");
      return;
    }
    setShown(w.mnemonic);
  }

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Back up your seed phrase</h1>
      <p className="text-sm text-muted-foreground">
        Showing wallet: <strong>{unlocked?.label}</strong>
      </p>

      <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-700/40 bg-amber-950/10 p-3 text-sm">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-500" />
        <p>
          Anyone with these words controls your TXC. Make sure no one is looking over your
          shoulder, no screen recording is on, and you trust this device.
        </p>
      </div>

      {!shown ? (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Confirm password</CardTitle>
            <CardDescription>To reveal the seed, re-enter the wallet password.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={verify} className="space-y-3">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="current-password"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={!password}>
                Reveal seed phrase
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="mt-5">
          <CardHeader>
            <CardTitle>Your seed phrase</CardTitle>
            <CardDescription>Write it on paper. Don't take a screenshot.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div
                className={`grid grid-cols-2 sm:grid-cols-3 gap-2 ${
                  reveal ? "" : "blur-md select-none pointer-events-none"
                }`}
              >
                {shown.split(" ").map((w, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-md border border-border/60 bg-background/60 px-3 py-2 font-mono text-sm"
                  >
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}.</span>
                    <span>{w}</span>
                  </div>
                ))}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setReveal((r) => !r)}
                className="mt-3"
              >
                {reveal ? <EyeOff className="h-4 w-4 mr-1.5" /> : <Eye className="h-4 w-4 mr-1.5" />}
                {reveal ? "Hide" : "Tap to reveal"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
