import {
  ExceptionFilter,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

interface HttpExceptionHost {
  switchToHttp(): {
    getResponse(): Pick<FastifyReply, 'header' | 'send' | 'status'>;
    getRequest(): Pick<FastifyRequest, 'method' | 'url'>;
  };
}

const DATABASE_UNAVAILABLE_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);
const DATABASE_UNAVAILABLE_PATTERNS = [
  /SQLSTATE:?\s*(?:08\w{3}|57P0[123])/i,
  /PostgresError \{ code: "(?:08\w{3}|57P0[123])"/i,
  /database system is (?:shutting down|starting up)/i,
  /terminating connection due to administrator command/i,
  /server has closed the connection/i,
  /connection (?:reset|terminated|closed)/i,
];

function isDatabaseUnavailable(exception: unknown): boolean {
  if (!exception || typeof exception !== 'object') return false;
  const candidate = exception as {
    code?: unknown;
    errorCode?: unknown;
    message?: unknown;
    name?: unknown;
  };
  const code = typeof candidate.code === 'string' ? candidate.code : candidate.errorCode;
  const message = typeof candidate.message === 'string' ? candidate.message : '';
  return (
    (typeof code === 'string' && DATABASE_UNAVAILABLE_CODES.has(code)) ||
    candidate.name === 'PrismaClientInitializationError' ||
    (candidate.name === 'PrismaClientUnknownRequestError' &&
      DATABASE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message)))
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: HttpExceptionHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse();
    const request = ctx.getRequest();

    const databaseUnavailable = isDatabaseUnavailable(exception);
    const status = databaseUnavailable
      ? HttpStatus.SERVICE_UNAVAILABLE
      : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = databaseUnavailable
      ? { statusCode: status, message: 'Service temporarily unavailable' }
      : exception instanceof HttpException
        ? exception.getResponse()
        : 'Internal server error';

    if (status === HttpStatus.SERVICE_UNAVAILABLE) {
      this.logger.warn(`Request unavailable on ${request.method} ${request.url}`);
      reply.header('retry-after', '1');
    } else if (status >= 500) {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    void reply
      .status(status)
      .send(typeof message === 'string' ? { statusCode: status, message } : message);
  }
}
