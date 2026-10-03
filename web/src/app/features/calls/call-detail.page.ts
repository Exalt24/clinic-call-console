import { Dialog } from '@angular/cdk/dialog';
import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CallsService } from '../../core/calls.service';
import { AuthService } from '../../core/auth.service';
import { CallDetail, CallStatus, RevealResponse } from '../../core/models';
import { ToastService } from '../../core/toast.service';
import { OUTCOME_LABEL, REASON_LABEL, STATUS_LABEL, formatDuration, maskLabel, parsePhiSummary } from '../../shared/format';
import { IconComponent } from '../../shared/icon';
import { RedactedTextComponent } from '../../shared/redacted-text';
import { RevealDialog, RevealDialogData } from './reveal-dialog';

/** Revealed text hides itself again, so an unattended screen does not keep showing protected details. */
export const REVEAL_VISIBLE_MS = 60_000;

interface StatusAction {
  to: CallStatus;
  label: string;
  primary: boolean;
}

@Component({
  selector: 'app-call-detail',
  imports: [RouterLink, DatePipe, IconComponent, RedactedTextComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './call-detail.page.html',
  styleUrl: './call-detail.page.css',
})
export class CallDetailPage {
  /** Arrives from the route resolver through withComponentInputBinding. */
  readonly detail = input.required<CallDetail>();

  private readonly calls = inject(CallsService);
  private readonly dialog = inject(Dialog);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(AuthService);

  protected readonly reasonLabel = REASON_LABEL;
  protected readonly outcomeLabel = OUTCOME_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly duration = formatDuration;
  protected readonly label = maskLabel;
  protected readonly visibleSeconds = REVEAL_VISIBLE_MS / 1000;

  /** Writable copy of the summary that resets whenever the resolver supplies a different call. */
  protected readonly summary = linkedSignal(() => this.detail().summary);
  protected readonly revealed = signal<RevealResponse | null>(null);
  protected readonly pending = signal(false);
  protected readonly announce = signal('');

  private hideTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly lines = computed(() => this.revealed()?.transcript ?? this.detail().transcript);
  protected readonly phi = computed(() => parsePhiSummary(this.detail().phiSummary));
  protected readonly phiTotal = computed(() => this.phi().reduce((n, p) => n + p.count, 0));

  protected readonly actions = computed<StatusAction[]>(() => {
    switch (this.summary().status) {
      case 'NEW':
        return [
          { to: 'IN_REVIEW', label: 'Start review', primary: true },
          { to: 'RESOLVED', label: 'Mark resolved', primary: false },
        ];
      case 'IN_REVIEW':
        return [
          { to: 'RESOLVED', label: 'Mark resolved', primary: true },
          { to: 'NEW', label: 'Move back to new', primary: false },
        ];
      default:
        return [{ to: 'IN_REVIEW', label: 'Reopen for review', primary: false }];
    }
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearTimer());
  }

  protected speaker(s: string): string {
    return s === 'AGENT' ? 'Assistant' : s === 'CALLER' ? 'Caller' : 'Note';
  }

  protected statusClass(s: CallStatus): string {
    return s === 'NEW' ? 'chip chip-new' : s === 'IN_REVIEW' ? 'chip chip-review' : 'chip chip-done';
  }

  protected changeStatus(to: CallStatus): void {
    if (this.pending()) return;
    this.pending.set(true);
    this.calls.setStatus(this.summary().id, to).subscribe({
      next: (s) => {
        this.summary.set(s);
        this.pending.set(false);
        this.announce.set(`Status changed to ${STATUS_LABEL[s.status]}.`);
      },
      error: () => {
        this.pending.set(false);
        this.toast.error('The status could not be changed. Please try again.');
      },
    });
  }

  protected openReveal(): void {
    const data: RevealDialogData = { callId: this.summary().id, callerLabel: this.summary().callerLabel };
    const ref = this.dialog.open<RevealResponse | undefined, RevealDialogData>(RevealDialog, {
      data,
      ariaModal: true,
      ariaLabelledBy: 'reveal-title',
      ariaDescribedBy: 'reveal-desc',
      autoFocus: 'first-tabbable',
      restoreFocus: true,
      backdropClass: 'app-backdrop',
    });
    ref.closed.subscribe((res) => {
      if (res) {
        this.revealed.set(res);
        this.announce.set('Protected details are now visible. This access was recorded.');
        this.clearTimer();
        this.hideTimer = setTimeout(() => this.hide(true), REVEAL_VISIBLE_MS);
      }
    });
  }

  protected hide(auto = false): void {
    this.clearTimer();
    this.revealed.set(null);
    this.announce.set(auto ? 'Protected details were hidden again.' : 'Protected details hidden.');
  }

  private clearTimer(): void {
    if (this.hideTimer !== undefined) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
    }
  }
}
