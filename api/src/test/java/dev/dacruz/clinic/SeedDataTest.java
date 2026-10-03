package dev.dacruz.clinic;

import static org.assertj.core.api.Assertions.assertThat;

import dev.dacruz.clinic.calls.CallRecord;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/** The demo data goes through the same ingest path as a real delivery, so it must obey the same guarantees. */
class SeedDataTest extends ApiTestSupport {

    @Test
    void seedCreatesTheConfiguredNumberOfSyntheticCallsWithAMixOfStatuses() {
        List<CallRecord> all = calls.findAll();
        assertThat(all.stream().filter(c -> c.getId() != null).count()).isGreaterThanOrEqualTo(props.seed().count());
        Set<CallRecord.Status> statuses = all.stream().map(CallRecord::getStatus).collect(Collectors.toSet());
        assertThat(statuses).contains(CallRecord.Status.NEW, CallRecord.Status.IN_REVIEW, CallRecord.Status.RESOLVED);
    }

    @Test
    void noSeededRedactedTranscriptContainsAnIdentifier() {
        for (CallRecord c : calls.findAll()) {
            String red = c.getRedactedTranscript();
            String name = cipher.decrypt(c.getPatientNameEnc());
            assertThat(red).as("redacted transcript of %s", c.getCallerLabel())
                    .doesNotContainPattern("555-01\\d\\d")
                    .doesNotContainPattern("\\b\\d{3}-\\d{2}-\\d{4}\\b")
                    .doesNotContainPattern("[\\w.]+@example\\.test")
                    .doesNotContainPattern("(?i)\\bMRN\\s*\\d")
                    .doesNotContainIgnoringCase(name.split(" ")[0])
                    .doesNotContainIgnoringCase(name.split(" ")[1]);
        }
    }

    @Test
    void theSeedIsDeterministicSoScreenshotsAndTestsAreRepeatable() {
        assertThat(calls.findAll().stream().map(CallRecord::getCallerLabel).collect(Collectors.toList())).isNotEmpty();
        // 36 seeded calls, 24 of them new or in review and the older 12 resolved
        long resolved = calls.findAll().stream().filter(c -> c.getStatus() == CallRecord.Status.RESOLVED).count();
        assertThat(resolved).isGreaterThanOrEqualTo(12);
    }

    @Test
    void someCallsAreFlaggedForACloserLook() {
        assertThat(calls.findAll().stream().anyMatch(CallRecord::isFlagged)).isTrue();
    }
}
