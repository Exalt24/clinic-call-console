import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of, startWith, switchMap } from 'rxjs';
import { CallsService } from '../../core/calls.service';
import { AuditAction, AuditRow, Page } from '../../core/models';
import { ACTION_LABEL } from '../../shared/format';
import { IconComponent } from '../../shared/icon';

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ok'; page: Page<AuditRow> };

@Component({
  selector: 'app-audit',
  imports: [DatePipe, RouterLink, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let v = view();
    <header class="head">
      <div>
        <h1>Audit trail</h1>
        <p class="muted sub">
          Every sign-in, every opened call, every reveal and every status change, newest first. Entries cannot be edited or deleted
          from this app.
        </p>
      </div>
    </header>

    @if (v.kind === 'loading') {
      <div class="card list" aria-busy="true" aria-label="Loading the audit trail">
        @for (n of skeleton; track n) { <div class="skel-row"><span class="skel"></span></div> }
      </div>
    } @else if (v.kind === 'error') {
      <div class="card state" role="alert">
        <h2>We could not load the audit trail</h2>
        <button type="button" class="btn btn-primary" (click)="retry()">Try again</button>
      </div>
    } @else {
      <div class="card tablewrap">
        <table class="table">
          <caption class="sr-only">Audit events, newest first</caption>
          <thead>
            <tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">What</th><th scope="col">Call</th><th scope="col">Detail</th></tr>
          </thead>
          <tbody>
            @for (e of v.page.content; track e.id) {
              <tr>
                <td class="nowrap">{{ e.at | date: 'MMM d, h:mm:ss a' }}</td>
                <td>
                  <div>{{ e.actor }}</div>
                  <div class="sub2">{{ e.actorRole === 'NONE' ? 'not signed in' : e.actorRole.toLowerCase() }}</div>
                </td>
                <td><span [class]="actionClass(e.action)">@if (e.action === 'REVEAL') { <app-icon name="eye" /> } {{ actionLabel[e.action] }}</span></td>
                <td class="nowrap">
                  @if (e.callId) { <a [routerLink]="['/calls', e.callId]">{{ e.callId.slice(0, 8) }}</a> } @else { <span class="muted">none</span> }
                </td>
                <td class="detail">{{ e.detail }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (v.page.totalPages > 1) {
        <nav class="pager" aria-label="Pages">
          <button type="button" class="btn btn-sm" [disabled]="v.page.page === 0" (click)="goTo(v.page.page - 1)">Newer</button>
          <span class="muted">Page {{ v.page.page + 1 }} of {{ v.page.totalPages }}</span>
          <button type="button" class="btn btn-sm" [disabled]="v.page.page + 1 >= v.page.totalPages" (click)="goTo(v.page.page + 1)">Older</button>
        </nav>
      }
    }
  `,
  styles: `
    :host { display: block; }
    .head { margin: .5rem 0 1.25rem; }
    .sub { margin-top: .4rem; max-width: 60ch; }
    .sub2 { font-size: .85rem; color: var(--ink-3); }
    .tablewrap { overflow-x: auto; }
    .detail { max-width: 28rem; color: var(--ink-2); }
    .pager { display: flex; align-items: center; justify-content: center; gap: 1rem; margin-top: 1.25rem; }
    .state { padding: 1.75rem; display: grid; gap: .75rem; justify-items: start; max-width: 32rem; }
    .skel-row { padding: 1rem 1.1rem; border-bottom: 1px solid var(--line); }
    .skel { display: block; height: .9rem; width: 80%; border-radius: 6px; background: linear-gradient(90deg, #e9eef6 25%, #f5f8fc 50%, #e9eef6 75%); background-size: 200% 100%; animation: shimmer 1.3s infinite linear; }
    @keyframes shimmer { to { background-position: -200% 0; } }
    @media (max-width: 860px) {
      .table thead { display: none; }
      .table, .table tbody, .table tr, .table td { display: block; width: 100%; }
      .table tr { padding: .8rem 1rem; border-bottom: 1px solid var(--line); }
      .table td { border: 0; padding: .15rem 0; }
    }
  `,
})
export class AuditPage {
  private readonly calls = inject(CallsService);

  protected readonly actionLabel = ACTION_LABEL;
  protected readonly skeleton = [1, 2, 3, 4, 5, 6, 7];
  private readonly page = signal(0);
  private readonly reload = signal(0);

  private readonly view$ = toObservable(computed(() => ({ p: this.page(), n: this.reload() }))).pipe(
    switchMap(({ p }) =>
      this.calls.audit(p, 15).pipe(
        map((page): View => ({ kind: 'ok', page })),
        startWith<View>({ kind: 'loading' }),
        catchError(() => of<View>({ kind: 'error' })),
      ),
    ),
  );
  protected readonly view = toSignal(this.view$, { initialValue: { kind: 'loading' } as View });

  protected goTo(p: number): void {
    this.page.set(p);
  }

  protected retry(): void {
    this.reload.update((n) => n + 1);
  }

  protected actionClass(a: AuditAction): string {
    switch (a) {
      case 'REVEAL':
        return 'chip chip-bad';
      case 'LOGIN_FAILED':
        return 'chip chip-review';
      case 'STATUS_CHANGE':
        return 'chip chip-new';
      default:
        return 'chip';
    }
  }
}
