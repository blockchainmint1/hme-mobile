package money.honest.txcwallet;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Fingerprint unlock done the bank-app way.
 *
 * The wallet password is encrypted with an AES key that lives inside the
 * Android Keystore (hardware-backed where available). The key is created with
 * setUserAuthenticationRequired(true), so the OS itself refuses to use it
 * until a STRONG biometric match unlocks that single cipher operation
 * (BiometricPrompt + CryptoObject). Adding a new fingerprint to the phone
 * permanently invalidates the key, forcing the password again.
 */
@CapacitorPlugin(name = "HmeBiometricVault")
public class HmeBiometricVaultPlugin extends Plugin {
    private static final String KEY_ALIAS = "hme_bio_unlock_v1";
    private static final String PREFS = "hme_bio_unlock";
    private static final String P_IV = "iv";
    private static final String P_CT = "ct";
    private static final int AUTH = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void status(PluginCall call) {
        int can = BiometricManager.from(getContext()).canAuthenticate(AUTH);
        JSObject r = new JSObject();
        r.put("available", can == BiometricManager.BIOMETRIC_SUCCESS);
        r.put("enrolled", prefs().contains(P_CT) && hasKey());
        r.put("code", can);
        call.resolve(r);
    }

    @PluginMethod
    public void enroll(PluginCall call) {
        String password = call.getString("password");
        if (password == null || password.isEmpty()) {
            call.reject("Password required", "BAD_INPUT");
            return;
        }
        try {
            wipe();
            SecretKey key = createKey();
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, key);
            prompt(call, cipher, "Turn on fingerprint unlock", "Confirm it's you", c -> {
                byte[] ct = c.doFinal(password.getBytes(StandardCharsets.UTF_8));
                prefs().edit()
                    .putString(P_IV, Base64.encodeToString(c.getIV(), Base64.NO_WRAP))
                    .putString(P_CT, Base64.encodeToString(ct, Base64.NO_WRAP))
                    .apply();
                call.resolve(new JSObject().put("enrolled", true));
            });
        } catch (Exception e) {
            wipe();
            call.reject("Could not set up fingerprint unlock", "SETUP_FAILED", e);
        }
    }

    @PluginMethod
    public void unlock(PluginCall call) {
        String iv = prefs().getString(P_IV, null);
        String ct = prefs().getString(P_CT, null);
        if (iv == null || ct == null || !hasKey()) {
            call.reject("Fingerprint unlock is not set up", "NOT_ENROLLED");
            return;
        }
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            SecretKey key = (SecretKey) ks.getKey(KEY_ALIAS, null);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key,
                new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            String title = call.getString("title", "Unlock honest.money");
            prompt(call, cipher, title, "Use your fingerprint", c -> {
                byte[] pt = c.doFinal(Base64.decode(ct, Base64.NO_WRAP));
                call.resolve(new JSObject().put("password", new String(pt, StandardCharsets.UTF_8)));
            });
        } catch (KeyPermanentlyInvalidatedException e) {
            wipe();
            call.reject("Fingerprints on this phone changed. Use your password, then turn fingerprint unlock on again.", "INVALIDATED");
        } catch (Exception e) {
            call.reject("Fingerprint unlock failed", "UNLOCK_FAILED", e);
        }
    }

    @PluginMethod
    public void disable(PluginCall call) {
        wipe();
        call.resolve();
    }

    private interface CipherUse {
        void run(Cipher c) throws Exception;
    }

    private void prompt(PluginCall call, Cipher cipher, String title, String subtitle, CipherUse use) {
        FragmentActivity activity = getActivity();
        activity.runOnUiThread(() -> {
            BiometricPrompt bp = new BiometricPrompt(activity, ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        BiometricPrompt.CryptoObject co = result.getCryptoObject();
                        if (co == null || co.getCipher() == null) {
                            call.reject("No secure result", "UNLOCK_FAILED");
                            return;
                        }
                        try {
                            use.run(co.getCipher());
                        } catch (Exception e) {
                            call.reject("Fingerprint unlock failed", "UNLOCK_FAILED", e);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int code, @NonNull CharSequence msg) {
                        boolean cancel = code == BiometricPrompt.ERROR_USER_CANCELED
                            || code == BiometricPrompt.ERROR_NEGATIVE_BUTTON
                            || code == BiometricPrompt.ERROR_CANCELED;
                        call.reject(msg.toString(), cancel ? "CANCELLED" : "AUTH_ERROR");
                    }
                });
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText("Use password")
                .setAllowedAuthenticators(AUTH)
                .setConfirmationRequired(false)
                .build();
            bp.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
        });
    }

    private SecretKey createKey() throws Exception {
        KeyGenParameterSpec.Builder b = new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            b.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        }
        KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        kg.init(b.build());
        return kg.generateKey();
    }

    private boolean hasKey() {
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            return ks.containsAlias(KEY_ALIAS);
        } catch (Exception e) {
            return false;
        }
    }

    private void wipe() {
        prefs().edit().clear().apply();
        try {
            KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
            ks.load(null);
            ks.deleteEntry(KEY_ALIAS);
        } catch (Exception ignored) {
        }
    }
}
