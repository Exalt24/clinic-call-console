import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { apiBaseUrl } from './app-config';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

/** Adds the bearer token, but ONLY to requests aimed at our own API, so the token can never leak to another origin. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const token = auth.token();
  if (token && req.url.startsWith(apiBaseUrl() + '/')) {
    return next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }));
  }
  return next(req);
};

/**
 * One place that turns API failures into behaviour: an expired or rejected token ends the session and goes to the login
 * page; a refused action explains itself; anything else on the network says so plainly. Components only handle the
 * errors that are specific to what they were doing (a 404 on one call, a 400 on a form).
 */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && req.url.startsWith(apiBaseUrl() + '/')) {
        const isLogin = req.url.endsWith('/api/auth/login');
        if (err.status === 401 && !isLogin) {
          auth.logout('Your session ended. Please sign in again.');
        } else if (err.status === 403) {
          toast.error('You do not have permission to do that.');
        } else if (err.status === 0) {
          toast.error('Cannot reach the server. Check your connection and try again.');
        } else if (err.status >= 500) {
          toast.error('Something went wrong on our side. Please try again.');
        }
      }
      return throwError(() => err);
    }),
  );
};
