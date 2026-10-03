import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { adminGuard, authGuard, guestGuard } from './auth.guard';
import { AuthService } from './auth.service';

function run(guard: typeof authGuard, auth: { token: () => string | null; isAdmin?: () => boolean }, url = '/calls/42') {
  TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: AuthService, useValue: auth }] });
  return TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot));
}

const serialize = (t: unknown) => TestBed.inject(Router).serializeUrl(t as UrlTree);

describe('authGuard', () => {
  it('lets a signed-in user through', () => {
    expect(run(authGuard, { token: () => 'tok' })).toBe(true);
  });

  it('sends everyone else to /login and remembers where they were going', () => {
    const result = run(authGuard, { token: () => null }, '/calls/42?x=1');
    expect(serialize(result)).toBe('/login?next=%2Fcalls%2F42%3Fx%3D1');
  });
});

describe('adminGuard', () => {
  it('lets an administrator through', () => {
    expect(run(adminGuard, { token: () => 'tok', isAdmin: () => true })).toBe(true);
  });

  it('sends a signed-in reviewer back to the queue, not to an empty page', () => {
    expect(serialize(run(adminGuard, { token: () => 'tok', isAdmin: () => false }))).toBe('/calls');
  });

  it('sends a signed-out visitor to the login page', () => {
    expect(serialize(run(adminGuard, { token: () => null, isAdmin: () => false }))).toBe('/login');
  });

  it('treats an expired session (token() is null) as signed out even if a role is still cached', () => {
    expect(serialize(run(adminGuard, { token: () => null, isAdmin: () => true }))).toBe('/login');
  });
});

describe('guestGuard', () => {
  it('shows the login page to someone who is signed out', () => {
    expect(run(guestGuard, { token: () => null })).toBe(true);
  });

  it('sends a signed-in user straight to the queue', () => {
    expect(serialize(run(guestGuard, { token: () => 'tok' }))).toBe('/calls');
  });
});
