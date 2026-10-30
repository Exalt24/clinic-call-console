import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, Public, Roles, RolesGuard } from './security';

const SECRET = 'unit-test-secret-that-is-at-least-32-bytes-long';
const jwt = new JwtService({ secret: SECRET });

class Handlers {
  open() {}
  @Public() pub() {}
  @Roles('ADMIN') adminOnly() {}
  @Roles('ADMIN', 'REVIEWER') either() {}
}

function ctx(handler: () => void, req: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const guard = new JwtAuthGuard(jwt, new Reflector());
  const h = new Handlers();
  const token = (claims: object, opts: object = { expiresIn: 600 }) => jwt.sign(claims, { subject: 'admin@demo.test', ...opts });

  it('lets a public route through with no token', () => {
    expect(guard.canActivate(ctx(h.pub, { headers: {} }))).toBe(true);
  });

  it('refuses a missing header, a wrong scheme and an empty token', () => {
    for (const authorization of [undefined, 'Basic abc', 'Bearer ']) {
      expect(() => guard.canActivate(ctx(h.open, { headers: { authorization } }))).toThrow(UnauthorizedException);
    }
  });

  it('accepts a valid token and puts the principal on the request', () => {
    const req: Record<string, any> = { headers: { authorization: `Bearer ${token({ role: 'ADMIN', name: 'Avery' })}` } };
    expect(guard.canActivate(ctx(h.open, req))).toBe(true);
    expect(req.user).toEqual({ username: 'admin@demo.test', role: 'ADMIN', name: 'Avery' });
  });

  it('refuses an expired token, another secret, an unknown role and an unsigned token', () => {
    const expired = jwt.sign({ role: 'ADMIN', exp: Math.floor(Date.now() / 1000) - 10 }, { subject: 'a' });
    const other = new JwtService({ secret: 'another-secret-that-is-also-32-bytes-long!!' }).sign({ role: 'ADMIN' }, { subject: 'a' });
    const odd = token({ role: 'ROOT' });
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from('{"role":"ADMIN"}').toString('base64url')}.`;
    for (const t of [expired, other, odd, none]) {
      expect(() => guard.canActivate(ctx(h.open, { headers: { authorization: `Bearer ${t}` } }))).toThrow(UnauthorizedException);
    }
  });
});

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const h = new Handlers();

  it('lets any signed-in user through a route with no @Roles', () => {
    expect(guard.canActivate(ctx(h.open, { user: { role: 'REVIEWER' } }))).toBe(true);
  });

  it('lets the named role through and refuses the other with 403', () => {
    expect(guard.canActivate(ctx(h.adminOnly, { user: { role: 'ADMIN' } }))).toBe(true);
    expect(() => guard.canActivate(ctx(h.adminOnly, { user: { role: 'REVIEWER' } }))).toThrow(ForbiddenException);
  });

  it('refuses a request that carries no user at all', () => {
    expect(() => guard.canActivate(ctx(h.adminOnly, {}))).toThrow(ForbiddenException);
  });

  it('accepts either of several roles', () => {
    expect(guard.canActivate(ctx(h.either, { user: { role: 'REVIEWER' } }))).toBe(true);
  });
});
