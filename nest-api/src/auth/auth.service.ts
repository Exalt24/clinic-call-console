import { HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hashSync } from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { Role } from '../common/security';

export interface Session {
  token: string;
  username: string;
  displayName: string;
  role: Role;
  expiresAt: string;
}

interface DemoUser {
  username: string;
  displayName: string;
  role: Role;
  hash: string;
}

/** Sliding-window lockout per username, in memory and per instance (a multi-instance deployment would keep it in Redis). */
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  isLocked(username: string): boolean {
    return this.prune(username).length >= this.maxFailures;
  }

  recordFailure(username: string): void {
    const q = this.prune(username);
    q.push(this.now());
    this.failures.set(this.key(username), q);
  }

  reset(username: string): void {
    this.failures.delete(this.key(username));
  }

  private prune(username: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const q = (this.failures.get(this.key(username)) ?? []).filter((t) => t >= cutoff);
    this.failures.set(this.key(username), q);
    return q;
  }

  private key(username: string): string {
    return (username ?? '').trim().toLowerCase();
  }
}

@Injectable()
export class AuthService {
  private readonly users: Map<string, DemoUser>;
  // a real bcrypt hash of a throwaway value, compared against when the username is unknown, so a missing account costs
  // the same as a wrong password
  private readonly dummyHash = hashSync(randomUUID(), 10);
  private readonly throttle: LoginThrottle;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {
    this.users = new Map(
      [
        { username: 'reviewer@demo.test', displayName: 'Riley Reviewer', role: 'REVIEWER' as Role, hash: hashSync(cfg.reviewerPassword, 10) },
        { username: 'admin@demo.test', displayName: 'Avery Admin', role: 'ADMIN' as Role, hash: hashSync(cfg.adminPassword, 10) },
      ].map((u) => [u.username, u]),
    );
    this.throttle = new LoginThrottle(cfg.loginMaxFailures, cfg.loginWindowMinutes * 60_000);
  }

  async login(rawUsername: string, password: string): Promise<Session> {
    const username = rawUsername.trim().toLowerCase();
    if (this.throttle.isLocked(username)) {
      // Refused before the password is checked, so a lockout cannot be used to guess the password.
      throw new HttpException('Too many failed attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    const user = this.users.get(username);
    const ok = await compare(password, user?.hash ?? this.dummyHash);
    if (!user || !ok) {
      this.throttle.recordFailure(username);
      await this.audit.recordAlone(username, 'NONE', 'LOGIN_FAILED', null, 'bad credentials');
      // The same message for an unknown user and a wrong password, so the response does not reveal which accounts exist.
      throw new UnauthorizedException('Wrong email or password');
    }
    this.throttle.reset(username);
    const ttlSeconds = this.cfg.jwtTtlMinutes * 60;
    const token = this.jwt.sign({ role: user.role, name: user.displayName }, { subject: user.username, expiresIn: ttlSeconds });
    const { exp } = this.jwt.decode<{ exp: number }>(token);
    await this.audit.recordAlone(user.username, user.role, 'LOGIN', null, 'signed in');
    return { token, username: user.username, displayName: user.displayName, role: user.role, expiresAt: new Date(exp * 1000).toISOString() };
  }
}
