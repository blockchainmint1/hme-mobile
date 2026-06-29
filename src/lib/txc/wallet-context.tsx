/**
 * React context holding the currently-unlocked TEXITcoin wallet (in memory only).
 * The BIP32 root is rebuilt from the mnemonic on unlock; nothing is persisted
 * in plaintext.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { BIP32Interface } from "bip32";
import { rootFromSeed, seedFromMnemonic } from "./wallet";
import { deleteWallet, unlockWallet, type UnlockedWallet } from "./storage";

interface WalletContextValue {
  unlocked: UnlockedWallet | null;
  root: BIP32Interface | null;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  forget: () => void;
  loadFromMemory: (w: UnlockedWallet) => Promise<void>;
}

const Ctx = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<UnlockedWallet | null>(null);
  const [root, setRoot] = useState<BIP32Interface | null>(null);

  const loadFromMemory = useCallback(async (w: UnlockedWallet) => {
    const seed = await seedFromMnemonic(w.mnemonic, w.passphrase);
    setRoot(rootFromSeed(seed));
    setUnlocked(w);
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
    setUnlocked(null);
    setRoot(null);
  }, []);

  const forget = useCallback(() => {
    deleteWallet();
    setUnlocked(null);
    setRoot(null);
  }, []);

  const value = useMemo<WalletContextValue>(
    () => ({ unlocked, root, unlock, lock, forget, loadFromMemory }),
    [unlocked, root, unlock, lock, forget, loadFromMemory],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used within WalletProvider");
  return v;
}
