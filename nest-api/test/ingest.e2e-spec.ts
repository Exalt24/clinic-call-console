import { header } from '../src/ingest/webhook-signature';
import { SAMPLE, TestApp, auditRows, createTestApp, resetDb, sampleCall } from './helpers';

describe('the signed ingest webhook (real PostgreSQL)', () => {
  let t: TestApp;
  const now = () => Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDb(t.ds);
  });

  const post = (body: string, sig?: string) => {
    const req = t.http().post('/api/ingest/calls').set('Content-Type', 'application/json');
    return (sig ? req.set('X-Signature', sig) : req).send(body);
  };

  it('accepts a correctly signed call, masks it, stores it encrypted and audits the ingest', async () => {
    const body = JSON.stringify(sampleCall('w-1'));
    const res = await post(body, header(t.cfg.webhookSecret, now(), body));
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(String), duplicate: false, phiCount: 4 });
    const [row] = await t.ds.query('SELECT * FROM call_record WHERE id = $1', [res.body.id]);
    expect(row.redacted_transcript).not.toContain(SAMPLE.phone);
    expect(row.raw_transcript_enc).not.toContain('Thanks for calling');
    const audit = await auditRows(t.ds, 'INGEST');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actor: 'voice-platform', actor_role: 'SYSTEM', call_id: res.body.id });
  });

  it('treats a redelivery as a duplicate and changes nothing', async () => {
    const body = JSON.stringify(sampleCall('w-2'));
    const first = await post(body, header(t.cfg.webhookSecret, now(), body));
    const again = await post(body, header(t.cfg.webhookSecret, now(), body));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id: first.body.id, duplicate: true });
    expect(await t.ds.query('SELECT 1 FROM call_record')).toHaveLength(1);
    expect(await auditRows(t.ds, 'INGEST')).toHaveLength(1);
  });

  it.each([
    ['no signature', () => undefined],
    ['a signature made with another secret', (b: string) => header('another-secret', now(), b)],
    ['a stale timestamp (replay)', (b: string) => header(t.cfg.webhookSecret, now() - 3600, b)],
    ['a malformed header', () => 't=abc,v1=zz'],
    ['a signature over a different body', () => header(t.cfg.webhookSecret, now(), '{}')],
  ])('answers 401 for %s and stores nothing', async (_label, sig) => {
    const body = JSON.stringify(sampleCall('w-3'));
    const res = await post(body, sig(body));
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Invalid webhook signature');
    expect(await t.ds.query('SELECT 1 FROM call_record')).toHaveLength(0);
  });

  it.each([
    ['a missing patient name', { patientName: undefined }],
    ['an unknown reason', { reason: 'GOSSIP' }],
    ['a negative duration', { durationSec: -5 }],
    ['an empty transcript', { transcript: [] }],
    ['a transcript line without text', { transcript: [{ speaker: 'CALLER' }] }],
    ['a start time that is not a date', { startedAt: 'yesterday' }],
  ])('answers 400 for a signed payload with %s', async (_label, over) => {
    const body = JSON.stringify({ ...sampleCall('w-4'), ...over });
    const res = await post(body, header(t.cfg.webhookSecret, now(), body));
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Validation failed');
    expect(await t.ds.query('SELECT 1 FROM call_record')).toHaveLength(0);
  });
});
