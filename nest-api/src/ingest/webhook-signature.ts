import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies a webhook the way payment and voice platforms sign them: header `X-Signature: t=<unix seconds>,v1=<hex>` where
 * v1 = HMAC-SHA256(secret, "<t>.<raw body>"). Binding the timestamp into the MAC and rejecting stale timestamps stops a
 * captured request from being replayed later; the comparison runs in constant time. The body must be the exact bytes received.
 */
export function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

export function header(secret: string, timestamp: number, body: string): string {
  return `t=${timestamp},v1=${sign(secret, timestamp, body)}`;
}

export function valid(headerValue: string | undefined, body: string | undefined, secret: string, nowMs: number, toleranceSeconds: number): boolean {
  if (!headerValue || body === undefined) return false;
  let t: number | null = null;
  let v1: string | null = null;
  for (const part of headerValue.split(',')) {
    const p = part.trim();
    if (p.startsWith('t=')) {
      if (!/^\d+$/.test(p.slice(2))) return false;
      t = Number(p.slice(2));
    } else if (p.startsWith('v1=')) {
      v1 = p.slice(3);
    }
  }
  if (t === null || v1 === null) return false;
  if (Math.abs(Math.floor(nowMs / 1000) - t) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, t, body), 'utf8');
  const given = Buffer.from(v1, 'utf8');
  return expected.length === given.length && timingSafeEqual(expected, given);
}
