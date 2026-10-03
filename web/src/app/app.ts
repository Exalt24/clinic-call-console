import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { IconComponent } from './shared/icon';
import { ToastService } from './core/toast.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip-link" href="#main">Skip to content</a>
    <router-outlet />
    <!-- Notifications live in a polite live region, so a screen reader announces them without stealing focus. -->
    <div class="toasts" role="status" aria-live="polite" aria-atomic="false">
      @for (t of toasts.toasts(); track t.id) {
        <div class="toast" [class.toast-error]="t.kind === 'error'" [class.toast-ok]="t.kind === 'success'">
          <app-icon [name]="t.kind === 'error' ? 'info' : 'check'" />
          <span>{{ t.text }}</span>
          <button type="button" class="x" (click)="toasts.dismiss(t.id)" aria-label="Dismiss notification">
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
  styles: `
    .toasts { position: fixed; z-index: 60; right: 1rem; bottom: 5.25rem; display: grid; gap: .5rem; max-width: min(26rem, calc(100vw - 2rem)); }
    @media (min-width: 861px) { .toasts { bottom: 1.25rem; } }
    .toast { display: flex; align-items: center; gap: .6rem; background: var(--ink); color: #fff; padding: .75rem .9rem; border-radius: var(--radius-sm); box-shadow: var(--shadow); }
    .toast-error { background: var(--bad-ink); }
    .toast-ok { background: var(--good-ink); }
    .toast span { flex: 1; font-size: .95rem; }
    .x { display: grid; place-items: center; width: 32px; height: 32px; border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 8px; }
    .x:hover { background: rgba(255,255,255,.16); }
  `,
})
export class App {
  protected readonly toasts = inject(ToastService);
}
