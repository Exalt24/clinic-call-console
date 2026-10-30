import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE = /^[A-Za-z0-9._-]{8,64}$/;
const access = new Logger('access');

/**
 * Observability without PHI: a correlation id (taken from X-Request-Id when it is a safe value, else generated) echoed in
 * the response, the security headers the Spring API sends, and one access line with method, path, status and duration.
 * Request and response bodies and the query string are never logged, because they can carry names and transcripts.
 */
export function requestHygiene(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  const id = incoming && SAFE.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - start) / 1_000_000n);
    access.log(`${req.method} ${req.path} -> ${res.statusCode} in ${ms} ms`);
  });
  next();
}
