import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, convertToParamMap, provideRouter } from '@angular/router';
import { Observable, firstValueFrom, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { callResolver, routes } from './app.routes';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';
import { CallsService } from './core/calls.service';
import { CallDetail } from './core/models';
import { ToastService } from './core/toast.service';

const DETAIL = { summary: { id: 'c1' }, transcript: [], phiSummary: '' } as unknown as CallDetail;

describe('App', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('renders toasts in a polite live region and lets each be dismissed', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(App);
    const toast = TestBed.inject(ToastService);
    toast.error('Something broke');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.toasts')?.getAttribute('aria-live')).toBe('polite');
    expect(el.querySelector('.toast')?.textContent).toContain('Something broke');
    el.querySelector<HTMLButtonElement>('.toast .x')!.click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.toast')).toHaveLength(0);
  });

  it('a toast removes itself, errors staying longer than confirmations', () => {
    const toast = TestBed.inject(ToastService);
    toast.success('Saved');
    toast.error('Failed');
    vi.advanceTimersByTime(4600);
    expect(toast.toasts().map((t) => t.text)).toEqual(['Failed']);
    vi.advanceTimersByTime(4000);
    expect(toast.toasts()).toHaveLength(0);
  });

  it('the same message twice is one toast', () => {
    const toast = TestBed.inject(ToastService);
    toast.error('Cannot reach the server.');
    toast.error('Cannot reach the server.');
    expect(toast.toasts()).toHaveLength(1);
  });

  it('has a skip link that targets the main region', () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a.skip-link')?.getAttribute('href')).toBe('#main');
  });
});

describe('route table', () => {
  it('protects the signed-in area, the audit page and the login page with the right guards', () => {
    const shell = routes.find((r) => r.path === '');
    const audit = shell?.children?.find((r) => r.path === 'audit');
    const login = routes.find((r) => r.path === 'login');
    expect(shell?.canActivate).toContain(authGuard);
    expect(audit?.canActivate).toContain(adminGuard);
    expect(login?.canActivate).toContain(guestGuard);
  });

  it('the call page resolves its data before it renders', () => {
    const detail = routes.find((r) => r.path === '')?.children?.find((r) => r.path === 'calls/:id');
    expect(detail?.resolve?.['detail']).toBe(callResolver);
  });

  it('every page is lazy loaded, so the first screen ships only what it needs', () => {
    const all = [...routes, ...(routes.find((r) => r.path === '')?.children ?? [])].filter((r) => r.path && r.path !== '**');
    expect(all.every((r) => r.loadComponent !== undefined)).toBe(true);
  });
});

describe('callResolver', () => {
  const route = (id: string) => ({ paramMap: convertToParamMap({ id }) }) as unknown as ActivatedRouteSnapshot;

  function setup(detail: () => Observable<CallDetail>) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CallsService, useValue: { detail: vi.fn(detail) } }] });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return { navigate, toast: TestBed.inject(ToastService) };
  }
  const run = (id: string) =>
    TestBed.runInInjectionContext(() => callResolver(route(id), {} as RouterStateSnapshot) as Observable<CallDetail>);

  it('returns the call when it loads', async () => {
    const { navigate } = setup(() => of(DETAIL));
    expect(await firstValueFrom(run('c1'))).toBe(DETAIL);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a call that does not exist sends the user back to the queue with an explanation', async () => {
    const { navigate, toast } = setup(() => throwError(() => new HttpErrorResponse({ status: 404 })));
    await expect(firstValueFrom(run('nope'), { defaultValue: 'empty' })).resolves.toBe('empty');
    expect(navigate).toHaveBeenCalledWith(['/calls']);
    expect(toast.toasts()[0].text).toContain('could not be found');
  });

  it('any other failure also returns to the queue without a misleading "not found"', async () => {
    const { navigate, toast } = setup(() => throwError(() => new HttpErrorResponse({ status: 500 })));
    await firstValueFrom(run('c1'), { defaultValue: 'empty' });
    expect(navigate).toHaveBeenCalledWith(['/calls']);
    expect(toast.toasts().some((t) => t.text.includes('could not be found'))).toBe(false);
  });
});
