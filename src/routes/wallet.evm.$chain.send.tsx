/**
 * Send native token on an EVM chain. Minimal v1: address + amount, gas auto.
 */
import { createFileRoute, Link, notFound, useNavigate, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { createWalletClient, http, isAddress, parseEther } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useWallet } from "@/lib/txc/wallet-context";
import { EVM_CHAINS, deriveEvmAccount, evmClient, formatEth, type EvmChainId } from "@/lib/chains/evm";
import { ContactPicker } from "@/components/ContactPicker";

export const Route = createFileRoute("/wallet/evm/$chain/send")({
  component: EvmSend,
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

function EvmSend() {
  const { chain } = useParams({ from: "/wallet/evm/$chain/send" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const { root } = useWallet();
  const navigate = useNavigate();

  const account = useMemo(() => (root ? deriveEvmAccount(root) : null), [root]);
  const [to, setTo] = useState("");
  const [confirmTail, setConfirmTail] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);

  const balance = useQuery({
    queryKey: ["evm-balance", chainId, account?.address],
    enabled: !!account,
    queryFn: () => evmClient(chainId).getBalance({ address: account!.address }),
    staleTime: 15_000,
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("Wallet locked");
      if (!isAddress(to)) throw new Error("Invalid address");
      const last4 = to.slice(-4).toLowerCase();
      if (confirmTail.toLowerCase() !== last4) {
        throw new Error("Re-type the last 4 characters of the address to confirm");
      }
      const value = parseEther(amount as `${number}`);
      const walletClient = createWalletClient({
        account,
        chain: meta.viemChain,
        transport: http(`/api/evm/${chainId}`),
      });
      const hash = await walletClient.sendTransaction({ to: to as `0x${string}`, value });
      return hash;
    },
    onError: (e: Error) => setError(e.message),
    onSuccess: () => {
      navigate({ to: "/wallet" });
    },
  });

  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Link
        to="/wallet"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <h1 className="text-2xl font-semibold mb-1">Send {meta.nativeSymbol}</h1>
      <p className="text-sm text-muted-foreground mb-6">on {meta.name}</p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">Recipient address</label>
            <Input
              value={to}
              onChange={(e) => setTo(e.target.value.trim())}
              placeholder="0x..."
              className="font-mono"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <div className="mt-2">
              <ContactPicker chain={chainId} onPick={setTo} />
            </div>
          </div>

          {isAddress(to) && (
            <div>
              <label className="text-xs uppercase tracking-wide text-muted-foreground">
                Confirm last 4 of address
              </label>
              <Input
                value={confirmTail}
                onChange={(e) => setConfirmTail(e.target.value.trim())}
                placeholder={to.slice(-4)}
                className="font-mono"
                maxLength={4}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
          )}

          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Amount ({meta.nativeSymbol})</span>
              {balance.data != null && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => setAmount(formatEth(balance.data, 18))}
                >
                  Max: {formatEth(balance.data)}
                </button>
              )}
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              placeholder="0.0"
              inputMode="decimal"
            />
          </div>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <Button
            onClick={() => {
              setError(null);
              send.mutate();
            }}
            disabled={!to || !amount || send.isPending}
            className="w-full"
            size="lg"
          >
            {send.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Send
          </Button>
        </CardContent>
      </Card>

      <p className="mt-4 text-xs text-muted-foreground">
        Gas is estimated automatically. The transaction is signed on this device and broadcast through
        the wallet's RPC.
      </p>
    </main>
  );
}
