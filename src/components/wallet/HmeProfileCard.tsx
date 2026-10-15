/**
 * Optional link between this wallet and an honest.money member profile.
 * Nothing about normal wallet use changes — no account is needed to use the
 * wallet. Linking just tells honest.money "this member uses HME Wallet" (plus
 * the referral code they arrived with) so their referrer gets credit. Sharing
 * the main TXC watch key + Ethereum address is a separate, off-by-default
 * choice: those let honest.money see that wallet's activity, never spend.
 */
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import * as ecc from "@bitcoinerlab/secp256k1";
import { BIP32Factory } from "bip32";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useWallet } from "@/lib/txc/wallet-context";
import { seedFromMnemonic } from "@/lib/txc/wallet";
import { TXC_NETWORK } from "@/lib/txc/network";
import { deriveEvmAccount } from "@/lib/chains/evm";
import { isExtension, isNative, nativePlatform } from "@/lib/native/platform";
import { getStoredRef } from "@/lib/hme-profile/ref";
import { linkHmeProfile } from "@/lib/hme-profile/profile.functions";
import {
  PENDING_KEY,
  clearSsoState,
  currentSsoState,
  loadProfileLink,
  newSsoState,
  saveProfileLink,
  ssoLoginUrl,
  type HmeProfileLink,
} from "@/lib/hme-profile/store";

const bip32 = BIP32Factory(ecc);

type Receipt = { type: string; memberId: string; email: string; exp: number; state: string; receipt: string };

export function HmeProfileCard() {
  const { unlocked } = useWallet();
  const link = useServerFn(linkHmeProfile);
  const [profile, setProfile] = useState<HmeProfileLink | null>(null);
  const [shareKeys, setShareKeys] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [native, setNative] = useState(false);
  const shareKeysRef = useRef(false);
  shareKeysRef.current = shareKeys;

  useEffect(() => {
    setProfile(loadProfileLink());
    setNative(isNative());
  }, []);

  async function finish(r: Receipt, withKeys: boolean) {
    if (r.type !== "hme-profile-receipt" || r.state !== currentSsoState()) return;
    clearSsoState();
    localStorage.removeItem(PENDING_KEY);
    sessionStorage.removeItem(PENDING_KEY);
    setBusy(true);
    setError(null);
    try {
      let keys: { txc_xpub: string; evm_address: string } | undefined;
      if (withKeys && unlocked?.mnemonic) {
        const seed = await seedFromMnemonic(unlocked.mnemonic, unlocked.passphrase ?? "");
        const txc_xpub = bip32.fromSeed(seed, TXC_NETWORK as never).derivePath("m/44'/696969'/0'").neutered().toBase58();
        const evm_address = deriveEvmAccount(bip32.fromSeed(seed)).address;
        keys = { txc_xpub, evm_address };
      }
      const platform = isExtension() ? "extension" : nativePlatform();
      await link({
        data: { memberId: r.memberId, email: r.email, exp: r.exp, state: r.state, receipt: r.receipt, platform, ref: getStoredRef(), keys },
      });
      const v = { memberId: r.memberId, email: r.email, linkedAt: Date.now(), sharedKeys: !!keys };
      saveProfileLink(v);
      setProfile(v);
    } catch (e) {
      setError((e as Error).message || "Linking failed.");
    } finally {
      setBusy(false);
    }
  }

  // Popup flow: the /sso page posts a verified receipt back to us.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as Receipt | null;
      if (d && typeof d === "object" && d.type === "hme-profile-receipt") void finish(d, shareKeysRef.current);
    };
    window.addEventListener("message", onMsg);
    // Same-tab fallback (popup blocked): pick up a receipt left by /sso.
    const pending = sessionStorage.getItem(PENDING_KEY) ?? localStorage.getItem(PENDING_KEY);
    if (pending) {
      try {
        void finish(JSON.parse(pending) as Receipt, localStorage.getItem("hme-sso-share") === "1");
      } catch {
        /* ignore */
      }
    }
    return () => window.removeEventListener("message", onMsg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unlocked]);


  function start() {
    setError(null);
    const url = ssoLoginUrl(newSsoState());
    localStorage.setItem("hme-sso-share", shareKeys ? "1" : "0");
    const w = window.open(url, "hme-sso", "width=480,height=720");
    if (!w) window.location.href = url;
  }

  if (profile) {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          Linked to <span className="font-medium">{profile.email || "your honest.money profile"}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {profile.sharedKeys
            ? "Your main TXC watch key and Ethereum address were shared so activity counts toward your referrer. They can see, never spend."
            : "Only your profile and this install were shared. No wallet keys or addresses."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            saveProfileLink(null);
            setProfile(null);
          }}
        >
          Unlink on this device
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Optional. Sign in with your honest.money member account so whoever referred you gets credit
        for your wallet. You don&apos;t need an account to use the wallet, and nothing else changes.
      </p>
      {native ? (
        <p className="text-xs text-muted-foreground">
          Linking from the phone app is coming soon. For now, link from mobile.honest.money or the
          Chrome extension.
        </p>
      ) : (
        <>
          {unlocked?.mnemonic && (
            <label className="flex items-start gap-2 text-xs">
              <Checkbox checked={shareKeys} onCheckedChange={(v) => setShareKeys(v === true)} />
              <span>
                Also share my main TXC watch key and Ethereum address, so purchases and activity
                count toward my referrer. Honest Money will be able to see that history, never spend.
              </span>
            </label>
          )}
          <Button onClick={start} disabled={busy}>
            {busy ? "Linking…" : "Link my Honest Money profile"}
          </Button>
        </>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
