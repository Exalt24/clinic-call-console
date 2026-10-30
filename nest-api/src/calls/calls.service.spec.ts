import { LoginThrottle } from '../auth/auth.service';
import { loadConfig } from '../config/config';
import { idForExternal, parseLines } from './calls.service';

describe('idForExternal', () => {
  it('is stable and looks like a version 3 UUID', () => {
    expect(idForExternal('seed-0')).toBe(idForExternal('seed-0'));
    expect(idForExternal('seed-0')).not.toBe(idForExternal('seed-1'));
    expect(idForExternal('seed-0')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('parseLines', () => {
  it('splits speaker and text, keeps later colons in the text, and files a line with no speaker under NOTE', () => {
    expect(parseLines('AGENT: Hello\nCALLER: at 9:30 today\n\nstray line')).toEqual([
      { speaker: 'AGENT', text: 'Hello' },
      { speaker: 'CALLER', text: 'at 9:30 today' },
      { speaker: 'NOTE', text: 'stray line' },
    ]);
  });
});

describe('LoginThrottle', () => {
  it('locks after the maximum number of failures and unlocks when the oldest ages out', () => {
    let now = 1_000_000;
    const t = new LoginThrottle(3, 600_000, () => now);
    t.recordFailure('a@x.test');
    t.recordFailure('A@x.test ');
    expect(t.isLocked('a@x.test')).toBe(false);
    now += 1000;
    t.recordFailure('a@x.test');
    expect(t.isLocked('a@x.test')).toBe(true);
    expect(t.isLocked('b@x.test')).toBe(false);
    now = 1_000_000 + 599_999;
    expect(t.isLocked('a@x.test')).toBe(true); // all three failures are still inside the window
    now = 1_000_000 + 600_001;
    expect(t.isLocked('a@x.test')).toBe(false); // the two oldest aged out, one failure is left
  });

  it('forgets the failures after a good sign-in', () => {
    const t = new LoginThrottle(1, 600_000);
    t.recordFailure('a@x.test');
    t.reset('a@x.test');
    expect(t.isLocked('a@x.test')).toBe(false);
  });
});

describe('config', () => {
  it('falls back to demo values outside production', () => {
    expect(loadConfig({} as NodeJS.ProcessEnv).databaseUrl).toContain('localhost:55442');
  });

  it('stops the boot in production when a secret is missing', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow('must be set');
  });

  it('refuses a signing secret under 32 bytes', () => {
    expect(() => loadConfig({ JWT_SECRET: 'short' } as NodeJS.ProcessEnv)).toThrow('at least 32 bytes');
  });
});
