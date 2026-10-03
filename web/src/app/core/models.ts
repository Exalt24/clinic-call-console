/** Wire types. They mirror the Java records in CallDtos, and `Page` mirrors the API's own PageDto, not Spring's PageImpl. */

export type Role = 'REVIEWER' | 'ADMIN';
export type CallStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED';
export type CallReason = 'APPOINTMENT' | 'INSURANCE' | 'BILLING' | 'REFILL' | 'OTHER';
export type CallOutcome = 'BOOKED' | 'INFO_GIVEN' | 'HANDED_OFF' | 'UNRESOLVED';
export type AuditAction = 'LOGIN' | 'LOGIN_FAILED' | 'VIEW_REDACTED' | 'REVEAL' | 'STATUS_CHANGE' | 'INGEST';

export interface Session {
  token: string;
  username: string;
  displayName: string;
  role: Role;
  /** ISO instant, taken from the server so the client never guesses how long a token lives. */
  expiresAt: string;
}

export interface Page<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface CallSummary {
  id: string;
  startedAt: string;
  durationSec: number;
  agent: string;
  callerLabel: string;
  reason: CallReason;
  outcome: CallOutcome;
  status: CallStatus;
  flagged: boolean;
  phiCount: number;
}

export interface TranscriptLine {
  speaker: string;
  text: string;
}

export interface CallDetail {
  summary: CallSummary;
  transcript: TranscriptLine[];
  /** "PHONE:2,DOB:1" */
  phiSummary: string;
}

export interface RevealResponse {
  callId: string;
  patientName: string;
  transcript: TranscriptLine[];
  revealedAt: string;
}

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  actorRole: string;
  action: AuditAction;
  callId: string | null;
  detail: string;
}

/** RFC 9457 problem details, the one error shape the API returns. */
export interface ProblemDetail {
  title?: string;
  detail?: string;
  status?: number;
}

export interface CallQuery {
  status: CallStatus | null;
  q: string;
  page: number;
  size: number;
}
