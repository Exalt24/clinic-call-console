package dev.dacruz.clinic;

import com.jayway.jsonpath.JsonPath;
import dev.dacruz.clinic.calls.CallRecord;
import dev.dacruz.clinic.calls.CallRepository;
import dev.dacruz.clinic.config.AppProperties;
import dev.dacruz.clinic.crypto.FieldCipher;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Shared plumbing for the integration tests: a real Spring context, real tokens from the real login endpoint. */
@SpringBootTest
@AutoConfigureMockMvc
public abstract class ApiTestSupport {

    @Autowired protected MockMvc mvc;
    @Autowired protected AppProperties props;
    @Autowired protected JdbcTemplate jdbc;
    @Autowired protected CallRepository calls;
    @Autowired protected FieldCipher cipher;

    protected String login(String user, String pass) throws Exception {
        String body = mvc.perform(post("/api/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"" + user + "\",\"password\":\"" + pass + "\"}"))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        return JsonPath.read(body, "$.token");
    }

    protected String reviewerToken() throws Exception {
        return login("reviewer@demo.test", props.demoUsers().reviewerPassword());
    }

    protected String adminToken() throws Exception {
        return login("admin@demo.test", props.demoUsers().adminPassword());
    }

    protected static String bearer(String token) {
        return "Bearer " + token;
    }

    /** A seeded call that has at least one masked identifier, so redaction is observable on it. */
    protected CallRecord aCallWithPhi() {
        return calls.findAll().stream().filter(c -> !c.getPhiSummary().isEmpty()).findFirst().orElseThrow();
    }

    protected long auditCount(String action, UUID callId) {
        Long n = jdbc.queryForObject("select count(*) from audit_event where action = ? and call_id = ?", Long.class, action,
                callId);
        return n == null ? 0 : n;
    }

    protected List<String> plaintextTokensFor(CallRecord c) {
        String name = cipher.decrypt(c.getPatientNameEnc());
        return List.of(name, name.split(" ")[0], name.split(" ")[1]);
    }
}
