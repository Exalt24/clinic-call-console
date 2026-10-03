import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { apiBaseUrl } from './app-config';
import { Session } from './models';

const STORAGE_KEY = 'clinic.session';

/**
 * Holds the signed-in session as a signal, so every component that depends on it updates by itself.
 *
 * The token lives in sessionStorage: it dies with the tab, and it is never written to localStorage. The trade-off is
 * documented in docs/DECISIONS.md: any script running on the page could read it, so the app ships a strict
 * Content-Security-Policy and has no third-party scripts; a production build would keep the token in an httpOnly cookie
 * issued by a backend-for-frontend instead.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly state = signal<Session | null>(this.restore());

  readonly session = this.state.asReadonly();
  readonly isSignedIn = computed(() => this.state() !== null);
  readonly isAdmin = computed(() => this.state()?.role === 'ADMIN');
  readonly displayName = computed(() => this.state()?.displayName ?? '');
  readonly role = computed(() => this.state()?.role ?? null);

  /** The raw token for the interceptor; null once it has expired, so an expired token is never sent. */
  token(): string | null {
    const s = this.state();
    if (!s) return null;
    if (Date.parse(s.expiresAt) <= Date.now()) {
      this.clear();
      return null;
    }
    return s.token;
  }

  login(username: string, password: string): Observable<Session> {
    return this.http
      .post<Session>(`${apiBaseUrl()}/api/auth/login`, { username, password })
      .pipe(tap((s) => this.store(s)));
  }

  /** Signs out locally and returns to the login page, optionally saying why. */
  logout(reason?: string): void {
    this.clear();
    void this.router.navigate(['/login'], reason ? { queryParams: { reason } } : {});
  }

  private store(s: Session): void {
    this.state.set(s);
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      // storage can be unavailable (private mode); the session then lasts until reload, which is acceptable
    }
  }

  private clear(): void {
    this.state.set(null);
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
  }

  private restore(): Session | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw) as Session;
      return Date.parse(s.expiresAt) > Date.now() ? s : null;
    } catch {
      return null;
    }
  }
}
