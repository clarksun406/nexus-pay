import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';
import { routingEngine } from './routing-engine';
import { providerDispatcher } from './provider-dispatcher';

export class PaymentIntentService {
  async create(merchantId: string, mode: string, body: any) {
    // Idempotency check
    const existing = await db('payment_intents')
      .where({ merchant_id: merchantId, idempotency_key: body.idempotencyKey })
      .first();
    if (existing) return this.toResponse(existing);

    const [intent] = await db('payment_intents').insert({
      merchant_id: merchantId,
      mode,
      amount: body.amount,
      currency: body.currency.toUpperCase(),
      status: 'REQUIRES_PAYMENT_METHOD',
      capture_method: body.captureMethod || 'AUTOMATIC',
      idempotency_key: body.idempotencyKey,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      order_id: body.orderId,
      description: body.description,
      billing_details: body.billingDetails ? JSON.stringify(body.billingDetails) : null,
      shipping_details: body.shippingDetails ? JSON.stringify(body.shippingDetails) : null,
      success_url: body.successUrl,
      cancel_url: body.cancelUrl,
      failure_url: body.failureUrl,
    }).returning('*');

    return this.toResponse(intent);
  }

  async get(merchantId: string, intentId: string) {
    const intent = await db('payment_intents')
      .where({ id: intentId, merchant_id: merchantId })
      .first();
    if (!intent) throw Object.assign(new Error('PaymentIntent not found'), { status: 404 });
    return this.toResponse(intent);
  }

  async list(merchantId: string, mode?: string, page = 0, size = 20) {
    let query = db('payment_intents').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const [{ count }] = await query.clone().count();
    const content = await query
      .orderBy('created_at', 'desc')
      .limit(size)
      .offset(page * size);

    return {
      content: content.map((i: any) => this.toResponse(i)),
      totalElements: parseInt(count as string),
      page,
      size,
    };
  }

  async confirm(merchantId: string, intentId: string, body: any, mode: string) {
    const intent = await db('payment_intents')
      .where({ id: intentId, merchant_id: merchantId })
      .first();
    if (!intent) throw Object.assign(new Error('PaymentIntent not found'), { status: 404 });

    if (intent.status !== 'REQUIRES_PAYMENT_METHOD' && intent.status !== 'REQUIRES_CONFIRMATION') {
      throw Object.assign(new Error(`Cannot confirm in status: ${intent.status}`), { status: 400 });
    }

    let provider: string;
    let providerAccountId: string;
    let rawPmId: string;

    if (body.paymentMethodId?.startsWith('gw_tok_')) {
      // Token-based flow
      const token = await db('payment_tokens')
        .where({ id: body.paymentMethodId.replace('gw_tok_', '') })
        .whereNull('used_at')
        .first();
      if (!token) throw Object.assign(new Error('Invalid or expired token'), { status: 400 });
      if (token.merchant_id !== merchantId) throw Object.assign(new Error('Token does not belong to this merchant'), { status: 403 });

      provider = token.provider;
      providerAccountId = token.account_id;
      rawPmId = token.provider_pm_id;

      await db('payment_tokens').where({ id: token.id }).update({ used_at: new Date() });
    } else {
      // Routing-based flow
      const routing = await routingEngine.resolve(merchantId, intent.amount, intent.currency, null, body.paymentMethodType || 'card')
        || { primary: await routingEngine.resolveAnyAccount(merchantId, mode), fallback: null };

      if (!routing.primary) {
        throw Object.assign(new Error('No active payment connector configured'), { status: 400 });
      }

      provider = routing.primary.provider;
      providerAccountId = routing.primary.id;
      rawPmId = body.paymentMethodId;
    }

    // Mark as processing
    await db('payment_intents').where({ id: intentId }).update({
      status: 'PROCESSING',
      resolved_provider: provider,
      connector_account_id: providerAccountId,
      payment_method_type: body.paymentMethodType || 'card',
    });

    // Create payment request attempt
    const [attempt] = await db('payment_requests').insert({
      payment_intent_id: intentId,
      amount: intent.amount,
      currency: intent.currency,
      payment_method_type: body.paymentMethodType || 'card',
      connector_account_id: providerAccountId,
      status: 'PENDING',
    }).returning('*');

    // Call provider
    try {
      const result = await providerDispatcher.charge(provider, {
        intentId,
        amount: intent.amount,
        currency: intent.currency,
        paymentMethodType: body.paymentMethodType || 'card',
        paymentMethodId: rawPmId,
        idempotencyKey: `pi-${intentId}-${attempt.id}`,
        captureMethod: intent.capture_method,
      }, providerAccountId);

      // Customer authentication required (e.g. 3DS): stop here and surface the action URL.
      if (result.requiresAction) {
        await db('payment_requests').where({ id: attempt.id }).update({
          status: 'PENDING',
          provider_request_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
        });

        const [updated] = await db('payment_intents').where({ id: intentId }).update({
          status: 'REQUIRES_ACTION',
          provider_payment_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
          three_ds_action_url: result.actionUrl || null,
        }).returning('*');

        await db('outbox_events').insert({
          merchant_id: merchantId,
          event_type: 'payment_intent.requires_action',
          resource_id: intentId,
          payload: JSON.stringify(this.toResponse(updated)),
        });

        return this.toResponse(updated);
      }

      // Async processing: leave as PROCESSING; the final state arrives via webhook.
      if (result.pending) {
        await db('payment_requests').where({ id: attempt.id }).update({
          status: 'PENDING',
          provider_request_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
        });

        const [updated] = await db('payment_intents').where({ id: intentId }).update({
          status: 'PROCESSING',
          provider_payment_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
        }).returning('*');

        return this.toResponse(updated);
      }

      // Update attempt
      await db('payment_requests').where({ id: attempt.id }).update({
        status: result.success ? 'SUCCEEDED' : 'FAILED',
        provider_request_id: result.providerPaymentId,
        provider_response: result.providerResponseJson,
        failure_code: result.failureCode,
        failure_message: result.failureMessage,
      });

      // Update intent
      const manualCapture = intent.capture_method === 'MANUAL';
      const finalStatus = result.success
        ? (manualCapture ? 'REQUIRES_CAPTURE' : 'SUCCEEDED')
        : 'FAILED';

      const [updated] = await db('payment_intents').where({ id: intentId }).update({
        status: finalStatus,
        provider_payment_id: result.providerPaymentId,
        provider_response: result.providerResponseJson,
      }).returning('*');

      // Write outbox event
      const eventType = result.success
        ? (manualCapture ? 'payment_intent.requires_capture' : 'payment_intent.succeeded')
        : 'payment_intent.failed';

      await db('outbox_events').insert({
        merchant_id: merchantId,
        event_type: eventType,
        resource_id: intentId,
        payload: JSON.stringify(this.toResponse(updated)),
      });

      return this.toResponse(updated);
    } catch (err: any) {
      await db('payment_intents').where({ id: intentId }).update({ status: 'FAILED' });
      await db('payment_requests').where({ id: attempt.id }).update({
        status: 'FAILED',
        failure_code: 'PROVIDER_ERROR',
        failure_message: err.message,
      });
      throw err;
    }
  }

  async capture(merchantId: string, intentId: string) {
    const intent = await db('payment_intents')
      .where({ id: intentId, merchant_id: merchantId })
      .first();
    if (!intent) throw Object.assign(new Error('PaymentIntent not found'), { status: 404 });
    if (intent.status !== 'REQUIRES_CAPTURE') {
      throw Object.assign(new Error(`Cannot capture in status: ${intent.status}`), { status: 400 });
    }

    const captured = await providerDispatcher.capture(
      intent.resolved_provider,
      intent.provider_payment_id,
      intent.connector_account_id,
    );

    const [updated] = await db('payment_intents').where({ id: intentId }).update({
      status: captured ? 'SUCCEEDED' : 'FAILED',
    }).returning('*');

    await db('outbox_events').insert({
      merchant_id: merchantId,
      event_type: captured ? 'payment_intent.succeeded' : 'payment_intent.failed',
      resource_id: intentId,
      payload: JSON.stringify(this.toResponse(updated)),
    });

    return this.toResponse(updated);
  }

  async cancel(merchantId: string, intentId: string) {
    const intent = await db('payment_intents')
      .where({ id: intentId, merchant_id: merchantId })
      .first();
    if (!intent) throw Object.assign(new Error('PaymentIntent not found'), { status: 404 });

    const cancelable = ['REQUIRES_PAYMENT_METHOD', 'REQUIRES_CONFIRMATION', 'REQUIRES_CAPTURE', 'REQUIRES_ACTION'];
    if (!cancelable.includes(intent.status)) {
      throw Object.assign(new Error(`Cannot cancel in status: ${intent.status}`), { status: 400 });
    }

    const [updated] = await db('payment_intents').where({ id: intentId }).update({
      status: 'CANCELED',
    }).returning('*');

    await db('outbox_events').insert({
      merchant_id: merchantId,
      event_type: 'payment_intent.canceled',
      resource_id: intentId,
      payload: JSON.stringify(this.toResponse(updated)),
    });

    return this.toResponse(updated);
  }

  toResponse(intent: any) {
    return {
      id: intent.id,
      merchantId: intent.merchant_id,
      mode: intent.mode,
      amount: intent.amount,
      currency: intent.currency,
      status: intent.status,
      captureMethod: intent.capture_method,
      idempotencyKey: intent.idempotency_key,
      resolvedProvider: intent.resolved_provider,
      providerPaymentId: intent.provider_payment_id,
      paymentMethodType: intent.payment_method_type,
      metadata: intent.metadata ? JSON.parse(intent.metadata) : null,
      orderId: intent.order_id,
      description: intent.description,
      billingDetails: intent.billing_details ? JSON.parse(intent.billing_details) : null,
      shippingDetails: intent.shipping_details ? JSON.parse(intent.shipping_details) : null,
      successUrl: intent.success_url,
      cancelUrl: intent.cancel_url,
      failureUrl: intent.failure_url,
      threeDsActionUrl: intent.three_ds_action_url,
      createdAt: intent.created_at,
      updatedAt: intent.updated_at,
    };
  }
}

export const paymentIntentService = new PaymentIntentService();
