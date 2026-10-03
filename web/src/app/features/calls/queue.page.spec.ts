import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CallsService } from '../../core/calls.service';
import { CallQuery, CallSummary, Page } from '../../core/models';
import { QueuePage } from './queue.page';

function call(n: number, over: Partial<CallSummary> = {}): CallSummary {
  return {
    id: `id-${n}`, startedAt: '2026-10-04T08:00:00Z', durationSec: 100 + n, agent: 'Front desk agent', callerLabel: `Caller 01${n}`,
    reason: 'APPOINTMENT', outcome: 'BOOKED', status: 'NEW', flagged: false, phiCount: 4, ...over,
  };
}
function page(items: CallSummary[], p = 0, total = items.length, pages = 1): Page<CallSummary> {
  return { content: items, page: p, size: 10, totalElements: total, totalPages: pages };
}

describe('QueuePage', () => {
  let fixture: ComponentFixture<QueuePage>;
  let list: ReturnType<typeof vi.fn>;

  async function create(impl: (q: CallQuery) => Observable<Page<CallSummary>>) {
    list = vi.fn(impl);
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: CallsService, useValue: { list } }] });
    fixture = TestBed.createComponent(QueuePage);
    fixture.detectChanges();
    await settle();
  }
  // With fake timers installed, fixture.whenStable() waits for scheduler timers that never fire, so advance the fake clock
  // and run change detection explicitly instead (twice: the first pass lets the query effect emit, the second renders it).
  const settle = async () => {
    await vi.advanceTimersByTimeAsync(5);
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(5);
    fixture.detectChanges();
  };
  const el = () => fixture.nativeElement as HTMLElement;
  const lastQuery = () => list.mock.calls.at(-1)![0] as CallQuery;

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('loads the first page on start and shows the rows and the range', async () => {
    await create(() => of(page([call(1), call(2)], 0, 36, 4)));
    expect(list).toHaveBeenCalledTimes(1);
    expect(lastQuery()).toEqual({ status: null, q: '', page: 0, size: 10 });
    expect(el().querySelectorAll('table tbody tr')).toHaveLength(2);
    expect(el().querySelector('p.sub')?.textContent).toContain('1-2 of 36 calls');
  });

  it('shows the masked caller label and a masked-count, never a name or number', async () => {
    await create(() => of(page([call(1, { phiCount: 6 })])));
    const text = el().textContent as string;
    expect(text).toContain('Caller 011');
    expect(text).toContain('6 masked');
    expect(text).not.toMatch(/555-01\d\d/);
  });

  it('flags a call that needs a closer look, with a text alternative for screen readers', async () => {
    await create(() => of(page([call(1, { flagged: true, outcome: 'UNRESOLVED' })])));
    expect(el().querySelector('table .flag .sr-only')?.textContent).toContain('Flagged');
  });

  it('debounces typing: one request after the pause, not one per keystroke, and it returns to page 1', async () => {
    await create(() => of(page([call(1)])));
    const search = el().querySelector<HTMLInputElement>('#q')!;
    for (const v of ['b', 'bi', 'bil', 'bill']) {
      search.value = v;
      search.dispatchEvent(new Event('input'));
      await vi.advanceTimersByTimeAsync(80);
    }
    expect(list).toHaveBeenCalledTimes(1);   // still only the initial load
    await vi.advanceTimersByTimeAsync(300);
    await settle();
    expect(list).toHaveBeenCalledTimes(2);
    expect(lastQuery()).toMatchObject({ q: 'bill', page: 0 });
  });

  it('a status filter requests that status and resets the page', async () => {
    await create(() => of(page([call(1)], 2, 36, 4)));
    el().querySelectorAll<HTMLButtonElement>('button[role="radio"]')[3].click();   // Resolved
    await settle();
    expect(lastQuery()).toMatchObject({ status: 'RESOLVED', page: 0 });
    expect(el().querySelectorAll('button[role="radio"]')[3].getAttribute('aria-checked')).toBe('true');
    expect(el().querySelectorAll('button[role="radio"]')[0].getAttribute('aria-checked')).toBe('false');
  });

  it('paging asks for the next page and the pager disables at the ends', async () => {
    await create(() => of(page([call(1)], 0, 36, 4)));
    const [prev, next] = Array.from(el().querySelectorAll<HTMLButtonElement>('nav.pager button'));
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    next.click();
    await settle();
    expect(lastQuery().page).toBe(1);
  });

  it('shows an empty state with a way out when filters match nothing, and clearing restores the list', async () => {
    await create(() => of(page([])));
    el().querySelectorAll<HTMLButtonElement>('button[role="radio"]')[1].click();
    await settle();
    expect(el().textContent).toContain('No calls match');
    el().querySelector<HTMLButtonElement>('button.btn:not(.btn-primary)')!.click();
    await settle();
    expect(lastQuery()).toEqual({ status: null, q: '', page: 0, size: 10 });
  });

  it('shows a plain "no calls yet" state when there are none and nothing is filtered', async () => {
    await create(() => of(page([])));
    expect(el().textContent).toContain('No calls yet');
    expect(el().textContent).not.toContain('Clear filters');
  });

  it('shows an error state with a retry that asks again', async () => {
    let fail = true;
    await create(() => (fail ? throwError(() => new Error('down')) : of(page([call(1)]))));
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('could not load');
    fail = false;
    el().querySelector<HTMLButtonElement>('[role="alert"] button')!.click();
    await settle();
    expect(el().querySelectorAll('table tbody tr')).toHaveLength(1);
  });

  it('every row links to its call', async () => {
    await create(() => of(page([call(1)])));
    expect(el().querySelector('a.rowlink')?.getAttribute('href')).toBe('/calls/id-1');
  });
});
