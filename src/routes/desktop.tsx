import { setPreferPhone } from "@/lib/desktop-pref";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowDownLeft,
  ArrowUpRight,
  LayoutDashboard,
  Settings as Cog,
  Users,
  BookUser,
  Smartphone,
  Link2,
  Shield,
} from "lucide-react";
import { useWallet } from "@/lib/txc/wallet-context";
import { scanAccount } from "@/lib/txc/scan";
import { satsToTxc, formatFiat } from "@/lib/txc/units";
import { getTxcPriceUsd } from "@/lib/txc/price.functions";
import { getAllPricesUsd } from "@/lib/chains/prices.functions";
import { EVM_CHAIN_LIST, evmClient } from "@/lib/chains/evm";
import { deriveSolanaAccount } from "@/lib/solana/network";
import { getSolBalance } from "@/lib/solana/api";
import { rootFingerprintHex } from "@/lib/txc/fingerprint";
import { loadPairing } from "@/lib/vault-link/pairing";
import { evmSourceAddress } from "@/lib/vault-link/evm-send";
import { vaultAccountSnapshot } from "@/lib/vault-link/snapshot";
import { ProfileSwitcher } from "@/components/wallet/ProfileSwitcher";
import { useHideBalances, maskAmount } from "@/lib/hide-balances";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/desktop")({
  head: () => ({
    meta: [
      { title: "Desktop Workspace — HME Wallet" },
      { name: "description", content: "A wide-screen workspace for your Honest Money wallets: portfolio, holdings and quick actions." },
      { property: "og:title", content: "Desktop Workspace — HME Wallet" },
      { property: "og:description", content: "A wide-screen workspace for your Honest Money wallets: portfolio, holdings and quick actions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DesktopWorkspace,
});

type Row = {
  key: string;
  name: string;
  symbol: string;
  amount: number | null;
  usd: number | null;
  send: { to: string; params?: Record<string, string> };
  receive: { to: string; params?: Record<string, string> };
};

function DesktopWorkspace() {
  const { unlocked, root, seed, activeProfileId, unlock } = useWallet();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden] = useHideBalances();
  const pairing = useMemo(
    () => (unlocked?.mode === "vault" ? loadPairing(activeProfileId) : null),
    [unlocked?.mode, activeProfileId],
  );

  // Same query keys as the phone wallet so both share cached results.
  const fetchPrice = useServerFn(getTxcPriceUsd);
  const price = useQuery({
    queryKey: ["txc-price"],
    queryFn: () => fetchPrice(),
    staleTime: 60_000,
    enabled: !!unlocked,
  });
  const account = useQuery({
    queryKey: ["account", unlocked?.kind, root ? rootFingerprintHex(root) : null],
    enabled: !!root && !!unlocked && (unlocked.mode !== "vault" || !!pairing?.chains.txc),
    queryFn: () => {
      if (unlocked?.mode === "vault") {
        if (!pairing) throw new Error("Vault pairing missing.");
        return vaultAccountSnapshot(pairing, "txc");
      }
      if (!root || !unlocked) throw new Error("Wallet locked.");
      return scanAccount(root, unlocked.kind);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const evmAddress = useMemo(
    () => evmSourceAddress(unlocked?.mode, root, pairing),
    [root, unlocked?.mode, pairing],
  );
  const solanaAddress = useMemo(() => (seed ? deriveSolanaAccount(seed).address : null), [seed]);
  const solanaBalance = useQuery({
    queryKey: ["solana-balance", solanaAddress],
    enabled: !!solanaAddress && !!unlocked,
    queryFn: () => getSolBalance(solanaAddress ?? ""),
    staleTime: 30_000,
  });
  const allPricesFn = useServerFn(getAllPricesUsd);
  const allPrices = useQuery({
    queryKey: ["all-prices"],
    queryFn: () => allPricesFn(),
    staleTime: 60_000,
    enabled: !!unlocked,
  });
  const evmBalances = useQueries({
    queries: EVM_CHAIN_LIST.map((c) => ({
      queryKey: ["evm-balance", c.id, evmAddress],
      enabled: !!evmAddress,
      queryFn: () => {
        if (!evmAddress) throw new Error("Wallet locked.");
        return evmClient(c.id).getBalance({ address: evmAddress });
      },
      staleTime: 30_000,
    })),
  });

  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    const txcAmt = account.data ? satsToTxc(account.data.balanceSats) : null;
    out.push({
      key: "txc",
      name: "TEXITcoin",
      symbol: "TXC",
      amount: txcAmt,
      usd: txcAmt != null && price.data?.usd ? txcAmt * price.data.usd : null,
      send: { to: "/wallet/send" },
      receive: { to: "/wallet/receive" },
    });
    EVM_CHAIN_LIST.forEach((c, i) => {
      const bal = evmBalances[i]?.data;
      const amt = bal != null ? Number(bal) / 1e18 : null;
      const p = allPrices.data?.prices?.[c.priceSymbol];
      out.push({
        key: c.id,
        name: c.name,
        symbol: c.priceSymbol,
        amount: amt,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: "/wallet/evm/$chain/send", params: { chain: c.id } },
        receive: { to: "/wallet/evm/$chain/receive", params: { chain: c.id } },
      });
    });
    if (solanaAddress) {
      const amt = solanaBalance.data != null ? solanaBalance.data / 1e9 : null;
      const p = allPrices.data?.prices?.SOL;
      out.push({
        key: "sol",
        name: "Solana",
        symbol: "SOL",
        amount: amt,
        usd: amt != null && p != null ? amt * p : null,
        send: { to: "/wallet/solana/send" },
        receive: { to: "/wallet/solana/receive" },
      });
    }
    return out;
  }, [account.data, price.data, evmBalances, allPrices.data, solanaBalance.data, solanaAddress]);

  const total = rows.reduce((s, r) => s + (r.usd ?? 0), 0);

  if (!unlocked) return (
    <main className="flex flex-1 items-center justify-center overflow-y-auto px-6 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold">Desktop Workspace</h1>
        <p className="mt-2 text-sm text-muted-foreground">Unlock your wallet</p>
        <form className="mt-6 space-y-4" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            if (!await unlock(password)) setError("Wrong password, or no wallet saved in this browser.");
            else setPassword("");
          } catch {
            setError("Could not unlock your wallet. Please try again.");
          } finally {
            setBusy(false);
          }
        }}>
          <Input type="password" aria-label="Wallet password" placeholder="Wallet password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</Button>
        </form>
        <div className="mt-4 flex justify-between gap-3">
          <Button asChild variant="outline"><Link to="/import">Import wallet</Link></Button>
          <Button asChild variant="ghost"><Link to="/" onClick={() => setPreferPhone(true)}>Phone view</Link></Button>
        </div>
      </div>
    </main>
  );

  const nav = [
    { to: "/wallet", label: "Phone view", icon: Smartphone },
    { to: "/wallet/shared", label: "Shared wallets", icon: Users },
    { to: "/wallet/contacts", label: "Address book", icon: BookUser },
    { to: "/wallet/signin", label: "Website sign-in", icon: Link2 },
    { to: "/wallet/backup", label: "Backup", icon: Shield },
    { to: "/wallet/settings", label: "Settings", icon: Cog },
  ] as const;

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="border-b border-border px-5 py-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Honest Money</div>
          <div className="text-lg font-semibold">Desktop Workspace</div>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <ProfileSwitcher />
        </div>
        <nav className="flex-1 space-y-1 p-3">
          <div className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm font-medium">
            <LayoutDashboard className="h-4 w-4" /> Portfolio
          </div>
          {nav.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={to === "/wallet" ? () => setPreferPhone(true) : undefined}
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Icon className="h-4 w-4" /> {label}
            </Link>
          ))}
        </nav>
        <div className="space-x-3 border-t border-border p-4 text-xs text-muted-foreground">
          <a href="https://honest.money" className="hover:text-foreground">honest.money</a>
          <Link to="/legal/terms" className="hover:text-foreground">Terms</Link>
          <Link to="/legal/privacy" className="hover:text-foreground">Privacy</Link>
          <Link to="/manifesto" className="hover:text-foreground">Manifesto</Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl p-8">
          <div className="text-sm text-muted-foreground">Total portfolio</div>
          <div className="mt-1 text-4xl font-semibold tracking-tight">
            {(hidden ? maskAmount(formatFiat(total)) : formatFiat(total))}
          </div>
          {unlocked.mode === "vault" && (
            <p className="mt-2 text-sm text-muted-foreground">
              Vault wallet — sending opens the QR signing flow with HME Vault.
            </p>
          )}

          <div className="mt-8 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3 text-right">Balance</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3 text-right">Share</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-border hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.symbol}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.amount == null
                        ? "…"
                        : (hidden ? maskAmount(r.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })) : r.amount.toLocaleString(undefined, { maximumFractionDigits: 8 }))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {r.usd == null ? "—" : (hidden ? maskAmount(formatFiat(r.usd)) : formatFiat(r.usd))}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {r.usd && total ? `${((r.usd / total) * 100).toFixed(1)}%` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button asChild size="sm" variant="outline">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          <Link to={r.receive.to as any} params={r.receive.params as any}>
                            <ArrowDownLeft className="mr-1 h-4 w-4" /> Receive
                          </Link>
                        </Button>
                        <Button asChild size="sm">
                          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                          <Link to={r.send.to as any} params={r.send.params as any}>
                            <ArrowUpRight className="mr-1 h-4 w-4" /> Send
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Same wallets, same safety checks as the phone app. Send and receive currently open the
            standard screens; more desktop tools are coming.
          </p>
        </div>
      </main>
    </div>
  );
}
