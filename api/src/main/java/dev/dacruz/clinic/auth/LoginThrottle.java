package dev.dacruz.clinic.auth;

import dev.dacruz.clinic.config.AppProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Component;

/**
 * Sliding-window lockout per username: after maxFailures failed attempts inside the window, further attempts are refused
 * until the oldest failure ages out. In memory, so it resets on restart and is per instance; a multi-instance deployment
 * would keep this in Redis (noted in the README).
 */
@Component
public class LoginThrottle {

    private final int maxFailures;
    private final Duration window;
    private final Clock clock;
    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

    public LoginThrottle(AppProperties props, Clock clock) {
        this.maxFailures = props.login().maxFailures();
        this.window = Duration.ofMinutes(props.login().windowMinutes());
        this.clock = clock;
    }

    public boolean isLocked(String username) {
        Deque<Instant> q = failures.get(key(username));
        if (q == null) {
            return false;
        }
        synchronized (q) {
            prune(q);
            return q.size() >= maxFailures;
        }
    }

    public void recordFailure(String username) {
        Deque<Instant> q = failures.computeIfAbsent(key(username), k -> new ArrayDeque<>());
        synchronized (q) {
            prune(q);
            q.addLast(clock.instant());
        }
    }

    public void reset(String username) {
        failures.remove(key(username));
    }

    private void prune(Deque<Instant> q) {
        Instant cutoff = clock.instant().minus(window);
        while (!q.isEmpty() && q.peekFirst().isBefore(cutoff)) {
            q.removeFirst();
        }
    }

    private static String key(String username) {
        return username == null ? "" : username.trim().toLowerCase();
    }
}
