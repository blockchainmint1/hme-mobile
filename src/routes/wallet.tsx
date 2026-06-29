import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useWallet } from "@/lib/txc/wallet-context";
import { Button } from "@/components/ui/button";
import { Lock, Home, Send, QrCode, Settings as Cog, Shield } from "lucide-react";
import { ThemeIconButton } from "@/components/ThemeToggle";
import txcIcon from "@/assets/txc-icon-512.png.asset.json";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [{ title: "Wallet — TEXITcoin" }],
  }),
  component: WalletLayout,
});

function WalletLayout() {
  const { unlocked, lock } = useWallet();
  const navigate = useNavigate();

  useEffect(() => {
    if (!unlocked) navigate({ to: "/" });
  }, [unlocked, navigate]);

  if (!unlocked) return null;

  return (
    <div className="min-h-screen">
      <header className="border-b border-border/60 bg-card/40 backdrop-blur supports-[backdrop-filter]:bg-card/30 sticky top-0 z-10">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/wallet" className="flex items-center gap-2">
            <img
              src={txcIcon.url}
              alt="TEXITcoin"
              className="w-8 h-8 rounded-lg"
            />
            <span className="font-semibold">TEXITcoin</span>
          </Link>
          <nav className="hidden sm:flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link to="/wallet">
                <Home className="h-4 w-4 mr-1.5" /> Home
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/wallet/receive">
                <QrCode className="h-4 w-4 mr-1.5" /> Receive
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/wallet/send">
                <Send className="h-4 w-4 mr-1.5" /> Send
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/wallet/backup">
                <Shield className="h-4 w-4 mr-1.5" /> Backup
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/wallet/settings">
                <Cog className="h-4 w-4 mr-1.5" /> Settings
              </Link>
            </Button>
          </nav>
          <div className="flex items-center gap-1">
            <ThemeIconButton />
            <Button variant="ghost" size="sm" onClick={lock} title="Lock wallet">
              <Lock className="h-4 w-4" />
              <span className="sr-only">Lock</span>
            </Button>
          </div>
        </div>
        <nav className="sm:hidden border-t border-border/60 mx-auto max-w-3xl px-2 py-1 flex justify-around text-xs">
          <Link to="/wallet" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded hover:bg-accent">
            <Home className="h-4 w-4" /> Home
          </Link>
          <Link to="/wallet/receive" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded hover:bg-accent">
            <QrCode className="h-4 w-4" /> Receive
          </Link>
          <Link to="/wallet/send" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded hover:bg-accent">
            <Send className="h-4 w-4" /> Send
          </Link>
          <Link to="/wallet/backup" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded hover:bg-accent">
            <Shield className="h-4 w-4" /> Backup
          </Link>
          <Link to="/wallet/settings" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded hover:bg-accent">
            <Cog className="h-4 w-4" /> More
          </Link>
        </nav>
      </header>
      <Outlet />
    </div>
  );
}
