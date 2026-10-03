package dev.dacruz.clinic.auth;

import dev.dacruz.clinic.config.AppProperties;
import java.util.Map;
import java.util.Optional;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

/**
 * Two demo accounts, passwords hashed with BCrypt at startup from configuration. This stands in for an identity provider;
 * a real deployment would delegate to the practice's SSO (OIDC) and keep no passwords here at all.
 */
@Component
public class UserDirectory {

    public record User(String username, String displayName, String role, String passwordHash) {}

    private final Map<String, User> users;
    private final PasswordEncoder encoder;
    // A real BCrypt hash of a throwaway value, compared against when the username is unknown, so a missing account
    // costs the same as a wrong password.
    private final String dummyHash;

    public UserDirectory(AppProperties props, PasswordEncoder encoder) {
        this.encoder = encoder;
        this.dummyHash = encoder.encode(java.util.UUID.randomUUID().toString());
        this.users = Map.of(
                "reviewer@demo.test", new User("reviewer@demo.test", "Riley Reviewer", "REVIEWER",
                        encoder.encode(props.demoUsers().reviewerPassword())),
                "admin@demo.test", new User("admin@demo.test", "Avery Admin", "ADMIN",
                        encoder.encode(props.demoUsers().adminPassword())));
    }

    /** Verifies the password; the same comparison cost runs whether or not the user exists. */
    public Optional<User> authenticate(String username, String password) {
        User u = users.get(username == null ? "" : username.trim().toLowerCase());
        boolean ok = encoder.matches(password == null ? "" : password, u != null ? u.passwordHash() : dummyHash);
        return ok && u != null ? Optional.of(u) : Optional.empty();
    }
}
