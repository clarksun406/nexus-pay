import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import db from '../db/connection';
import { config } from '../config';
import { paymentIntentService } from '../services/payment-intent.service';

/**
 * Inbound provider webhooks (e.g. Stripe).
 *
 * Mounted BEFORE the global JSON body parser so we can access the raw request
 * body required for signature verification. Each handler:
 *   1. verifies the provider signature,
 *   2. deduplicates via `processed_webhook_events`,
 *   3. reconciles the matching PaymentIntent/Refund,
 *   4. emits an outbox event so the merchant's own webhooks fire.
 */
const router = Router();

// Default Stripe webhook tolerance: 5 minutes.
const SIGNATURE_TOLERANCE_SECONDS = 300;

function verifyStripeSignature(
  rawBody: Buffer,
  sigHeader: string | undefined,
  secret: string,
): { valid: boolean; reason?: string } {
  if (!secret) return { valid: false, reason: 'Webhook secret not configured' };
  if (!sigHeader) return { valid: false, reason: 'Missing signature header' };

  const parts = sigHeader.split(',').reduce((acc: Record<string, string>, part) => {
    const idx = part.indexOf('=');
    if (idx > 0) acc[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    return acc;
  }, {});

  const timestamp = parts['t'];
  const v1 = parts['v1'];
  if (!timestamp || !v1) return { valid: false, reason: 'Malformed signature header' };

  // Replay protection.
  const age = Math.abs(Math.floor(Date.now() / 1000) - parseInt(timestamp, 10));
  if (Number.isNaN(age) || age > SIGNATURE_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'Signature timestamp outside tolerance' };
  }

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

  try {
    const expectedBuf = Buffer.from(expected);
    const providedBuf = Buffer.from(v1);
    if (expectedBuf.length !== providedBuf.length) return { valid: false, reason: 'Signature mismatch' };
    if (!crypto.timingSafeEqual(expectedBuf, providedBuf)) return { valid: false, reason: 'Signature mismatch' };
  } catch {
    return { valid: false, reason: 'Signature comparison failed' };
  }

  return { valid: true };
}

/** Update a PaymentIntent's status (if changed) and queue a merchant webhook event. */
async function reconcileIntentStatus(providerPaymentId: string, newStatus: string, eventType: string) {
  if (!providerPaymentId) return;
  const intent = await db('payment_intents').where({ provider_payment_id: providerPaymentId }).first();
  if (!intent || intent.status === newStatus) return;

  const [updated] = await db('payment_intents')
    .where({ id: intent.id })
    .update({ status: newStatus })
    .returning('*');

  await db('outbox_events').insert({
    merchant_id: updated.merchant_id,
    event_type: eventType,
    resource_id: updated.id,
    payload: JSON.stringify(paymentIntentService.toResponse(updated)),
  });
}

async function handleStripeEvent(event: any): Promise<void> {
  const obj = event?.data?.object || {};
  switch (event.type) {
    case 'payment_intent.succeeded':
      await reconcileIntentStatus(obj.id, 'SUCCEEDED', 'payment_intent.succeeded');
      break;
    case 'payment_intent.payment_failed':
      await reconcileIntentStatus(obj.id, 'FAILED', 'payment_intent.failed');
      break;
    case 'payment_intent.canceled':
      await reconcileIntentStatus(obj.id, 'CANCELED', 'payment_intent.canceled');
      break;
    case 'payment_intent.amount_capturable_updated':
      await reconcileIntentStatus(obj.id, 'REQUIRES_CAPTURE', 'payment_intent.requires_capture');
      break;
    case 'charge.refund.updated':
    case 'refund.updated': {
      // obj is a refund object.
      if (obj.id) {
        const status = obj.status === 'succeeded' ? 'SUCCEEDED' : obj.status === 'failed' ? 'FAILED' : 'PENDING';
        await db('refunds').where({ provider_refund_id: obj.id }).update({ status });
      }
      break;
    }
    default:
      // Unhandled event types are acknowledged but ignored.
      break;
  }
}

// POST /webhooks/stripe
router.post('/stripe', express.raw({ type: '*/*' }), async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const sigHeader = req.headers['stripe-signature'] as string | undefined;

  const verification = verifyStripeSignature(rawBody, sigHeader, config.stripe.webhookSecret);
  if (!verification.valid) {
    return res.status(400).json({ title: 'Invalid signature', detail: verification.reason });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ title: 'Invalid payload', detail: 'Body is not valid JSON' });
  }

  if (!event?.id) {
    return res.status(400).json({ title: 'Invalid payload', detail: 'Missing event id' });
  }

  // Idempotency: skip events we have already processed.
  const existing = await db('processed_webhook_events').where({ event_id: event.id }).first();
  if (existing) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
    await db('processed_webhook_events').insert({ event_id: event.id }).onConflict('event_id').ignore();
    return res.json({ received: true });
  } catch (err: any) {
    console.error('[stripe-webhook] processing error:', err);
    // Return 500 so Stripe retries delivery.
    return res.status(500).json({ title: 'Processing error', detail: err.message });
  }
});

export default router;
