import { TestApp, addCall, auditRows, bearer, createTestApp, expiredToken, forgedToken, login, resetDb, unsignedToken } from './helpers';

describe('sign-in and tokens (real PostgreSQL)', () => {
  let t: TestApp;
  let reviewerToken: string;

  beforeAll(async () => {
    t = await createTestApp({ loginMaxFailures: 3 });
    reviewerToken = await login(t, 'reviewer'); // before the lockout test locks that account
  });
  afterAll(async () => {
    await t.app.close();
  });
  beforeEach(async () => {
    await resetDb(t.ds);
  });

  it('signs a reviewer in and answers with the session shape the client reads', async () => {
    const res = await t.http().post('/api/auth/login').send({ username: 'Reviewer@Demo.test ', password: 'reviewer-demo-pass' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ username: 'reviewer@demo.test', displayName: 'Riley Reviewer', role: 'REVIEWER' });
    expect(Date.parse(res.body.expiresAt)).toBeGreaterThan(Date.now());
    expect((await auditRows(t.ds, 'LOGIN')).map((r) => r.actor)).toEqual(['reviewer@demo.test']);
  });

  it('refuses a wrong password and an unknown account with the same message, and audits the failure', async () => {
    const wrong = await t.http().post('/api/auth/login').send({ username: 'admin@demo.test', password: 'nope-nope' });
    const unknown = await t.http().post('/api/auth/login').send({ username: 'nobody@demo.test', password: 'nope-nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.detail).toBe('Wrong email or password');
    expect(unknown.body.detail).toBe(wrong.body.detail);
    expect(await auditRows(t.ds, 'LOGIN_FAILED')).toHaveLength(2);
  });

  it('locks an account after repeated failures, before the password is even checked', async () => {
    for (let i = 0; i < 3; i++) {
      await t.http().post('/api/auth/login').send({ username: 'reviewer@demo.test', password: 'wrong-wrong' }).expect(401);
    }
    const locked = await t.http().post('/api/auth/login').send({ username: 'reviewer@demo.test', password: 'reviewer-demo-pass' });
    expect(locked.status).toBe(429);
  });

  it.each([
    ['an empty body', {}],
    ['a missing password', { username: 'admin@demo.test' }],
    ['a number for the username', { username: 42, password: 'x' }],
    ['a password over 200 characters', { username: 'admin@demo.test', password: 'p'.repeat(201) }],
  ])('refuses malformed login input: %s', async (_label, body) => {
    const res = await t.http().post('/api/auth/login').send(body as object);
    expect(res.status).toBe(400);
    expect(res.body.title).toBe('Validation failed');
  });

  it('refuses unreadable JSON with the same problem shape and no parser detail', async () => {
    const res = await t.http().post('/api/auth/login').set('Content-Type', 'application/json').send('{"username": ');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ type: 'about:blank', title: 'Bad Request', status: 400, detail: 'The request could not be read' });
  });

  describe('every protected route', () => {
    it.each([
      ['no token', () => ({})],
      ['a token signed with another secret', () => bearer(forgedToken('ADMIN'))],
      ['an expired token', () => bearer(expiredToken(t.cfg))],
      ['an unsigned (alg none) token', () => bearer(unsignedToken())],
      ['a correctly signed token with an unknown role', () => bearer(forgedToken('SUPERUSER', t.cfg.jwtSecret))],
      ['a bearer header with no token', () => ({ Authorization: 'Bearer ' })],
    ])('answers 401 for %s', async (_label, headers) => {
      const id = await addCall(t, 'a-1');
      for (const path of ['/api/calls', `/api/calls/${id}`, '/api/audit']) {
        const res = await t.http().get(path).set(headers());
        expect(res.status).toBe(401);
      }
      expect((await t.http().post(`/api/calls/${id}/reveal`).set(headers()).send({ reason: 'billing dispute review' })).status).toBe(401);
      expect((await t.http().patch(`/api/calls/${id}/status`).set(headers()).send({ status: 'RESOLVED' })).status).toBe(401);
    });
  });

  it('keeps the health check public and answers it from the database', async () => {
    const res = await t.http().get('/actuator/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'UP' });
  });

  it('sends the security headers and echoes a safe request id', async () => {
    const token = reviewerToken;
    const res = await t.http().get('/api/calls').set(bearer(token)).set('X-Request-Id', 'trace-12345678');
    expect(res.headers['x-request-id']).toBe('trace-12345678');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    const unsafe = await t.http().get('/api/calls').set(bearer(token)).set('X-Request-Id', 'bad id with spaces');
    expect(unsafe.headers['x-request-id']).not.toBe('bad id with spaces');
  });

  it('allows the Angular origin through CORS and no other', async () => {
    const ok = await t.http().options('/api/calls').set('Origin', 'http://localhost:4200').set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    const other = await t.http().options('/api/calls').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
