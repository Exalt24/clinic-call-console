package dev.dacruz.clinic.calls;

import dev.dacruz.clinic.audit.AuditEvent;
import dev.dacruz.clinic.audit.AuditService;
import dev.dacruz.clinic.calls.CallDtos.CallDetail;
import dev.dacruz.clinic.calls.CallDtos.CallSummary;
import dev.dacruz.clinic.calls.CallDtos.IngestRequest;
import dev.dacruz.clinic.calls.CallDtos.IngestResponse;
import dev.dacruz.clinic.calls.CallDtos.RevealResponse;
import dev.dacruz.clinic.calls.CallDtos.TranscriptLine;
import dev.dacruz.clinic.crypto.FieldCipher;
import dev.dacruz.clinic.redaction.PhiRedactor;
import jakarta.persistence.criteria.Predicate;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.data.jpa.domain.Specification;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class CallService {

    /**
     * A call with this many masked identifiers is flagged for a closer look even if it ended well. Six, not four: a flag on
     * nearly every call carries no information (the first seeded run flagged almost the whole queue).
     */
    static final int DENSE_PHI_THRESHOLD = 6;

    private final CallRepository calls;
    private final FieldCipher cipher;
    private final PhiRedactor redactor;
    private final AuditService audit;
    private final Clock clock;

    public CallService(CallRepository calls, FieldCipher cipher, PhiRedactor redactor, AuditService audit, Clock clock) {
        this.calls = calls;
        this.cipher = cipher;
        this.redactor = redactor;
        this.audit = audit;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public Page<CallSummary> page(CallRecord.Status status, String q, int page, int size) {
        int safeSize = Math.max(1, Math.min(size, 50));
        Specification<CallRecord> spec = (root, query, cb) -> {
            List<Predicate> ps = new ArrayList<>();
            if (status != null) {
                ps.add(cb.equal(root.get("status"), status));
            }
            if (q != null && !q.isBlank()) {
                // Searches the REDACTED transcript, the agent and the masked caller label. The patient name is
                // encrypted, so it cannot be searched, which is the point.
                String like = "%" + q.trim().toLowerCase().replace("%", "").replace("_", "") + "%";
                ps.add(cb.or(cb.like(cb.lower(root.get("redactedTranscript")), like),
                        cb.like(cb.lower(root.get("agent")), like),
                        cb.like(cb.lower(root.get("callerLabel")), like)));
            }
            return cb.and(ps.toArray(new Predicate[0]));
        };
        return calls.findAll(spec, PageRequest.of(Math.max(page, 0), safeSize, Sort.by(Sort.Direction.DESC, "startedAt")))
                .map(CallService::summary);
    }

    /** Opening a call shows the redacted transcript only, and that act is itself audited. */
    @Transactional
    public CallDetail detail(UUID id, String actor, String role) {
        CallRecord c = find(id);
        audit.record(actor, role, AuditEvent.Action.VIEW_REDACTED, id, "opened redacted transcript");
        return new CallDetail(summary(c), lines(c.getRedactedTranscript()), c.getPhiSummary());
    }

    /**
     * The only path that returns readable PHI. The role check lives on the controller; the reason is required by
     * validation; and the audit row is written in the same transaction, so there is no reveal without a record.
     */
    @Transactional
    public RevealResponse reveal(UUID id, String reason, String actor, String role) {
        CallRecord c = find(id);
        audit.record(actor, role, AuditEvent.Action.REVEAL, id, "reason: " + reason.trim());
        return new RevealResponse(id, cipher.decrypt(c.getPatientNameEnc()), lines(cipher.decrypt(c.getRawTranscriptEnc())),
                clock.instant());
    }

    @Transactional
    public CallSummary changeStatus(UUID id, CallRecord.Status next, String actor, String role) {
        CallRecord c = find(id);
        CallRecord.Status before = c.getStatus();
        c.setStatus(next);
        audit.record(actor, role, AuditEvent.Action.STATUS_CHANGE, id, "from " + before + " to " + next);
        return summary(c);
    }

    /** Idempotent: the same externalId always maps to the same id, so a redelivered webhook changes nothing. */
    @Transactional
    public IngestResponse ingest(IngestRequest req) {
        UUID id = UUID.nameUUIDFromBytes(("ext:" + req.externalId()).getBytes(StandardCharsets.UTF_8));
        CallRecord existing = calls.findById(id).orElse(null);
        if (existing != null) {
            return new IngestResponse(id, true, phiCount(existing));
        }
        StringBuilder raw = new StringBuilder();
        for (CallDtos.IngestLine l : req.transcript()) {
            if (raw.length() > 0) raw.append('\n');
            raw.append(l.speaker().toUpperCase()).append(": ").append(l.text().replace('\n', ' '));
        }
        PhiRedactor.Result red = redactor.redact(raw.toString(), List.of(req.patientName()));
        String digits = req.callerNumber().replaceAll("\\D", "");
        String label = "Caller ••• " + (digits.length() >= 4 ? digits.substring(digits.length() - 4) : "????");
        boolean flagged = req.outcome() == CallRecord.Outcome.UNRESOLVED || red.total() >= DENSE_PHI_THRESHOLD;
        calls.save(new CallRecord(id, req.startedAt(), req.durationSec(), req.agent(), label, req.reason(), req.outcome(),
                CallRecord.Status.NEW, flagged, cipher.encrypt(req.patientName()), cipher.encrypt(raw.toString()),
                red.text(), red.summary()));
        audit.record("voice-platform", "SYSTEM", AuditEvent.Action.INGEST, id, "received, " + red.total() + " identifiers masked");
        return new IngestResponse(id, false, red.total());
    }

    private CallRecord find(UUID id) {
        return calls.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "Call not found"));
    }

    private static CallSummary summary(CallRecord c) {
        return new CallSummary(c.getId(), c.getStartedAt(), c.getDurationSec(), c.getAgent(), c.getCallerLabel(),
                c.getReason(), c.getOutcome(), c.getStatus(), c.isFlagged(), phiCount(c));
    }

    private static int phiCount(CallRecord c) {
        int n = 0;
        for (String part : c.getPhiSummary().split(",")) {
            int i = part.indexOf(':');
            if (i > 0) {
                n += Integer.parseInt(part.substring(i + 1).trim());
            }
        }
        return n;
    }

    static List<TranscriptLine> lines(String transcript) {
        List<TranscriptLine> out = new ArrayList<>();
        for (String line : transcript.split("\n")) {
            int i = line.indexOf(':');
            if (i > 0) {
                out.add(new TranscriptLine(line.substring(0, i).trim(), line.substring(i + 1).trim()));
            } else if (!line.isBlank()) {
                out.add(new TranscriptLine("NOTE", line.trim()));
            }
        }
        return out;
    }
}
