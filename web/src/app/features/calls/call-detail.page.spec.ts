import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { CallsService } from '../../core/calls.service';
import { CallDetail, CallSummary, RevealResponse } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { CallDetailPage, REVEAL_VISIBLE_MS } from './call-detail.page';

const SUMMARY: CallSummary = {
  id: 'c1', startedAt: '2026-10-04T08:00:00Z', durationSec: 142, agent: 'Front desk agent', callerLabel: 'Caller 0143',
  reason: 'APPOINTMENT', outcome: 'BOOKED', status: 'NEW', flagged: false, phiCount: 3,
};
const DETAIL: CallDetail = {
  summary: SUMMARY,
  transcript: [
    { speaker: 'AGENT', text: 'How can I help?' },
    { speaker: 'CALLER', text: 'Hi, my name is [NAME]. Text me at [PHONE].' },
  ],
  phiSummary: 'NAME:1,PHONE:2',
};
const REVEALED: RevealResponse = {
  callId: 'c1', patientName: 'Dana Whitfield', revealedAt: '2026-10-04T08:05:00Z',
  transcript: [{ speaker: 'CALLER', text: 'Hi, my name is Dana Whitfield. Text me at (415) 555-0199.' }],
};

describe('CallDetailPage', () => {
  let fixture: ComponentFixture<CallDetailPage>;
  let setStatus: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let closed: Subject<RevealResponse | undefined>;

  function create(isAdmin: boolean) {
    setStatus = vi.fn((_id: string, status: CallSummary['status']) => of({ ...SUMMARY, status }));
    closed = new Subject<RevealResponse | undefined>();
    open = vi.fn(() => ({ closed }));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: CallsService, useValue: { setStatus } },
        { provide: Dialog, useValue: { open } },
        { provide: AuthService, useValue: { isAdmin: () => isAdmin } },
      ],
    });
    fixture = TestBed.createComponent(CallDetailPage);
    fixture.componentRef.setInput('detail', DETAIL);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  // fixture.whenStable() hangs under fake timers (the scheduler's timers never fire), so advance the fake clock and detect explicitly.
  const flush = async () => {
    await vi.advanceTimersByTimeAsync(1);
    fixture.detectChanges();
  };
  const bubbles = () => Array.from(el().querySelectorAll('.bubble p')).map((p) => p.textContent?.replace(/\s+/g, ' ').trim());

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the masked transcript with tags, the masked count, and no real values', () => {
    create(false);
    expect(el().querySelectorAll('.mask')).toHaveLength(2);
    expect(el().querySelector('#phi-title ~ p')?.textContent).toContain('3 details were masked');
    expect(el().textContent).not.toContain('Dana');
    expect(el().querySelector('.t-head')?.textContent).toContain('Masked');
  });

  it('a reviewer has no Reveal button and is told who can reveal', () => {
    create(false);
    expect(el().querySelector('[data-test="reveal"]')).toBeNull();
    expect(el().textContent).toContain('Only administrators can reveal');
  });

  it('an administrator has a Reveal button', () => {
    create(true);
    expect(el().querySelector('[data-test="reveal"]')).not.toBeNull();
    expect(el().textContent).not.toContain('Only administrators can reveal');
  });

  it('opening Reveal passes the call and its masked label to the dialog', () => {
    create(true);
    el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.click();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][1].data).toEqual({ callId: 'c1', callerLabel: 'Caller 0143' });
    expect(open.mock.calls[0][1].restoreFocus).toBe(true);
  });

  it('cancelling the dialog reveals nothing', async () => {
    create(true);
    el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.click();
    closed.next(undefined);
    await flush();
    expect(el().querySelector('.reveal-banner')).toBeNull();
    expect(el().querySelectorAll('.mask')).toHaveLength(2);
  });

  it('a successful reveal shows the plain transcript, says it was recorded, and disables the button', async () => {
    create(true);
    el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.click();
    closed.next(REVEALED);
    await flush();
    expect(bubbles()).toEqual(['Hi, my name is Dana Whitfield. Text me at (415) 555-0199.']);
    expect(el().querySelector('.reveal-banner')?.textContent).toContain('recorded in the audit trail');
    expect(el().querySelector('.reveal-banner')?.textContent).toContain('Dana Whitfield');
    expect(el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.disabled).toBe(true);
    expect(el().querySelector('.sr-only[role="status"]')?.textContent).toContain('now visible');
  });

  it('revealed details hide themselves again after the time limit', async () => {
    create(true);
    el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.click();
    closed.next(REVEALED);
    await flush();
    await vi.advanceTimersByTimeAsync(REVEAL_VISIBLE_MS - 1000);
    await flush();
    expect(el().querySelector('.reveal-banner')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1500);
    await flush();
    expect(el().querySelector('.reveal-banner')).toBeNull();
    expect(el().querySelectorAll('.mask')).toHaveLength(2);
    expect(el().querySelector('.sr-only[role="status"]')?.textContent).toContain('hidden again');
  });

  it('Hide now masks it at once and the old timer cannot hide a LATER reveal early', async () => {
    create(true);
    const btn = () => el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!;
    btn().click();
    closed.next(REVEALED);
    await flush();
    await vi.advanceTimersByTimeAsync(50_000);
    el().querySelector<HTMLButtonElement>('.reveal-banner button')!.click();
    await flush();
    expect(el().querySelector('.reveal-banner')).toBeNull();
    // reveal again; the first timer would fire 10s from now and must not hide this one
    closed = new Subject();
    open.mockReturnValue({ closed });
    btn().click();
    closed.next(REVEALED);
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await flush();
    expect(el().querySelector('.reveal-banner')).not.toBeNull();
  });

  it('leaves no timer running when the page is destroyed', async () => {
    create(true);
    el().querySelector<HTMLButtonElement>('[data-test="reveal"]')!.click();
    closed.next(REVEALED);
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    fixture.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('offers the next sensible status actions and applies one through the API', async () => {
    create(false);
    const labels = () => Array.from(el().querySelectorAll('.stack button')).map((b) => b.textContent?.trim());
    expect(labels()).toEqual(['Start review', 'Mark resolved']);
    el().querySelector<HTMLButtonElement>('.stack button')!.click();
    await flush();
    expect(setStatus).toHaveBeenCalledWith('c1', 'IN_REVIEW');
    expect(el().querySelector('.head .chip')?.textContent).toContain('In review');
    expect(labels()).toEqual(['Mark resolved', 'Move back to new']);
    expect(el().querySelector('.sr-only[role="status"]')?.textContent).toContain('Status changed to In review');
  });

  it('a resolved call can be reopened', async () => {
    create(false);
    fixture.componentRef.setInput('detail', { ...DETAIL, summary: { ...SUMMARY, status: 'RESOLVED' } });
    fixture.detectChanges();
    expect(Array.from(el().querySelectorAll('.stack button')).map((b) => b.textContent?.trim())).toEqual(['Reopen for review']);
  });

  it('a failed status change tells the user and leaves the status alone', async () => {
    create(false);
    setStatus.mockReturnValue(throwError(() => new Error('down')));
    el().querySelector<HTMLButtonElement>('.stack button')!.click();
    await flush();
    expect(el().querySelector('.head .chip')?.textContent).toContain('New');
    expect(TestBed.inject(ToastService).toasts()[0].text).toContain('could not be changed');
  });
});
