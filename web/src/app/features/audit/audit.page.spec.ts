import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallsService } from '../../core/calls.service';
import { AuditRow, Page } from '../../core/models';
import { AuditPage } from './audit.page';

const ROWS: AuditRow[] = [
  { id: 3, at: '2026-10-04T08:05:00Z', actor: 'admin@demo.test', actorRole: 'ADMIN', action: 'REVEAL', callId: '9928e566-9fae', detail: 'reason: audit sample' },
  { id: 2, at: '2026-10-04T08:04:00Z', actor: 'reviewer@demo.test', actorRole: 'REVIEWER', action: 'VIEW_REDACTED', callId: '9928e566-9fae', detail: 'opened redacted transcript' },
  { id: 1, at: '2026-10-04T08:03:00Z', actor: 'ghost@demo.test', actorRole: 'NONE', action: 'LOGIN_FAILED', callId: null, detail: 'bad credentials' },
];
const PAGE: Page<AuditRow> = { content: ROWS, page: 0, size: 15, totalElements: 40, totalPages: 3 };

describe('AuditPage', () => {
  let fixture: ComponentFixture<AuditPage>;
  let audit: ReturnType<typeof vi.fn>;

  async function create(impl: (p: number, s: number) => ReturnType<CallsService['audit']>) {
    audit = vi.fn(impl);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CallsService, useValue: { audit } }] });
    fixture = TestBed.createComponent(AuditPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  beforeEach(() => TestBed.resetTestingModule());

  it('lists events with readable action names, the actor, the reason and a link to the call', async () => {
    await create(() => of(PAGE));
    const rows = el().querySelectorAll('table tbody tr');
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain('Revealed details');
    expect(rows[0].textContent).toContain('reason: audit sample');
    expect(rows[0].querySelector('a')?.getAttribute('href')).toBe('/calls/9928e566-9fae');
    expect(rows[0].querySelector('a')?.textContent).toBe('9928e566');
    expect(rows[1].textContent).toContain('Opened call');
  });

  it('says a failed sign-in was not signed in, and shows "none" where there is no call', async () => {
    await create(() => of(PAGE));
    const last = el().querySelectorAll('table tbody tr')[2];
    expect(last.textContent).toContain('not signed in');
    expect(last.textContent).toContain('none');
    expect(last.textContent).toContain('Failed sign-in');
  });

  it('marks a reveal with its own visual class so it stands out from routine events', async () => {
    await create(() => of(PAGE));
    expect(el().querySelectorAll('table tbody tr')[0].querySelector('.chip')?.classList.contains('chip-bad')).toBe(true);
    expect(el().querySelectorAll('table tbody tr')[1].querySelector('.chip')?.classList.contains('chip-bad')).toBe(false);
  });

  it('states that entries cannot be edited from the app', async () => {
    await create(() => of(PAGE));
    expect(el().textContent).toContain('cannot be edited or deleted');
  });

  it('pages from newest to older', async () => {
    await create(() => of(PAGE));
    const [newer, older] = Array.from(el().querySelectorAll<HTMLButtonElement>('nav.pager button'));
    expect(newer.disabled).toBe(true);
    older.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(audit).toHaveBeenLastCalledWith(1, 15);
  });

  it('shows an error state with a retry', async () => {
    let fail = true;
    await create(() => (fail ? throwError(() => new Error('down')) : of(PAGE)));
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not load');
    fail = false;
    el().querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el().querySelectorAll('table tbody tr')).toHaveLength(3);
  });
});
