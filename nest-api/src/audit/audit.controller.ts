import { Controller, Get, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional } from 'class-validator';
import { Roles } from '../common/security';
import { AuditService } from './audit.service';

export class AuditPageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a whole number' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'size must be a whole number' })
  size?: number;
}

@Controller('api/audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  /** The audit trail itself is admin-only: reviewers must not be able to read who looked at what. */
  @Get()
  @Roles('ADMIN')
  list(@Query() q: AuditPageQuery) {
    return this.audit.page(q.page ?? 0, q.size ?? 20);
  }
}
