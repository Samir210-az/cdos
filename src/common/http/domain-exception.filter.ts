import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';

/**
 * Faz 3.15 bənd V: Service-layer error-larını (hər domain-in öz *Error class-ı,
 * hamısında ortaq ".code" sahəsi var) uyğun HTTP status-a map edir.
 * Sensitiv məlumat (stack trace, DB xəta detalları) response-a çıxmır.
 */
const CODE_TO_STATUS: Record<string, number> = {
  ACCESS_DENIED: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID: HttpStatus.BAD_REQUEST,
  VALIDATION_ERROR: HttpStatus.UNPROCESSABLE_ENTITY,
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  USER_SUSPENDED: HttpStatus.FORBIDDEN,
  NO_ACTIVE_MEMBERSHIP: HttpStatus.FORBIDDEN,
  TOKEN_REUSE_DETECTED: HttpStatus.UNAUTHORIZED,
  INVALID_REFRESH_TOKEN: HttpStatus.UNAUTHORIZED,
  INVALID_DSL: HttpStatus.UNPROCESSABLE_ENTITY,
  INSUFFICIENT_CONTEXT: HttpStatus.UNPROCESSABLE_ENTITY,
  OUTPUT_VALIDATION_FAILED: HttpStatus.UNPROCESSABLE_ENTITY,
  PROVIDER_TIMEOUT: HttpStatus.BAD_GATEWAY,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PROVIDER_ERROR: HttpStatus.BAD_GATEWAY,
  CHILD_MISMATCH: HttpStatus.UNPROCESSABLE_ENTITY,
};

// Postgres error code -> HTTP status (constraint pozuntuları üçün, xam DB xətası deyil)
const PG_CODE_TO_STATUS: Record<string, number> = {
  '23505': HttpStatus.CONFLICT, // unique_violation
  '23503': HttpStatus.UNPROCESSABLE_ENTITY, // foreign_key_violation
  '23514': HttpStatus.UNPROCESSABLE_ENTITY, // check_violation
  '42501': HttpStatus.FORBIDDEN, // insufficient_privilege (RLS/REVOKE)
  P0001: HttpStatus.UNPROCESSABLE_ENTITY, // plpgsql RAISE EXCEPTION (mövcud trigger-lərin integrity mesajları)
};

@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest();
    // Faz 3.18 bənd 6: request correlation — error response-da da eyni ID.
    const requestId: string | undefined = req?.requestId;

    if (exception instanceof HttpException) {
      res.status(exception.getStatus()).json({ error: exception.message, requestId });
      return;
    }

    const err = exception as { code?: string; message?: string };
    if (err?.code && CODE_TO_STATUS[err.code]) {
      res.status(CODE_TO_STATUS[err.code]).json({ error: err.message ?? err.code, code: err.code, requestId });
      return;
    }

    const pgErr = exception as { code?: string; message?: string };
    if (pgErr?.code && PG_CODE_TO_STATUS[pgErr.code]) {
      // DB constraint pozuntusu — xam Postgres mesajı DEYİL, ümumi, təhlükəsiz mesaj
      res.status(PG_CODE_TO_STATUS[pgErr.code]).json({ error: 'Sorğu mövcud data integrity qaydalarını pozur.', requestId });
      return;
    }

    // gerçəkdən gözlənilməyən xəta — heç bir daxili detal ötürülmür
    // eslint-disable-next-line no-console
    console.error('Unhandled exception:', requestId ? `[${requestId}]` : '', exception);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: 'Daxili server xətası.', requestId });
  }
}
