import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { PageDto, pageOf } from '../common/page';
import { AuditAction, AuditEvent } from './audit-event.entity';

export interface AuditRow {
  id: number;
  at: string;
  actor: string;
  actorRole: string;
  action: AuditAction;
  callId: string | null;
  detail: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly ds: DataSource) {}

  /**
   * Writes through the CALLER's transaction manager on purpose: if the action it records rolls back, so does its audit row,
   * and if the audit insert fails the action fails too. Access to protected details never happens without its record.
   */
  async record(
    manager: EntityManager,
    actor: string,
    role: string,
    action: AuditAction,
    callId: string | null,
    detail: string,
  ): Promise<void> {
    await manager.insert(AuditEvent, {
      at: new Date(),
      actor: actor.slice(0, 80),
      actorRole: role,
      action,
      callId,
      detail: (detail ?? '').slice(0, 400),
    });
  }

  /** For events with no other write to join (a sign-in, a failed sign-in): its own short transaction. */
  async recordAlone(actor: string, role: string, action: AuditAction, callId: string | null, detail: string): Promise<void> {
    await this.ds.transaction((m) => this.record(m, actor, role, action, callId, detail));
  }

  async page(page: number, size: number): Promise<PageDto<AuditRow>> {
    const safeSize = Math.max(1, Math.min(size, 100));
    const safePage = Math.max(page, 0);
    const [rows, total] = await this.ds.getRepository(AuditEvent).findAndCount({
      order: { at: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });
    const content = rows.map<AuditRow>((e) => ({
      id: Number(e.id),
      at: e.at.toISOString(),
      actor: e.actor,
      actorRole: e.actorRole,
      action: e.action,
      callId: e.callId,
      detail: e.detail,
    }));
    return pageOf(content, safePage, safeSize, total);
  }
}
