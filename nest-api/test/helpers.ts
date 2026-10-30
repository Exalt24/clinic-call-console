import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { AppConfig, loadConfig } from '../src/config/config';
import { CallsService } from '../src/calls/calls.service';
import { IngestDto } from '../src/calls/calls.dto';

export interface TestApp {
  app: INestApplication;
  ds: DataSource;
  cfg: AppConfig;
  http: () => ReturnType<typeof request>;
}

/** Boots the real app (real guards, pipes, filter, TypeORM migrations) against the local PostgreSQL container. */
export async function createTestApp(overrides: Partial<AppConfig> = {}): Promise<TestApp> {
  const cfg: AppConfig = { ...loadConfig({ DATABASE_URL: process.env.DATABASE_URL } as NodeJS.ProcessEnv), ...overrides, seedEnabled: false };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(cfg)] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  configureApp(app, cfg);
  await app.init();
  return { app, ds: app.get(DataSource), cfg, http: () => request(app.getHttpServer()) };
}

export async function resetDb(ds: DataSource): Promise<void> {
  await ds.query('TRUNCATE call_record, audit_event RESTART IDENTITY');
}

export type Who = 'reviewer' | 'admin';

export async function login(t: TestApp, who: Who): Promise<string> {
  const res = await t.http().post('/api/auth/login').send({ username: `${who}@demo.test`, password: `${who}-demo-pass` });
  if (res.status !== 200) throw new Error(`login as ${who} failed with ${res.status}`);
  return res.body.token;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Synthetic caller details that appear in the raw transcript; the tests prove none of them leaves the API masked. */
export const SAMPLE = {
  name: 'Dana Whitfield',
  phone: '(415) 555-0142',
  dob: 'March 3, 1984',
  email: 'dana.whitfield@example.test',
};

export function sampleCall(externalId: string, over: Partial<IngestDto> = {}): IngestDto {
  return {
    externalId,
    startedAt: '2026-10-30T09:00:00.000Z',
    durationSec: 120,
    agent: 'Front desk agent',
    callerNumber: SAMPLE.phone,
    reason: 'APPOINTMENT',
    outcome: 'BOOKED',
    patientName: SAMPLE.name,
    transcript: [
      { speaker: 'AGENT', text: 'Thanks for calling. How can I help?' },
      { speaker: 'CALLER', text: `Hi, my name is ${SAMPLE.name}. I was born on ${SAMPLE.dob}.` },
      { speaker: 'CALLER', text: `You can reach me at ${SAMPLE.phone} or ${SAMPLE.email}.` },
    ],
    ...over,
  };
}

/** Stores one call through the same ingest path the webhook uses and returns its id. */
export async function addCall(t: TestApp, externalId: string, over: Partial<IngestDto> = {}): Promise<string> {
  return (await t.app.get(CallsService).ingest(sampleCall(externalId, over))).id;
}

export function forgedToken(role: string, secret = 'a-different-secret-that-is-long-enough-123456'): string {
  return new JwtService({ secret }).sign({ role, name: 'Mallory' }, { subject: 'admin@demo.test', expiresIn: 600 });
}

export function expiredToken(cfg: AppConfig): string {
  const past = Math.floor(Date.now() / 1000) - 3600;
  return new JwtService({ secret: cfg.jwtSecret }).sign({ role: 'ADMIN', name: 'Avery Admin', iat: past - 60, exp: past }, { subject: 'admin@demo.test' });
}

export function unsignedToken(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'admin@demo.test', role: 'ADMIN', exp: Math.floor(Date.now() / 1000) + 600 })}.`;
}

/** Makes every audit insert of the given action fail inside PostgreSQL, to prove what happens to the work around it. */
export async function failAuditInserts(ds: DataSource, action: string): Promise<() => Promise<void>> {
  await ds.query(`CREATE OR REPLACE FUNCTION refuse_audit() RETURNS trigger AS $$
    BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'audit insert refused'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
  await ds.query('CREATE TRIGGER refuse_audit_trg BEFORE INSERT ON audit_event FOR EACH ROW EXECUTE FUNCTION refuse_audit()');
  return async () => {
    await ds.query('DROP TRIGGER IF EXISTS refuse_audit_trg ON audit_event');
    await ds.query('DROP FUNCTION IF EXISTS refuse_audit()');
  };
}

export async function auditRows(ds: DataSource, action?: string): Promise<Array<Record<string, any>>> {
  return action
    ? ds.query('SELECT * FROM audit_event WHERE action = $1 ORDER BY id', [action])
    : ds.query('SELECT * FROM audit_event ORDER BY id');
}
