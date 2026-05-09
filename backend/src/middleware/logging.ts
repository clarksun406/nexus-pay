import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = uuidv4();
  const startTime = Date.now();

  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-Id', requestId);

  const originalJson = res.json.bind(res);
  let responseBody: any;

  res.json = function (body: any) {
    responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    const duration = Date.now() - startTime;

    // Skip logging for health checks and static files
    if (req.path === '/health' || req.path.startsWith('/actuator')) return;

    // Log to database (fire and forget)
    db('gateway_logs').insert({
      merchant_id: req.apiKey?.merchantId || null,
      api_key_id: req.apiKey?.keyId || null,
      request_id: requestId,
      type: 'API_CALL',
      method: req.method,
      path: req.path,
      request_headers: JSON.stringify({
        'content-type': req.headers['content-type'],
        'user-agent': req.headers['user-agent'],
      }),
      request_body: req.method !== 'GET' ? JSON.stringify(req.body).slice(0, 10000) : null,
      response_status: res.statusCode,
      duration_ms: duration,
      trace_id: requestId,
    }).catch(() => {}); // Ignore logging errors
  });

  next();
}
