import { ArgumentsHost, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProblemDetailsFilter, ValidationFailedException } from './problem-details.filter';

function run(ex: unknown) {
  const out: { status?: number; type?: string; body?: any } = {};
  const res = {
    status(s: number) {
      out.status = s;
      return res;
    },
    type(t: string) {
      out.type = t;
      return res;
    },
    json(b: unknown) {
      out.body = b;
      return res;
    },
  };
  const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
  new ProblemDetailsFilter().catch(ex, host);
  return out;
}

describe('problem details filter', () => {
  it('turns a validation failure into a sorted 400 detail', () => {
    const o = run(new ValidationFailedException(['b is wrong', 'a is wrong']));
    expect(o.status).toBe(400);
    expect(o.type).toBe('application/problem+json');
    expect(o.body).toEqual({ type: 'about:blank', title: 'Validation failed', status: 400, detail: 'a is wrong; b is wrong' });
  });

  it('keeps the message of a 404 and a 403', () => {
    expect(run(new NotFoundException('Call not found')).body.detail).toBe('Call not found');
    expect(run(new ForbiddenException('You do not have permission to do that')).body).toMatchObject({ status: 403, title: 'Forbidden' });
  });

  it('never leaks the text of an unexpected error', () => {
    const o = run(new Error('relation "call_record" does not exist at /srv/app/calls.service.ts:88'));
    expect(o.status).toBe(500);
    expect(JSON.stringify(o.body)).not.toMatch(/call_record|srv|\.ts/);
    expect(o.body).toEqual({ type: 'about:blank', title: 'Internal Server Error', status: 500, detail: 'An unexpected error occurred' });
  });

  it('answers a body-parser style error with a 400 and no parser text', () => {
    const o = run(Object.assign(new SyntaxError('Unexpected token } in JSON at position 9'), { status: 400 }));
    expect(o.status).toBe(400);
    expect(o.body.detail).toBe('The request could not be read');
  });
});
