import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import db from '../db/connection';
import { config } from '../config';
import { paymentIntentService } from '../services/payment-intent.service';
import { disputeService } from '../services/dispute.service';
import { verifyStripeSignature } from '../utils/stripe-signature';
import { verifySquareSignature } from '../utils/square-signature';
import { verifyBraintreeSignature, extractBraintreeKind } from '../utils/braintree-signature';
import { decrypt } from '../utils/crypto';

/**
 * Inbound provider webhooks (Stripe / Square / Braintree).
 *
 * Mounted BEFORE the global JSON body parser so we can access the raw request
 * body required for signature verification. Each handler:
 *   1. verifies the provider signature (per-provider scheme),
 *   2. deduplicates via `processed_webhook_events`,
 *   3. reconciles the matching PaymentIntent / Refund / Dispute,
 *   4. emits an outbox event so the merchant's own webhooks fire.
 */
const router = Router();

// ── Shared helpers ──────────────────────────────────────────────────────────

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

async function alreadyProcessed(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const existing = await db('processed_webhook_events').where({ event_id: eventId }).first();
  return !!existing;
}

async function markProcessed(eventId: string): Promise<void> {
  if (!eventId) return;
  await db('processed_webhook_events').insert({ event_id: eventId }).onConflict('event_id').ignore();
}

function loadAccountCreds(account: any): any {
  if (!account) return {};
  if (account.encrypted_credentials) {
    try { return JSON.parse(decrypt(account.encrypted_credentials)); } catch { return {}; }
  }
  return {};
}

// ── Stripe ──────────────────────────────────────────────────────────────────

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
      if (obj.id) {
        const status = obj.status === 'succeeded' ? 'SUCCEEDED' : obj.status === 'failed' ? 'FAILED' : 'PENDING';
        await db('refunds').where({ provider_refund_id: obj.id }).update({ status });
      }
      break;
    }
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.funds_withdrawn':
    case 'charge.dispute.funds_reinstated':
    case 'charge.dispute.closed':
      await disputeService.upsertFromStripe(obj, event.type);
      break;
    default:
      break;
  }
}

router.post('/stripe', express.raw({ type: '*/*' }), async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const sigHeader = req.headers['stripe-signature'] as string | undefined;

  const verification = verifyStripeSignature(rawBody, sigHeader, config.stripe.webhookSecret);
  if (!verification.valid) {
    return res.status(400).json({ title: 'Invalid signature', detail: verification.reason });
  }

  let event: any;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ title: 'Invalid payload', detail: 'Body is not valid JSON' }); }

  if (!event?.id) {
    return res.status(400).json({ title: 'Invalid payload', detail: 'Missing event id' });
  }
  if (await alreadyProcessed(`stripe:${event.id}`)) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    await handleStripeEvent(event);
    await markProcessed(`stripe:${event.id}`);
    return res.json({ received: true });
  } catch (err: any) {
    console.error('[stripe-webhook] processing error:', err);
    return res.status(500).json({ title: 'Processing error', detail: err.message });
  }
});

// ── Square ──────────────────────────────────────────────────────────────────

function mapSquareDisputeState(state: string | undefined): string {
  switch ((state || '').toUpperCase()) {
    case 'INQUIRY_EVIDENCE_REQUIRED':
    case 'EVIDENCE_REQUIRED': return 'OPEN';
    case 'PROCESSING':
    case 'INQUIRY_PROCESSING': return 'UNDER_REVIEW';
    case 'WON':
    case 'INQUIRY_CLOSED': return 'WON';
    case 'LOST': return 'LOST';
    case 'ACCEPTED': return 'CHARGE_REFUNDED';
    default: return 'OPEN';
  }
}

async function handleSquareEvent(event: any): Promise<void> {
  const obj = event?.data?.object || {};
  switch (event.type) {
    case 'payment.updated': {
      const payment = obj.payment;
      if (!payment?.id) break;
      const status = payment.status as string; // APPROVED | COMPLETED | CANCELED | FAILED
      if (status === 'COMPLETED') await reconcileIntentStatus(payment.id, 'SUCCEEDED', 'payment_intent.succeeded');
      else if (status === 'CANCELED') await reconcileIntentStatus(payment.id, 'CANCELED', 'payment_intent.canceled');
      else if (status === 'FAILED') await reconcileIntentStatus(payment.id, 'FAILED', 'payment_intent.failed');
      else if (status === 'APPROVED') await reconcileIntentStatus(payment.id, 'REQUIRES_CAPTURE', 'payment_intent.requires_capture');
      break;
    }
    case 'refund.updated': {
      const refund = obj.refund;
      if (!refund?.id) break;
      const status = refund.status as string; // PENDING | COMPLETED | REJECTED | FAILED
      const internal = status === 'COMPLETED' ? 'SUCCEEDED' : status === 'FAILED' || status === 'REJECTED' ? 'FAILED' : 'PENDING';
      await db('refunds').where({ provider_refund_id: refund.id }).update({ status: internal });
      break;
    }
    case 'dispute.created':
    case 'dispute.state.updated':
    case 'dispute.evidence.created': {
      const dispute = obj.dispute;
      if (!dispute?.id) break;
      const sqPaymentId = dispute.disputed_payment?.payment_id || dispute.payment_id;
      const intent = sqPaymentId
        ? await db('payment_intents').where({ provider_payment_id: sqPaymentId }).first()
        : null;
      if (!intent) break;
      await disputeService.upsertGeneric({
        provider: 'SQUARE',
        providerDisputeId: dispute.id,
        intent,
        merchantId: intent.merchant_id,
        mode: intent.mode,
        amount: dispute.amount_money?.amount ?? intent.amount,
        currency: dispute.amount_money?.currency ?? intent.currency,
        reason: dispute.reason,
        status: mapSquareDisputeState(dispute.state),
        evidenceDueBy: dispute.due_at ?? null,
        payload: dispute,
        eventType: event.type,
      });
      break;
    }
    default:
      break;
  }
}

router.post('/square', express.raw({ type: '*/*' }), async (req: Request, res: Response) => {
  const rawBody: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  const sigHeader = req.headers['x-square-hmacsha256-signature'] as string | undefined;

  // The Square webhook URL is configured per-connector in
  // provider_config.webhookNotificationUrl (default: PAY_BASE_URL + '/webhooks/square').
  // Each connector also stores its webhookSignatureKey in encrypted_credentials.
  // Try every active Square connector until one verifies the signature.
  const accounts = await db('provider_accounts')
    .where({ provider: 'SQUARE', status: 'ACTIVE' });

  let matched: any = null;
  for (const account of accounts) {
    const creds = loadAccountCreds(account);
    if (!creds.webhookSignatureKey) continue;
    let providerCfg: any = {};
    try { providerCfg = account.provider_config ? JSON.parse(account.provider_config) : {}; } catch {}
    const notificationUrl = providerCfg.webhookNotificationUrl || `${config.payBaseUrl}/webhooks/square`;
    const ok = verifySquareSignature(notificationUrl, rawBody, sigHeader, creds.webhookSignatureKey);
    if (ok.valid) { matched = account; break; }
  }
  if (!matched) {
    return res.status(400).json({ title: 'Invalid signature', detail: 'No Square connector verified this signature' });
  }

  let event: any;
  try { event = JSON.parse(rawBody.toString('utf8')); }
  catch { return res.status(400).json({ title: 'Invalid payload', detail: 'Body is not valid JSON' }); }

  const eventId = event?.event_id;
  if (!eventId) {
    return res.status(400).json({ title: 'Invalid payload', detail: 'Missing event_id' });
  }
  if (await alreadyProcessed(`square:${eventId}`)) {
    return res.json({ received: true, duplicate: true });
  }

  try {
    await handleSquareEvent(event);
    await markProcessed(`square:${eventId}`);
    return res.json({ received: true });
  } catch (err: any) {
    console.error('[square-webhook] processing error:', err);
    return res.status(500).json({ title: 'Processing error', detail: err.message });
  }
});

// ── Braintree ───────────────────────────────────────────────────────────────

function mapBraintreeKindToInternal(kind: string): { type: 'intent' | 'dispute' | 'unknown'; status?: string; eventType?: string } {
  switch (kind) {
    case 'transaction_settled': return { type: 'intent', status: 'SUCCEEDED', eventType: 'payment_intent.succeeded' };
    case 'transaction_settlement_declined': return { type: 'intent', status: 'FAILED', eventType: 'payment_intent.failed' };
    case 'dispute_opened': return { type: 'dispute', status: 'OPEN' };
    case 'dispute_lost': return { type: 'dispute', status: 'LOST' };
    case 'dispute_won': return { type: 'dispute', status: 'WON' };
    case 'dispute_under_review': return { type: 'dispute', status: 'UNDER_REVIEW' };
    case 'dispute_accepted': return { type: 'dispute', status: 'CHARGE_REFUNDED' };
    default: return { type: 'unknown' };
  }
}

/** Best-effort tag extractor (no XML parser needed for the few fields we use). */
function tagValue(xml: string, tag: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}>([^<]*)<\\/${tag}>`));
  return m ? m[1].trim() : undefined;
}

async function handleBraintreeNotification(xml: string, account: any): Promise<void> {
  const kind = extractBraintreeKind(xml);
  const mapped = mapBraintreeKindToInternal(kind);
  if (mapped.type === 'unknown') return;

  if (mapped.type === 'intent') {
    const txId = tagValue(xml, 'id'); // first <id> usually belongs to the transaction
    if (!txId) return;
    await reconcileIntentStatus(txId, mapped.status!, mapped.eventType!);
    return;
  }

  // dispute
  const disputeId = tagValue(xml, 'id');
  const txId = tagValue(xml, 'transaction-id') || tagValue(xml, 'transactionId');
  const amount = tagValue(xml, 'amount');
  const currency = tagValue(xml, 'currency-iso-code') || tagValue(xml, 'currencyIsoCode') || 'USD';
  const reason = tagValue(xml, 'reason');
  const replyBy = tagValue(xml, 'reply-by-date') || tagValue(xml, 'replyByDate');

  if (!disputeId) return;

  const intent = txId
    ? await db('payment_intents').where({ provider_payment_id: txId }).first()
    : null;
  if (!intent) return;

  await disputeService.upsertGeneric({
    provider: 'BRAINTREE',
    providerDisputeId: disputeId,
    intent,
    merchantId: intent.merchant_id,
    mode: intent.mode,
    amount: amount ? Math.round(parseFloat(amount) * 100) : intent.amount,
    currency,
    reason,
    status: mapped.status!,
    evidenceDueBy: replyBy ? new Date(replyBy).toISOString() : null,
    payload: { kind, xml: xml.slice(0, 4000) },
    eventType: kind,
  });
}

// Braintree's webhook URL verification: the gateway makes a GET with a
// `bt_challenge` query param and expects back `<publicKey>|<sigHex>` where
// sig = HMAC-SHA1(SHA1(privateKey), bt_challenge).hex. We try every active
// Braintree connector's keys and respond with the first match.
router.get('/braintree', async (req: Request, res: Response) => {
  const challenge = (req.query?.bt_challenge as string | undefined) || '';
  if (!challenge) {
    return res.status(400).type('text/plain').send('missing bt_challenge');
  }

  const accounts = await db('provider_accounts')
    .where({ provider: 'BRAINTREE', status: 'ACTIVE' });

  for (const account of accounts) {
    const creds = loadAccountCreds(account);
    if (!creds.publicKey || !creds.privateKey) continue;
    const hashedKey = crypto.createHash('sha1').update(creds.privateKey).digest();
    const sig = crypto.createHmac('sha1', hashedKey).update(challenge).digest('hex');
    return res.type('text/plain').send(`${creds.publicKey}|${sig}`);
  }

  return res.status(404).type('text/plain').send('no Braintree connector configured');
});

router.post(
  '/braintree',
  express.urlencoded({ extended: false, limit: '512kb' }),
  async (req: Request, res: Response) => {
    const btSignature = req.body?.bt_signature as string | undefined;
    const btPayload = req.body?.bt_payload as string | undefined;

    // Build a publicKey -> privateKey map from all active Braintree connectors.
    const accounts = await db('provider_accounts')
      .where({ provider: 'BRAINTREE', status: 'ACTIVE' });
    const keyring: Record<string, string> = {};
    const accountByPub: Record<string, any> = {};
    for (const a of accounts) {
      const creds = loadAccountCreds(a);
      if (creds.publicKey && creds.privateKey) {
        keyring[creds.publicKey] = creds.privateKey;
        accountByPub[creds.publicKey] = a;
      }
    }

    const verified = verifyBraintreeSignature(btSignature, btPayload, keyring);
    if (!verified.valid) {
      return res.status(400).json({ title: 'Invalid signature', detail: verified.reason });
    }

    let xml: string;
    try {
      xml = Buffer.from(btPayload!, 'base64').toString('utf8');
    } catch {
      return res.status(400).json({ title: 'Invalid payload', detail: 'bt_payload is not valid base64' });
    }

    // Braintree notifications include a <timestamp> but no stable event id;
    // we synthesise one from publicKey + sha256(xml) for idempotency.
    const eventId = `braintree:${verified.matchedPublicKey}:${crypto.createHash('sha256').update(xml).digest('hex').slice(0, 32)}`;

    if (await alreadyProcessed(eventId)) {
      return res.json({ received: true, duplicate: true });
    }

    try {
      await handleBraintreeNotification(xml, accountByPub[verified.matchedPublicKey!]);
      await markProcessed(eventId);
      return res.json({ received: true });
    } catch (err: any) {
      console.error('[braintree-webhook] processing error:', err);
      return res.status(500).json({ title: 'Processing error', detail: err.message });
    }
  },
);

export default router;
