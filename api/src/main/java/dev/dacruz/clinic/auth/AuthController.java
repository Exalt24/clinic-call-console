package dev.dacruz.clinic.auth;

import dev.dacruz.clinic.audit.AuditEvent;
import dev.dacruz.clinic.audit.AuditService;
import dev.dacruz.clinic.config.AppProperties;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    public record LoginRequest(@NotBlank @Size(max = 120) String username, @NotBlank @Size(max = 200) String password) {}

    public record LoginResponse(String token, String username, String displayName, String role, Instant expiresAt) {}

    private final UserDirectory users;
    private final LoginThrottle throttle;
    private final JwtEncoder encoder;
    private final AuditService audit;
    private final Clock clock;
    private final Duration ttl;

    public AuthController(UserDirectory users, LoginThrottle throttle, JwtEncoder encoder, AuditService audit, Clock clock,
                          AppProperties props) {
        this.users = users;
        this.throttle = throttle;
        this.encoder = encoder;
        this.audit = audit;
        this.clock = clock;
        this.ttl = Duration.ofMinutes(props.jwt().ttlMinutes());
    }

    @PostMapping("/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest req) {
        String username = req.username().trim().toLowerCase();
        if (throttle.isLocked(username)) {
            // Refused before the password is even checked, so a lockout cannot be used to guess the password.
            throw new ResponseStatusException(HttpStatus.TOO_MANY_REQUESTS, "Too many failed attempts. Try again later.");
        }
        UserDirectory.User user = users.authenticate(username, req.password()).orElse(null);
        if (user == null) {
            throttle.recordFailure(username);
            audit.record(username, "NONE", AuditEvent.Action.LOGIN_FAILED, null, "bad credentials");
            // The same message for an unknown user and a wrong password, so the response does not reveal which accounts exist.
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Wrong email or password");
        }
        throttle.reset(username);
        Instant now = clock.instant();
        Instant exp = now.plus(ttl);
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .subject(user.username())
                .issuedAt(now)
                .expiresAt(exp)
                .claim("role", user.role())
                .claim("name", user.displayName())
                .build();
        String token = encoder.encode(JwtEncoderParameters.from(JwsHeader.with(MacAlgorithm.HS256).build(), claims)).getTokenValue();
        audit.record(user.username(), user.role(), AuditEvent.Action.LOGIN, null, "signed in");
        return ResponseEntity.ok()
                .header("Cache-Control", "no-store")
                .body(new LoginResponse(token, user.username(), user.displayName(), user.role(), exp));
    }
}
