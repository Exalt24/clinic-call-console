import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';

export type Role = 'REVIEWER' | 'ADMIN';

/** The signed-in user, rebuilt from the token on every request. */
export interface Principal {
  username: string;
  role: Role;
  name: string;
}

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

/** Opts one route out of the default-deny guard: login, the signed webhook and the health check. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts one route to the listed roles. A route without it is open to any signed-in user. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export function principalOf(req: { user?: Principal }): Principal {
  if (!req.user) throw new UnauthorizedException('Sign in required');
  return req.user;
}

/** Default deny: every route needs a valid, unexpired HS256 token unless it is marked @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('Sign in required');
    try {
      const claims = this.jwt.verify(header.slice(7).trim(), { algorithms: ['HS256'] });
      if (claims.role !== 'REVIEWER' && claims.role !== 'ADMIN') throw new Error('unknown role');
      req.user = { username: claims.sub, role: claims.role, name: claims.name ?? claims.sub } satisfies Principal;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}

/** Role check, kept apart from authentication so a missing @Roles() on a route is the only way it opens up. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const wanted = this.reflector.getAllAndOverride<Role[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!wanted || wanted.length === 0) return true;
    const user: Principal | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !wanted.includes(user.role)) throw new ForbiddenException('You do not have permission to do that');
    return true;
  }
}
