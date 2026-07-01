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
import { deleteWallet, renameStoredWallet, unlockWallet, type UnlockedWallet } from "./storage";
import { AUTO_LOCK_MS, clearSession, loadSession, saveSession, touchSession } from "./session-cache";

interface WalletContextValue {
  unlocked: UnlockedWallet | null;
  root: BIP32Interface | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  forget: () => void;
  loadFromMemory: (w: UnlockedWallet) => Promise<void>;
  rename: (label: string) => void;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<UnlockedWallet | null>(null);
  const [root, setRoot] = useState<BIP32Interface | null>(null);
  const autoLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadFromMemory = useCallback(async (w: UnlockedWallet) => {
    const seed = await seedFromMnemonic(w.mnemonic, w.passphrase);
    const nextRoot = rootFromSeed(seed);
    flushSync(() => {
      setRoot(nextRoot);
      setUnlocked(w);
    });
    saveSession(w);
  }, []);

  const unlock = useCallback(
    async (password: string) => {
      const w = await unlockWallet(password);
      if (!w) return false;
      await loadFromMemory(w);
      return true;
    },
    [loadFromMemory],
  );

  const lock = useCallback(() => {
    clearSession();
    setUnlocked(null);
    setRoot(null);
  }, []);

  const forget = useCallback(() => {
    deleteWallet();
    clearSession();
    setUnlocked(null);
    setRoot(null);
  }, []);

  const rename = useCallback((label: string) => {
    renameStoredWallet(label);
    setUnlocked((prev) => {
      if (!prev) return prev;
      const next = { ...prev, label };
      saveSession(next);
      return next;
    });
  }, []);

  // Rehydrate from sessionStorage on mount (page reload within 5 min).
  useEffect(() => {
    const cached = loadSession();
    if (cached) {
      void loadFromMemory(cached);
    }
  }, [loadFromMemory]);

  // Sliding auto-lock: bump lastActiveAt on user activity, and hard-lock
  // AUTO_LOCK_MS after the last touch.
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

    scheduleLock();
    const events = ["pointerdown", "keydown", "touchstart", "visibilitychange"] as const;
    for (const ev of events) window.addEventListener(ev, onActivity, { passive: true });

    return () => {
      for (const ev of events) window.removeEventListener(ev, onActivity);
      if (autoLockTimer.current) clearTimeout(autoLockTimer.current);
    };
  }, [unlocked, lock]);


  const value = useMemo<WalletContextValue>(
    () => ({ unlocked, root, unlock, lock, forget, loadFromMemory, rename }),
    [unlocked, root, unlock, lock, forget, loadFromMemory, rename],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within WalletProvider");
  return v;
}

