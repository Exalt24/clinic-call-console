import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { apiBaseUrl } from './app-config';
import {
  AuditRow,
  CallDetail,
  CallQuery,
  CallStatus,
  CallSummary,
  Page,
  RevealResponse,
} from './models';

/** Every call to the API in one place, so components never build URLs and the wire contract has one home. */
@Injectable({ providedIn: 'root' })
export class CallsService {
  private readonly http = inject(HttpClient);

  list(query: CallQuery): Observable<Page<CallSummary>> {
    let params = new HttpParams().set('page', query.page).set('size', query.size);
    if (query.status) params = params.set('status', query.status);
    const q = query.q.trim();
    if (q) params = params.set('q', q);
    return this.http.get<Page<CallSummary>>(`${apiBaseUrl()}/api/calls`, { params });
  }

  detail(id: string): Observable<CallDetail> {
    return this.http.get<CallDetail>(`${apiBaseUrl()}/api/calls/${encodeURIComponent(id)}`);
  }

  setStatus(id: string, status: CallStatus): Observable<CallSummary> {
    return this.http.patch<CallSummary>(`${apiBaseUrl()}/api/calls/${encodeURIComponent(id)}/status`, { status });
  }

  reveal(id: string, reason: string): Observable<RevealResponse> {
    return this.http.post<RevealResponse>(`${apiBaseUrl()}/api/calls/${encodeURIComponent(id)}/reveal`, { reason });
  }

  audit(page: number, size: number): Observable<Page<AuditRow>> {
    const params = new HttpParams().set('page', page).set('size', size);
    return this.http.get<Page<AuditRow>>(`${apiBaseUrl()}/api/audit`, { params });
  }
}
