import db from '../db/connection';
import { providerDispatcher } from './provider-dispatcher';

export class RefundService {
  async create(merchantId: string, intentId: string, body: { amount?: number; reason?: string }) {
    const intent = await db('payment_intents')
      .where({ id: intentId, merchant_id: merchantId })
      .first();
    if (!intent) throw Object.assign(new Error('PaymentIntent not found'), { status: 404 });
    if (intent.status !== 'SUCCEEDED') {
      throw Object.assign(new Error('Can only refund succeeded payments'), { status: 400 });
    }

    const refundAmount = body.amount || intent.amount;
    if (refundAmount <= 0) {
      throw Object.assign(new Error('Refund amount must be positive'), { status: 400 });
    }
    if (refundAmount > intent.amount) {
      throw Object.assign(new Error('Refund amount exceeds payment amount'), { status: 400 });
    }

    // Guard against over-refunding across multiple partial refunds.
    const [{ sum }] = await db('refunds')
      .where({ payment_intent_id: intentId, status: 'SUCCEEDED' })
      .sum('amount as sum');
    const alreadyRefunded = parseInt((sum as string) || '0', 10) || 0;
    if (alreadyRefunded + refundAmount > intent.amount) {
      throw Object.assign(
        new Error(`Refund exceeds remaining refundable amount (${intent.amount - alreadyRefunded})`),
        { status: 400 },
      );
    }

    const [refund] = await db('refunds').insert({
      payment_intent_id: intentId,
      merchant_id: merchantId,
      mode: intent.mode,
      amount: refundAmount,
      currency: intent.currency,
      reason: body.reason,
      status: 'PENDING',
    }).returning('*');

    // Call the provider to perform the actual refund.
    try {
      const result = await providerDispatcher.refund(
        intent.resolved_provider,
        { providerPaymentId: intent.provider_payment_id, amount: refundAmount },
        intent.connector_account_id,
      );

      if (result.success) {
        await db('refunds').where({ id: refund.id }).update({
          status: 'SUCCEEDED',
          provider_refund_id: result.providerRefundId,
        });
      } else {
        await db('refunds').where({ id: refund.id }).update({
          status: 'FAILED',
          provider_refund_id: result.providerRefundId,
          failure_reason: result.failureMessage || result.failureCode || 'Refund failed',
        });
      }
    } catch (err: any) {
      await db('refunds').where({ id: refund.id }).update({
        status: 'FAILED',
        failure_reason: err.message,
      });
    }

    const updated = await db('refunds').where({ id: refund.id }).first();

    // Emit an outbox event so subscribed webhook endpoints get notified.
    await db('outbox_events').insert({
      merchant_id: merchantId,
      event_type: updated.status === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed',
      resource_id: refund.id,
      payload: JSON.stringify(this.toResponse(updated)),
    });

    return this.toResponse(updated);
  }

  async list(merchantId: string, mode?: string, page = 0, size = 20) {
    let query = db('refunds').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const [{ count }] = await query.clone().count();
    const content = await query.orderBy('created_at', 'desc').limit(size).offset(page * size);

    return {
      content: content.map((r: any) => this.toResponse(r)),
      totalElements: parseInt(count as string),
      page,
      size,
    };
  }

  async get(merchantId: string, refundId: string) {
    const refund = await db('refunds').where({ id: refundId, merchant_id: merchantId }).first();
    if (!refund) throw Object.assign(new Error('Refund not found'), { status: 404 });
    return this.toResponse(refund);
  }

  private toResponse(refund: any) {
    return {
      id: refund.id,
      paymentIntentId: refund.payment_intent_id,
      merchantId: refund.merchant_id,
      mode: refund.mode,
      amount: refund.amount,
      currency: refund.currency,
      status: refund.status,
      reason: refund.reason,
      providerRefundId: refund.provider_refund_id,
      failureReason: refund.failure_reason,
      createdAt: refund.created_at,
      updatedAt: refund.updated_at,
    };
  }
}

export const refundService = new RefundService();
