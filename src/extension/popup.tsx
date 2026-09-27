/**
 * Chrome extension popup for the honest.money wallet.
 *
 * Reuses the exact same TXC engine as the web/mobile app
 * (src/lib/txc/*) — encrypted storage, scanning, signing — so a fix
 * anywhere applies to both. The popup keeps the unlocked wallet in
 * memory only; closing the popup locks it.
 */
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Monitor, Moon, Sun } from "lucide-react";
import type { BIP32Interface } from "bip32";
import {
  generateMnemonic,
  normalizeMnemonic,
  rootFromSeed,
  seedFromMnemonic,
  validateMnemonic,
  buildAndSignTx,
  DUST_SATS,
} from "@/lib/txc/wallet";
import {
  hasWallet,
  saveWallet,
  unlockWallet,
  type UnlockedWallet,
} from "@/lib/txc/storage";
import { scanAccount, type AccountSnapshot } from "@/lib/txc/scan";
import { broadcastTx, explorerAddressUrl, explorerTxUrl, getFeeEstimates } from "@/lib/txc/mempool";
import { deriveEvmAccount } from "@/lib/chains/evm";
import { signMessageWithSeed, verifyMessage } from "@/lib/txc/message-sign";
import { checkLoginMessageShape } from "@/lib/hm-login-template";

declare const chrome: any;

/** Set when this window was opened by a website request needing approval. */
const REQ_ID = new URLSearchParams(window.location.search).get("req");
type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "hme.extension.theme";

function savedTheme(): ThemeChoice {
  const value = localStorage.getItem(THEME_KEY);
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(theme: ThemeChoice) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
}

applyTheme(savedTheme());

function ThemePicker() {
  const [theme, setTheme] = useState<ThemeChoice>(savedTheme);
  const choices = [
    { value: "system", label: "Follow system appearance", icon: Monitor },
    { value: "light", label: "Light mode", icon: Sun },
    { value: "dark", label: "Dark mode", icon: Moon },
  ] as const;

  return (
    <div className="theme-picker">
      <div className="theme-options" role="radiogroup" aria-label="Appearance">
        {choices.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
            onClick={() => {
              localStorage.setItem(THEME_KEY, value);
              applyTheme(value);
              setTheme(value);
            }}
          >
            <Icon aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  );
}

const SATS = 100_000_000;

function fmtTxc(sats: number): string {
  return (sats / SATS).toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function parseTxc(amount: string): number | null {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * SATS);
}

type View =
  | { name: "loading" }
  | { name: "welcome" }
  | { name: "unlock" }
  | { name: "create"; words?: string }
  | { name: "import" }
  | { name: "wallet" };

function App() {
  const [view, setView] = useState<View>({ name: "loading" });
  const [wallet, setWallet] = useState<UnlockedWallet | null>(null);
  const [root, setRoot] = useState<BIP32Interface | null>(null);

  useEffect(() => {
    setView(hasWallet() ? { name: "unlock" } : { name: "welcome" });
  }, []);

  const load = useCallback(async (w: UnlockedWallet) => {
    const seed = await seedFromMnemonic(w.mnemonic, w.passphrase);
    setRoot(rootFromSeed(seed));
    setWallet(w);
    setView({ name: "wallet" });
  }, []);

  if (view.name === "loading") return <div className="spin">Loading…</div>;
  if (view.name === "welcome") return <Welcome onCreate={() => setView({ name: "create" })} onImport={() => setView({ name: "import" })} />;
  if (view.name === "create") return <Create onDone={load} onBack={() => setView({ name: "welcome" })} />;
  if (view.name === "import") return <Import onDone={load} onBack={() => setView({ name: "welcome" })} />;
  if (view.name === "unlock") return <Unlock onDone={load} />;
  if (wallet && root && REQ_ID) return <Approve reqId={REQ_ID} wallet={wallet} root={root} />;
  if (wallet && root) return <Wallet wallet={wallet} root={root} onLock={() => { setWallet(null); setRoot(null); setView({ name: "unlock" }); }} />;
  return null;
}

function Header() {
  return (
    <div className="header">
      <img src="icon.png" alt="honest.money" />
      <h1>honest.money</h1>
      <p>Self-custodial TEXITcoin wallet</p>
    </div>
  );
}

function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <>
      <Header />
      <div className="card">
        <h2>Create a new wallet</h2>
        <p className="desc">Generate a fresh 12-word seed phrase. You'll back it up on the next screen.</p>
        <button onClick={onCreate}>Create new wallet</button>
      </div>
      <div className="card">
        <h2>I already have a wallet</h2>
        <p className="desc">Import your 12 or 24-word seed phrase from the old TXC Wallet app or any BIP39 wallet.</p>
        <button className="secondary" onClick={onImport}>Import seed phrase</button>
      </div>
    </>
  );
}

function Create({ onDone, onBack }: { onDone: (w: UnlockedWallet) => void; onBack: () => void }) {
  const [words, setWords] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setWords(generateMnemonic(128));
  }, []);

  async function finish() {
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    if (!words) return;
    setBusy(true);
    try {
      const w: UnlockedWallet = { mnemonic: words, passphrase: "", kind: "bip44", label: "Main wallet", mode: "seed" };
      await saveWallet(w, password);
      onDone(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save wallet.");
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <div className="card">
        <h2>Back up these words</h2>
        <p className="desc">Write them down on paper, in order. Anyone with these words can take your funds. We can never recover them for you.</p>
        <div className="words">
          {words?.split(" ").map((w, i) => (
            <span key={i}><i>{i + 1}</i>{w}</span>
          ))}
        </div>
        <label>Password (encrypts the wallet on this browser)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label>Confirm password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button onClick={finish} disabled={busy || !words}>{busy ? "Saving…" : "I've written them down"}</button>
          <button className="ghost" onClick={onBack}>Back</button>
        </div>
      </div>
    </>
  );
}

function Import({ onDone, onBack }: { onDone: (w: UnlockedWallet) => void; onBack: () => void }) {
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finish() {
    setError(null);
    const normalized = normalizeMnemonic(phrase);
    if (!validateMnemonic(normalized)) return setError("That seed phrase isn't valid. Check the words and order.");
    if (password.length < 8) return setError("Password must be at least 8 characters.");
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      const w: UnlockedWallet = { mnemonic: normalized, passphrase: "", kind: "bip44", label: "Main wallet", mode: "seed" };
      await saveWallet(w, password);
      onDone(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save wallet.");
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <div className="card">
        <h2>Import seed phrase</h2>
        <p className="desc">Enter your 12 or 24 words, separated by spaces.</p>
        <textarea value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="word1 word2 word3 …" autoFocus />
        <label>Password (encrypts the wallet on this browser)</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label>Confirm password</label>
        <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button onClick={finish} disabled={busy || !phrase.trim()}>{busy ? "Importing…" : "Import"}</button>
          <button className="ghost" onClick={onBack}>Back</button>
        </div>
      </div>
    </>
  );
}

function Unlock({ onDone }: { onDone: (w: UnlockedWallet) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const w = await unlockWallet(password);
    setBusy(false);
    if (!w) return setError("Wrong password.");
    onDone(w);
  }

  return (
    <>
      <Header />
      <div className="card">
        <h2>Unlock your wallet</h2>
        <p className="desc">Enter the password you set when this wallet was created.</p>
        <form onSubmit={submit}>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Wallet password" autoFocus />
          {error && <p className="error">{error}</p>}
          <button type="submit" disabled={busy || !password}>{busy ? "Unlocking…" : "Unlock"}</button>
        </form>
      </div>
    </>
  );
}

function Wallet({ wallet, root, onLock }: { wallet: UnlockedWallet; root: BIP32Interface; onLock: () => void }) {
  const [tab, setTab] = useState<"balance" | "receive" | "send">("balance");
  const [snap, setSnap] = useState<AccountSnapshot | null>(null);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState<string | null>(null);

  const refresh = useCallback(async (deep = false) => {
    setScanning(true);
    setScanError(null);
    try {
      setSnap(await scanAccount(root, wallet.kind, { deep }));
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Couldn't reach the network.");
    } finally {
      setScanning(false);
    }
  }, [root, wallet.kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <div className="header">
        <img src="icon.png" alt="honest.money" />
        <h1>{wallet.label || "honest.money"}</h1>
      </div>
      <div className="tabs">
        <button className={tab === "balance" ? "active" : ""} onClick={() => setTab("balance")}>Balance</button>
        <button className={tab === "receive" ? "active" : ""} onClick={() => setTab("receive")}>Receive</button>
        <button className={tab === "send" ? "active" : ""} onClick={() => setTab("send")}>Send</button>
      </div>

      {tab === "balance" && (
        <div className="card">
          {scanning && !snap ? (
            <div className="spin">Scanning the blockchain…</div>
          ) : (
            <>
              <div className="balance">{fmtTxc(snap?.balanceSats ?? 0)} <small>TXC</small></div>
              {scanError && <p className="error center">{scanError}</p>}
              <div className="row" style={{ justifyContent: "center" }}>
                <button className="secondary" onClick={() => void refresh()} disabled={scanning}>
                  {scanning ? "Refreshing…" : "Refresh"}
                </button>
                <button className="ghost" onClick={onLock}>Lock</button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === "receive" && <Receive snap={snap} />}
      {tab === "send" && <Send snap={snap} root={root} kind={wallet.kind} onSent={() => void refresh()} />}
    </>
  );
}

function Receive({ snap }: { snap: AccountSnapshot | null }) {
  const [copied, setCopied] = useState(false);
  if (!snap) return <div className="card"><div className="spin">Scanning…</div></div>;
  const addr = snap.nextReceiveAddress;
  return (
    <div className="card">
      <h2>Receive TXC</h2>
      <p className="desc">Send TEXITcoin to this address:</p>
      <div className="addr">{addr}</div>
      <div className="row">
        <button
          onClick={() => {
            void navigator.clipboard.writeText(addr).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied ✓" : "Copy address"}
        </button>
        <a href={explorerAddressUrl(addr)} target="_blank" rel="noreferrer"><button className="ghost">View on explorer</button></a>
      </div>
    </div>
  );
}

function Send({ snap, root, kind, onSent }: { snap: AccountSnapshot | null; root: BIP32Interface; kind: UnlockedWallet["kind"]; onSent: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [txid, setTxid] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function send() {
    setError(null);
    if (!snap) return setError("Still scanning — try again in a moment.");
    const sats = parseTxc(amount);
    if (!sats) return setError("Enter a valid amount.");
    if (sats < DUST_SATS) return setError(`Amount is below TEXITcoin's minimum (${DUST_SATS} sats).`);
    if (!to.trim()) return setError("Enter a destination address.");
    setBusy(true);
    try {
      const fees = await getFeeEstimates();
      const rate = Math.max(fees.halfHourFee, fees.minimumFee, 1);
      // Conservative size estimate: legacy inputs are the heaviest we support.
      const estVbytes = snap.utxos.length * 148 + 2 * 34 + 10;
      const feeSats = Math.max(Math.ceil(estVbytes * rate), 10_000);
      const total = sats + feeSats;
      const available = snap.balanceSats;
      if (total > available) throw new Error(`Insufficient funds. Need ${fmtTxc(total)} TXC including the ~${fmtTxc(feeSats)} TXC network fee.`);

      // Coin selection: largest-first until covered.
      const sorted = [...snap.utxos].sort((a, b) => b.value - a.value);
      const inputs = [];
      let acc = 0;
      for (const u of sorted) {
        inputs.push(u);
        acc += u.value;
        if (acc >= total) break;
      }

      const { hex, txid: id } = buildAndSignTx({
        root,
        kind,
        inputs,
        outputs: [{ address: to.trim(), valueSats: sats }],
        changeAddress: snap.nextChangeAddress,
        changeIndex: snap.nextChangeIndex,
        feeSats,
      });
      await broadcastTx(hex);
      setTxid(id);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  if (txid) {
    return (
      <div className="card">
        <h2>Sent ✓</h2>
        <p className="desc">Your transaction was broadcast to the network.</p>
        <div className="addr">{txid}</div>
        <div className="row">
          <button
            onClick={() => {
              void navigator.clipboard.writeText(txid).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied ✓" : "Copy transaction ID"}
          </button>
          <a href={explorerTxUrl(txid)} target="_blank" rel="noreferrer"><button className="ghost">View on explorer</button></a>
          <button className="ghost" onClick={() => { setTxid(null); setTo(""); setAmount(""); }}>Send another</button>
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2>Send TXC</h2>
      <p className="desc">Available: {fmtTxc(snap?.balanceSats ?? 0)} TXC</p>
      <label>To address</label>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="T… or txc1…" />
      <label>Amount (TXC)</label>
      <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" />
      {error && <p className="error">{error}</p>}
      <button onClick={send} disabled={busy || !snap}>{busy ? "Sending…" : "Send"}</button>
    </div>
  );
}

type ApprovalReq = { origin: string; method: string; params: unknown };

function hexToText(hex: string): string {
  if (!/^0x[0-9a-f]*$/i.test(hex)) return hex;
  try {
    const bytes = new Uint8Array((hex.slice(2).match(/../g) ?? []).map((b) => parseInt(b, 16)));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return hex;
  }
}

function Approve({ reqId, wallet, root }: { reqId: string; wallet: UnlockedWallet; root: BIP32Interface }) {
  const [req, setReq] = useState<ApprovalReq | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const account = deriveEvmAccount(root);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "hm:get", id: reqId }, (r: ApprovalReq | null) => setReq(r ?? null));
  }, [reqId]);

  if (req === undefined) return <div className="spin">Loading request…</div>;
  if (req === null) return <div className="card"><h2>Request expired</h2><p className="desc">You can close this window.</p></div>;

  const host = new URL(req.origin).hostname;
  const params = req.params as any;
  let title = "";
  let body: React.ReactNode = null;
  let signin: { ok: boolean; siteLabel?: string } | null = null;

  if (req.method === "eth_requestAccounts" || req.method === "wallet_requestPermissions") {
    title = "Connect to this site?";
    body = <p className="desc">The site will see your Ethereum address:<span className="addr" style={{ display: "block" }}>{account.address}</span>It can't move funds — every signature asks you first.</p>;
  } else if (req.method === "personal_sign") {
    title = "Sign a message";
    body = <div className="addr" style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}>{hexToText(String(params?.[0] ?? ""))}</div>;
  } else if (req.method === "eth_signTypedData_v4") {
    title = "Sign structured data";
    let pretty = String(params?.[1] ?? "");
    try { pretty = JSON.stringify(JSON.parse(pretty), null, 2); } catch { /* raw */ }
    body = <div className="addr" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>{pretty}</div>;
  } else if (req.method === "txc_signIn") {
    const message = String(params?.message ?? "");
    signin = checkLoginMessageShape(message, host);
    title = "Sign in with TEXITcoin";
    body = signin.ok
      ? <><div className="addr" style={{ whiteSpace: "pre-wrap" }}>{message}</div><p className="muted" style={{ marginTop: 8 }}>This only proves you own your address. It can't move money.</p></>
      : <p className="error">This site sent a sign-in message that doesn't match the honest.money format for {host}. It can't be signed.</p>;
  }

  function finish(payload: { result?: unknown; error?: string; connect?: { address: string } }) {
    chrome.runtime.sendMessage({ type: "hm:resolve", id: reqId, ...payload }, () => window.close());
  }

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      if (req!.method === "eth_requestAccounts") return finish({ result: [account.address], connect: { address: account.address } });
      if (req!.method === "wallet_requestPermissions") return finish({ result: [{ parentCapability: "eth_accounts" }], connect: { address: account.address } });
      if (req!.method === "personal_sign") {
        const [data, addr] = params as [string, string];
        if (String(addr).toLowerCase() !== account.address.toLowerCase()) throw new Error("That address isn't in this wallet.");
        const raw = /^0x[0-9a-f]*$/i.test(data) ? (data as `0x${string}`) : undefined;
        return finish({ result: await account.signMessage({ message: raw ? { raw } : String(data) }) });
      }
      if (req!.method === "eth_signTypedData_v4") {
        const [addr, json] = params as [string, string];
        if (String(addr).toLowerCase() !== account.address.toLowerCase()) throw new Error("That address isn't in this wallet.");
        const td = typeof json === "string" ? JSON.parse(json) : json;
        const { EIP712Domain: _d, ...types } = td.types ?? {};
        return finish({ result: await account.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message }) });
      }
      if (req!.method === "txc_signIn") {
        if (!signin?.ok) throw new Error("Invalid sign-in message.");
        const signed = await signMessageWithSeed({ mnemonic: wallet.mnemonic, passphrase: wallet.passphrase, kind: "bip44", change: 0, index: 0, message: String(params.message) });
        if (!verifyMessage(signed.address, signed.message, signed.signature)) throw new Error("Couldn't verify the signature.");
        return finish({ result: { address: signed.address, signature: signed.signature, message: signed.message } });
      }
      throw new Error("Unsupported request.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Signing failed.");
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <div className="card">
        <h2>{title}</h2>
        <p className="muted" style={{ marginBottom: 8 }}>Requested by <b style={{ color: "var(--text)" }}>{host}</b></p>
        {body}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button onClick={approve} disabled={busy || (signin !== null && !signin.ok)}>{busy ? "Signing…" : "Approve"}</button>
          <button className="secondary" onClick={() => finish({ error: "User rejected the request." })}>Reject</button>
        </div>
      </div>
    </>
  );
}

const mount = document.getElementById("root");
if (mount) createRoot(mount).render(<><ThemePicker /><App /></>);
