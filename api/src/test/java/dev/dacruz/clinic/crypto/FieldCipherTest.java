package dev.dacruz.clinic.crypto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.dacruz.clinic.config.AppProperties;
import java.util.Base64;
import org.junit.jupiter.api.Test;

class FieldCipherTest {

    private static AppProperties propsWithKey(byte[] key) {
        return new AppProperties(null, new AppProperties.Crypto(Base64.getEncoder().encodeToString(key)), null, null, null, null, null);
    }

    private static byte[] key(int fill) {
        byte[] k = new byte[32];
        java.util.Arrays.fill(k, (byte) fill);
        return k;
    }

    @Test
    void roundTripsUnicodeText() {
        FieldCipher c = new FieldCipher(propsWithKey(key(7)));
        String text = "AGENT: Hola, ¿cómo está? ••• 4721";
        assertThat(c.decrypt(c.encrypt(text))).isEqualTo(text);
    }

    @Test
    void sameTextEncryptsDifferentlyEachTimeBecauseTheIvIsRandom() {
        FieldCipher c = new FieldCipher(propsWithKey(key(7)));
        assertThat(c.encrypt("Dana Whitfield")).isNotEqualTo(c.encrypt("Dana Whitfield"));
    }

    @Test
    void storedValueDoesNotContainThePlaintext() {
        FieldCipher c = new FieldCipher(propsWithKey(key(7)));
        String stored = c.encrypt("Dana Whitfield 415-555-0142");
        assertThat(stored).doesNotContain("Dana").doesNotContain("415");
        assertThat(new String(Base64.getDecoder().decode(stored), java.nio.charset.StandardCharsets.ISO_8859_1))
                .doesNotContain("Whitfield");
    }

    @Test
    void aTamperedValueFailsToDecryptInsteadOfReturningGarbage() {
        FieldCipher c = new FieldCipher(propsWithKey(key(7)));
        byte[] raw = Base64.getDecoder().decode(c.encrypt("secret transcript"));
        raw[raw.length - 1] ^= 0x01;
        String tampered = Base64.getEncoder().encodeToString(raw);
        assertThatThrownBy(() -> c.decrypt(tampered)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aDifferentKeyCannotDecrypt() {
        String stored = new FieldCipher(propsWithKey(key(7))).encrypt("secret transcript");
        FieldCipher other = new FieldCipher(propsWithKey(key(8)));
        assertThatThrownBy(() -> other.decrypt(stored)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void aKeyThatIsNot32BytesIsRefusedAtStartup() {
        assertThatThrownBy(() -> new FieldCipher(propsWithKey(new byte[16]))).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("32 bytes");
    }

    @Test
    void aTooShortCiphertextIsRejected() {
        FieldCipher c = new FieldCipher(propsWithKey(key(7)));
        assertThatThrownBy(() -> c.decrypt(Base64.getEncoder().encodeToString(new byte[5]))).isInstanceOf(IllegalArgumentException.class);
    }
}
