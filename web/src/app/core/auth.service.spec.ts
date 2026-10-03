import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrlForTests } from './app-config';
import { AuthService } from './auth.service';
import { Session } from './models';

const FUTURE = new Date(Date.now() + 30 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function session(over: Partial<Session> = {}): Session {
  return { token: 'tok-123', username: 'admin@demo.test', displayName: 'Avery Admin', role: 'ADMIN', expiresAt: FUTURE, ...over };
}

function setup(stored?: unknown) {
  sessionStorage.clear();
  if (stored !== undefined) sessionStorage.setItem('clinic.session', typeof stored === 'string' ? stored : JSON.stringify(stored));
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  setApiBaseUrlForTests('http://api.test');
  return { auth: TestBed.inject(AuthService), http: TestBed.inject(HttpTestingController), router: TestBed.inject(Router) };
}

describe('AuthService', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('starts signed out when nothing is stored', () => {
    const { auth } = setup();
    expect(auth.isSignedIn()).toBe(false);
    expect(auth.token()).toBeNull();
    expect(auth.role()).toBeNull();
  });

  it('login posts the credentials, stores the session and exposes role and name as signals', () => {
    const { auth, http } = setup();
    let got: Session | undefined;
    auth.login('admin@demo.test', 'pw').subscribe((s) => (got = s));
    const req = http.expectOne('http://api.test/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ username: 'admin@demo.test', password: 'pw' });
    req.flush(session());
    expect(got?.token).toBe('tok-123');
    expect(auth.isSignedIn()).toBe(true);
    expect(auth.isAdmin()).toBe(true);
    expect(auth.displayName()).toBe('Avery Admin');
    expect(JSON.parse(sessionStorage.getItem('clinic.session') as string).token).toBe('tok-123');
    expect(localStorage.getItem('clinic.session')).toBeNull();   // never persisted beyond the tab
  });

  it('a reviewer is not an admin', () => {
    const { auth, http } = setup();
    auth.login('r', 'p').subscribe();
    http.expectOne('http://api.test/api/auth/login').flush(session({ role: 'REVIEWER' }));
    expect(auth.isAdmin()).toBe(false);
    expect(auth.role()).toBe('REVIEWER');
  });

  it('a failed login stores nothing', () => {
    const { auth, http } = setup();
    auth.login('r', 'bad').subscribe({ error: () => undefined });
    http.expectOne('http://api.test/api/auth/login').flush({ detail: 'no' }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.isSignedIn()).toBe(false);
    expect(sessionStorage.getItem('clinic.session')).toBeNull();
  });

  it('restores a still-valid session after a reload', () => {
    const { auth } = setup(session());
    expect(auth.token()).toBe('tok-123');
    expect(auth.isAdmin()).toBe(true);
  });

  it('ignores an expired stored session', () => {
    const { auth } = setup(session({ expiresAt: PAST }));
    expect(auth.isSignedIn()).toBe(false);
  });

  it('ignores a corrupt stored session instead of crashing', () => {
    const { auth } = setup('{not json');
    expect(auth.isSignedIn()).toBe(false);
  });

  it('token() drops a session that has expired since it was loaded, so an expired token is never sent', () => {
    vi.useFakeTimers();
    try {
      const soon = new Date(Date.now() + 1000).toISOString();
      const { auth } = setup(session({ expiresAt: soon }));
      expect(auth.token()).toBe('tok-123');
      vi.advanceTimersByTime(2000);
      expect(auth.token()).toBeNull();
      expect(auth.isSignedIn()).toBe(false);
      expect(sessionStorage.getItem('clinic.session')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('logout clears the session and goes to /login, carrying the reason when there is one', () => {
    const { auth, router } = setup(session());
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    auth.logout('Your session ended.');
    expect(auth.isSignedIn()).toBe(false);
    expect(sessionStorage.getItem('clinic.session')).toBeNull();
    expect(nav).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'Your session ended.' } });
    auth.logout();
    expect(nav).toHaveBeenLastCalledWith(['/login'], {});
  });
});
