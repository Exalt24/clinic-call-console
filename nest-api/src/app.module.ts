import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as pg from 'pg';
import { AuditController } from './audit/audit.controller';
import { AuditEvent } from './audit/audit-event.entity';
import { AuditService } from './audit/audit.service';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { CallRecord } from './calls/call-record.entity';
import { CallsController } from './calls/calls.controller';
import { CallsService } from './calls/calls.service';
import { JwtAuthGuard, RolesGuard } from './common/security';
import { APP_CONFIG, AppConfig } from './config/config';
import { HealthController } from './health.controller';
import { IngestController } from './ingest/ingest.controller';
import { Schema1761800000000 } from './migrations/1761800000000-Schema';
import { DemoDataSeeder } from './seed/demo-data-seeder';

export const MIGRATIONS = [Schema1761800000000];
export const ENTITIES = [CallRecord, AuditEvent];

@Module({})
export class AppModule {
  static register(cfg: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          driver: pg, // handed over explicitly so the driver resolves the same way under node, ts-node and jest
          retryAttempts: 5,
          retryDelay: 1000,
          url: cfg.databaseUrl,
          entities: ENTITIES,
          migrations: MIGRATIONS,
          migrationsRun: true,
          synchronize: false,
        }),
        JwtModule.register({ secret: cfg.jwtSecret, signOptions: { algorithm: 'HS256' } }),
      ],
      controllers: [AuthController, CallsController, AuditController, IngestController, HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: cfg },
        AuthService,
        AuditService,
        CallsService,
        DemoDataSeeder,
        // order matters: authenticate first, then check the role the token carries
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    };
  }
}
