package dev.dacruz.clinic.calls;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Wire shapes. Nothing here can carry the readable transcript except RevealResponse, which only the reveal path builds. */
public final class CallDtos {

    private CallDtos() {}

    public record CallSummary(UUID id, Instant startedAt, int durationSec, String agent, String callerLabel,
                              CallRecord.Reason reason, CallRecord.Outcome outcome, CallRecord.Status status,
                              boolean flagged, int phiCount) {}

    public record TranscriptLine(String speaker, String text) {}

    public record CallDetail(CallSummary summary, List<TranscriptLine> transcript, String phiSummary) {}

    public record RevealRequest(
            @NotBlank(message = "A reason is required to reveal protected health information")
            @Size(min = 10, max = 300, message = "Give a reason of 10 to 300 characters") String reason) {}

    public record RevealResponse(UUID callId, String patientName, List<TranscriptLine> transcript, Instant revealedAt) {}

    public record StatusRequest(@NotNull(message = "status is required") CallRecord.Status status) {}

    public record IngestLine(@NotBlank @Size(max = 10) String speaker, @NotBlank @Size(max = 2000) String text) {}

    /** The call as the voice platform delivers it. externalId makes redelivery idempotent. */
    public record IngestRequest(
            @NotBlank @Size(max = 80) String externalId,
            @NotNull Instant startedAt,
            @Min(0) @Max(7200) int durationSec,
            @NotBlank @Size(max = 60) String agent,
            @NotBlank @Size(max = 30) String callerNumber,
            @NotNull CallRecord.Reason reason,
            @NotNull CallRecord.Outcome outcome,
            @NotBlank @Size(max = 80) String patientName,
            @NotEmpty @Size(max = 200) List<@Valid IngestLine> transcript) {}

    public record IngestResponse(UUID id, boolean duplicate, int phiCount) {}
}
