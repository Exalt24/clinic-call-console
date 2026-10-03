package dev.dacruz.clinic.auth;

import static org.assertj.core.api.Assertions.assertThat;

import dev.dacruz.clinic.config.AppProperties;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class LoginThrottleTest {

    /** A clock the test can move, so the window is proven without sleeping. */
    static final class MovableClock extends Clock {
        private Instant now = Instant.parse("2026-10-04T12:00:00Z");

        void advance(Duration d) { now = now.plus(d); }

        @Override public java.time.ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    private static AppProperties props() {
        return new AppProperties(null, null, null, null, null, new AppProperties.Login(5, 10), null);
    }

    @Test
    void locksAfterTheConfiguredNumberOfFailures() {
        LoginThrottle t = new LoginThrottle(props(), new MovableClock());
        for (int i = 0; i < 4; i++) t.recordFailure("a@x.test");
        assertThat(t.isLocked("a@x.test")).isFalse();
        t.recordFailure("a@x.test");
        assertThat(t.isLocked("a@x.test")).isTrue();
    }

    @Test
    void failuresAgeOutOfTheWindow() {
        MovableClock clock = new MovableClock();
        LoginThrottle t = new LoginThrottle(props(), clock);
        for (int i = 0; i < 5; i++) t.recordFailure("a@x.test");
        assertThat(t.isLocked("a@x.test")).isTrue();
        clock.advance(Duration.ofMinutes(10).plusSeconds(1));
        assertThat(t.isLocked("a@x.test")).isFalse();
    }

    @Test
    void oneAccountsFailuresDoNotLockAnotherAndNamesAreCaseInsensitive() {
        LoginThrottle t = new LoginThrottle(props(), new MovableClock());
        for (int i = 0; i < 5; i++) t.recordFailure("A@X.test");
        assertThat(t.isLocked("a@x.test")).isTrue();
        assertThat(t.isLocked("b@x.test")).isFalse();
    }

    @Test
    void aSuccessfulLoginClearsTheCount() {
        LoginThrottle t = new LoginThrottle(props(), new MovableClock());
        for (int i = 0; i < 4; i++) t.recordFailure("a@x.test");
        t.reset("a@x.test");
        t.recordFailure("a@x.test");
        assertThat(t.isLocked("a@x.test")).isFalse();
    }
}
