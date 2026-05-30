import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';
import { scrubToJson } from '../utils/scrub';

/**
 * Logs every API request to `gateway_logs`, with sensitive data scrubbed
 * (see utils/scrub). Health/actuator endpoints and inbound webhook bodies
 * are skipped to keep the log table focused.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = uuidv4();
  const startTime = Date.now();

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Skip logging for health checks, metrics, and inbound provider webhooks
    // (the latter are signed payloads from Stripe/Square/Braintree and we
    // shouldn't store their raw bodies).
    if (
      req.path === '/health' ||
      req.path.startsWith('/actuator') ||
      req.path.startsWith('/webhooks')
    ) return;

    // Scrub headers down to a safe allowlist; explicitly DO NOT include
    // Authorization, Cookie, or any signature header.
    const safeHeaders = {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent'],
      'x-request-id': requestId,
    };

    const requestBody = req.method === 'GET' ? null : scrubToJson(req.body);

    db('gateway_logs').insert({
      merchant_id: req.apiKey?.merchantId || null,
      api_key_id: req.apiKey?.keyId || null,
      request_id: requestId,
      type: 'API_CALL',
      method: req.method,
      path: req.path,
      request_headers: JSON.stringify(safeHeaders),
      // Hard cap to avoid unbounded log rows even after scrubbing.
      request_body: requestBody ? requestBody.slice(0, 4000) : null,
      response_status: res.statusCode,
      duration_ms: duration,
      trace_id: requestId,
    }).catch(() => {}); // Ignore logging errors
  });

  next();
}
