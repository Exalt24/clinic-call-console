import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { Principal, Roles, principalOf } from '../common/security';
import { ListCallsQuery, RevealDto, StatusDto } from './calls.dto';
import { CallsService } from './calls.service';

type Authed = { user?: Principal };

@Controller('api/calls')
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @Get()
  list(@Query() q: ListCallsQuery) {
    return this.calls.page(q.status, q.q, q.page ?? 0, q.size ?? 12);
  }

  /** Protected-detail responses must never be cached by a browser, a proxy or a CDN. */
  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id', ParseUUIDPipe) id: string, @Req() req: Authed) {
    const p = principalOf(req);
    return this.calls.detail(id, p.username, p.role);
  }

  @Patch(':id/status')
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: StatusDto, @Req() req: Authed) {
    const p = principalOf(req);
    return this.calls.changeStatus(id, body.status, p.username, p.role);
  }

  /** ADMIN only, enforced here and again by a test that proves a REVIEWER gets 403. */
  @Post(':id/reveal')
  @Roles('ADMIN')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  reveal(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevealDto, @Req() req: Authed) {
    const p = principalOf(req);
    return this.calls.reveal(id, body.reason, p.username, p.role);
  }
}
