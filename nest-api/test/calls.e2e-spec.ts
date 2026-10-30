import { SAMPLE, TestApp, addCall, auditRows, bearer, createTestApp, login, resetDb } from './helpers';

const LEAKS = [SAMPLE.name, 'Dana', 'Whitfield', SAMPLE.phone, '555-0142', SAMPLE.dob, SAMPLE.email];

describe('reading calls: masked by default (real PostgreSQL)', () => {
  let t: TestApp;
  let reviewer: string;
  let admin: string;

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
  });

  it('lists calls with no readable detail anywhere in the payload', async () => {
    await addCall(t, 'm-1');
    const res = await t.http().get('/api/calls').set(bearer(reviewer));
    expect(res.status).toBe(200);
    expect(res.body.content).toHaveLength(1);
    const text = JSON.stringify(res.body);
    for (const leak of LEAKS) expect(text).not.toContain(leak);
    expect(res.body.content[0]).toMatchObject({ callerLabel: 'Caller ••• 0142', phiCount: 4, status: 'NEW' });
  });

  it('shows the masked transcript on one call, for a reviewer and an admin alike, and never the original', async () => {
    const id = await addCall(t, 'm-2');
    for (const token of [reviewer, admin]) {
      const res = await t.http().get(`/api/calls/${id}`).set(bearer(token));
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const text = JSON.stringify(res.body);
      for (const leak of LEAKS) expect(text).not.toContain(leak);
      expect(text).toContain('[NAME]');
      expect(text).toContain('[PHONE]');
      expect(res.body.phiSummary).toBe('EMAIL:1,DOB:1,PHONE:1,NAME:1');
    }
  });

  it('writes a VIEW_REDACTED audit row for every opened call', async () => {
    const id = await addCall(t, 'm-3');
    await t.http().get(`/api/calls/${id}`).set(bearer(reviewer)).expect(200);
    const rows = await auditRows(t.ds, 'VIEW_REDACTED');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: 'reviewer@demo.test', actor_role: 'REVIEWER', call_id: id });
  });

  it('keeps the original text out of the database: only ciphertext sits in the sensitive columns', async () => {
    const id = await addCall(t, 'm-4');
    const [row] = await t.ds.query('SELECT * FROM call_record WHERE id = $1', [id]);
    for (const col of ['patient_name_enc', 'raw_transcript_enc']) {
      for (const leak of LEAKS) expect(row[col]).not.toContain(leak);
    }
    for (const leak of LEAKS) expect(row.redacted_transcript).not.toContain(leak);
  });

  it('filters by status and searches the masked text, the agent and the caller label', async () => {
    const a = await addCall(t, 'f-1', { agent: 'After-hours agent' });
    await addCall(t, 'f-2', { agent: 'Scheduling agent' });
    await t.ds.query("UPDATE call_record SET status = 'RESOLVED' WHERE id = $1", [a]);
    const resolved = await t.http().get('/api/calls?status=RESOLVED').set(bearer(reviewer));
    expect(resolved.body.content.map((c: { id: string }) => c.id)).toEqual([a]);
    const byAgent = await t.http().get('/api/calls?q=scheduling').set(bearer(reviewer));
    expect(byAgent.body.totalElements).toBe(1);
    const byMask = await t.http().get('/api/calls?q=[PHONE]').set(bearer(reviewer));
    expect(byMask.body.totalElements).toBe(2);
    // the encrypted name cannot be searched, which is the point
    const byName = await t.http().get('/api/calls?q=whitfield').set(bearer(reviewer));
    expect(byName.body.totalElements).toBe(0);
    // wildcard characters are not wildcards
    const wild = await t.http().get('/api/calls?q=%25').set(bearer(reviewer));
    expect(wild.body.totalElements).toBe(2);
  });

  it('pages newest first and caps the page size at 50', async () => {
    for (let i = 0; i < 3; i++) await addCall(t, `p-${i}`, { startedAt: `2026-10-30T0${i}:00:00.000Z` });
    const res = await t.http().get('/api/calls?size=2&page=0').set(bearer(reviewer));
    expect(res.body).toMatchObject({ page: 0, size: 2, totalElements: 3, totalPages: 2 });
    expect(res.body.content.map((c: { startedAt: string }) => c.startedAt)).toEqual(['2026-10-30T02:00:00.000Z', '2026-10-30T01:00:00.000Z']);
    const big = await t.http().get('/api/calls?size=5000').set(bearer(reviewer));
    expect(big.body.size).toBe(50);
    const negative = await t.http().get('/api/calls?page=-4').set(bearer(reviewer));
    expect(negative.body.page).toBe(0);
  });

  it.each([
    ['an unknown status', '?status=DELETED'],
    ['a page that is not a number', '?page=abc'],
    ['a size that is not a number', '?size=ten'],
    ['a search term over 200 characters', `?q=${'x'.repeat(201)}`],
  ])('refuses malformed list input: %s', async (_label, qs) => {
    const res = await t.http().get(`/api/calls${qs}`).set(bearer(reviewer));
    expect(res.status).toBe(400);
  });

  it('answers 404 for a call that does not exist and 400 for an id that is not a UUID, with no audit row for either', async () => {
    const missing = await t.http().get('/api/calls/3f2b8c1e-7a53-4f43-9d0a-0a1b2c3d4e5f').set(bearer(reviewer));
    expect(missing.status).toBe(404);
    expect(missing.body.detail).toBe('Call not found');
    const bad = await t.http().get('/api/calls/not-a-uuid').set(bearer(reviewer));
    expect(bad.status).toBe(400);
    expect(await auditRows(t.ds)).toHaveLength(0);
  });
});
