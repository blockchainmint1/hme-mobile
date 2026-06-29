import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { QrCode } from "@/components/wallet/QrCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Copy } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/wallet/receive")({
  head: () => ({ meta: [{ title: "Receive — TEXITcoin Wallet" }] }),
  component: ReceivePage,
});

function ReceivePage() {
  const { root, unlocked } = useWallet();
  const account = useQuery({
    queryKey: ["account", unlocked?.kind, unlocked?.mnemonic.slice(0, 12)],
    enabled: !!root && !!unlocked,
    queryFn: () => scanAccount(root!, unlocked!.kind),
    staleTime: 30_000,
  });

  const address = account.data?.nextReceiveAddress ?? "";

  return (
    <main className="mx-auto max-w-xl px-4 py-8">
      <Link to="/wallet" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back
      </Link>
      <h1 className="mt-3 text-2xl font-bold">Receive TXC</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Share this address with the sender. A new one is generated after each use, but old
        addresses keep working.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your deposit address</CardTitle>
          <CardDescription>{unlocked?.label}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          {account.isLoading ? (
            <div className="w-60 h-60 rounded-lg bg-muted animate-pulse" />
          ) : address ? (
            <>
              <QrCode value={`texitcoin:${address}`} size={240} />
              <code className="font-mono text-sm text-center break-all px-2">{address}</code>
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(address);
                  toast.success("Address copied");
                }}
              >
                <Copy className="h-4 w-4 mr-2" /> Copy address
              </Button>
            </>
          ) : (
            <p className="text-sm text-destructive">Couldn't load an address. Try again.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
