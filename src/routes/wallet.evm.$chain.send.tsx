/**
 * Send on an EVM chain. Supports the native token plus USDC / USDT.
 *
 * The selected asset is driven by the `?asset=` search param so we can deep-link
 * from token rows on the dashboard: `/wallet/evm/eth/send?asset=USDC`.
 * Missing/unknown → native token.
 */
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import {
  createWalletClient,
  http,
  isAddress,
  parseEther,
  type Address,
} from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { useWallet } from "@/lib/txc/wallet-context";
import {
  EVM_CHAINS,
  deriveEvmAccount,
  evmClient,
  formatEth,
  type EvmChainId,
} from "@/lib/chains/evm";
import {
  encodeTransfer,
  readErc20Balance,
  tokenAmountFromRaw,
  tokenAmountToRaw,
  type Erc20TokenMeta,
} from "@/lib/chains/erc20";
import { getKnownTokens, useTokensForChain } from "@/lib/token-prefs";
import { AddressBookButton } from "@/components/wallet/AddressBookButton";
import { QrScanButton } from "@/components/wallet/QrScanButton";
import { hapticSuccess, hapticError } from "@/lib/native/ui";

function findKnownToken(chain: EvmChainId, symbol: string): Erc20TokenMeta | null {
  const s = symbol.toUpperCase();
  return getKnownTokens(chain).find((t) => t.symbol.toUpperCase() === s) ?? null;
}

const searchSchema = z.object({
  asset: z.string().optional(),
  to: z.string().optional(),
  amount: z.string().optional(),
});

export const Route = createFileRoute("/wallet/evm/$chain/send")({
  component: EvmSend,
  validateSearch: (raw) => searchSchema.parse(raw),
  beforeLoad: ({ params }) => {
    if (!(params.chain in EVM_CHAINS)) throw notFound();
  },
});

/**
 * Parse a scanned string. Accepts:
 *   - plain `0x…` addresses
 *   - EIP-681 URIs like `ethereum:0xabc…@1?value=1e18`
 *     and the ERC-20 form `ethereum:0xTOKEN@1/transfer?address=0xabc&uint256=…`
 * Returns the recipient address and, when we can extract it, the token symbol
 * (matched against the chain's known ERC-20s) and a decimal amount string.
 */
function parseEvmUri(
  input: string,
  chain: EvmChainId,
): { address?: string; assetSymbol?: string; amount?: string } {
  const s = input.trim();
  if (!s) return {};
  // Plain address
  if (/^0x[0-9a-fA-F]{40}$/.test(s)) return { address: s };
  // ethereum:… (or any chain scheme, we ignore the scheme and chain-id suffix)
  const m = s.match(/^[a-z]+:([^@?/]+)(?:@[^/?]+)?(?:\/([a-zA-Z0-9_]+))?(?:\?(.*))?$/);
  if (!m) return {};
  const target = m[1];
  const fn = m[2];
  const params = new URLSearchParams(m[3] ?? "");
  // ERC-20 transfer form: target = token contract, fn = "transfer"
  if (fn === "transfer" && /^0x[0-9a-fA-F]{40}$/.test(target)) {
    const to = params.get("address") ?? "";
    const raw = params.get("uint256") ?? params.get("value") ?? "";
    // Match token by contract address (case-insensitive)
    const known = getKnownTokens(chain).find(
      (t) => t.address.toLowerCase() === target.toLowerCase(),
    );
    const amount = known && raw ? safeFormatUnits(raw, known.decimals) : undefined;
    return {
      address: /^0x[0-9a-fA-F]{40}$/.test(to) ? to : undefined,
      assetSymbol: known?.symbol,
      amount,
    };
  }
  // Native payment: target is recipient, optional value= in wei
  if (/^0x[0-9a-fA-F]{40}$/.test(target)) {
    const raw = params.get("value") ?? "";
    const amount = raw ? safeFormatUnits(raw, 18) : undefined;
    return { address: target, amount };
  }
  return {};
}

function safeFormatUnits(raw: string, decimals: number): string | undefined {
  try {
    // Accept scientific notation like "1e18" too.
    const asBig =
      /^[0-9]+$/.test(raw) ? BigInt(raw) : BigInt(Math.trunc(Number(raw)));
    return tokenAmountFromRaw(asBig, decimals);
  } catch {
    return undefined;
  }
}

type AssetKind = { kind: "native" } | { kind: "erc20"; token: Erc20TokenMeta };

function EvmSend() {
  const { chain } = useParams({ from: "/wallet/evm/$chain/send" });
  const search = useSearch({ from: "/wallet/evm/$chain/send" });
  const chainId = chain as EvmChainId;
  const meta = EVM_CHAINS[chainId];
  const tokens = useTokensForChain(chainId);
  const { root } = useWallet();
  const navigate = useNavigate();

  const account = useMemo(() => (root ? deriveEvmAccount(root) : null), [root]);

  // Selected asset: derive initial from ?asset= then let user change.
  const initialAsset: AssetKind = useMemo(() => {
    const wanted = search.asset?.toUpperCase();
    if (wanted && wanted !== meta.nativeSymbol.toUpperCase()) {
      const t = findKnownToken(chainId, wanted);
      if (t) return { kind: "erc20", token: t };
    }
    return { kind: "native" };
  }, [search.asset, chainId, meta.nativeSymbol]);
  const [asset, setAsset] = useState<AssetKind>(initialAsset);

  const [to, setTo] = useState(search.to ?? "");
  const [confirmTail, setConfirmTail] = useState("");
  const [amount, setAmount] = useState(search.amount ?? "");
  const [error, setError] = useState<string | null>(null);

  // Native balance (always fetched — used for gas visibility and native sends).
  const nativeBal = useQuery({
    queryKey: ["evm-balance", chainId, account?.address],
    enabled: !!account,
    queryFn: () => evmClient(chainId).getBalance({ address: account!.address }),
    staleTime: 15_000,
  });

  // ERC20 balances for every listed token on this chain (for the asset picker).
  const tokenBalances = useQueries({
    queries: tokens.map((t) => ({
      queryKey: ["erc20-balance", chainId, t.address, account?.address],
      enabled: !!account,
      queryFn: () => readErc20Balance(chainId, t, account!.address),
      staleTime: 30_000,
    })),
  });

  const symbol =
    asset.kind === "native" ? meta.nativeSymbol : asset.token.symbol;

  const balanceDisplay = useMemo(() => {
    if (asset.kind === "native") {
      return nativeBal.data != null ? formatEth(nativeBal.data) : null;
    }
    const idx = tokens.findIndex((t) => t.address === asset.token.address);
    const raw = tokenBalances[idx]?.data;
    if (raw == null) return null;
    return Number(tokenAmountFromRaw(raw, asset.token.decimals)).toLocaleString(
      undefined,
      { maximumFractionDigits: 6 },
    );
  }, [asset, nativeBal.data, tokenBalances, tokens]);

  const handleScan = (raw: string) => {
    const parsed = parseEvmUri(raw, chainId);
    if (parsed.address) setTo(parsed.address);
    if (parsed.amount) setAmount(parsed.amount);
    if (parsed.assetSymbol) {
      const t = findKnownToken(chainId, parsed.assetSymbol);
      if (t) setAsset({ kind: "erc20", token: t });
    }
  };

  const send = useMutation({
    mutationFn: async () => {
      if (!account) throw new Error("Wallet locked");
      if (!isAddress(to)) throw new Error("Invalid address");
      const last4 = to.slice(-4).toLowerCase();
      if (confirmTail.toLowerCase() !== last4) {
        throw new Error("Re-type the last 4 characters of the address to confirm");
      }
      if (!amount || Number(amount) <= 0) throw new Error("Enter an amount");

      const walletClient = createWalletClient({
        account,
        chain: meta.viemChain,
        transport: http(`/api/evm/${chainId}`),
      });

      if (asset.kind === "native") {
        const value = parseEther(amount as `${number}`);
        return walletClient.sendTransaction({
          to: to as Address,
          value,
        });
      }

      // ERC20 transfer(to, amount)
      const raw = tokenAmountToRaw(amount, asset.token.decimals);
      const data = encodeTransfer(to as Address, raw);
      return walletClient.sendTransaction({
        to: asset.token.address,
        data,
        value: 0n,
      });
    },
    onError: (e: Error) => {
      hapticError();
      setError(e.message);
    },
    onSuccess: () => {
      hapticSuccess();
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

      <h1 className="text-2xl font-semibold mb-1">Send {symbol}</h1>
      <p className="text-sm text-muted-foreground mb-6">on {meta.name}</p>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {/* Asset picker */}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Asset
            </label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <AssetChip
                selected={asset.kind === "native"}
                onClick={() => setAsset({ kind: "native" })}
                label={meta.nativeSymbol}
                sub={nativeBal.data != null ? formatEth(nativeBal.data) : "…"}
              />
              {tokens.map((t, i) => {
                const raw = tokenBalances[i]?.data;
                const pretty =
                  raw == null
                    ? "…"
                    : Number(tokenAmountFromRaw(raw, t.decimals)).toLocaleString(
                        undefined,
                        { maximumFractionDigits: 4 },
                      );
                return (
                  <AssetChip
                    key={t.address}
                    selected={
                      asset.kind === "erc20" && asset.token.address === t.address
                    }
                    onClick={() => setAsset({ kind: "erc20", token: t })}
                    label={t.symbol}
                    sub={pretty}
                  />
                );
              })}
            </div>
          </div>

          {/* Recipient */}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground">
              Recipient address
            </label>
            <div className="mt-1 flex gap-2">
              <Input
                value={to}
                onChange={(e) => setTo(e.target.value.trim())}
                placeholder="0x..."
                className="font-mono"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <QrScanButton onScan={handleScan} />
              <AddressBookButton chain={chainId} onPick={setTo} />
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

          {/* Amount */}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted-foreground flex justify-between">
              <span>Amount ({symbol})</span>
              {balanceDisplay != null && (
                <button
                  type="button"
                  className="underline hover:text-foreground"
                  onClick={() => {
                    if (asset.kind === "native" && nativeBal.data != null) {
                      setAmount(formatEth(nativeBal.data, 18));
                    } else if (asset.kind === "erc20") {
                      const idx = tokens.findIndex(
                        (t) => t.address === asset.token.address,
                      );
                      const raw = tokenBalances[idx]?.data;
                      if (raw != null) {
                        setAmount(tokenAmountFromRaw(raw, asset.token.decimals));
                      }
                    }
                  }}
                >
                  Max: {balanceDisplay}
                </button>
              )}
            </label>
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(",", "."))}
              placeholder="0.0"
              inputMode="decimal"
            />
            {asset.kind === "erc20" && (
              <p className="mt-1 text-xs text-muted-foreground">
                Gas is paid in {meta.nativeSymbol}. You have{" "}
                {nativeBal.data != null ? formatEth(nativeBal.data) : "…"}{" "}
                {meta.nativeSymbol}.
              </p>
            )}
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
            Send {symbol}
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

function AssetChip({
  selected,
  onClick,
  label,
  sub,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  sub: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border/60 bg-card/40 hover:bg-card"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="text-xs text-muted-foreground truncate">{sub}</div>
    </button>
  );
}
