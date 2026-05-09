import crypto from 'crypto';
import db from '../db/connection';

export class WebhookService {
  async createEndpoint(merchantId: string, body: any) {
    const signingSecret = `whsec_${crypto.randomBytes(24).toString('hex')}`;

    const [endpoint] = await db('webhook_endpoints').insert({
      merchant_id: merchantId,
      url: body.url,
      signing_secret: signingSecret,
      description: body.description,
      subscribed_events: body.subscribedEvents?.join(',') || 'payment_intent.succeeded,payment_intent.failed,payment_intent.canceled',
      status: 'ACTIVE',
    }).returning('*');

    return this.toResponse(endpoint);
  }

  async listEndpoints(merchantId: string) {
    const endpoints = await db('webhook_endpoints')
      .where({ merchant_id: merchantId })
      .orderBy('created_at', 'desc');
    return endpoints.map((e: any) => this.toResponse(e));
  }

  async getEndpoint(merchantId: string, endpointId: string) {
    const endpoint = await db('webhook_endpoints')
      .where({ id: endpointId, merchant_id: merchantId })
      .first();
    if (!endpoint) throw Object.assign(new Error('Webhook endpoint not found'), { status: 404 });
    return this.toResponse(endpoint);
  }

  async updateEndpoint(merchantId: string, endpointId: string, body: any) {
    const endpoint = await db('webhook_endpoints')
      .where({ id: endpointId, merchant_id: merchantId })
      .first();
    if (!endpoint) throw Object.assign(new Error('Webhook endpoint not found'), { status: 404 });

    const updates: any = {};
    if (body.url) updates.url = body.url;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status) updates.status = body.status;
    if (body.subscribedEvents) updates.subscribed_events = body.subscribedEvents.join(',');

    const [updated] = await db('webhook_endpoints').where({ id: endpointId }).update(updates).returning('*');
    return this.toResponse(updated);
  }

  async deleteEndpoint(merchantId: string, endpointId: string) {
    await db('webhook_endpoints').where({ id: endpointId, merchant_id: merchantId }).delete();
  }

  async listDeliveries(merchantId: string, endpointId?: string) {
    let query = db('webhook_deliveries')
      .join('webhook_endpoints', 'webhook_endpoints.id', 'webhook_deliveries.webhook_endpoint_id')
      .where('webhook_endpoints.merchant_id', merchantId);

    if (endpointId) query = query.where('webhook_deliveries.webhook_endpoint_id', endpointId);

    const deliveries = await query
      .select('webhook_deliveries.*')
      .orderBy('webhook_deliveries.created_at', 'desc')
      .limit(100);

    return deliveries.map((d: any) => ({
      id: d.id,
      gatewayEventId: d.gateway_event_id,
      webhookEndpointId: d.webhook_endpoint_id,
      status: d.status,
      httpStatus: d.http_status,
      responseBody: d.response_body,
      attemptCount: d.attempt_count,
      nextRetryAt: d.next_retry_at,
      lastAttemptedAt: d.last_attempted_at,
      createdAt: d.created_at,
    }));
  }

  signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  private toResponse(endpoint: any) {
    return {
      id: endpoint.id,
      merchantId: endpoint.merchant_id,
      url: endpoint.url,
      description: endpoint.description,
      status: endpoint.status,
      subscribedEvents: endpoint.subscribed_events?.split(',') || [],
      signingSecret: endpoint.signing_secret,
      createdAt: endpoint.created_at,
      updatedAt: endpoint.updated_at,
    };
  }
}

export const webhookService = new WebhookService();
