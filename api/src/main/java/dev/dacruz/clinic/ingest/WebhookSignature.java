package dev.dacruz.clinic.ingest;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Verifies a webhook the way payment and voice platforms sign them: header {@code X-Signature: t=<unix seconds>,v1=<hex>}
 * where v1 = HMAC-SHA256(secret, "<t>.<raw body>"). Binding the timestamp into the MAC and rejecting stale timestamps
 * stops a captured request from being replayed later; comparing in constant time avoids leaking the signature byte by
 * byte. The body must be the exact bytes received, never a re-serialised copy.
 */
public final class WebhookSignature {

    private WebhookSignature() {}

    public static String sign(String secret, long timestamp, String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            byte[] out = mac.doFinal((timestamp + "." + body).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(out);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HMAC unavailable", e);
        }
    }

    public static String header(String secret, long timestamp, String body) {
        return "t=" + timestamp + ",v1=" + sign(secret, timestamp, body);
    }

    public static boolean valid(String header, String body, String secret, Instant now, int toleranceSeconds) {
        if (header == null || body == null) {
            return false;
        }
        Long t = null;
        String v1 = null;
        for (String part : header.split(",")) {
            String p = part.trim();
            if (p.startsWith("t=")) {
                try {
                    t = Long.parseLong(p.substring(2));
                } catch (NumberFormatException e) {
                    return false;
                }
            } else if (p.startsWith("v1=")) {
                v1 = p.substring(3);
            }
        }
        if (t == null || v1 == null) {
            return false;
        }
        if (Math.abs(now.getEpochSecond() - t) > toleranceSeconds) {
            return false;
        }
        byte[] expected = sign(secret, t, body).getBytes(StandardCharsets.UTF_8);
        return MessageDigest.isEqual(expected, v1.getBytes(StandardCharsets.UTF_8));
    }
}
