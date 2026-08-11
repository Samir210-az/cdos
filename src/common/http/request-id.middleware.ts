import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';

/**
 * Faz 3.18 bənd 6: request correlation. Gələn "X-Request-ID" varsa istifadə
 * olunur, yoxdursa server tərəfindən UUID generasiya edilir. Response
 * header-ə əks olunur ki, client öz sorğusunu audit_logs.request_id ilə
 * uyğunlaşdıra bilsin (mövcud audit sahəsi, YENİ EVENT UYDURULMUR).
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
    (req as any).requestId = requestId;
    res.setHeader('X-Request-ID', requestId);
    next();
  }
}
