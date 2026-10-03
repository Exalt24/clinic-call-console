import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Signed-in users only. Anyone else is sent to the login page, remembering where they were going. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.token()) return true;
  return inject(Router).createUrlTree(['/login'], { queryParams: { next: state.url } });
};

/** Administrators only. A reviewer who types the URL is sent back to the queue, not shown an empty page. */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  if (!auth.token()) return inject(Router).createUrlTree(['/login']);
  return auth.isAdmin() ? true : inject(Router).createUrlTree(['/calls']);
};

/** The login page is for people who are not signed in; a signed-in user goes straight to the queue. */
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.token() ? inject(Router).createUrlTree(['/calls']) : true;
};
