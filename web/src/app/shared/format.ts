import { AuditAction, CallOutcome, CallReason, CallStatus } from '../core/models';

export const REASON_LABEL: Record<CallReason, string> = {
  APPOINTMENT: 'Appointment',
  INSURANCE: 'Insurance',
  BILLING: 'Billing',
  REFILL: 'Refill',
  OTHER: 'Other',
};

export const OUTCOME_LABEL: Record<CallOutcome, string> = {
  BOOKED: 'Booked',
  INFO_GIVEN: 'Info given',
  HANDED_OFF: 'Handed off',
  UNRESOLVED: 'Unresolved',
};

export const STATUS_LABEL: Record<CallStatus, string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
};

export const ACTION_LABEL: Record<AuditAction, string> = {
  LOGIN: 'Signed in',
  LOGIN_FAILED: 'Failed sign-in',
  VIEW_REDACTED: 'Opened call',
  REVEAL: 'Revealed details',
  STATUS_CHANGE: 'Changed status',
  INGEST: 'Call received',
};

/** 142 -> "2m 22s", 45 -> "45s". */
export function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s.toString().padStart(2, '0')}s`;
}

const MASK_LABEL: Record<string, string> = {
  PHONE: 'phone number',
  DOB: 'date of birth',
  SSN: 'social security number',
  EMAIL: 'email address',
  MRN: 'medical record number',
  ADDRESS: 'street address',
  INSURANCE_ID: 'insurance ID',
  NAME: 'name',
};

export function maskLabel(kind: string): string {
  return MASK_LABEL[kind] ?? kind.toLowerCase();
}

export interface Segment {
  /** 'text' is shown as is; 'mask' is a redaction placeholder such as [PHONE]. */
  type: 'text' | 'mask';
  value: string;
}

const MASK = /\[([A-Z_]{2,16})\]/g;

/** Splits "call [PHONE] about [NAME]" into text and mask segments so masks can be drawn as tags. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MASK)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) });
    out.push({ type: 'mask', value: m[1] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** "PHONE:2,DOB:1" -> [{kind:'PHONE', count:2}, {kind:'DOB', count:1}] */
export function parsePhiSummary(summary: string): { kind: string; count: number }[] {
  return summary
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const [kind, n] = p.split(':');
      return { kind, count: Number(n) || 0 };
    })
    .filter((x) => x.count > 0);
}
