import { inject } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ResolveFn, Router, Routes } from '@angular/router';
import { EMPTY, catchError } from 'rxjs';
import { adminGuard, authGuard, guestGuard } from './core/auth.guard';
import { CallsService } from './core/calls.service';
import { CallDetail } from './core/models';
import { ToastService } from './core/toast.service';

/**
 * Loads the call BEFORE the page is shown, so the detail screen never renders half-empty. A call that does not exist
 * sends the user back to the queue with an explanation instead of a broken page.
 */
export const callResolver: ResolveFn<CallDetail> = (route) => {
  const router = inject(Router);
  const toast = inject(ToastService);
  return inject(CallsService)
    .detail(route.paramMap.get('id') ?? '')
    .pipe(
      catchError((err: unknown) => {
        if (err instanceof HttpErrorResponse && err.status === 404) {
          toast.error('That call could not be found.');
        }
        void router.navigate(['/calls']);
        return EMPTY;
      }),
    );
};

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in',
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'calls' },
      {
        path: 'calls',
        title: 'Calls to review',
        loadComponent: () => import('./features/calls/queue.page').then((m) => m.QueuePage),
      },
      {
        path: 'calls/:id',
        title: 'Call',
        resolve: { detail: callResolver },
        loadComponent: () => import('./features/calls/call-detail.page').then((m) => m.CallDetailPage),
      },
      {
        path: 'audit',
        title: 'Audit trail',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/audit/audit.page').then((m) => m.AuditPage),
      },
    ],
  },
  { path: '**', redirectTo: 'calls' },
];
