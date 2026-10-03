package dev.dacruz.clinic.audit;

import java.time.Clock;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuditService {

    private final AuditRepository repo;
    private final Clock clock;

    public AuditService(AuditRepository repo, Clock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    /**
     * Joins the caller's transaction on purpose: if the action it records rolls back, so does its audit row, and if the
     * audit insert fails the action fails too. Access to PHI never happens without its record.
     */
    @Transactional
    public void record(String actor, String role, AuditEvent.Action action, UUID callId, String detail) {
        repo.save(new AuditEvent(clock.instant(), actor, role, action, callId, detail));
    }

    @Transactional(readOnly = true)
    public Page<AuditEvent> page(int page, int size) {
        int safeSize = Math.max(1, Math.min(size, 100));
        return repo.findAll(PageRequest.of(Math.max(page, 0), safeSize, Sort.by(Sort.Direction.DESC, "at", "id")));
    }
}
