package dev.dacruz.clinic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import dev.dacruz.clinic.ingest.WebhookSignature;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

class IngestApiTest extends ApiTestSupport {

    private static final MediaType JSON = MediaType.APPLICATION_JSON;

    private String payload(String externalId) {
        return """
                {"externalId":"%s","startedAt":"2026-10-04T08:15:00Z","durationSec":142,"agent":"Front desk agent",
                 "callerNumber":"(415) 555-0199","reason":"APPOINTMENT","outcome":"BOOKED","patientName":"Casey Rowan",
                 "transcript":[
                  {"speaker":"AGENT","text":"Thanks for calling. How can I help?"},
                  {"speaker":"CALLER","text":"Hi, my name is Casey Rowan, born on June 9, 1988."},
                  {"speaker":"CALLER","text":"Text me at (415) 555-0199 or casey.rowan@example.test about Tuesday at 9:30."}]}
                """.formatted(externalId);
    }

    private MvcResult send(String body, String signatureHeader) throws Exception {
        var req = post("/api/ingest/calls").contentType(JSON).content(body);
        if (signatureHeader != null) {
            req = req.header("X-Signature", signatureHeader);
        }
        return mvc.perform(req).andReturn();
    }

    private String sign(String body, long timestamp) {
        return WebhookSignature.header(props.ingest().webhookSecret(), timestamp, body);
    }

    private String now() {
        return String.valueOf(Instant.now().getEpochSecond());
    }

    @Test
    void aValidSignedDeliveryCreatesTheCallAndMasksTheIdentifiers() throws Exception {
        String ext = "wh-" + UUID.randomUUID();
        String body = payload(ext);
        MvcResult res = send(body, sign(body, Instant.now().getEpochSecond()));
        assertThat(res.getResponse().getStatus()).isEqualTo(201);
        String id = JsonPath.read(res.getResponse().getContentAsString(), "$.id");
        assertThat((Boolean) JsonPath.read(res.getResponse().getContentAsString(), "$.duplicate")).isFalse();
        // one introduced name, one birth date, one phone number, one email
        assertThat((Integer) JsonPath.read(res.getResponse().getContentAsString(), "$.phiCount")).isEqualTo(4);

        String detail = mvc.perform(get("/api/calls/" + id).header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(detail).doesNotContainIgnoringCase("casey").doesNotContainIgnoringCase("rowan")
                .doesNotContain("555-0199").doesNotContain("example.test").doesNotContain("1988")
                .contains("[PHONE]").contains("[EMAIL]").contains("[NAME]").contains("Tuesday at 9:30");
        assertThat(auditCount("INGEST", UUID.fromString(id))).isEqualTo(1);
    }

    @Test
    void redeliveringTheSameCallIsIdempotent() throws Exception {
        String ext = "wh-" + UUID.randomUUID();
        String body = payload(ext);
        MvcResult first = send(body, sign(body, Instant.now().getEpochSecond()));
        long count = calls.count();
        MvcResult second = send(body, sign(body, Instant.now().getEpochSecond()));
        assertThat(first.getResponse().getStatus()).isEqualTo(201);
        assertThat(second.getResponse().getStatus()).isEqualTo(200);
        assertThat((Boolean) JsonPath.read(second.getResponse().getContentAsString(), "$.duplicate")).isTrue();
        assertThat(JsonPath.<String>read(second.getResponse().getContentAsString(), "$.id"))
                .isEqualTo(JsonPath.<String>read(first.getResponse().getContentAsString(), "$.id"));
        assertThat(calls.count()).isEqualTo(count);
    }

    @Test
    void aMissingSignatureIsRefused() throws Exception {
        assertThat(send(payload("wh-" + UUID.randomUUID()), null).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void aBearerTokenAloneDoesNotSubstituteForTheSignature() throws Exception {
        MvcResult res = mvc.perform(post("/api/ingest/calls").header("Authorization", bearer(adminToken()))
                .contentType(JSON).content(payload("wh-" + UUID.randomUUID()))).andReturn();
        assertThat(res.getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void aWrongSecretIsRefused() throws Exception {
        String body = payload("wh-" + UUID.randomUUID());
        assertThat(send(body, WebhookSignature.header("not-the-secret", Instant.now().getEpochSecond(), body)).getResponse().getStatus())
                .isEqualTo(401);
    }

    @Test
    void aBodyChangedAfterSigningIsRefused() throws Exception {
        String body = payload("wh-" + UUID.randomUUID());
        String sig = sign(body, Instant.now().getEpochSecond());
        assertThat(send(body.replace("Casey", "Chris"), sig).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void aReplayedOldDeliveryIsRefused() throws Exception {
        String body = payload("wh-" + UUID.randomUUID());
        long stale = Instant.now().getEpochSecond() - props.ingest().toleranceSeconds() - 60;
        assertThat(send(body, sign(body, stale)).getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void aSignedButInvalidPayloadIsA400NotA500() throws Exception {
        String bad = payload("wh-" + UUID.randomUUID()).replace("\"reason\":\"APPOINTMENT\"", "\"reason\":\"NOT_A_REASON\"");
        assertThat(send(bad, sign(bad, Instant.now().getEpochSecond())).getResponse().getStatus()).isEqualTo(400);
        String empty = "{\"externalId\":\"x-" + UUID.randomUUID() + "\",\"startedAt\":\"2026-10-04T08:15:00Z\",\"durationSec\":10,"
                + "\"agent\":\"a\",\"callerNumber\":\"1\",\"reason\":\"OTHER\",\"outcome\":\"INFO_GIVEN\",\"patientName\":\"A B\",\"transcript\":[]}";
        MvcResult res = send(empty, sign(empty, Instant.now().getEpochSecond()));
        assertThat(res.getResponse().getStatus()).isEqualTo(400);
        String garbage = "this is not json";
        assertThat(send(garbage, sign(garbage, Instant.now().getEpochSecond())).getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void anOversizedTranscriptIsRefused() throws Exception {
        StringBuilder lines = new StringBuilder();
        for (int i = 0; i < 201; i++) {
            if (i > 0) lines.append(',');
            lines.append("{\"speaker\":\"AGENT\",\"text\":\"line ").append(i).append("\"}");
        }
        String body = "{\"externalId\":\"big-" + UUID.randomUUID() + "\",\"startedAt\":\"2026-10-04T08:15:00Z\",\"durationSec\":10,"
                + "\"agent\":\"a\",\"callerNumber\":\"1\",\"reason\":\"OTHER\",\"outcome\":\"INFO_GIVEN\",\"patientName\":\"A B\",\"transcript\":["
                + lines + "]}";
        assertThat(send(body, sign(body, Instant.now().getEpochSecond())).getResponse().getStatus()).isEqualTo(400);
    }

    @Test
    void theErrorShapeNeverLeaksInternals() throws Exception {
        MvcResult res = send("{}", null);
        String body = res.getResponse().getContentAsString();
        assertThat(body).doesNotContain("Exception").doesNotContain("dev.dacruz").doesNotContain("at org.");
    }

    @Test
    void anIngestedCallAppearsInTheListWithoutAnyReadableText() throws Exception {
        String ext = "wh-" + UUID.randomUUID();
        String body = payload(ext);
        send(body, sign(body, Instant.now().getEpochSecond()));
        String list = mvc.perform(get("/api/calls?q=tuesday&size=50").header("Authorization", bearer(adminToken())))
                .andExpect(status().isOk()).andExpect(jsonPath("$.content").isNotEmpty()).andReturn().getResponse().getContentAsString();
        assertThat(list).doesNotContainIgnoringCase("casey");
    }
}
