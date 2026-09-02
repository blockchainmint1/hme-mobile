/**
 * React context holding the currently-unlocked TEXITcoin wallet.
 * The BIP32 root is rebuilt from the mnemonic on unlock. The unlocked
 * payload is cached in sessionStorage with a 5-minute inactivity timeout
 * so a page reload doesn't immediately re-prompt for the password.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import type { BIP32Interface } from "bip32";
import { rootFromSeed, seedFromMnemonic } from "./wallet";
import {
  deleteWallet,
  getActiveProfileId,
  listWalletProfiles,
  renameStoredWallet,
  setStoredKind,
  unlockProfile,
  unlockWallet,
  type UnlockedWallet,
  type WalletProfileSummary,
} from "./storage";
import { PROFILES_CHANGED_EVENT } from "@/lib/profiles";
import type { DerivationKind } from "./network";
import {
  AUTO_LOCK_MS,
  clearSession,
  getSessionPassword,
  loadSession,
  saveSession,
  touchSession,
} from "./session-cache";
import { clearWalletTraces } from "@/lib/query-persist";


interface WalletContextValue {
  unlocked: UnlockedWallet | null;
  root: BIP32Interface | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  forget: () => void;
  loadFromMemory: (w: UnlockedWallet) => Promise<void>;
  rename: (label: string) => void;
  /** Switch the primary derivation branch (all paths stay scanned). */
  setKind: (kind: DerivationKind) => void;
  /** All wallet profiles (vaults) stored on this device. */
  profiles: WalletProfileSummary[];
  /** Id of the profile currently loaded. */
  activeProfileId: string;
  /**
   * Switch to another profile. Uses the shared session password; pass one
   * explicitly when the session has expired. Returns false if it can't unlock.
   */
  switchProfile: (id: string, password?: string) => Promise<boolean>;
  /** True while a session password is cached (switching won't re-prompt). */
  canSwitchSilently: boolean;
  /** Re-read the profile list from storage. */
  refreshProfiles: () => void;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<UnlockedWallet | null>(null);
  const [root, setRoot] = useState<BIP32Interface | null>(null);
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profiles, setProfiles] = useState<WalletProfileSummary[]>([]);
  const [activeProfile, setActiveProfile] = useState<string>("default");

  const refreshProfiles = useCallback(() => {
    setProfiles(listWalletProfiles());
    setActiveProfile(getActiveProfileId());
  }, []);

  useEffect(() => {
    refreshProfiles();
    const h = () => refreshProfiles();
    window.addEventListener(PROFILES_CHANGED_EVENT, h);
    return () => window.removeEventListener(PROFILES_CHANGED_EVENT, h);
  }, [refreshProfiles]);

  const loadFromMemory = useCallback(async (w: UnlockedWallet) => {
    // A seed wallet's primary TXC branch is always the registered SLIP-0044
    // legacy-address path. Older encrypted envelopes and cached sessions can
    // still carry the old app's bip44-legacy metadata, which made Settings
    // report m/44'/0'/0' until the user happened to open Receive. Normalize
    // during every load so receive addresses and transaction change are
    // correct immediately, while background scanning continues to cover all
    // historical paths.
    const loadedWallet =
      w.mode !== "keyonly" && w.kind !== "bip44" ? { ...w, kind: "bip44" as const } : w;
    if (loadedWallet !== w) setStoredKind("bip44");

    // Key-only wallets have no mnemonic. Their BIP32 "root" is derived from a
    // random anchor and is used only as the wrapping key for imported WIFs —
    // no addresses are ever derived from it.
    let nextRoot;
    if (loadedWallet.mode === "keyonly") {
      const bin = atob(loadedWallet.anchor ?? "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      nextRoot = rootFromSeed(bytes);
    } else {
      const seed = await seedFromMnemonic(loadedWallet.mnemonic, loadedWallet.passphrase);
      nextRoot = rootFromSeed(seed);
    }
    flushSync(() => {
      setRoot(nextRoot);
      setUnlocked(loadedWallet);
    });
    await saveSession(loadedWallet);
    refreshProfiles();
  }, [refreshProfiles]);


  const unlock = useCallback(
    async (password: string) => {
      const w = await unlockWallet(password);
      if (!w) return false;
      await loadFromMemory(w);
      // Keep the password for the life of the session so switching vaults
      // doesn't re-prompt (one password unlocks them all).
      await saveSession(w, password);
      return true;
    },
    [loadFromMemory],
  );

  const switchProfile = useCallback(
    async (id: string, password?: string) => {
      const pw = password ?? getSessionPassword();
      if (!pw) return false;
      const w = await unlockProfile(id, pw);
      if (!w) return false;
      await loadFromMemory(w);
      await saveSession(w, pw);
      refreshProfiles();
      return true;
    },
    [loadFromMemory, refreshProfiles],
  );

  const lock = useCallback(() => {
    clearSession();
    setUnlocked(null);
    setRoot(null);
  }, []);

  const forget = useCallback(() => {
    deleteWallet();
    clearSession();
    clearWalletTraces();
    setUnlocked(null);
    setRoot(null);
    refreshProfiles();
  }, [refreshProfiles]);


  const rename = useCallback((label: string) => {
    renameStoredWallet(label);
    setProfiles(listWalletProfiles());
    setUnlocked((prev) => {
      if (!prev) return prev;
      const next = { ...prev, label };
      void saveSession(next);
      return next;
    });
  }, []);

  const setKind = useCallback((kind: DerivationKind) => {
    setStoredKind(kind);
    setUnlocked((prev) => {
      if (!prev) return prev;
      const next = { ...prev, kind };
      void saveSession(next);
      return next;
    });
  }, []);

  // Rehydrate from sessionStorage on mount (page reload within 5 min).
  useEffect(() => {
    let cancelled = false;
    void loadSession().then((cached) => {
      if (!cancelled && cached) void loadFromMemory(cached);
    });
    return () => {
      cancelled = true;
    };
  }, [loadFromMemory]);

  // Sliding auto-lock on activity + immediate lock on backgrounding.
  useEffect(() => {
    if (!unlocked) return;

    const scheduleLock = () => {
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
      autoLockTimer.current = setTimeout(() => lock(), AUTO_LOCK_MS);
    };
    const onActivity = () => {
      touchSession();
      scheduleLock();
    };
    // Backgrounding the app must LOCK, not extend the session. A short
    // grace window prevents an accidental home-swipe from wiping state.
    const BACKGROUND_GRACE_MS = 15_000;
    let bgTimer: ReturnType<typeof setTimeout> | null = null;
    const armBackgroundLock = () => {
      if (bgTimer) clearTimeout(bgTimer);
      bgTimer = setTimeout(() => lock(), BACKGROUND_GRACE_MS);
    };
    const cancelBackgroundLock = () => {
      if (bgTimer) {
        clearTimeout(bgTimer);
        bgTimer = null;
      }
    };
    const onVisibility = () => {
      if (document.hidden) armBackgroundLock();
      else {
        cancelBackgroundLock();
        onActivity();
      }
    };

    scheduleLock();
    const activityEvents = ["pointerdown", "keydown", "touchstart"] as const;
    for (const ev of activityEvents) window.addEventListener(ev, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    // Native app-lifecycle: iOS WKWebView often does not fire visibilitychange
    // when backgrounded under memory pressure, so listen to the Capacitor
    // App plugin directly.
    let removeAppListener: (() => void) | null = null;
    void (async () => {
      try {
        const { isNative } = await import("@/lib/native/platform");
        if (!isNative()) return;
        const { App } = await import("@capacitor/app");
        const sub = await App.addListener("appStateChange", ({ isActive }) => {
          if (isActive) {
            cancelBackgroundLock();
            onActivity();
          } else {
            armBackgroundLock();
          }
        });
        removeAppListener = () => {
          sub.remove().catch(() => {});
        };
      } catch {
        /* plugin not present on web */
      }
    })();

    return () => {
      for (const ev of activityEvents) window.removeEventListener(ev, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
      cancelBackgroundLock();
      removeAppListener?.();
    };
  }, [unlocked, lock]);


  const value = useMemo<WalletContextValue>(
    () => ({
      unlocked,
      root,
      unlock,
      lock,
      forget,
      loadFromMemory,
      rename,
      setKind,
      profiles,
      activeProfileId: activeProfile,
      switchProfile,
      canSwitchSilently: !!unlocked,
      refreshProfiles,
    }),
    [
      unlocked,
      root,
      unlock,
      lock,
      forget,
      loadFromMemory,
      rename,
      setKind,
      profiles,
      activeProfile,
      switchProfile,
      refreshProfiles,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within WalletProvider");
  return v;
}

