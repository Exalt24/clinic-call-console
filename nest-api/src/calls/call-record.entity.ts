import { Column, Entity, PrimaryColumn } from 'typeorm';

export const REASONS = ['APPOINTMENT', 'INSURANCE', 'BILLING', 'REFILL', 'OTHER'] as const;
export const OUTCOMES = ['BOOKED', 'INFO_GIVEN', 'HANDED_OFF', 'UNRESOLVED'] as const;
export const STATUSES = ['NEW', 'IN_REVIEW', 'RESOLVED'] as const;
export type CallReason = (typeof REASONS)[number];
export type CallOutcome = (typeof OUTCOMES)[number];
export type CallStatus = (typeof STATUSES)[number];

/**
 * One voice-agent call. patientNameEnc and rawTranscriptEnc hold AES-GCM ciphertext, written and read only through
 * CallsService, so no controller can accidentally serialise the readable transcript.
 */
@Entity({ name: 'call_record' })
export class CallRecord {
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  @Column({ name: 'started_at', type: 'timestamptz' })
  startedAt: Date;

  @Column({ name: 'duration_sec', type: 'int' })
  durationSec: number;

  @Column({ type: 'varchar', length: 60 })
  agent: string;

  @Column({ name: 'caller_label', type: 'varchar', length: 40 })
  callerLabel: string;

  @Column({ type: 'varchar', length: 20 })
  reason: CallReason;

  @Column({ type: 'varchar', length: 20 })
  outcome: CallOutcome;

  @Column({ type: 'varchar', length: 20 })
  status: CallStatus;

  @Column({ type: 'boolean', default: false })
  flagged: boolean;

  @Column({ name: 'patient_name_enc', type: 'text' })
  patientNameEnc: string;

  @Column({ name: 'raw_transcript_enc', type: 'text' })
  rawTranscriptEnc: string;

  @Column({ name: 'redacted_transcript', type: 'text' })
  redactedTranscript: string;

  @Column({ name: 'phi_summary', type: 'varchar', length: 200, default: '' })
  phiSummary: string;
}
