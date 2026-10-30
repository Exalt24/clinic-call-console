import * as fs from 'node:fs';
import * as path from 'node:path';
import { ClientTypes } from './client-types';
import { TestApp, addCall, bearer, createTestApp, login, resetDb } from './helpers';

const CORE = path.resolve(__dirname, '../../web/src/app/core');
const types = new ClientTypes(path.join(CORE, 'models.ts'));

describe('contract: the responses match the types the Angular client declares', () => {
  let t: TestApp;
  let reviewer: string;
  let admin: string;
  let id: string;

  beforeAll(async () => {
    t = await createTestApp();
    reviewer = await login(t, 'reviewer');
    admin = await login(t, 'admin');
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDb(t.ds);
    id = await addCall(t, 'c-1');
  });

  const expectShape = (typeText: string, body: unknown, opts?: { allowExtra?: boolean }) => expect(types.check(typeText, body, opts)).toEqual([]);

  it('reads the client types it checks against (a missing file would make every check vacuous)', () => {
    expect(types.names()).toEqual(expect.arrayContaining(['Session', 'Page', 'CallSummary', 'CallDetail', 'RevealResponse', 'AuditRow', 'ProblemDetail']));
  });

  it('login answers a Session', async () => {
    const res = await t.http().post('/api/auth/login').send({ username: 'admin@demo.test', password: 'admin-demo-pass' });
    expectShape('Session', res.body);
  });

  it('the call list answers a Page<CallSummary>, with and without filters', async () => {
    await addCall(t, 'c-2', { outcome: 'UNRESOLVED', reason: 'BILLING' });
    for (const qs of ['', '?status=NEW&size=5', '?q=phone&page=0&size=12']) {
      const res = await t.http().get(`/api/calls${qs}`).set(bearer(reviewer));
      expect(res.status).toBe(200);
      expectShape('Page<CallSummary>', res.body);
    }
  });

  it('one call answers a CallDetail', async () => {
    const res = await t.http().get(`/api/calls/${id}`).set(bearer(reviewer));
    expectShape('CallDetail', res.body);
  });

  it('a status change answers a CallSummary', async () => {
    const res = await t.http().patch(`/api/calls/${id}/status`).set(bearer(reviewer)).send({ status: 'RESOLVED' });
    expectShape('CallSummary', res.body);
  });

  it('a reveal answers a RevealResponse', async () => {
    const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: 'caller disputes a billing line' });
    expectShape('RevealResponse', res.body);
  });

  it('the audit trail answers a Page<AuditRow>, including rows with no call', async () => {
    await login(t, 'admin'); // a sign-in row has no call
    await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: 'caller disputes a billing line' });
    const res = await t.http().get('/api/audit?size=50').set(bearer(admin));
    expect(res.body.content.some((r: { callId: string | null }) => r.callId === null)).toBe(true); // the sign-ins
    expectShape('Page<AuditRow>', res.body);
  });

  it('every failure the client can see carries the ProblemDetail fields', async () => {
    const failures = [
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: 'x' }),
      await t.http().get('/api/calls/3f2b8c1e-7a53-4f43-9d0a-0a1b2c3d4e5f').set(bearer(reviewer)),
      await t.http().get('/api/audit').set(bearer(reviewer)),
      await t.http().get('/api/calls'),
      await t.http().post('/api/auth/login').send({ username: 'admin@demo.test', password: 'wrong-wrong' }),
    ];
    expect(failures.map((f) => f.status)).toEqual([400, 404, 403, 401, 401]);
    for (const f of failures) {
      expectShape('ProblemDetail', f.body, { allowExtra: true });
      expect(f.body.status).toBe(f.status);
    }
  });

  it('every endpoint the client source calls exists on this API', async () => {
    const calls: Array<{ method: string; url: string }> = [];
    for (const file of fs.readdirSync(CORE).filter((f) => f.endsWith('.service.ts'))) {
      const src = fs.readFileSync(path.join(CORE, file), 'utf8');
      for (const m of src.matchAll(/this\.http\s*\.(get|post|patch|put|delete)(?:<[^(]*>)?\(\s*`\$\{apiBaseUrl\(\)\}([^`]*)`/g)) {
        calls.push({ method: m[1], url: m[2].replace(/\$\{encodeURIComponent\(id\)\}/g, id) });
      }
    }
    // login, list, detail, status, reveal, audit and the health check
    expect(calls.length).toBeGreaterThanOrEqual(7);
    for (const c of calls) {
      const req = t.http()[c.method as 'get'](c.url).set(bearer(admin));
      const res = await (c.method === 'get' ? req : req.send({ username: 'admin@demo.test', password: 'admin-demo-pass', status: 'NEW', reason: 'checking the route exists' }));
      expect([404, 405]).not.toContain(res.status);
    }
  });

  describe('the checker itself is not vacuous', () => {
    const good = { callId: 'x', patientName: 'n', transcript: [{ speaker: 's', text: 't' }], revealedAt: 'now' };
    it('accepts a matching value', () => expect(types.check('RevealResponse', good)).toEqual([]));
    it('rejects a missing field', () => expect(types.check('RevealResponse', { ...good, revealedAt: undefined })).not.toEqual([]));
    it('rejects an extra field', () => expect(types.check('RevealResponse', { ...good, rawTranscript: 'x' })).not.toEqual([]));
    it('rejects a wrong primitive', () => expect(types.check('RevealResponse', { ...good, patientName: 7 })).not.toEqual([]));
    it('rejects a value outside a union', () =>
      expect(types.check('CallSummary', { id: 'a', startedAt: 'a', durationSec: 1, agent: 'a', callerLabel: 'a', reason: 'GOSSIP', outcome: 'BOOKED', status: 'NEW', flagged: false, phiCount: 0 })).not.toEqual([]));
  });
});
