import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { IconComponent } from '../shared/icon';

/**
 * The signed-in frame. Desktop: a fixed sidebar. Phone: a top bar and a bottom tab bar, because the thumb reaches the
 * bottom of a phone and not the corner. Two destinations at most, so nothing is nested.
 */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="frame">
      <aside class="side" aria-label="Main">
        <a class="brand" routerLink="/calls" aria-label="Call review home">
          <span class="mark"><app-icon name="shield" /></span>
          <span class="brand-text">Call review</span>
        </a>
        <nav class="nav" aria-label="Sections">
          <a routerLink="/calls" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: false }" class="nav-link">
            <app-icon name="calls" /> Calls
          </a>
          @if (auth.isAdmin()) {
            <a routerLink="/audit" routerLinkActive="active" class="nav-link"><app-icon name="audit" /> Audit trail</a>
          }
        </nav>
        <div class="user">
          <div class="who">
            <span class="name">{{ auth.displayName() }}</span>
            <span class="role" [class.role-admin]="auth.isAdmin()">{{ auth.isAdmin() ? 'Administrator' : 'Reviewer' }}</span>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" (click)="auth.logout()">
            <app-icon name="logout" /> Sign out
          </button>
        </div>
      </aside>

      <div class="body">
        <header class="top">
          <a class="brand brand-top" routerLink="/calls" aria-label="Call review home">
            <span class="mark"><app-icon name="shield" /></span>
            <span class="brand-text">Call review</span>
          </a>
          <span class="demo-pill" title="Every call, name and number in this app is invented.">
            <span class="full">Synthetic demo data</span><span class="short">Demo data</span>
          </span>
          <span class="role role-top" [class.role-admin]="auth.isAdmin()">{{ auth.isAdmin() ? 'Admin' : 'Reviewer' }}</span>
        </header>
        <main id="main" tabindex="-1"><router-outlet /></main>
      </div>

      <nav class="tabs" aria-label="Sections">
        <a routerLink="/calls" routerLinkActive="active" class="tab"><app-icon name="calls" /><span>Calls</span></a>
        @if (auth.isAdmin()) {
          <a routerLink="/audit" routerLinkActive="active" class="tab"><app-icon name="audit" /><span>Audit</span></a>
        }
        <button type="button" class="tab" (click)="auth.logout()"><app-icon name="logout" /><span>Sign out</span></button>
      </nav>
    </div>
  `,
  styleUrl: './shell.css',
})
export class Shell {
  protected readonly auth = inject(AuthService);
}
