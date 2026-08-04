/**
 * Server-side Relay Protocol client for Tron → EVM stablecoin bridging.
 *
 * Kept server-side so the strict CSP `connect-src` stays closed, and so we
 * can add an integrator/app fee or API key later without shipping a new
 * mobile build.
 */
import {
  RELAY_TRON_CHAIN_ID,
  type BridgeQuote,
  type BridgeStatus,
  type BridgeStep,
} from "./relay";

const RELAY_API = "https://api.relay.link";

interface RelayStepItem {
  status?: string;
  data?: {
    type?: string;
    parameter?: {
      owner_address?: string;
      contract_address?: string;
      call_value?: number;
      data?: string;
    };
  };
}

interface RelayStep {
  id?: string;
  description?: string;
  action?: string;
  items?: RelayStepItem[];
  requestId?: string;
}

interface RelayAmount {
  amount?: string;
  amountUsd?: string;
  minimumAmount?: string;
}

interface RelayQuoteResponse {
  steps?: RelayStep[];
  fees?: { gas?: RelayAmount; relayer?: RelayAmount };
  details?: {
    currencyIn?: RelayAmount;
    currencyOut?: RelayAmount;
    totalImpact?: { percent?: string };
    timeEstimate?: number;
  };
  message?: string;
}

export interface QuoteArgs {
  fromAddress: string;
  fromContract: string;
  toChainId: number;
  toCurrency: string;
  amount: string;
  recipient: string;
}

export async function fetchBridgeQuote(args: QuoteArgs): Promise<BridgeQuote> {
  const res = await fetch(`${RELAY_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      user: args.fromAddress,
      originChainId: RELAY_TRON_CHAIN_ID,
      originCurrency: args.fromContract,
      destinationChainId: args.toChainId,
      destinationCurrency: args.toCurrency,
      amount: args.amount,
      recipient: args.recipient,
      tradeType: "EXACT_INPUT",
      referrer: "honest.money",
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = `Bridge quote unavailable (${res.status})`;
    try {
      const j = JSON.parse(text) as { message?: string };
      if (j.message) msg = j.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }

  const json = JSON.parse(text) as RelayQuoteResponse;
  const steps: BridgeStep[] = [];
  let requestId = "";

  for (const s of json.steps ?? []) {
    if (s.requestId) requestId = s.requestId;
    for (const item of s.items ?? []) {
      const p = item.data?.parameter;
      if (item.data?.type !== "TriggerSmartContract" || !p?.contract_address || !p.data) continue;
      steps.push({
        id: s.id ?? "step",
        description: s.description ?? s.action ?? "Confirm transaction",
        contractHex: p.contract_address,
        data: p.data,
        callValue: p.call_value ?? 0,
      });
    }
  }

  if (steps.length === 0 || !requestId) {
    throw new Error("Relay didn't return a signable Tron route for this pair.");
  }

  return {
    requestId,
    steps,
    amountIn: json.details?.currencyIn?.amount ?? args.amount,
    amountOut: json.details?.currencyOut?.amount ?? "0",
    amountOutMin: json.details?.currencyOut?.minimumAmount ?? json.details?.currencyOut?.amount ?? "0",
    amountInUsd: json.details?.currencyIn?.amountUsd ?? null,
    amountOutUsd: json.details?.currencyOut?.amountUsd ?? null,
    relayerFee: json.fees?.relayer?.amount ?? "0",
    tronGasSun: json.fees?.gas?.amount ?? "0",
    etaSeconds: json.details?.timeEstimate ?? null,
    impactPercent: json.details?.totalImpact?.percent ?? null,
  };
}

interface RelayStatusResponse {
  status?: string;
  details?: string;
  inTxHashes?: string[];
  txHashes?: string[];
}

export async function fetchBridgeStatus(requestId: string): Promise<BridgeStatus> {
  const res = await fetch(
    `${RELAY_API}/intents/status?requestId=${encodeURIComponent(requestId)}`,
    { headers: { accept: "application/json" } },
  );
  if (!res.ok) return { status: "unknown", destinationTxHash: null, originTxHash: null, details: null };

  const json = (await res.json()) as RelayStatusResponse;
  const raw = json.status ?? "unknown";
  const status: BridgeStatus["status"] =
    raw === "success"
      ? "success"
      : raw === "failure"
        ? "failure"
        : raw === "refund"
          ? "refund"
          : raw === "pending" || raw === "waiting" || raw === "delayed"
            ? "pending"
            : "unknown";

  return {
    status,
    destinationTxHash: json.txHashes?.[0] ?? null,
    originTxHash: json.inTxHashes?.[0] ?? null,
    details: json.details ?? null,
  };
}
