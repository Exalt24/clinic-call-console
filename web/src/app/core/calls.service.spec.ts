import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setApiBaseUrlForTests } from './app-config';
import { CallsService } from './calls.service';

describe('CallsService', () => {
  let svc: CallsService;
  let ctl: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    setApiBaseUrlForTests('http://api.test');
    svc = TestBed.inject(CallsService);
    ctl = TestBed.inject(HttpTestingController);
  });
  afterEach(() => ctl.verify());

  it('list sends page and size always, and status and a trimmed search only when set', () => {
    svc.list({ status: 'RESOLVED', q: '  billing  ', page: 2, size: 10 }).subscribe();
    const req = ctl.expectOne((r) => r.url === 'http://api.test/api/calls');
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('size')).toBe('10');
    expect(req.request.params.get('status')).toBe('RESOLVED');
    expect(req.request.params.get('q')).toBe('billing');
    req.flush({ content: [], page: 2, size: 10, totalElements: 0, totalPages: 0 });
  });

  it('list leaves out an empty status and a blank search', () => {
    svc.list({ status: null, q: '   ', page: 0, size: 10 }).subscribe();
    const req = ctl.expectOne((r) => r.url === 'http://api.test/api/calls');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('q')).toBe(false);
    req.flush({});
  });

  it('encodes ids in the path so one cannot break out of it', () => {
    svc.detail('a/b?c').subscribe();
    ctl.expectOne('http://api.test/api/calls/a%2Fb%3Fc').flush({});
  });

  it('setStatus patches only the status', () => {
    svc.setStatus('abc', 'RESOLVED').subscribe();
    const req = ctl.expectOne('http://api.test/api/calls/abc/status');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ status: 'RESOLVED' });
    req.flush({});
  });

  it('reveal posts the reason and nothing else', () => {
    svc.reveal('abc', 'patient asked for a copy').subscribe();
    const req = ctl.expectOne('http://api.test/api/calls/abc/reveal');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'patient asked for a copy' });
    req.flush({});
  });

  it('audit pages through the trail', () => {
    svc.audit(1, 15).subscribe();
    const req = ctl.expectOne((r) => r.url === 'http://api.test/api/audit');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('size')).toBe('15');
    req.flush({});
  });
});
