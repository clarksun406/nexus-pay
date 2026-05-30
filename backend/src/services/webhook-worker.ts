import db from '../db/connection';
import { webhookService } from './webhook.service';

/**
 * Webhook delivery engine.
 *
 * Two cooperating loops implement the transactional-outbox pattern:
 *   1. fanout()  — drains unprocessed `outbox_events`, materialises a
 *                  `gateway_events` row per event and a `webhook_deliveries`
 *                  row per subscribed endpoint, then marks the outbox row done.
 *   2. deliver() — picks due deliveries (PENDING + next_retry_at <= now),
 *                  HMAC-signs the payload, POSTs it, and records the result,
 *                  scheduling an exponential backoff retry on failure.
 */

const FANOUT_INTERVAL_MS = 5000;
const DELIVERY_INTERVAL_MS = 5000;
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 6;
const DELIVERY_TIMEOUT_MS = 10000;
// Backoff (seconds) indexed by attempt number: 1m, 5m, 30m, 2h, 6h (then capped).
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600];

class WebhookWorker {
  private fanoutTimer?: NodeJS.Timeout;
  private deliveryTimer?: NodeJS.Timeout;
  private fanoutRunning = false;
  private deliveryRunning = false;

  start(): void {
    if (this.fanoutTimer || this.deliveryTimer) return;
    this.fanoutTimer = setInterval(() => this.safeFanout(), FANOUT_INTERVAL_MS);
    this.deliveryTimer = setInterval(() => this.safeDeliver(), DELIVERY_INTERVAL_MS);
    if (this.fanoutTimer.unref) this.fanoutTimer.unref();
    if (this.deliveryTimer.unref) this.deliveryTimer.unref();
    // Kick off an initial pass shortly after boot.
    setTimeout(() => this.safeFanout(), 1000);
    setTimeout(() => this.safeDeliver(), 1500);
    console.log('[webhook-worker] started');
  }

  stop(): void {
    if (this.fanoutTimer) clearInterval(this.fanoutTimer);
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.fanoutTimer = undefined;
    this.deliveryTimer = undefined;
  }

  private async safeFanout(): Promise<void> {
    if (this.fanoutRunning) return;
    this.fanoutRunning = true;
    try {
      await this.fanout();
    } catch (err) {
      console.error('[webhook-worker] fanout error:', err);
    } finally {
      this.fanoutRunning = false;
    }
  }

  private async safeDeliver(): Promise<void> {
    if (this.deliveryRunning) return;
    this.deliveryRunning = true;
    try {
      await this.deliver();
    } catch (err) {
      console.error('[webhook-worker] deliver error:', err);
    } finally {
      this.deliveryRunning = false;
    }
  }

  /** Turn unprocessed outbox events into gateway events + queued deliveries. */
  async fanout(): Promise<void> {
    const events = await db('outbox_events')
      .where({ processed: false })
      .orderBy('created_at', 'asc')
      .limit(BATCH_SIZE);

    for (const ev of events) {
      await db.transaction(async (trx) => {
        const [gatewayEvent] = await trx('gateway_events')
          .insert({
            merchant_id: ev.merchant_id,
            event_type: ev.event_type,
            resource_id: ev.resource_id,
            payload: ev.payload,
          })
          .returning('*');

        const endpoints = await trx('webhook_endpoints')
          .where({ merchant_id: ev.merchant_id, status: 'ACTIVE' });

        for (const endpoint of endpoints) {
          const subscribed = (endpoint.subscribed_events || '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
          if (subscribed.length > 0 && !subscribed.includes(ev.event_type)) continue;

          await trx('webhook_deliveries').insert({
            gateway_event_id: gatewayEvent.id,
            webhook_endpoint_id: endpoint.id,
            status: 'PENDING',
            attempt_count: 0,
            next_retry_at: new Date(),
          });
        }

        await trx('outbox_events').where({ id: ev.id }).update({ processed: true });
      });
    }
  }

  /** Attempt all deliveries that are due. */
  async deliver(): Promise<void> {
    const now = new Date();
    const due = await db('webhook_deliveries')
      .where('status', 'PENDING')
      .andWhere((qb) => {
        qb.whereNull('next_retry_at').orWhere('next_retry_at', '<=', now);
      })
      .orderBy('created_at', 'asc')
      .limit(BATCH_SIZE);

    for (const delivery of due) {
      const event = await db('gateway_events').where({ id: delivery.gateway_event_id }).first();
      const endpoint = await db('webhook_endpoints').where({ id: delivery.webhook_endpoint_id }).first();

      if (!event || !endpoint) {
        await db('webhook_deliveries').where({ id: delivery.id }).update({
          status: 'FAILED',
          response_body: 'Associated event or endpoint no longer exists',
          last_attempted_at: now,
          next_retry_at: null,
        });
        continue;
      }

      if (endpoint.status !== 'ACTIVE') {
        await db('webhook_deliveries').where({ id: delivery.id }).update({
          status: 'FAILED',
          response_body: 'Endpoint is not active',
          last_attempted_at: now,
          next_retry_at: null,
        });
        continue;
      }

      const attempt = (delivery.attempt_count || 0) + 1;
      const result = await this.send(endpoint, event);

      if (result.ok) {
        await db('webhook_deliveries').where({ id: delivery.id }).update({
          status: 'SUCCESS',
          http_status: result.status ?? null,
          response_body: (result.body || '').slice(0, 2000),
          attempt_count: attempt,
          last_attempted_at: now,
          next_retry_at: null,
        });
      } else {
        const exhausted = attempt >= MAX_ATTEMPTS;
        const backoff = BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)];
        await db('webhook_deliveries').where({ id: delivery.id }).update({
          status: exhausted ? 'FAILED' : 'PENDING',
          http_status: result.status ?? null,
          response_body: (result.body || result.error || '').slice(0, 2000),
          attempt_count: attempt,
          last_attempted_at: now,
          next_retry_at: exhausted ? null : new Date(Date.now() + backoff * 1000),
        });
      }
    }
  }

  private async send(
    endpoint: any,
    event: any,
  ): Promise<{ ok: boolean; status?: number; body?: string; error?: string }> {
    const payload: string = event.payload; // already a JSON string
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = webhookService.signPayload(`${timestamp}.${payload}`, endpoint.signing_secret);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'NexusPay-Webhook/1.0',
          'X-NexusPay-Event': event.event_type,
          'X-NexusPay-Event-Id': event.id,
          'X-NexusPay-Signature': `t=${timestamp},v1=${signature}`,
        },
        body: payload,
        signal: controller.signal,
      });
      const body = await res.text().catch(() => '');
      return { ok: res.ok, status: res.status, body };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Request failed' };
    } finally {
      clearTimeout(timer);
    }
  }
}

export const webhookWorker = new WebhookWorker();
