package dev.dacruz.clinic.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** One append-only audit row. There is deliberately no setter and no update or delete path anywhere in the code. */
@Entity
@Table(name = "audit_event")
public class AuditEvent {

    public enum Action { LOGIN, LOGIN_FAILED, VIEW_REDACTED, REVEAL, STATUS_CHANGE, INGEST }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private Instant at;

    @Column(nullable = false, length = 80)
    private String actor;

    @Column(name = "actor_role", nullable = false, length = 20)
    private String actorRole;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private Action action;

    @Column(name = "call_id")
    private UUID callId;

    @Column(nullable = false, length = 400)
    private String detail;

    protected AuditEvent() {
        // JPA
    }

    public AuditEvent(Instant at, String actor, String actorRole, Action action, UUID callId, String detail) {
        this.at = at;
        this.actor = actor;
        this.actorRole = actorRole;
        this.action = action;
        this.callId = callId;
        this.detail = detail == null ? "" : (detail.length() > 400 ? detail.substring(0, 400) : detail);
    }

    public Long getId() { return id; }
    public Instant getAt() { return at; }
    public String getActor() { return actor; }
    public String getActorRole() { return actorRole; }
    public Action getAction() { return action; }
    public UUID getCallId() { return callId; }
    public String getDetail() { return detail; }
}
