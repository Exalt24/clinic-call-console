import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ProblemDetail } from '../../core/models';
import { ServerStatusService } from '../../core/server-status.service';
import { IconComponent } from '../../shared/icon';

/** Only an in-app path may be used as the post-login destination: no other origin, no protocol-relative URL. */
export function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/calls';
}

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main id="main" class="wrap" tabindex="-1">
      <section class="card panel" aria-labelledby="login-title">
        <div class="brand">
          <span class="mark"><app-icon name="shield" /></span>
          <span class="brand-text">Call review</span>
        </div>
        <h1 id="login-title">Sign in to review calls</h1>
        <p class="muted lead">Calls from the voice assistant, with patient details masked until an administrator has a reason to see them.</p>

        @if (reason()) {
          <p class="notice" role="status">{{ reason() }}</p>
        }
        @if (server.state() === 'waking') {
          <p class="notice waking" role="status" data-test="waking">
            The demo server is waking up. Free hosting sleeps when idle, so the first visit can take a minute. This page keeps
            checking and you can sign in as soon as it answers.
          </p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <div class="field">
            <label for="username">Work email</label>
            <input id="username" class="input" type="email" autocomplete="username" formControlName="username"
              [attr.aria-invalid]="invalid('username')" aria-describedby="username-err" />
            @if (invalid('username')) {
              <p id="username-err" class="error-text">Enter your work email.</p>
            }
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" class="input" type="password" autocomplete="current-password" formControlName="password"
              [attr.aria-invalid]="invalid('password')" aria-describedby="password-err" />
            @if (invalid('password')) {
              <p id="password-err" class="error-text">Enter your password.</p>
            }
          </div>

          <p class="error-text server-error" role="alert" aria-live="assertive">{{ error() }}</p>

          <button type="submit" class="btn btn-primary full" [disabled]="pending()">
            {{ pending() ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <div class="demo" aria-labelledby="demo-title">
          <h2 id="demo-title">Try the demo</h2>
          <p class="hint">This is a demonstration with invented patients. These two accounts exist for it.</p>
          <div class="demo-buttons">
            <button type="button" class="btn btn-sm" (click)="fill('reviewer')" data-test="fill-reviewer">Reviewer</button>
            <button type="button" class="btn btn-sm" (click)="fill('admin')" data-test="fill-admin">Administrator</button>
          </div>
          <p class="hint">A reviewer sees masked calls. An administrator can also reveal details, with a reason, and read the audit trail.</p>
        </div>
      </section>
    </main>
  `,
  styles: `
    .wrap { min-height: 100vh; display: grid; place-items: center; padding: 1.25rem; }
    .panel { width: min(100%, 30rem); padding: clamp(1.25rem, 4vw, 2.25rem); display: grid; gap: 1rem; }
    .brand { display: inline-flex; align-items: center; gap: .6rem; }
    .mark { display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; background: var(--ink); color: #bcd3ff; --icon-size: 1.3rem; }
    .brand-text { font-family: var(--font-display); font-size: 1.3rem; }
    .lead { max-width: 36ch; }
    form { display: grid; gap: 1rem; }
    .full { width: 100%; }
    .server-error { min-height: 1.4em; margin: -.25rem 0; }
    .notice { background: var(--info-bg); color: var(--info-ink); padding: .65rem .9rem; border-radius: var(--radius-sm); font-size: .95rem; }
    .demo { margin-top: .5rem; padding-top: 1rem; border-top: 1px solid var(--line); display: grid; gap: .6rem; }
    .demo-buttons { display: flex; gap: .5rem; flex-wrap: wrap; }
  `,
})
export class LoginPage {
  private readonly fb = inject(FormBuilder).nonNullable;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly server = inject(ServerStatusService);

  /** Bound from the ?next= and ?reason= query parameters by withComponentInputBinding. */
  readonly next = input<string>();
  readonly reason = input<string>();

  protected readonly pending = signal(false);
  protected readonly error = signal('');

  protected readonly form = this.fb.group({
    username: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor() {
    this.server.start();
  }

  protected invalid(control: 'username' | 'password'): boolean {
    const c = this.form.controls[control];
    return c.invalid && (c.touched || c.dirty);
  }

  protected fill(who: 'reviewer' | 'admin'): void {
    this.form.setValue({
      username: `${who}@demo.test`,
      password: who === 'admin' ? 'admin-demo-pass' : 'reviewer-demo-pass',
    });
    this.error.set('');
  }

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.pending.set(true);
    this.error.set('');
    const { username, password } = this.form.getRawValue();
    this.auth.login(username, password).subscribe({
      next: () => void this.router.navigateByUrl(safeNext(this.next())),
      error: (err: unknown) => {
        this.pending.set(false);
        this.error.set(messageFor(err));
        this.form.controls.password.reset('');
      },
    });
  }
}

function messageFor(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    if (err.status === 429) return 'Too many attempts. Wait a few minutes and try again.';
    if (err.status === 401) return 'That email or password is not right.';
    if (err.status === 0) return 'Cannot reach the server. Check your connection and try again.';
    const detail = (err.error as ProblemDetail | null)?.detail;
    if (detail) return detail;
  }
  return 'Sign-in failed. Please try again.';
}
