import { header, sign, valid } from './webhook-signature';

const SECRET = 'unit-test-secret';
const NOW = 1_800_000_000_000;
const T = NOW / 1000;

describe('webhook signature', () => {
  it('accepts a fresh, correctly signed body', () => {
    expect(valid(header(SECRET, T, '{"a":1}'), '{"a":1}', SECRET, NOW, 300)).toBe(true);
  });

  it('rejects a body changed by one byte', () => {
    expect(valid(header(SECRET, T, '{"a":1}'), '{"a":2}', SECRET, NOW, 300)).toBe(false);
  });

  it('rejects another secret', () => {
    expect(valid(header('other', T, 'x'), 'x', SECRET, NOW, 300)).toBe(false);
  });

  it('rejects a stale timestamp and a future one, and accepts the edge of the window', () => {
    expect(valid(header(SECRET, T - 301, 'x'), 'x', SECRET, NOW, 300)).toBe(false);
    expect(valid(header(SECRET, T + 301, 'x'), 'x', SECRET, NOW, 300)).toBe(false);
    expect(valid(header(SECRET, T - 300, 'x'), 'x', SECRET, NOW, 300)).toBe(true);
  });

  it('binds the timestamp into the MAC, so a captured signature cannot be re-dated', () => {
    const sig = sign(SECRET, T - 3600, 'x');
    expect(valid(`t=${T},v1=${sig}`, 'x', SECRET, NOW, 300)).toBe(false);
  });

  it.each([undefined, '', 'garbage', 't=1', 'v1=abc', 't=abc,v1=abc', 't=-5,v1=abc'])('rejects the header %s', (h) => {
    expect(valid(h, 'x', SECRET, NOW, 300)).toBe(false);
  });

  it('rejects a missing body', () => {
    expect(valid(header(SECRET, T, 'x'), undefined, SECRET, NOW, 300)).toBe(false);
  });

  it('rejects a signature of the wrong length without throwing', () => {
    expect(valid(`t=${T},v1=abcd`, 'x', SECRET, NOW, 300)).toBe(false);
  });
});
