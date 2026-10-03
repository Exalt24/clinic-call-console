import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../core/auth.service';
import { Shell } from './shell';

function create(isAdmin: boolean) {
  const logout = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { isAdmin: () => isAdmin, displayName: () => 'Riley Reviewer', logout } },
    ],
  });
  const fixture = TestBed.createComponent(Shell);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, logout };
}

describe('Shell', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('a reviewer sees Calls but no Audit trail, in the sidebar and the phone tab bar', () => {
    const { el } = create(false);
    expect(el.querySelectorAll('a[href="/audit"]')).toHaveLength(0);
    expect(el.querySelectorAll('a[href="/calls"]').length).toBeGreaterThan(0);
    expect(el.querySelector('.user')?.textContent).toContain('Reviewer');
  });

  it('an administrator sees the Audit trail in both navigations', () => {
    const { el } = create(true);
    expect(el.querySelectorAll('a[href="/audit"]')).toHaveLength(2);
    expect(el.querySelector('.user')?.textContent).toContain('Administrator');
  });

  it('shows who is signed in and says the data is synthetic', () => {
    const { el } = create(false);
    expect(el.querySelector('.user .name')?.textContent).toBe('Riley Reviewer');
    expect(el.querySelector('.demo-pill')?.getAttribute('title')).toContain('invented');
  });

  it('the main region is the skip-link target and both navs are labelled', () => {
    const { el } = create(false);
    expect(el.querySelector('main#main')).not.toBeNull();
    expect(Array.from(el.querySelectorAll('nav')).every((n) => n.getAttribute('aria-label'))).toBe(true);
  });

  it('either sign-out button signs out', () => {
    const { el, logout } = create(false);
    el.querySelector<HTMLButtonElement>('.user button')!.click();
    el.querySelector<HTMLButtonElement>('.tabs button')!.click();
    expect(logout).toHaveBeenCalledTimes(2);
  });
});
