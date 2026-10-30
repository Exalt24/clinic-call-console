import { randomBytes } from 'node:crypto';
import { FieldCipher } from './field-cipher';

const key = () => randomBytes(32).toString('base64');

describe('field cipher (AES-256-GCM)', () => {
  it('round-trips text, including unicode', () => {
    const c = new FieldCipher(key());
    for (const s of ['Dana Whitfield', '', 'Caller ••• 0142\nline two', '名前']) expect(c.decrypt(c.encrypt(s))).toBe(s);
  });

  it('uses a fresh IV every time, so the same text never encrypts the same way twice', () => {
    const c = new FieldCipher(key());
    expect(c.encrypt('same')).not.toBe(c.encrypt('same'));
  });

  it('does not store the plain text', () => {
    const c = new FieldCipher(key());
    expect(Buffer.from(c.encrypt('Dana Whitfield'), 'base64').toString('utf8')).not.toContain('Dana');
  });

  it('refuses a tampered value instead of returning garbage', () => {
    const c = new FieldCipher(key());
    const raw = Buffer.from(c.encrypt('Dana Whitfield'), 'base64');
    raw[raw.length - 20] ^= 0x01;
    expect(() => c.decrypt(raw.toString('base64'))).toThrow('decryption failed');
  });

  it('refuses the wrong key and a value that is too short', () => {
    const stored = new FieldCipher(key()).encrypt('x');
    expect(() => new FieldCipher(key()).decrypt(stored)).toThrow('decryption failed');
    expect(() => new FieldCipher(key()).decrypt('AAAA')).toThrow('too short');
  });

  it('requires a 32 byte key', () => {
    expect(() => new FieldCipher(randomBytes(16).toString('base64'))).toThrow('exactly 32 bytes');
  });

  it('stores the layout the Spring Boot API uses: 12 byte IV, then ciphertext, then a 16 byte tag', () => {
    const c = new FieldCipher('ZGVtby1vbmx5LWZpZWxkLWtleS0zMi1ieXRlcyEhISE=');
    expect(Buffer.from(c.encrypt('abc'), 'base64')).toHaveLength(12 + 3 + 16);
  });
});
