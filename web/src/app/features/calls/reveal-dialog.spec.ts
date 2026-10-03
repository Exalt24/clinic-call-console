import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CallsService } from '../../core/calls.service';
import { RevealResponse } from '../../core/models';
import { REASON_MAX, REASON_MIN, RevealDialog, trimmedLength } from './reveal-dialog';

const RESULT: RevealResponse = { callId: 'c1', patientName: 'Dana Whitfield', transcript: [], revealedAt: '2026-10-04T00:00:00Z' };

describe('trimmedLength validator', () => {
  const v = trimmedLength(10, 20);
  it('judges the TRIMMED text, the way the server does', () => {
    expect(v({ value: '          ' })).not.toBeNull();
    expect(v({ value: '  short  ' })).not.toBeNull();
    expect(v({ value: '  ten chars!  ' })).toBeNull();
    expect(v({ value: 'x'.repeat(21) })).not.toBeNull();
    expect(v({ value: 'x'.repeat(20) })).toBeNull();
  });
});

describe('RevealDialog', () => {
  let fixture: ComponentFixture<RevealDialog>;
  let reveal: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;

  function create(revealImpl: () => Observable<RevealResponse> = () => of(RESULT)) {
    reveal = vi.fn(revealImpl);
    close = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: CallsService, useValue: { reveal } },
        { provide: DIALOG_DATA, useValue: { callId: 'c1', callerLabel: 'Caller 0143' } },
        { provide: DialogRef, useValue: { close } },
      ],
    });
    fixture = TestBed.createComponent(RevealDialog);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const form = () => el().querySelector('form')!;
  const typeReason = (value: string) => {
    const t = el().querySelector<HTMLTextAreaElement>('#reason')!;
    t.value = value;
    t.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    form().dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());

  it('handles the submit event itself, so the browser never submits the form natively and reloads the page', () => {
    // Regression: <form (ngSubmit)> with no form directive left the submit unhandled and the whole page reloaded.
    create();
    const ev = new Event('submit', { cancelable: true });
    form().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('asks for a reason and shows nothing is revealed yet', () => {
    create();
    expect(el().textContent).toContain('Reason for revealing');
    expect(el().textContent).toContain('Caller 0143');
    expect(el().querySelectorAll('[role="dialog"]').length).toBe(0);   // the one dialog role lives on the CDK container
  });

  it('does not call the API without a reason and shows the rule', async () => {
    create();
    await submit();
    expect(reveal).not.toHaveBeenCalled();
    expect(el().querySelector('#reason-help')?.textContent).toContain(`${REASON_MIN} to ${REASON_MAX}`);
    expect(el().querySelector('#reason')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('refuses a reason that is only spaces or too short', async () => {
    create();
    typeReason('            ');
    await submit();
    typeReason('too short');
    await submit();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('sends the TRIMMED reason and closes with the revealed result', async () => {
    create();
    typeReason('   Patient asked for a copy of this call   ');
    await submit();
    expect(reveal).toHaveBeenCalledWith('c1', 'Patient asked for a copy of this call');
    expect(close).toHaveBeenCalledWith(RESULT);
  });

  it('counts the trimmed characters live', async () => {
    create();
    typeReason('  abcde  ');
    fixture.detectChanges();
    expect(el().querySelector('#reason-count')?.textContent).toContain('5 / 300');
  });

  it('a 403 says only administrators can do this, and the dialog stays open', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 403 })));
    typeReason('A perfectly good reason');
    await submit();
    expect(el().textContent).toContain('Only administrators can reveal');
    expect(close).not.toHaveBeenCalled();
    expect(el().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('a server failure says nothing was shown and offers another try', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    typeReason('A perfectly good reason');
    await submit();
    expect(el().textContent).toContain('Nothing was shown');
    expect(close).not.toHaveBeenCalled();
  });

  it('a server-side 400 shows the server message', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 400, error: { detail: 'Give a reason of 10 to 300 characters' } })));
    typeReason('A perfectly good reason');
    await submit();
    expect(el().textContent).toContain('Give a reason of 10 to 300 characters');
  });

  it('Cancel closes without a result', () => {
    create();
    el().querySelector<HTMLButtonElement>('button.btn:not([type="submit"])')!.click();
    expect(close).toHaveBeenCalledWith();
    expect(reveal).not.toHaveBeenCalled();
  });
});
