import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setApiBaseUrlForTests } from './app-config';
import { HEALTH_RETRY_MS, HEALTH_TIMEOUT_MS, ServerStatusService } from './server-status.service';

const URL = 'http://api.test/actuator/health';

describe('ServerStatusService', () => {
  let svc: ServerStatusService;
  let ctl: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    setApiBaseUrlForTests('http://api.test');
    svc = TestBed.inject(ServerStatusService);
    ctl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => {
    svc.stop();
    vi.useRealTimers();
  });

  it('starts as "checking" and becomes "up" on the first healthy answer, then stops polling', async () => {
    svc.start();
    expect(svc.state()).toBe('checking');
    await vi.advanceTimersByTimeAsync(1);
    ctl.expectOne(URL).flush({ status: 'UP' });
    expect(svc.state()).toBe('up');
    await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS * 3);
    ctl.expectNone(URL);   // no polling once the server answered
  });

  it('says the server is waking when it errors, and keeps asking until it answers', async () => {
    svc.start();
    await vi.advanceTimersByTimeAsync(1);
    ctl.expectOne(URL).error(new ProgressEvent('error'));
    expect(svc.state()).toBe('waking');
    await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS);
    ctl.expectOne(URL).flush('boom', { status: 503, statusText: 'Service Unavailable' });
    expect(svc.state()).toBe('waking');
    await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS);
    ctl.expectOne(URL).flush({ status: 'UP' });
    expect(svc.state()).toBe('up');
  });

  it('a request that never answers counts as waking after the timeout instead of hanging forever', async () => {
    svc.start();
    await vi.advanceTimersByTimeAsync(1);
    const pending = ctl.expectOne(URL);
    await vi.advanceTimersByTimeAsync(HEALTH_TIMEOUT_MS + 1);
    expect(svc.state()).toBe('waking');
    expect(pending.cancelled).toBe(true);
  });

  it('a slow request is not cancelled by the next retry tick, and ticks do not pile up requests', async () => {
    svc.start();
    await vi.advanceTimersByTimeAsync(1);
    const first = ctl.expectOne(URL);
    await vi.advanceTimersByTimeAsync(HEALTH_RETRY_MS + 100);   // the retry tick has fired while the request is still pending
    expect(first.cancelled).toBe(false);
    ctl.expectNone(URL);
    first.flush({ status: 'UP' });
    expect(svc.state()).toBe('up');
  });

  it('calling start twice does not run two checks', async () => {
    svc.start();
    svc.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctl.match(URL)).toHaveLength(1);
  });
});
