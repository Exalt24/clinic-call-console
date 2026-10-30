/**
 * Settings come from the environment. The defaults are DEMO VALUES so the project runs after a fresh clone, the same way
 * the Spring Boot API does; with NODE_ENV=production a missing secret stops the boot instead of falling back.
 */
export interface AppConfig {
  databaseUrl: string;
  port: number;
  jwtSecret: string;
  jwtTtlMinutes: number;
  fieldKey: string;
  webhookSecret: string;
  webhookToleranceSeconds: number;
  corsOrigins: string[];
  reviewerPassword: string;
  adminPassword: string;
  seedEnabled: boolean;
  seedCount: number;
  loginMaxFailures: number;
  loginWindowMinutes: number;
}

const DEMO: Record<string, string> = {
  DATABASE_URL: 'postgres://clinic:clinic@localhost:55442/clinic_nest',
  JWT_SECRET: 'demo-only-signing-secret-change-me-0123456789abcdef',
  FIELD_KEY: 'ZGVtby1vbmx5LWZpZWxkLWtleS0zMi1ieXRlcyEhISE=',
  WEBHOOK_SECRET: 'demo-only-webhook-secret-change-me',
  CORS_ORIGINS: 'http://localhost:4200,http://127.0.0.1:4200',
  REVIEWER_PASSWORD: 'reviewer-demo-pass',
  ADMIN_PASSWORD: 'admin-demo-pass',
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prod = env.NODE_ENV === 'production';
  const need = (name: string): string => {
    const v = env[name];
    if (v && v.length > 0) return v;
    if (prod) throw new Error(`${name} must be set when NODE_ENV=production`);
    return DEMO[name];
  };
  const jwtSecret = need('JWT_SECRET');
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32) throw new Error('JWT_SECRET must be at least 32 bytes for HS256');
  return {
    databaseUrl: need('DATABASE_URL'),
    port: Number(env.PORT ?? 3100),
    jwtSecret,
    jwtTtlMinutes: Number(env.JWT_TTL_MINUTES ?? 30),
    fieldKey: need('FIELD_KEY'),
    webhookSecret: need('WEBHOOK_SECRET'),
    webhookToleranceSeconds: 300,
    corsOrigins: need('CORS_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean),
    reviewerPassword: need('REVIEWER_PASSWORD'),
    adminPassword: need('ADMIN_PASSWORD'),
    seedEnabled: (env.SEED ?? 'true') !== 'false',
    seedCount: Number(env.SEED_COUNT ?? 36),
    loginMaxFailures: Number(env.LOGIN_MAX_FAILURES ?? 5),
    loginWindowMinutes: Number(env.LOGIN_WINDOW_MINUTES ?? 10),
  };
}

/** Injection token for the loaded settings. */
export const APP_CONFIG = Symbol('APP_CONFIG');
