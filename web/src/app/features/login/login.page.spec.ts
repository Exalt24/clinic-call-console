import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../core/auth.service';
import { Session } from '../../core/models';
import { ServerState, ServerStatusService } from '../../core/server-status.service';
import { LoginPage, safeNext } from './login.page';

const SESSION: Session = { token: 't', username: 'a@demo.test', displayName: 'A', role: 'ADMIN', expiresAt: '2999-01-01T00:00:00Z' };

describe('safeNext (open-redirect guard)', () => {
  it('accepts in-app paths', () => {
    expect(safeNext('/calls/42')).toBe('/calls/42');
    expect(safeNext('/audit?page=2')).toBe('/audit?page=2');
  });

  it.each([undefined, '', 'calls', 'https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)'])(
    'falls back to the queue for %s',
    (bad) => {
      expect(safeNext(bad as string | undefined)).toBe('/calls');
    },
  );
});

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let login: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  let serverState: ReturnType<typeof signal<ServerState>>;
  let serverStart: ReturnType<typeof vi.fn>;

  function create(loginImpl: () => Observable<Session>, server: ServerState = 'up') {
    login = vi.fn(loginImpl);
    serverState = signal<ServerState>(server);
    serverStart = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { login } },
        { provide: ServerStatusService, useValue: { state: serverState, start: serverStart } },
      ],
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
  }
  const el = () => fixture.nativeElement as HTMLElement;
  const type = (sel: string, value: string) => {
    const input = el().querySelector<HTMLInputElement>(sel)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const submit = async () => {
    el().querySelector<HTMLButtonElement>('button[type="submit"]')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  beforeEach(() => TestBed.resetTestingModule());

  it('does not call the API with an empty or malformed form, and says what is wrong', async () => {
    create(() => of(SESSION));
    await submit();
    expect(login).not.toHaveBeenCalled();
    expect(el().querySelector('#username-err')?.textContent).toContain('work email');
    expect(el().querySelector('#password-err')?.textContent).toContain('password');
    type('#username', 'not-an-email');
    type('#password', 'x');
    await submit();
    expect(login).not.toHaveBeenCalled();
  });

  it('signs in and goes to the requested page', async () => {
    create(() => of(SESSION));
    fixture.componentRef.setInput('next', '/calls/9');
    type('#username', 'a@demo.test');
    type('#password', 'pw');
    await submit();
    expect(login).toHaveBeenCalledWith('a@demo.test', 'pw');
    expect(navigate).toHaveBeenCalledWith('/calls/9');
  });

  it('refuses to follow an off-site next parameter', async () => {
    create(() => of(SESSION));
    fixture.componentRef.setInput('next', '//evil.example/phish');
    type('#username', 'a@demo.test');
    type('#password', 'pw');
    await submit();
    expect(navigate).toHaveBeenCalledWith('/calls');
  });

  it('a wrong password shows a plain message, clears the password and stays', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 401 })));
    type('#username', 'a@demo.test');
    type('#password', 'bad');
    await submit();
    expect(el().querySelector('.server-error')?.textContent).toContain('not right');
    expect(el().querySelector<HTMLInputElement>('#password')!.value).toBe('');
    expect(navigate).not.toHaveBeenCalled();
    expect(el().querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('a lockout (429) tells the user to wait', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 429 })));
    type('#username', 'a@demo.test');
    type('#password', 'bad');
    await submit();
    expect(el().querySelector('.server-error')?.textContent).toContain('Wait a few minutes');
  });

  it('an unreachable server says so', async () => {
    create(() => throwError(() => new HttpErrorResponse({ status: 0 })));
    type('#username', 'a@demo.test');
    type('#password', 'bad');
    await submit();
    expect(el().querySelector('.server-error')?.textContent).toContain('Cannot reach the server');
  });

  it('the demo buttons fill the form but do not sign in on their own', async () => {
    create(() => of(SESSION));
    el().querySelector<HTMLButtonElement>('[data-test="fill-admin"]')!.click();
    fixture.detectChanges();
    expect(el().querySelector<HTMLInputElement>('#username')!.value).toBe('admin@demo.test');
    expect(login).not.toHaveBeenCalled();
  });

  it('shows why the user was sent here when a reason is given', () => {
    create(() => of(SESSION));
    fixture.componentRef.setInput('reason', 'Your session ended. Please sign in again.');
    fixture.detectChanges();
    expect(el().querySelector('.notice')?.textContent).toContain('session ended');
  });

  it('checks that the server is awake as soon as the page opens, once', () => {
    create(() => of(SESSION));
    expect(serverStart).toHaveBeenCalledTimes(1);
  });

  it('says so, plainly, while a sleeping server is waking, and not otherwise', () => {
    create(() => of(SESSION), 'waking');
    expect(el().querySelector('[data-test="waking"]')?.textContent).toContain('waking up');
    expect(el().querySelector('[data-test="waking"]')?.getAttribute('role')).toBe('status');
    serverState.set('up');
    fixture.detectChanges();
    expect(el().querySelector('[data-test="waking"]')).toBeNull();
  });

  it('does not show the waking notice while it is still checking, so a fast server never flashes it', () => {
    create(() => of(SESSION), 'checking');
    expect(el().querySelector('[data-test="waking"]')).toBeNull();
  });

  it('is reachable by label, so a screen reader announces the fields', () => {
    create(() => of(SESSION));
    expect(el().querySelector('label[for="username"]')?.textContent).toContain('email');
    expect(el().querySelector('label[for="password"]')?.textContent).toContain('Password');
  });
});
