import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';
import { ApiProblem } from './problem';

interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  type(t: string): HttpResponseLike;
  send(body: unknown): void;
  headersSent?: boolean;
}

const slug = (code: string) => code.toLowerCase().replace(/_/g, '-');

/** Renders every error as RFC 9457 problem details; never leaks stack traces, SQL or other tenants' ids. */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly log = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<HttpResponseLike>();
    const req = host.switchToHttp().getRequest<{ url?: string; requestId?: string }>();
    const problem = this.toProblem(exception);
    if (problem.status >= 500)
      this.log.error(
        `${req.requestId ?? '-'} ${req.url ?? ''}: ${(exception as Error)?.stack ?? String(exception)}`,
      );
    if (res.headersSent) return;
    res
      .status(problem.status)
      .type('application/problem+json')
      .send({
        type: `urn:budgetflow:problem:${slug(problem.code)}`,
        title: problem.code
          .replace(/_/g, ' ')
          .toLowerCase()
          .replace(/^\w/, (c) => c.toUpperCase()),
        status: problem.status,
        code: problem.code,
        detail: problem.detail,
        ...(req.url ? { instance: req.url.split('?')[0] } : {}),
        ...(problem.params ? { params: problem.params } : {}),
        ...(problem.errors ? { errors: problem.errors } : {}),
      });
  }

  private toProblem(e: unknown): ApiProblem {
    if (e instanceof ApiProblem) return e;
    if (e instanceof ZodError) {
      return new ApiProblem(
        400,
        'VALIDATION_FAILED',
        'Some fields are missing or invalid.',
        undefined,
        e.issues.map((i) => ({ path: i.path.join('.') || '(body)', message: i.message })),
      );
    }
    const pgCode = (e as { code?: string })?.code;
    if (pgCode === 'BF001')
      return new ApiProblem(
        409,
        'CONFLICT',
        'Ledger and audit records are append-only; post a reversal instead.',
      );
    if (pgCode === 'BF002')
      return new ApiProblem(409, 'PERIOD_CLOSED', 'That accounting period is closed.');
    if (pgCode === 'BF003')
      return new ApiProblem(422, 'JOURNAL_UNBALANCED', 'Debits and credits must be equal.');
    if (pgCode === '22P02')
      return new ApiProblem(
        400,
        'VALIDATION_FAILED',
        'An identifier or value has the wrong format.',
      );
    if (e instanceof HttpException) {
      const status = e.getStatus();
      if (status === 404) return new ApiProblem(404, 'NOT_FOUND', 'No such endpoint.');
      if (status === 401) return new ApiProblem(401, 'UNAUTHENTICATED', 'Sign in again.');
      if (status === 403)
        return new ApiProblem(403, 'FORBIDDEN', 'You do not have permission to do this.');
      if (status === 413 || status === 400)
        return new ApiProblem(400, 'VALIDATION_FAILED', 'The request body could not be read.');
      return new ApiProblem(status, 'INTERNAL_ERROR', 'Something went wrong.');
    }
    return new ApiProblem(500, 'INTERNAL_ERROR', 'Something went wrong. The error was logged.');
  }
}
