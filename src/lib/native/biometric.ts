/**
 * Fingerprint unlock for the HME Wallet (Android APK only).
 *
 * The password is encrypted by a key inside the Android Keystore that the OS
 * only releases after a strong biometric match (native HmeBiometricVault
 * plugin). JS never stores the password; older builds without the plugin
 * simply report "unavailable". Never touches wallet envelopes or profiles.
 */
import { registerPlugin } from "@capacitor/core";
import { isNative, nativePlatform } from "./platform";

interface HmeBiometricVaultPlugin {
  status(): Promise<{ available: boolean; enrolled: boolean; code?: number }>;
  enroll(opts: { password: string }): Promise<{ enrolled: boolean }>;
  unlock(opts?: { title?: string }): Promise<{ password: string }>;
  disable(): Promise<void>;
}

const Vault = registerPlugin<HmeBiometricVaultPlugin>("HmeBiometricVault");

// Legacy keys from the old (unsafe) JS-gated storage — always cleared.
const LEGACY_SECURE_KEY = "txc.wallet.bio.password.v1";
const LEGACY_FLAG_KEY_V1 = "txc.wallet.bio.enabled.v1";
const LEGACY_FLAG_KEY = "txc.wallet.bio.enabled";

export interface BiometricStatus {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

function supported(): boolean {
  return isNative() && nativePlatform() === "android";
}

let legacyCleared = false;
async function clearLegacy(): Promise<void> {
  if (legacyCleared) return;
  legacyCleared = true;
  try {
    localStorage.removeItem(LEGACY_FLAG_KEY);
  } catch {
    /* ignore */
  }
  if (!isNative()) return;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    await SecureStorage.remove(LEGACY_SECURE_KEY).catch(() => undefined);
    await SecureStorage.remove(LEGACY_FLAG_KEY_V1).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  void clearLegacy();
  if (!supported()) return { available: false, enabled: false, reason: "Fingerprint unlock is available in the Android app." };
  try {
    const s = await Vault.status();
    return {
      available: s.available,
      enabled: s.available && s.enrolled,
      reason: s.available ? undefined : "Set up a fingerprint in your phone's settings first.",
    };
  } catch {
    return { available: false, enabled: false, reason: "Update the app to use fingerprint unlock." };
  }
}

export async function isBiometricAvailable(): Promise<boolean> {
  return (await getBiometricStatus()).available;
}

/** Caller must verify the password unlocks the wallet before enrolling. */
export async function enableBiometric(password: string): Promise<void> {
  if (!supported()) throw new Error("Fingerprint unlock is available in the Android app.");
  try {
    await Vault.enroll({ password });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "CANCELLED") throw new Error("Fingerprint setup cancelled.");
    throw new Error(e instanceof Error ? e.message : "Could not set up fingerprint unlock.");
  }
}

export async function disableBiometric(): Promise<void> {
  await clearLegacy();
  if (!supported()) return;
  try {
    await Vault.disable();
  } catch {
    /* ignore — older build without the plugin */
  }
}

export class BiometricInvalidatedError extends Error {}

/**
 * Show the OS fingerprint prompt and return the password the OS released.
 * Returns null on cancel. Throws BiometricInvalidatedError when fingerprints
 * changed on the phone (the key is gone; user must re-enable).
 */
export async function unlockWithBiometric(): Promise<string | null> {
  if (!supported()) return null;
  try {
    const { password } = await Vault.unlock({ title: "Unlock honest.money" });
    return password || null;
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "INVALIDATED") throw new BiometricInvalidatedError((e as Error).message);
    return null;
  }
}

/**
 * Re-authenticate before a sensitive action (e.g. broadcasting a payment).
 * Resolves true when biometrics is unavailable (caller has its own confirm UI)
 * and false only when the user cancels or fails the prompt.
 */
export async function confirmWithBiometric(reason: string): Promise<boolean> {
  if (!isNative()) return true;
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: "Cancel",
      allowDeviceCredential: false,
      iosFallbackTitle: "Use Passcode",
      androidTitle: "Confirm payment",
      androidSubtitle: reason,
    });
    return true;
  } catch {
    return false;
  }
}
