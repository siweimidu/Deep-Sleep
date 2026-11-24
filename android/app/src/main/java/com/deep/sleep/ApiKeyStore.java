package com.deep.sleep;

import android.annotation.TargetApi;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.util.Arrays;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * API Key 的本地存储。
 *
 * Android 6.0(API 23) 起用 AndroidKeyStore 的硬件支持密钥做 AES/GCM；Android 5.x 没有
 * KeyGenParameterSpec，退回 SharedPreferences 里存 base64。能加密的版本尽量加密，老系统至少不崩。
 */
final class ApiKeyStore {
    private static final String KEY_ALIAS = "deepseek-api-key";
    private static final String VALUE = "encrypted";
    /** Android 5.x 的退路：没有 KeyGenParameterSpec，只能明文 base64 存 */
    private static final String LEGACY = "legacy";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private final SharedPreferences preferences;

    ApiKeyStore(Context context) {
        preferences = context.getSharedPreferences("credentials", Context.MODE_PRIVATE);
    }

    private static boolean hardwareBacked() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
    }

    String read() {
        if (!hardwareBacked()) {
            String stored = preferences.getString(LEGACY, null);
            if (stored == null) return null;
            try {
                return new String(Base64.decode(stored, Base64.NO_WRAP), StandardCharsets.UTF_8);
            } catch (IllegalArgumentException ignored) {
                return null;
            }
        }
        String stored = preferences.getString(VALUE, null);
        if (stored == null) return null;
        try {
            byte[] bytes = Base64.decode(stored, Base64.NO_WRAP);
            if (bytes.length <= IV_LENGTH) return null;
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, bytes, 0, IV_LENGTH));
            return new String(cipher.doFinal(bytes, IV_LENGTH, bytes.length - IV_LENGTH),
                StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException | java.io.IOException ignored) {
            return null;
        }
    }

    boolean write(String value) {
        if (value == null || value.isEmpty()) {
            return preferences.edit().remove(VALUE).remove(LEGACY).commit();
        }
        if (!hardwareBacked()) {
            return preferences.edit()
                .putString(LEGACY, Base64.encodeToString(
                    value.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP))
                .remove(VALUE)
                .commit();
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key());
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
            byte[] bytes = Arrays.copyOf(iv, iv.length + encrypted.length);
            System.arraycopy(encrypted, 0, bytes, iv.length, encrypted.length);
            return preferences.edit().putString(VALUE, Base64.encodeToString(bytes, Base64.NO_WRAP))
                .remove(LEGACY)
                .commit();
        } catch (GeneralSecurityException | java.io.IOException ignored) {
            return false;
        }
    }

    @TargetApi(Build.VERSION_CODES.M)
    private SecretKey key() throws GeneralSecurityException, java.io.IOException {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.getKey(KEY_ALIAS, null) instanceof SecretKey existing) return existing;

        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }
}
