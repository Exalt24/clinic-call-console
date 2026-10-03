package dev.dacruz.clinic.ingest;

import dev.dacruz.clinic.calls.CallDtos.IngestRequest;
import dev.dacruz.clinic.calls.CallDtos.IngestResponse;
import dev.dacruz.clinic.calls.CallService;
import dev.dacruz.clinic.config.AppProperties;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validator;
import java.time.Clock;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.json.JsonMapper;

/**
 * The voice platform's webhook. It is not behind a user token; it authenticates by HMAC signature over the raw body, so
 * the body is taken as a String, verified FIRST, and only then parsed and validated.
 */
@RestController
@RequestMapping("/api/ingest")
public class IngestController {

    private final CallService calls;
    private final AppProperties props;
    private final Clock clock;
    private final JsonMapper json;
    private final Validator validator;

    public IngestController(CallService calls, AppProperties props, Clock clock, JsonMapper json, Validator validator) {
        this.calls = calls;
        this.props = props;
        this.clock = clock;
        this.json = json;
        this.validator = validator;
    }

    @PostMapping("/calls")
    public ResponseEntity<IngestResponse> ingest(@RequestHeader(value = "X-Signature", required = false) String signature,
                                                 @RequestBody String rawBody) {
        if (!WebhookSignature.valid(signature, rawBody, props.ingest().webhookSecret(), clock.instant(),
                props.ingest().toleranceSeconds())) {
            // One message for every failure (missing, malformed, stale, wrong): no hint about which check failed.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Invalid webhook signature");
        }
        IngestRequest req;
        try {
            req = json.readValue(rawBody, IngestRequest.class);
        } catch (JacksonException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Body is not a valid call payload");
        }
        Set<ConstraintViolation<IngestRequest>> problems = validator.validate(req);
        if (!problems.isEmpty()) {
            String msg = problems.stream().map(v -> v.getPropertyPath() + " " + v.getMessage()).sorted().collect(Collectors.joining("; "));
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, msg);
        }
        IngestResponse out = calls.ingest(req);
        return ResponseEntity.status(out.duplicate() ? HttpStatus.OK : HttpStatus.CREATED).body(out);
    }
}
