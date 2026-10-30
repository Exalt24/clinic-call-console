import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { STATUS_CODES } from 'node:http';

/** Raised by the validation pipe so the filter can tell a failed validation from any other 400. */
export class ValidationFailedException extends BadRequestException {
  constructor(public readonly messages: string[]) {
    super('Validation failed');
  }
}

/**
 * One error shape for the whole API (RFC 9457 problem details, the same as the Spring Boot API), so the Angular client
 * handles every failure the same way and no stack trace, SQL text or internal class name ever reaches a response body.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('errors');

  catch(ex: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let detail = 'An unexpected error occurred';
    let title: string | undefined;

    if (ex instanceof ValidationFailedException) {
      status = 400;
      title = 'Validation failed';
      detail = [...ex.messages].sort().join('; ') || 'Invalid request';
    } else if (ex instanceof HttpException) {
      status = ex.getStatus();
      const body = ex.getResponse();
      const msg = typeof body === 'string' ? body : (body as { message?: unknown }).message;
      // a framework 400 (a malformed id, an unreadable body) says nothing a client can use beyond "could not be read"
      detail = status === 400 ? 'The request could not be read' : typeof msg === 'string' ? msg : STATUS_CODES[status] ?? 'Error';
    } else if (isHttpError(ex)) {
      // body-parser failures (malformed JSON, payload too large) are plain errors that carry a status
      status = ex.status >= 400 && ex.status < 500 ? ex.status : 400;
      detail = 'The request could not be read';
    } else {
      // the error NAME only: its message may hold SQL text or a value from a call
      this.log.error(`unhandled ${ex instanceof Error ? ex.name : typeof ex}`);
    }

    res
      .status(status)
      .type('application/problem+json')
      .json({ type: 'about:blank', title: title ?? STATUS_CODES[status] ?? 'Error', status, detail });
  }
}

function isHttpError(ex: unknown): ex is { status: number } {
  return typeof ex === 'object' && ex !== null && typeof (ex as { status?: unknown }).status === 'number';
}
