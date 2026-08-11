import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../http/public.decorator';
import { getAppPool } from '../db/pool';

/**
 * Faz 3.18 bənd 8: minimal LIVENESS/READINESS. Heç bir biznes məlumatı
 * qaytarmır, authorization tələb etmir (deployment infrastrukturu üçün
 * standart tələb — health check-lər adətən auth-suz olur).
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  /** LIVENESS — proses işləyir? (DB-dən asılı deyil) */
  @Public()
  @Get('health/live')
  liveness() {
    return { status: 'ok' };
  }

  /** READINESS — tətbiq DB ilə real işləyə bilir? */
  @Public()
  @Get('health/ready')
  async readiness(@Res() res: Response) {
    try {
      await getAppPool().query('SELECT 1');
      res.status(HttpStatus.OK).json({ status: 'ready' });
    } catch {
      // Xam DB xətası HEÇ VAXT client-ə çıxmır — yalnız ümumi "not ready".
      res.status(HttpStatus.SERVICE_UNAVAILABLE).json({ status: 'not_ready' });
    }
  }
}
