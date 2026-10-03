package dev.dacruz.clinic.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import org.junit.jupiter.api.Test;

class WebhookSignatureTest {

    private static final String SECRET = "shared-secret";
    private static final String BODY = "{\"externalId\":\"abc\"}";
    private static final Instant NOW = Instant.parse("2026-10-04T12:00:00Z");
    private static final long T = NOW.getEpochSecond();

    @Test
    void acceptsAFreshCorrectlySignedBody() {
        assertThat(WebhookSignature.valid(WebhookSignature.header(SECRET, T, BODY), BODY, SECRET, NOW, 300)).isTrue();
    }

    @Test
    void rejectsAWrongSecret() {
        assertThat(WebhookSignature.valid(WebhookSignature.header("other", T, BODY), BODY, SECRET, NOW, 300)).isFalse();
    }

    @Test
    void rejectsABodyChangedAfterSigning() {
        assertThat(WebhookSignature.valid(WebhookSignature.header(SECRET, T, BODY), BODY + " ", SECRET, NOW, 300)).isFalse();
    }

    @Test
    void rejectsAReplayedRequestOlderThanTheTolerance() {
        long old = T - 301;
        assertThat(WebhookSignature.valid(WebhookSignature.header(SECRET, old, BODY), BODY, SECRET, NOW, 300)).isFalse();
    }

    @Test
    void acceptsARequestJustInsideTheTolerance() {
        long edge = T - 300;
        assertThat(WebhookSignature.valid(WebhookSignature.header(SECRET, edge, BODY), BODY, SECRET, NOW, 300)).isTrue();
    }

    @Test
    void rejectsATimestampFromTheFutureBeyondTheTolerance() {
        long future = T + 301;
        assertThat(WebhookSignature.valid(WebhookSignature.header(SECRET, future, BODY), BODY, SECRET, NOW, 300)).isFalse();
    }

    @Test
    void theTimestampIsPartOfTheSignedValueSoSwappingItInvalidatesTheMac() {
        String sig = WebhookSignature.sign(SECRET, T, BODY);
        assertThat(WebhookSignature.valid("t=" + (T + 5) + ",v1=" + sig, BODY, SECRET, NOW, 300)).isFalse();
    }

    @Test
    void rejectsMissingMalformedAndHalfPresentHeaders() {
        assertThat(WebhookSignature.valid(null, BODY, SECRET, NOW, 300)).isFalse();
        assertThat(WebhookSignature.valid("", BODY, SECRET, NOW, 300)).isFalse();
        assertThat(WebhookSignature.valid("garbage", BODY, SECRET, NOW, 300)).isFalse();
        assertThat(WebhookSignature.valid("t=abc,v1=00", BODY, SECRET, NOW, 300)).isFalse();
        assertThat(WebhookSignature.valid("t=" + T, BODY, SECRET, NOW, 300)).isFalse();
        assertThat(WebhookSignature.valid("v1=" + WebhookSignature.sign(SECRET, T, BODY), BODY, SECRET, NOW, 300)).isFalse();
    }
}
