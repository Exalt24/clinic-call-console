package dev.dacruz.clinic.audit;

import java.time.Instant;
import java.util.UUID;
import dev.dacruz.clinic.web.PageDto;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/audit")
public class AuditController {

    public record AuditRow(long id, Instant at, String actor, String actorRole, AuditEvent.Action action, UUID callId, String detail) {}

    private final AuditService audit;

    public AuditController(AuditService audit) {
        this.audit = audit;
    }

    /** The audit trail itself is admin-only: reviewers must not be able to read who looked at what. */
    @GetMapping
    @PreAuthorize("hasRole('ADMIN')")
    public PageDto<AuditRow> list(@RequestParam(defaultValue = "0") int page, @RequestParam(defaultValue = "20") int size) {
        return PageDto.of(audit.page(page, size).map(e -> new AuditRow(e.getId(), e.getAt(), e.getActor(), e.getActorRole(),
                e.getAction(), e.getCallId(), e.getDetail())));
    }
}
