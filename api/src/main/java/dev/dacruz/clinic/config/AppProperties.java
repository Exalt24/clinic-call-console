package dev.dacruz.clinic.config;

import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Every tunable in one typed place, bound from application.yml and the environment. */
@ConfigurationProperties(prefix = "app")
public record AppProperties(Jwt jwt, Crypto crypto, Cors cors, DemoUsers demoUsers, Seed seed, Login login, Ingest ingest) {

    public record Jwt(String secret, int ttlMinutes) {}

    /** key is Base64 of exactly 32 bytes (AES-256). */
    public record Crypto(String key) {}

    public record Cors(List<String> allowedOrigins) {}

    public record DemoUsers(String reviewerPassword, String adminPassword) {}

    public record Seed(boolean enabled, int count) {}

    public record Login(int maxFailures, int windowMinutes) {}

    /** The voice platform signs every webhook body with this shared secret (HMAC-SHA256). */
    public record Ingest(String webhookSecret, int toleranceSeconds) {}
}
