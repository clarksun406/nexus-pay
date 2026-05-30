import { Request, Response, NextFunction } from 'express';

/**
 * Lightweight in-memory token-bucket rate limiter.
 *
 * Buckets are keyed by an arbitrary string (typically API key id, user id, or
 * client IP). Each bucket refills `capacity` tokens per `windowMs` linearly.
 *
 * Notes & trade-offs:
 *   - In-memory only: not consistent across multiple instances. For a single-
 *     instance deployment this is fine; multi-instance deployments should
 *     replace the underlying store with Redis.
 *   - Old buckets are pruned opportunistically every 5 minutes.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface RateLimitOptions {
  /** Max requests allowed within `windowMs`. */
  capacity: number;
  /** Window over which the bucket fully refills, in milliseconds. */
  windowMs: number;
  /** Per-request key extractor; defaults to client IP. */
  keyGenerator?: (req: Request) => string;
  /** Optional bucket-name prefix for scoping (e.g. "auth", "api"). */
  scope?: string;
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 5 * 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  for (const [k, b] of buckets) {
    if (now - b.updatedAt > 30 * 60_000) buckets.delete(k);
  }
  lastSweep = now;
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length) return xff.split(',')[0]!.trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}

export function rateLimit(opts: RateLimitOptions) {
  const { capacity, windowMs, scope = 'default' } = opts;
  const refillPerMs = capacity / windowMs;
  const keyGen = opts.keyGenerator || clientIp;

  return function rateLimiter(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    sweep(now);

    const id = keyGen(req);
    const key = `${scope}:${id}`;
    const bucket = buckets.get(key);

    let tokens: number;
    if (!bucket) {
      tokens = capacity;
    } else {
      const elapsed = now - bucket.updatedAt;
      tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    }

    if (tokens < 1) {
      const retryMs = Math.ceil((1 - tokens) / refillPerMs);
      res.setHeader('Retry-After', Math.ceil(retryMs / 1000));
      res.setHeader('X-RateLimit-Limit', capacity);
      res.setHeader('X-RateLimit-Remaining', 0);
      buckets.set(key, { tokens, updatedAt: now });
      return res.status(429).json({
        title: 'Too Many Requests',
        detail: 'Rate limit exceeded. Please retry later.',
      });
    }

    tokens -= 1;
    buckets.set(key, { tokens, updatedAt: now });
    res.setHeader('X-RateLimit-Limit', capacity);
    res.setHeader('X-RateLimit-Remaining', Math.floor(tokens));
    next();
  };
}

/** Per-API-key limiter (falls back to IP if no API key was attached). */
export function apiKeyRateLimit(capacity: number, windowMs: number) {
  return rateLimit({
    scope: 'api',
    capacity,
    windowMs,
    keyGenerator: (req) => req.apiKey?.keyId || `ip:${clientIp(req)}`,
  });
}

/** Per-IP limiter for /auth and /pub endpoints. */
export function ipRateLimit(scope: string, capacity: number, windowMs: number) {
  return rateLimit({ scope, capacity, windowMs });
}

/** Internal helper for tests. */
export function _resetForTests() {
  buckets.clear();
  lastSweep = Date.now();
}
