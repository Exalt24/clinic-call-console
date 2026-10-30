import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Public } from './common/security';

/** The Angular login page asks this endpoint whether a sleeping free-tier server has woken up, so the path matches the Spring API's. */
@Controller('actuator')
export class HealthController {
  constructor(private readonly ds: DataSource) {}

  @Public()
  @Get('health')
  async health() {
    try {
      await this.ds.query('SELECT 1');
      return { status: 'UP' };
    } catch {
      throw new HttpException({ status: 'DOWN' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
