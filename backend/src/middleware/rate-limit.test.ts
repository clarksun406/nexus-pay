import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, _resetForTests } from './rate-limit';

function mockReq(ip = '1.2.3.4'): any {
  return {
    ip,
    headers: {},
    socket: { remoteAddress: ip },
  };
}

function mockRes() {
  const headers: Record<string, any> = {};
  let statusCode = 200;
  let body: any = null;
  return {
    headers,
    setHeader(k: string, v: any) { headers[k.toLowerCase()] = v; },
    status(c: number) { statusCode = c; return this; },
    json(b: any) { body = b; return this; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  } as any;
}

describe('rateLimit', () => {
  beforeEach(() => _resetForTests());

  it('allows requests up to the bucket capacity', () => {
    const limiter = rateLimit({ scope: 't1', capacity: 3, windowMs: 60_000 });
    let calledNext = 0;
    const next = () => { calledNext += 1; };

    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      limiter(mockReq(), res, next);
      expect(res.statusCode).toBe(200);
    }
    expect(calledNext).toBe(3);
  });

  it('rejects requests over the capacity with 429', () => {
    const limiter = rateLimit({ scope: 't2', capacity: 2, windowMs: 60_000 });
    const next = () => {};

    limiter(mockReq(), mockRes(), next);
    limiter(mockReq(), mockRes(), next);

    const res = mockRes();
    limiter(mockReq(), res, next);
    expect(res.statusCode).toBe(429);
    expect(res.body.title).toBe('Too Many Requests');
    expect(res.headers['retry-after']).toBeDefined();
  });

  it('isolates buckets by key', () => {
    const limiter = rateLimit({ scope: 't3', capacity: 1, windowMs: 60_000 });
    const next = () => {};

    const ra = mockRes();
    limiter(mockReq('10.0.0.1'), ra, next);
    expect(ra.statusCode).toBe(200);

    const rb = mockRes();
    limiter(mockReq('10.0.0.2'), rb, next);
    expect(rb.statusCode).toBe(200);

    const rc = mockRes();
    limiter(mockReq('10.0.0.1'), rc, next);
    expect(rc.statusCode).toBe(429);
  });

  it('refills the bucket as time passes', async () => {
    const limiter = rateLimit({ scope: 't4', capacity: 1, windowMs: 50 });
    const next = () => {};

    const r1 = mockRes();
    limiter(mockReq(), r1, next);
    expect(r1.statusCode).toBe(200);

    const r2 = mockRes();
    limiter(mockReq(), r2, next);
    expect(r2.statusCode).toBe(429);

    await new Promise((r) => setTimeout(r, 70));

    const r3 = mockRes();
    limiter(mockReq(), r3, next);
    expect(r3.statusCode).toBe(200);
  });

  it('uses a custom keyGenerator when provided', () => {
    const limiter = rateLimit({
      scope: 't5',
      capacity: 1,
      windowMs: 60_000,
      keyGenerator: (req: any) => req.headers['x-tenant'] as string,
    });
    const next = () => {};
    const reqA = { ...mockReq(), headers: { 'x-tenant': 'A' } };
    const reqB = { ...mockReq(), headers: { 'x-tenant': 'B' } };

    const ra = mockRes();
    limiter(reqA, ra, next);
    expect(ra.statusCode).toBe(200);

    const rb = mockRes();
    limiter(reqB, rb, next);
    expect(rb.statusCode).toBe(200);

    const ra2 = mockRes();
    limiter(reqA, ra2, next);
    expect(ra2.statusCode).toBe(429);
  });
});
