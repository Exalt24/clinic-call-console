import { SAMPLE, TestApp, addCall, auditRows, bearer, createTestApp, failAuditInserts, login, resetDb } from './helpers';

const REASON = 'caller disputes a billing line';

describe('reveal, status change and the audit trail (real PostgreSQL)', () => {
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
    id = await addCall(t, 'r-1');
    await t.ds.query('TRUNCATE audit_event RESTART IDENTITY'); // start each test with the ingest row out of the way
  });

  describe('reveal needs the admin role', () => {
    it('refuses a reviewer with 403, returns nothing readable and writes no audit row', async () => {
      const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(reviewer)).send({ reason: REASON });
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain(SAMPLE.name);
      expect(await auditRows(t.ds)).toHaveLength(0);
    });

    it('refuses a reviewer before it even reads the body', async () => {
      const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(reviewer)).send({});
      expect(res.status).toBe(403);
    });
  });

  describe('reveal needs a real reason', () => {
    it.each([
      ['no body', undefined],
      ['no reason', {}],
      ['an empty reason', { reason: '' }],
      ['a blank reason', { reason: '            ' }],
      ['a reason of 9 characters', { reason: '123456789' }],
      ['a reason of 9 characters padded with spaces', { reason: '   123456789   ' }],
      ['a reason over 300 characters', { reason: 'r'.repeat(301) }],
      ['a reason that is a number', { reason: 1234567890123 }],
      ['a reason that is an object', { reason: { text: REASON } }],
    ])('answers 400 for %s and writes nothing', async (_label, body) => {
      const req = t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin));
      const res = await (body === undefined ? req : req.send(body as object));
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).not.toContain(SAMPLE.name);
      expect(await auditRows(t.ds)).toHaveLength(0);
    });

    it('names what is wrong in the problem detail', async () => {
      const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: 'short' });
      expect(res.body).toEqual({ type: 'about:blank', title: 'Validation failed', status: 400, detail: 'Give a reason of 10 to 300 characters' });
    });

    it('answers 404 for a call that does not exist and writes nothing', async () => {
      const res = await t.http().post('/api/calls/3f2b8c1e-7a53-4f43-9d0a-0a1b2c3d4e5f/reveal').set(bearer(admin)).send({ reason: REASON });
      expect(res.status).toBe(404);
      expect(await auditRows(t.ds)).toHaveLength(0);
    });
  });

  describe('a good reveal', () => {
    it('returns the original name and transcript, uncached', async () => {
      const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.callId).toBe(id);
      expect(res.body.patientName).toBe(SAMPLE.name);
      const text = res.body.transcript.map((l: { text: string }) => l.text).join(' ');
      expect(text).toContain(SAMPLE.phone);
      expect(text).toContain(SAMPLE.dob);
      expect(Date.parse(res.body.revealedAt)).not.toBeNaN();
    });

    it('writes exactly one REVEAL audit row with the trimmed reason, the actor and the call', async () => {
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: `   ${REASON}   ` }).expect(200);
      const rows = await auditRows(t.ds);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ action: 'REVEAL', actor: 'admin@demo.test', actor_role: 'ADMIN', call_id: id, detail: `reason: ${REASON}` });
    });

    it('writes one more row per reveal, never merging two', async () => {
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON }).expect(200);
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON }).expect(200);
      expect(await auditRows(t.ds, 'REVEAL')).toHaveLength(2);
    });
  });

  describe('the reveal and its audit row are one transaction', () => {
    it('returns nothing readable when the audit insert fails, and leaves no REVEAL row', async () => {
      const undo = await failAuditInserts(t.ds, 'REVEAL');
      try {
        const res = await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON });
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain(SAMPLE.name);
        expect(res.body.detail).toBe('An unexpected error occurred');
      } finally {
        await undo();
      }
      expect(await auditRows(t.ds, 'REVEAL')).toHaveLength(0);
      // and the app still works once the fault is gone
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON }).expect(200);
      expect(await auditRows(t.ds, 'REVEAL')).toHaveLength(1);
    });

    it('rolls a status change back when its audit insert fails', async () => {
      const undo = await failAuditInserts(t.ds, 'STATUS_CHANGE');
      try {
        const res = await t.http().patch(`/api/calls/${id}/status`).set(bearer(reviewer)).send({ status: 'RESOLVED' });
        expect(res.status).toBe(500);
      } finally {
        await undo();
      }
      const [row] = await t.ds.query('SELECT status FROM call_record WHERE id = $1', [id]);
      expect(row.status).toBe('NEW');
      expect(await auditRows(t.ds)).toHaveLength(0);
    });

    it('does not open a call when its audit insert fails', async () => {
      const undo = await failAuditInserts(t.ds, 'VIEW_REDACTED');
      try {
        const res = await t.http().get(`/api/calls/${id}`).set(bearer(reviewer));
        expect(res.status).toBe(500);
        expect(JSON.stringify(res.body)).not.toContain('NAME');
      } finally {
        await undo();
      }
    });
  });

  describe('status changes', () => {
    it('lets a reviewer move a call and records from and to', async () => {
      const res = await t.http().patch(`/api/calls/${id}/status`).set(bearer(reviewer)).send({ status: 'IN_REVIEW' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id, status: 'IN_REVIEW' });
      const rows = await auditRows(t.ds, 'STATUS_CHANGE');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ actor: 'reviewer@demo.test', detail: 'from NEW to IN_REVIEW' });
    });

    it.each([
      ['a status that does not exist', { status: 'DELETED' }],
      ['no status', {}],
      ['a lower-case status', { status: 'resolved' }],
      ['a status that is a number', { status: 7 }],
    ])('answers 400 for %s and changes nothing', async (_label, body) => {
      const res = await t.http().patch(`/api/calls/${id}/status`).set(bearer(reviewer)).send(body);
      expect(res.status).toBe(400);
      const [row] = await t.ds.query('SELECT status FROM call_record WHERE id = $1', [id]);
      expect(row.status).toBe('NEW');
      expect(await auditRows(t.ds)).toHaveLength(0);
    });
  });

  describe('the audit trail itself', () => {
    it('is closed to a reviewer', async () => {
      const res = await t.http().get('/api/audit').set(bearer(reviewer));
      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('reviewer@demo.test');
    });

    it('lists newest first for an admin, with the row shape the client reads', async () => {
      await t.http().get(`/api/calls/${id}`).set(bearer(reviewer)).expect(200);
      await t.http().post(`/api/calls/${id}/reveal`).set(bearer(admin)).send({ reason: REASON }).expect(200);
      const res = await t.http().get('/api/audit').set(bearer(admin));
      expect(res.status).toBe(200);
      expect(res.body.content.map((r: { action: string }) => r.action)).toEqual(['REVEAL', 'VIEW_REDACTED']);
      expect(res.body.content[0]).toEqual({
        id: expect.any(Number),
        at: expect.any(String),
        actor: 'admin@demo.test',
        actorRole: 'ADMIN',
        action: 'REVEAL',
        callId: id,
        detail: `reason: ${REASON}`,
      });
    });

    it('pages, caps the size at 100 and refuses a size that is not a number', async () => {
      for (let i = 0; i < 3; i++) await t.http().get(`/api/calls/${id}`).set(bearer(reviewer)).expect(200);
      const page = await t.http().get('/api/audit?size=2&page=1').set(bearer(admin));
      expect(page.body).toMatchObject({ page: 1, size: 2, totalElements: 3, totalPages: 2 });
      expect(page.body.content).toHaveLength(1);
      expect((await t.http().get('/api/audit?size=9999').set(bearer(admin))).body.size).toBe(100);
      expect((await t.http().get('/api/audit?size=lots').set(bearer(admin))).status).toBe(400);
    });
  });
});
