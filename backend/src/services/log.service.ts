import db from '../db/connection';

export class LogService {
  async list(merchantId: string, page = 0, size = 50, type?: string) {
    let query = db('gateway_logs').where({ merchant_id: merchantId });
    if (type) query = query.where({ type });

    const [{ count }] = await query.clone().count();
    const content = await query
      .orderBy('created_at', 'desc')
      .limit(size)
      .offset(page * size);

    return {
      content: content.map((l: any) => this.toResponse(l)),
      totalElements: parseInt(count as string),
      page,
      size,
    };
  }

  async get(merchantId: string, logId: string) {
    const log = await db('gateway_logs').where({ id: logId, merchant_id: merchantId }).first();
    if (!log) throw Object.assign(new Error('Log not found'), { status: 404 });
    return this.toResponse(log);
  }

  async create(data: any) {
    const [log] = await db('gateway_logs').insert(data).returning('*');
    return log;
  }

  private toResponse(log: any) {
    return {
      id: log.id,
      merchantId: log.merchant_id,
      apiKeyId: log.api_key_id,
      requestId: log.request_id,
      type: log.type,
      method: log.method,
      path: log.path,
      requestHeaders: log.request_headers,
      requestBody: log.request_body,
      responseStatus: log.response_status,
      responseBody: log.response_body,
      durationMs: log.duration_ms,
      traceId: log.trace_id,
      createdAt: log.created_at,
    };
  }
}

export const logService = new LogService();
