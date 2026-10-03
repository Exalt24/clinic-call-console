import { HttpClient } from '@angular/common/http';
import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, catchError, exhaustMap, map, of, takeWhile, timeout, timer } from 'rxjs';
import { apiBaseUrl } from './app-config';

export type ServerState = 'checking' | 'up' | 'waking';

export const HEALTH_TIMEOUT_MS = 6000;
export const HEALTH_RETRY_MS = 4000;

/**
 * Free hosting puts an idle API to sleep and wakes it on the first request, which can take a minute or more. A login page that
 * just spins looks broken, so this asks the health endpoint, says plainly that the server is waking, and keeps checking until
 * it answers. It stops as soon as the server is up, so there is no polling once the user can work.
 */
@Injectable({ providedIn: 'root' })
export class ServerStatusService {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  private sub?: Subscription;

  readonly state = signal<ServerState>('checking');

  /** Safe to call more than once; a running check is not duplicated. */
  start(): void {
    if (this.sub && !this.sub.closed) return;
    this.state.set('checking');
    this.sub = timer(0, HEALTH_RETRY_MS)
      .pipe(
        // exhaustMap, NOT switchMap: a tick that arrives while a request is still in flight is ignored. With switchMap the next
        // tick (4s) cancelled a hanging request before its 6s timeout, so a sleeping server never reached "waking".
        exhaustMap(() =>
          this.http.get(`${apiBaseUrl()}/actuator/health`).pipe(
            timeout(HEALTH_TIMEOUT_MS),
            map(() => true),
            catchError(() => of(false)),
          ),
        ),
        takeWhile((up) => !up, true),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((up) => this.state.set(up ? 'up' : 'waking'));
  }

  stop(): void {
    this.sub?.unsubscribe();
  }
}
