package dev.dacruz.clinic.calls;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * One voice-agent call. patientNameEnc and rawTranscriptEnc hold AES-GCM ciphertext (see FieldCipher), written and read
 * only through CallService, so no controller can accidentally serialise the readable transcript.
 */
@Entity
@Table(name = "call_record")
public class CallRecord {

    public enum Reason { APPOINTMENT, INSURANCE, BILLING, REFILL, OTHER }

    public enum Outcome { BOOKED, INFO_GIVEN, HANDED_OFF, UNRESOLVED }

    public enum Status { NEW, IN_REVIEW, RESOLVED }

    @Id
    private UUID id;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "duration_sec", nullable = false)
    private int durationSec;

    @Column(nullable = false, length = 60)
    private String agent;

    @Column(name = "caller_label", nullable = false, length = 40)
    private String callerLabel;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Reason reason;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Outcome outcome;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Status status;

    @Column(nullable = false)
    private boolean flagged;

    @Column(name = "patient_name_enc", nullable = false)
    private String patientNameEnc;

    @Column(name = "raw_transcript_enc", nullable = false)
    private String rawTranscriptEnc;

    @Column(name = "redacted_transcript", nullable = false)
    private String redactedTranscript;

    @Column(name = "phi_summary", nullable = false, length = 200)
    private String phiSummary = "";

    protected CallRecord() {
        // JPA
    }

    public CallRecord(UUID id, Instant startedAt, int durationSec, String agent, String callerLabel, Reason reason,
                      Outcome outcome, Status status, boolean flagged, String patientNameEnc, String rawTranscriptEnc,
                      String redactedTranscript, String phiSummary) {
        this.id = id;
        this.startedAt = startedAt;
        this.durationSec = durationSec;
        this.agent = agent;
        this.callerLabel = callerLabel;
        this.reason = reason;
        this.outcome = outcome;
        this.status = status;
        this.flagged = flagged;
        this.patientNameEnc = patientNameEnc;
        this.rawTranscriptEnc = rawTranscriptEnc;
        this.redactedTranscript = redactedTranscript;
        this.phiSummary = phiSummary;
    }

    public UUID getId() { return id; }
    public Instant getStartedAt() { return startedAt; }
    public int getDurationSec() { return durationSec; }
    public String getAgent() { return agent; }
    public String getCallerLabel() { return callerLabel; }
    public Reason getReason() { return reason; }
    public Outcome getOutcome() { return outcome; }
    public Status getStatus() { return status; }
    public boolean isFlagged() { return flagged; }
    public String getPatientNameEnc() { return patientNameEnc; }
    public String getRawTranscriptEnc() { return rawTranscriptEnc; }
    public String getRedactedTranscript() { return redactedTranscript; }
    public String getPhiSummary() { return phiSummary; }

    public void setStatus(Status status) { this.status = status; }
}
