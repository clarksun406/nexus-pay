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
    if (refundAmount > intent.amount) {
      throw Object.assign(new Error('Refund amount exceeds payment amount'), { status: 400 });
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

    // Call provider for refund
    try {
      // In a real implementation, this would call the provider's refund API
      await db('refunds').where({ id: refund.id }).update({ status: 'SUCCEEDED' });
    } catch (err: any) {
      await db('refunds').where({ id: refund.id }).update({
        status: 'FAILED',
        failure_reason: err.message,
      });
    }

    const updated = await db('refunds').where({ id: refund.id }).first();
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
