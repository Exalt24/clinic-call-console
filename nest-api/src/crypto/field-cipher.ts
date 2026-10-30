import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * AES-256-GCM for fields that must never sit readable in the database. Each value gets a fresh random 12-byte IV stored in
 * front of the ciphertext, and GCM authenticates it, so a tampered value fails to decrypt. The stored format is
 * Base64(iv || ciphertext || tag), the same bytes the Spring Boot API writes.
 */
export class FieldCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error(`FIELD_KEY must be Base64 of exactly 32 bytes, got ${this.key.length}`);
    }
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
  }

  decrypt(stored: string): string {
    const buf = Buffer.from(stored, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('ciphertext too short');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(buf.length - TAG_BYTES);
    const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('decryption failed (wrong key or tampered value)');
    }
  }
}
