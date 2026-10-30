import { Controller, Headers, HttpStatus, Inject, Post, RawBodyRequest, Req, Res, UnauthorizedException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request, Response } from 'express';
import { ValidationFailedException } from '../common/problem-details.filter';
import { Public } from '../common/security';
import { APP_CONFIG, AppConfig } from '../config/config';
import { IngestDto } from '../calls/calls.dto';
import { CallsService } from '../calls/calls.service';
import { valid } from './webhook-signature';

/**
 * The voice platform's webhook. It is not behind a user token; it authenticates by HMAC signature over the raw body, so
 * the signature is verified FIRST and only then is the payload validated.
 */
@Controller('api/ingest')
export class IngestController {
  constructor(
    private readonly calls: CallsService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Public()
  @Post('calls')
  async ingest(
    @Headers('x-signature') signature: string | undefined,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = req.rawBody?.toString('utf8');
    if (!valid(signature, raw, this.cfg.webhookSecret, Date.now(), this.cfg.webhookToleranceSeconds)) {
      // One message for every failure (missing, malformed, stale, wrong): no hint about which check failed.
      throw new UnauthorizedException('Invalid webhook signature');
    }
    const dto = plainToInstance(IngestDto, req.body);
    const problems = validateSync(dto, { whitelist: true });
    if (problems.length > 0) {
      const msgs = problems.flatMap((p) => Object.values(p.constraints ?? { [p.property]: `${p.property} is invalid` }));
      throw new ValidationFailedException(msgs);
    }
    const out = await this.calls.ingest(dto);
    res.status(out.duplicate ? HttpStatus.OK : HttpStatus.CREATED);
    return out;
  }
}
