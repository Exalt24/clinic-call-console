import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrlForTests } from './app-config';
import { authInterceptor, errorInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

function setup(token: string | null) {
  const auth = { token: vi.fn(() => token), logout: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])),
      provideHttpClientTesting(),
      { provide: AuthService, useValue: auth },
    ],
  });
  setApiBaseUrlForTests('http://api.test');
  return { auth, http: TestBed.inject(HttpClient), ctl: TestBed.inject(HttpTestingController), toast: TestBed.inject(ToastService) };
}

describe('authInterceptor', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('adds the bearer token to requests for our own API', () => {
    const { http, ctl } = setup('tok-1');
    http.get('http://api.test/api/calls').subscribe();
    expect(ctl.expectOne('http://api.test/api/calls').request.headers.get('Authorization')).toBe('Bearer tok-1');
  });

  it('never sends the token to another origin', () => {
    const { http, ctl } = setup('tok-1');
    http.get('https://evil.example/steal').subscribe();
    expect(ctl.expectOne('https://evil.example/steal').request.headers.has('Authorization')).toBe(false);
  });

  it('does not treat a look-alike host as ours', () => {
    const { http, ctl } = setup('tok-1');
    http.get('http://api.test.evil.example/api/calls').subscribe();
    expect(ctl.expectOne('http://api.test.evil.example/api/calls').request.headers.has('Authorization')).toBe(false);
  });

  it('sends no header at all when there is no token', () => {
    const { http, ctl } = setup(null);
    http.get('http://api.test/api/auth/login').subscribe();
    expect(ctl.expectOne('http://api.test/api/auth/login').request.headers.has('Authorization')).toBe(false);
  });
});

describe('errorInterceptor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.inject(HttpTestingController).verify();
  });

  const fail = (ctl: HttpTestingController, url: string, status: number) =>
    ctl.expectOne(url).flush({ detail: 'x' }, { status, statusText: 'err' });

  it('a 401 on any API call ends the session and says why', () => {
    const { http, ctl, auth } = setup('tok');
    http.get('http://api.test/api/calls').subscribe({ error: () => undefined });
    fail(ctl, 'http://api.test/api/calls', 401);
    expect(auth.logout).toHaveBeenCalledWith('Your session ended. Please sign in again.');
  });

  it('a 401 on the login call itself is a wrong password, not an ended session', () => {
    const { http, ctl, auth } = setup(null);
    http.post('http://api.test/api/auth/login', {}).subscribe({ error: () => undefined });
    fail(ctl, 'http://api.test/api/auth/login', 401);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('a 403 explains that the action is not permitted', () => {
    const { http, ctl, toast } = setup('tok');
    http.get('http://api.test/api/audit').subscribe({ error: () => undefined });
    fail(ctl, 'http://api.test/api/audit', 403);
    expect(toast.toasts()[0].text).toBe('You do not have permission to do that.');
  });

  it('a network failure (status 0) says the server cannot be reached', () => {
    const { http, ctl, toast } = setup('tok');
    http.get('http://api.test/api/calls').subscribe({ error: () => undefined });
    ctl.expectOne('http://api.test/api/calls').error(new ProgressEvent('error'));
    expect(toast.toasts()[0].text).toContain('Cannot reach the server');
  });

  it('a 500 says it is our side, without exposing any detail', () => {
    const { http, ctl, toast } = setup('tok');
    http.get('http://api.test/api/calls').subscribe({ error: () => undefined });
    fail(ctl, 'http://api.test/api/calls', 500);
    expect(toast.toasts()[0].text).toBe('Something went wrong on our side. Please try again.');
  });

  it('a 400 or 404 is left for the component that knows what it was doing', () => {
    const { http, ctl, toast, auth } = setup('tok');
    http.get('http://api.test/api/calls/1').subscribe({ error: () => undefined });
    fail(ctl, 'http://api.test/api/calls/1', 404);
    expect(toast.toasts()).toHaveLength(0);
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it('re-throws every error so the caller still sees it', () => {
    const { http, ctl } = setup('tok');
    let status = 0;
    http.get('http://api.test/api/calls').subscribe({ error: (e) => (status = e.status) });
    fail(ctl, 'http://api.test/api/calls', 404);
    expect(status).toBe(404);
  });

  it('ignores failures from other origins entirely', () => {
    const { http, ctl, toast, auth } = setup('tok');
    http.get('https://fonts.example/css').subscribe({ error: () => undefined });
    fail(ctl, 'https://fonts.example/css', 401);
    expect(auth.logout).not.toHaveBeenCalled();
    expect(toast.toasts()).toHaveLength(0);
  });
});
