package dev.dacruz.clinic;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.nimbusds.jose.jwk.source.ImmutableSecret;
import dev.dacruz.clinic.auth.LoginThrottle;
import dev.dacruz.clinic.calls.CallRecord;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.UUID;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.web.servlet.MvcResult;

class ApiSecurityTest extends ApiTestSupport {

    @Autowired LoginThrottle throttle;

    private static final MediaType JSON = MediaType.APPLICATION_JSON;

    // ---------- authentication: the default is deny ----------

    @Test
    void everyProtectedEndpointRefusesARequestWithNoToken() throws Exception {
        UUID id = aCallWithPhi().getId();
        mvc.perform(get("/api/calls")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/calls/" + id)).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/calls/" + id + "/reveal").contentType(JSON).content("{\"reason\":\"a valid long reason\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(patch("/api/calls/" + id + "/status").contentType(JSON).content("{\"status\":\"RESOLVED\"}"))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/audit")).andExpect(status().isUnauthorized());
    }

    @Test
    void aTokenSignedWithAnotherKeyIsRefusedEvenWhenItClaimsAdmin() throws Exception {
        var otherKey = new SecretKeySpec("a-completely-different-signing-key-0123456789".getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        var encoder = new NimbusJwtEncoder(new ImmutableSecret<>(otherKey));
        String forged = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
                JwtClaimsSet.builder().subject("attacker@evil.test").claim("role", "ADMIN")
                        .issuedAt(Instant.now()).expiresAt(Instant.now().plusSeconds(600)).build())).getTokenValue();
        mvc.perform(get("/api/audit").header("Authorization", bearer(forged))).andExpect(status().isUnauthorized());
    }

    @Test
    void anExpiredTokenIsRefusedEvenWhenCorrectlySigned() throws Exception {
        var key = new SecretKeySpec(props.jwt().secret().getBytes(StandardCharsets.UTF_8), "HmacSHA256");
        var encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key));
        String expired = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(),
                JwtClaimsSet.builder().subject("admin@demo.test").claim("role", "ADMIN")
                        .issuedAt(Instant.now().minusSeconds(7200)).expiresAt(Instant.now().minusSeconds(3600)).build())).getTokenValue();
        mvc.perform(get("/api/audit").header("Authorization", bearer(expired))).andExpect(status().isUnauthorized());
    }

    @Test
    void aMalformedTokenIsRefused() throws Exception {
        mvc.perform(get("/api/calls").header("Authorization", "Bearer not.a.jwt")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/calls").header("Authorization", "Basic abc")).andExpect(status().isUnauthorized());
    }

    // ---------- least privilege: a reviewer is not an admin ----------

    @Test
    void aReviewerCannotRevealProtectedInformationAndNoRevealIsRecorded() throws Exception {
        UUID id = aCallWithPhi().getId();
        long before = auditCount("REVEAL", id);
        mvc.perform(post("/api/calls/" + id + "/reveal").header("Authorization", bearer(reviewerToken()))
                        .contentType(JSON).content("{\"reason\":\"I would like to see the full transcript\"}"))
                .andExpect(status().isForbidden());
        assertThat(auditCount("REVEAL", id)).isEqualTo(before);
    }

    @Test
    void aReviewerCannotReadTheAuditTrail() throws Exception {
        mvc.perform(get("/api/audit").header("Authorization", bearer(reviewerToken()))).andExpect(status().isForbidden());
    }

    // ---------- a reveal needs a reason, and leaves a record ----------

    @Test
    void anAdminRevealWithoutAValidReasonIsRefusedAndLeavesNoRecord() throws Exception {
        UUID id = aCallWithPhi().getId();
        String token = adminToken();
        long before = auditCount("REVEAL", id);
        for (String body : new String[] {"{}", "{\"reason\":\"\"}", "{\"reason\":\"   \"}", "{\"reason\":\"too short\"}", "not json",
                "{\"reason\":\"" + "x".repeat(301) + "\"}"}) {
            mvc.perform(post("/api/calls/" + id + "/reveal").header("Authorization", bearer(token)).contentType(JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
        assertThat(auditCount("REVEAL", id)).isEqualTo(before);
    }

    @Test
    void anAdminRevealWithAReasonReturnsPlaintextAndWritesAnAuditRowCarryingThatReason() throws Exception {
        CallRecord call = aCallWithPhi();
        String reason = "Patient requested a copy of the call for her records";
        long before = auditCount("REVEAL", call.getId());
        MvcResult res = mvc.perform(post("/api/calls/" + call.getId() + "/reveal").header("Authorization", bearer(adminToken()))
                        .contentType(JSON).content("{\"reason\":\"" + reason + "\"}"))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn();
        String body = res.getResponse().getContentAsString();
        String name = cipher.decrypt(call.getPatientNameEnc());
        assertThat((String) JsonPath.read(body, "$.patientName")).isEqualTo(name);
        assertThat(body).contains(name.split(" ")[0]);
        assertThat(auditCount("REVEAL", call.getId())).isEqualTo(before + 1);
        String detail = jdbc.queryForObject("select detail from audit_event where action = 'REVEAL' and call_id = ? order by id desc limit 1",
                String.class, call.getId());
        String actor = jdbc.queryForObject("select actor from audit_event where action = 'REVEAL' and call_id = ? order by id desc limit 1",
                String.class, call.getId());
        assertThat(detail).isEqualTo("reason: " + reason);
        assertThat(actor).isEqualTo("admin@demo.test");
    }

    @Test
    void theAuditTrailShowsTheRevealToAnAdmin() throws Exception {
        CallRecord call = aCallWithPhi();
        String token = adminToken();
        mvc.perform(post("/api/calls/" + call.getId() + "/reveal").header("Authorization", bearer(token)).contentType(JSON)
                .content("{\"reason\":\"Compliance audit sample review\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/audit?size=50").header("Authorization", bearer(token)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[?(@.action=='REVEAL')]").isNotEmpty());
    }

    // ---------- redaction: the default view never carries PHI ----------

    @Test
    void aReviewerSeesRedactedTextOnlyAndOpeningTheCallIsAudited() throws Exception {
        CallRecord call = aCallWithPhi();
        long before = auditCount("VIEW_REDACTED", call.getId());
        MvcResult res = mvc.perform(get("/api/calls/" + call.getId()).header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string("Cache-Control", "no-store"))
                .andReturn();
        String body = res.getResponse().getContentAsString();
        for (String token : plaintextTokensFor(call)) {
            assertThat(body).as("plaintext %s must not appear", token).doesNotContainIgnoringCase(token);
        }
        assertThat(body).doesNotContainPattern("555-01\\d\\d").doesNotContainPattern("\\b\\d{3}-\\d{2}-\\d{4}\\b");
        assertThat(auditCount("VIEW_REDACTED", call.getId())).isEqualTo(before + 1);
    }

    @Test
    void theListNeverExposesTranscriptTextOrNames() throws Exception {
        String body = mvc.perform(get("/api/calls?size=50").header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(body).doesNotContain("transcript").doesNotContain("patientName").doesNotContainPattern("555-01\\d\\d");
    }

    @Test
    void theDatabaseColumnsHoldNoReadablePatientDataAndEveryRowStillDecrypts() {
        for (CallRecord c : calls.findAll()) {
            String name = cipher.decrypt(c.getPatientNameEnc());
            assertThat(c.getPatientNameEnc()).doesNotContainIgnoringCase(name.split(" ")[0]);
            assertThat(c.getRawTranscriptEnc()).doesNotContain("555-01").doesNotContainIgnoringCase(name.split(" ")[0]);
            assertThat(cipher.decrypt(c.getRawTranscriptEnc())).contains(name.split(" ")[0]);
        }
    }

    @Test
    void searchCannotFindAPatientByNameBecauseTheNameIsEncrypted() throws Exception {
        CallRecord call = aCallWithPhi();
        String lastName = cipher.decrypt(call.getPatientNameEnc()).split(" ")[1];
        String body = mvc.perform(get("/api/calls?q=" + lastName).header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat((Integer) JsonPath.read(body, "$.totalElements")).isZero();
    }

    // ---------- list behaviour ----------

    @Test
    void statusFilterReturnsOnlyThatStatusAndPageSizeIsCapped() throws Exception {
        String token = reviewerToken();
        String body = mvc.perform(get("/api/calls?status=RESOLVED&size=1000").header("Authorization", bearer(token)))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat((Integer) JsonPath.read(body, "$.size")).isLessThanOrEqualTo(50);
        assertThat((java.util.List<String>) JsonPath.read(body, "$.content[*].status")).isNotEmpty().allMatch("RESOLVED"::equals);
    }

    @Test
    void searchMatchesTheRedactedTranscript() throws Exception {
        String body = mvc.perform(get("/api/calls?q=billing").header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat((Integer) JsonPath.read(body, "$.totalElements")).isGreaterThan(0);
    }

    @Test
    void anUnknownCallIs404() throws Exception {
        mvc.perform(get("/api/calls/" + UUID.randomUUID()).header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.title").value("Not Found"));
    }

    // ---------- status changes ----------

    @Test
    void aStatusChangeIsAppliedAndAudited() throws Exception {
        CallRecord call = aCallWithPhi();
        long before = auditCount("STATUS_CHANGE", call.getId());
        mvc.perform(patch("/api/calls/" + call.getId() + "/status").header("Authorization", bearer(reviewerToken()))
                        .contentType(JSON).content("{\"status\":\"IN_REVIEW\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("IN_REVIEW"));
        assertThat(auditCount("STATUS_CHANGE", call.getId())).isEqualTo(before + 1);
    }

    @Test
    void anInvalidOrMissingStatusIsRefused() throws Exception {
        UUID id = aCallWithPhi().getId();
        String token = reviewerToken();
        mvc.perform(patch("/api/calls/" + id + "/status").header("Authorization", bearer(token)).contentType(JSON)
                .content("{\"status\":\"BOGUS\"}")).andExpect(status().isBadRequest());
        mvc.perform(patch("/api/calls/" + id + "/status").header("Authorization", bearer(token)).contentType(JSON)
                .content("{}")).andExpect(status().isBadRequest());
    }

    // ---------- login behaviour ----------

    @Test
    void anUnknownUserAndAWrongPasswordGetTheSameAnswer() throws Exception {
        MvcResult unknown = mvc.perform(post("/api/auth/login").contentType(JSON)
                .content("{\"username\":\"nobody-1@demo.test\",\"password\":\"whatever-123\"}")).andReturn();
        MvcResult wrong = mvc.perform(post("/api/auth/login").contentType(JSON)
                .content("{\"username\":\"admin@demo.test\",\"password\":\"definitely-wrong\"}")).andReturn();
        assertThat(unknown.getResponse().getStatus()).isEqualTo(401).isEqualTo(wrong.getResponse().getStatus());
        assertThat((String) JsonPath.read(unknown.getResponse().getContentAsString(), "$.detail"))
                .isEqualTo(JsonPath.read(wrong.getResponse().getContentAsString(), "$.detail"));
        throttle.reset("admin@demo.test");
    }

    @Test
    void repeatedFailuresLockTheAccountEvenAgainstTheCorrectPasswordUntilTheWindowPasses() throws Exception {
        String user = "reviewer@demo.test";
        try {
            for (int i = 0; i < 5; i++) {
                mvc.perform(post("/api/auth/login").contentType(JSON).content("{\"username\":\"" + user + "\",\"password\":\"nope-" + i + "\"}"))
                        .andExpect(status().isUnauthorized());
            }
            mvc.perform(post("/api/auth/login").contentType(JSON)
                            .content("{\"username\":\"" + user + "\",\"password\":\"" + props.demoUsers().reviewerPassword() + "\"}"))
                    .andExpect(status().isTooManyRequests());
        } finally {
            throttle.reset(user);
        }
        reviewerToken();   // and the account works again once reset
    }

    @Test
    void loginRejectsABlankBody() throws Exception {
        mvc.perform(post("/api/auth/login").contentType(JSON).content("{\"username\":\"\",\"password\":\"\"}"))
                .andExpect(status().isBadRequest());
    }

    // ---------- response hygiene ----------

    @Test
    void responsesCarrySecurityHeadersAndARequestId() throws Exception {
        mvc.perform(get("/api/calls").header("Authorization", bearer(reviewerToken())))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("X-Frame-Options", "DENY"))
                .andExpect(header().exists("X-Request-Id"));
    }

    @Test
    void aSafeRequestIdIsEchoedAndAnUnsafeOneIsReplaced() throws Exception {
        String token = reviewerToken();
        mvc.perform(get("/api/calls").header("Authorization", bearer(token)).header("X-Request-Id", "client-trace-0001"))
                .andExpect(header().string("X-Request-Id", "client-trace-0001"));
        MvcResult res = mvc.perform(get("/api/calls").header("Authorization", bearer(token)).header("X-Request-Id", "bad id\nwith newline"))
                .andReturn();
        assertThat(res.getResponse().getHeader("X-Request-Id")).isNotEqualTo("bad id\nwith newline").matches("[A-Za-z0-9._-]{8,64}");
    }

    @Test
    void healthAllowsTheConfiguredFrontendOriginToReadItAndNoOtherOrigin() throws Exception {
        String allowed = props.cors().allowedOrigins().get(0);
        mvc.perform(get("/actuator/health").header("Origin", allowed))
                .andExpect(status().isOk()).andExpect(header().string("Access-Control-Allow-Origin", allowed));
        mvc.perform(get("/actuator/health").header("Origin", "https://evil.example"))
                .andExpect(status().isForbidden());
    }

    @Test
    void healthIsPublicButNothingElseUnderActuatorIs() throws Exception {
        mvc.perform(get("/actuator/health")).andExpect(status().isOk());
        mvc.perform(get("/actuator/env")).andExpect(status().isUnauthorized());
    }
}
