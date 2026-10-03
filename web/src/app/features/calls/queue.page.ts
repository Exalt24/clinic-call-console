import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { catchError, debounceTime, distinctUntilChanged, map, of, startWith, switchMap } from 'rxjs';
import { CallsService } from '../../core/calls.service';
import { CallQuery, CallStatus, CallSummary, Page } from '../../core/models';
import { OUTCOME_LABEL, REASON_LABEL, STATUS_LABEL, formatDuration } from '../../shared/format';
import { IconComponent } from '../../shared/icon';

type View =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ok'; page: Page<CallSummary> };

const FILTERS: { value: CallStatus | null; label: string }[] = [
  { value: null, label: 'All' },
  { value: 'NEW', label: 'New' },
  { value: 'IN_REVIEW', label: 'In review' },
  { value: 'RESOLVED', label: 'Resolved' },
];

@Component({
  selector: 'app-queue',
  imports: [RouterLink, ReactiveFormsModule, DatePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './queue.page.html',
  styleUrl: './queue.page.css',
})
export class QueuePage {
  private readonly calls = inject(CallsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly filters = FILTERS;
  protected readonly reasonLabel = REASON_LABEL;
  protected readonly outcomeLabel = OUTCOME_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly duration = formatDuration;

  /** One signal holds the whole query, so a change to any part is one atomic update and one request. */
  protected readonly query = signal<CallQuery>({ status: null, q: '', page: 0, size: 10 });
  protected readonly search = new FormControl('', { nonNullable: true });
  private readonly reload = signal(0);

  private readonly view$ = toObservable(computed(() => ({ q: this.query(), n: this.reload() }))).pipe(
    switchMap(({ q }) =>
      this.calls.list(q).pipe(
        map((page): View => ({ kind: 'ok', page })),
        startWith<View>({ kind: 'loading' }),
        catchError(() => of<View>({ kind: 'error' })),
      ),
    ),
  );
  protected readonly view = toSignal(this.view$, { initialValue: { kind: 'loading' } as View });

  protected readonly hasFilters = computed(() => this.query().status !== null || this.query().q.trim() !== '');
  protected readonly skeleton = [1, 2, 3, 4, 5, 6];

  constructor() {
    // Typing is debounced and de-duplicated, then resets to page 1: a new search never lands on page 4 of the old one.
    this.search.valueChanges
      .pipe(debounceTime(250), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((q) => this.query.update((cur) => ({ ...cur, q, page: 0 })));
  }

  protected setStatus(status: CallStatus | null): void {
    this.query.update((cur) => ({ ...cur, status, page: 0 }));
  }

  protected goTo(page: number): void {
    this.query.update((cur) => ({ ...cur, page }));
  }

  protected clearFilters(): void {
    this.search.setValue('', { emitEvent: false });
    this.query.update((cur) => ({ ...cur, status: null, q: '', page: 0 }));
  }

  protected retry(): void {
    this.reload.update((n) => n + 1);
  }

  protected statusClass(s: CallStatus): string {
    return s === 'NEW' ? 'chip chip-new' : s === 'IN_REVIEW' ? 'chip chip-review' : 'chip chip-done';
  }

  protected outcomeClass(c: CallSummary): string {
    return c.outcome === 'UNRESOLVED' ? 'chip chip-bad' : 'chip';
  }

  protected summaryLine(page: Page<CallSummary>): string {
    const n = page.totalElements;
    if (n === 0) return 'No calls';
    const from = page.page * page.size + 1;
    const to = Math.min(n, from + page.content.length - 1);
    return `${from}-${to} of ${n} ${n === 1 ? 'call' : 'calls'}`;
  }
}
