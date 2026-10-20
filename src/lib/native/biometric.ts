/**
 * Biometric unlock for the HME Wallet.
 *
 * Password unlock remains unchanged. Biometric password retention is disabled
 * until the OS itself gates secret retrieval, rather than a separate JS prompt.
 * Startup clears only legacy biometric keys, never wallet/profile data.
 */
import { isNative } from "./platform";

const SECURE_KEY = "txc.wallet.bio.password.v1";
const FLAG_KEY = "txc.wallet.bio.enabled.v1";
const LEGACY_FLAG_KEY = "txc.wallet.bio.enabled";

export interface BiometricStatus {
  available: boolean;
  enabled: boolean;
  reason?: string;
}

async function loadPlugins() {
  if (!isNative()) return null;
  const [{ BiometricAuth }, { SecureStorage }] = await Promise.all([
    import("@aparajita/capacitor-biometric-auth"),
    import("@aparajita/capacitor-secure-storage"),
  ]);
  return { BiometricAuth, SecureStorage };
}

export async function isBiometricAvailable(): Promise<boolean> {
  // Disabled until native key retrieval itself requires OS biometric authorization.
  // Clearing only these keys does not touch wallet envelopes or profiles.
  await disableBiometric();
  return false;
}

export function isBiometricEnabled(): boolean {
  return false;
}

export async function getBiometricStatus(): Promise<BiometricStatus> {
  const available = await isBiometricAvailable();
  return { available, enabled: false, reason: "Fingerprint unlock is temporarily unavailable. Use your wallet password." };
}

/**
 * Never retain a password in plugin storage.
 */
export async function enableBiometric(password: string): Promise<void> {
  void password;
  await disableBiometric();
  throw new Error("Fingerprint unlock is temporarily unavailable. Use your wallet password.");
}

export async function disableBiometric(): Promise<void> {
  const plugins = await loadPlugins();
  if (plugins) {
    try {
      await plugins.SecureStorage.remove(SECURE_KEY);
    } catch {
      /* ignore */
    }
    try {
      await plugins.SecureStorage.remove(FLAG_KEY);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LEGACY_FLAG_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Prompt for biometrics and return the stored password on success.
 * Returns null if the user cancels or biometrics is not enabled.
 */
export async function unlockWithBiometric(): Promise<string | null> {
  await disableBiometric();
  return null;
}

/**
 * Re-authenticate the user with biometrics before a sensitive action
 * (e.g. broadcasting a payment). Resolves true on success or when
 * biometrics is unavailable / not enabled on this device (the caller is
 * expected to have its own confirmation UI in that case). Resolves false
 * only when biometrics is available + enabled and the user cancels or
 * fails the prompt.
 */
export async function confirmWithBiometric(reason: string): Promise<boolean> {
  const plugins = await loadPlugins();
  if (!plugins) return true;
  try {
    await plugins.BiometricAuth.authenticate({
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
