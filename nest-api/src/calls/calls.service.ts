import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { PageDto, pageOf } from '../common/page';
import { APP_CONFIG, AppConfig } from '../config/config';
import { FieldCipher } from '../crypto/field-cipher';
import { redact } from '../redaction/phi-redactor';
import { IngestDto } from './calls.dto';
import { CallOutcome, CallReason, CallRecord, CallStatus } from './call-record.entity';

/** A call with this many masked identifiers is flagged even if it ended well (six, so a flag still carries information). */
export const DENSE_PHI_THRESHOLD = 6;

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
  phiSummary: string;
}

export interface RevealResponse {
  callId: string;
  patientName: string;
  transcript: TranscriptLine[];
  revealedAt: string;
}

export interface IngestResponse {
  id: string;
  duplicate: boolean;
  phiCount: number;
}

/** The same id the Spring Boot API derives from an external id (a name-based UUID, version 3), so a redelivery maps to one row. */
export function idForExternal(externalId: string): string {
  const d = createHash('md5').update(`ext:${externalId}`, 'utf8').digest();
  d[6] = (d[6] & 0x0f) | 0x30;
  d[8] = (d[8] & 0x3f) | 0x80;
  const h = d.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function parseLines(transcript: string): TranscriptLine[] {
  const out: TranscriptLine[] = [];
  for (const line of transcript.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out.push({ speaker: line.slice(0, i).trim(), text: line.slice(i + 1).trim() });
    else if (line.trim()) out.push({ speaker: 'NOTE', text: line.trim() });
  }
  return out;
}

function phiCount(summary: string): number {
  let n = 0;
  for (const part of summary.split(',')) {
    const i = part.indexOf(':');
    if (i > 0) n += Number.parseInt(part.slice(i + 1).trim(), 10) || 0;
  }
  return n;
}

function summaryOf(c: CallRecord): CallSummary {
  return {
    id: c.id,
    startedAt: c.startedAt.toISOString(),
    durationSec: c.durationSec,
    agent: c.agent,
    callerLabel: c.callerLabel,
    reason: c.reason,
    outcome: c.outcome,
    status: c.status,
    flagged: c.flagged,
    phiCount: phiCount(c.phiSummary),
  };
}

@Injectable()
export class CallsService {
  private readonly cipher: FieldCipher;

  constructor(
    private readonly ds: DataSource,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    this.cipher = new FieldCipher(cfg.fieldKey);
  }

  async page(status: CallStatus | undefined, q: string | undefined, page: number, size: number): Promise<PageDto<CallSummary>> {
    const safeSize = Math.max(1, Math.min(size, 50));
    const safePage = Math.max(page, 0);
    const qb = this.ds.getRepository(CallRecord).createQueryBuilder('c');
    if (status) qb.andWhere('c.status = :status', { status });
    const term = (q ?? '').trim();
    if (term) {
      // Searches the REDACTED transcript, the agent and the masked caller label. The patient name is encrypted, so it
      // cannot be searched, which is the point.
      const like = `%${term.toLowerCase().replace(/[%_\\]/g, '')}%`;
      qb.andWhere('(lower(c.redactedTranscript) LIKE :like OR lower(c.agent) LIKE :like OR lower(c.callerLabel) LIKE :like)', { like });
    }
    const [rows, total] = await qb
      .orderBy('c.startedAt', 'DESC')
      .addOrderBy('c.id', 'ASC')
      .skip(safePage * safeSize)
      .take(safeSize)
      .getManyAndCount();
    return pageOf(rows.map(summaryOf), safePage, safeSize, total);
  }

  /** Opening a call shows the redacted transcript only, and that act is itself audited. */
  detail(id: string, actor: string, role: string): Promise<CallDetail> {
    return this.ds.transaction(async (m) => {
      const c = await this.find(m, id);
      await this.audit.record(m, actor, role, 'VIEW_REDACTED', id, 'opened redacted transcript');
      return { summary: summaryOf(c), transcript: parseLines(c.redactedTranscript), phiSummary: c.phiSummary };
    });
  }

  /**
   * The only path that returns readable details. The role check lives on the controller and the reason is required by
   * validation; the audit row goes through the SAME transaction manager as the read, so there is no reveal without a
   * record, and nothing readable leaves this method unless the audit insert succeeded.
   */
  reveal(id: string, reason: string, actor: string, role: string): Promise<RevealResponse> {
    return this.ds.transaction(async (m) => {
      const c = await this.find(m, id);
      await this.audit.record(m, actor, role, 'REVEAL', id, `reason: ${reason.trim()}`);
      return {
        callId: id,
        patientName: this.cipher.decrypt(c.patientNameEnc),
        transcript: parseLines(this.cipher.decrypt(c.rawTranscriptEnc)),
        revealedAt: new Date().toISOString(),
      };
    });
  }

  changeStatus(id: string, next: CallStatus, actor: string, role: string): Promise<CallSummary> {
    return this.ds.transaction(async (m) => {
      const c = await this.find(m, id);
      const before = c.status;
      await m.update(CallRecord, { id }, { status: next });
      c.status = next;
      await this.audit.record(m, actor, role, 'STATUS_CHANGE', id, `from ${before} to ${next}`);
      return summaryOf(c);
    });
  }

  /** Idempotent: the same externalId always maps to the same id, so a redelivered webhook changes nothing. */
  async ingest(req: IngestDto): Promise<IngestResponse> {
    const id = idForExternal(req.externalId);
    const existing = await this.ds.getRepository(CallRecord).findOneBy({ id });
    if (existing) return { id, duplicate: true, phiCount: phiCount(existing.phiSummary) };

    const raw = req.transcript.map((l) => `${l.speaker.toUpperCase()}: ${l.text.replace(/\n/g, ' ')}`).join('\n');
    const red = redact(raw, [req.patientName]);
    const digits = req.callerNumber.replace(/\D/g, '');
    const label = `Caller ••• ${digits.length >= 4 ? digits.slice(-4) : '????'}`;
    const flagged = req.outcome === 'UNRESOLVED' || red.total >= DENSE_PHI_THRESHOLD;
    try {
      await this.ds.transaction(async (m) => {
        await m.insert(CallRecord, {
          id,
          startedAt: new Date(req.startedAt),
          durationSec: req.durationSec,
          agent: req.agent,
          callerLabel: label,
          reason: req.reason,
          outcome: req.outcome,
          status: 'NEW',
          flagged,
          patientNameEnc: this.cipher.encrypt(req.patientName),
          rawTranscriptEnc: this.cipher.encrypt(raw),
          redactedTranscript: red.text,
          phiSummary: red.summary,
        });
        await this.audit.record(m, 'voice-platform', 'SYSTEM', 'INGEST', id, `received, ${red.total} identifiers masked`);
      });
    } catch (e) {
      // two deliveries of the same call racing: the second one lost the insert and is a duplicate, not an error
      if ((e as { code?: string; driverError?: { code?: string } }).driverError?.code === '23505') {
        return { id, duplicate: true, phiCount: red.total };
      }
      throw e;
    }
    return { id, duplicate: false, phiCount: red.total };
  }

  private async find(m: EntityManager, id: string): Promise<CallRecord> {
    const c = await m.findOneBy(CallRecord, { id });
    if (!c) throw new NotFoundException('Call not found');
    return c;
  }
}
