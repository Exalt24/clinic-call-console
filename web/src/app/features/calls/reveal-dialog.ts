import { HttpErrorResponse } from '@angular/common/http';
import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CallsService } from '../../core/calls.service';
import { ProblemDetail, RevealResponse } from '../../core/models';
import { IconComponent } from '../../shared/icon';

export interface RevealDialogData {
  callId: string;
  callerLabel: string;
}

export const REASON_MIN = 10;
export const REASON_MAX = 300;

/**
 * Asks WHY before any protected detail is shown. The reason is sent with the request and stored in the audit trail by the
 * server; this form only makes it impossible to ask without one. It runs in a CDK dialog, which traps focus, closes on
 * Escape and returns focus to the button that opened it.
 */
@Component({
  selector: 'app-reveal-dialog',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- [formGroup] is what makes (ngSubmit) real: without a form directive the browser submits the form itself and reloads the page. -->
    <!-- The dialog role, aria-modal and the labelling are on the CDK container (see openReveal), so there is exactly one dialog. -->
    <form class="box" [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <div class="icon"><app-icon name="eye" /></div>
      <h2 id="reveal-title">Reveal protected details</h2>
      <p id="reveal-desc" class="muted">
        You are about to see the unmasked transcript for <strong>{{ data.callerLabel }}</strong>. This is recorded in the
        audit trail with your name, the time and the reason you give. Use it only when you need the details to do your job.
      </p>

      <div class="field">
        <label for="reason">Reason for revealing</label>
        <textarea id="reason" class="textarea" formControlName="reason" [attr.aria-invalid]="showError()"
          aria-describedby="reason-help reason-count" maxlength="300" placeholder="For example: patient asked for a copy of this call"></textarea>
        <div class="row">
          <p id="reason-help" class="hint" [class.error-text]="showError()">
            @if (showError()) { Give a reason of {{ min }} to {{ max }} characters. } @else { At least {{ min }} characters. }
          </p>
          <p id="reason-count" class="hint">{{ reason.value.trim().length }} / {{ max }}</p>
        </div>
      </div>

      <p class="error-text" role="alert">{{ error() }}</p>

      <div class="actions">
        <button type="button" class="btn" (click)="ref.close()">Cancel</button>
        <button type="submit" class="btn btn-danger" [disabled]="pending()">{{ pending() ? 'Revealing…' : 'Reveal and record' }}</button>
      </div>
    </form>
  `,
  styles: `
    :host { display: block; }
    .box { display: grid; gap: 1rem; width: min(92vw, 34rem); padding: clamp(1.1rem, 4vw, 1.75rem); background: var(--surface); border-radius: var(--radius); box-shadow: 0 20px 60px rgba(20,33,61,.3); }
    .icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 12px; background: var(--bad-bg); color: var(--bad-ink); --icon-size: 1.4rem; }
    .row { display: flex; justify-content: space-between; gap: 1rem; }
    .actions { display: flex; justify-content: flex-end; gap: .6rem; flex-wrap: wrap; }
    .error-text { min-height: 1.3em; margin: 0; }
  `,
})
export class RevealDialog {
  protected readonly data = inject<RevealDialogData>(DIALOG_DATA);
  protected readonly ref = inject<DialogRef<RevealResponse | undefined>>(DialogRef);
  private readonly calls = inject(CallsService);

  protected readonly min = REASON_MIN;
  protected readonly max = REASON_MAX;
  protected readonly pending = signal(false);
  protected readonly error = signal('');
  private readonly touched = signal(false);

  protected readonly form = new FormGroup({
    reason: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, trimmedLength(REASON_MIN, REASON_MAX)],
    }),
  });
  protected readonly reason = this.form.controls.reason;

  protected showError(): boolean {
    return this.reason.invalid && (this.touched() || this.reason.dirty);
  }

  protected submit(): void {
    this.touched.set(true);
    if (this.reason.invalid) {
      return;
    }
    this.pending.set(true);
    this.error.set('');
    this.calls.reveal(this.data.callId, this.reason.value.trim()).subscribe({
      next: (res) => this.ref.close(res),
      error: (err: unknown) => {
        this.pending.set(false);
        this.error.set(describe(err));
      },
    });
  }
}

/** The length rule is on the TRIMMED text, the same way the server judges it, so "          " is not a reason. */
export function trimmedLength(min: number, max: number) {
  return (c: { value: string }) => {
    const n = (c.value ?? '').trim().length;
    return n < min || n > max ? { length: { min, max, actual: n } } : null;
  };
}

function describe(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 403) return 'Only administrators can reveal protected details.';
    if (err.status === 404) return 'That call no longer exists.';
    const detail = (err.error as ProblemDetail | null)?.detail;
    if (err.status === 400 && detail) return detail;
  }
  return 'The details could not be revealed. Nothing was shown. Please try again.';
}
