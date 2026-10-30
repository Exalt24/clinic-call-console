import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export const AUDIT_ACTIONS = ['LOGIN', 'LOGIN_FAILED', 'VIEW_REDACTED', 'REVEAL', 'STATUS_CHANGE', 'INGEST'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** One append-only audit row. Nothing in the code updates or deletes one. */
@Entity({ name: 'audit_event' })
export class AuditEvent {
  // BIGINT comes back from the driver as a string; AuditService turns it into a number for the wire, like the Spring API's long.
  @PrimaryGeneratedColumn('identity', { type: 'bigint', generatedIdentity: 'BY DEFAULT' })
  id: string;

  @Column({ type: 'timestamptz' })
  at: Date;

  @Column({ type: 'varchar', length: 80 })
  actor: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 20 })
  actorRole: string;

  @Column({ type: 'varchar', length: 30 })
  action: AuditAction;

  @Column({ name: 'call_id', type: 'uuid', nullable: true })
  callId: string | null;

  @Column({ type: 'varchar', length: 400, default: '' })
  detail: string;
}
