import db from '../db/connection';

/** Maps a Stripe dispute status to our internal status enum. */
function mapStripeStatus(s: string): string {
  switch (s) {
    case 'warning_needs_response':
    case 'warning_under_review':
    case 'warning_closed':
      return 'WARNING_NEEDS_RESPONSE';
    case 'needs_response':
      return 'OPEN';
    case 'under_review':
      return 'UNDER_REVIEW';
    case 'won':
      return 'WON';
    case 'lost':
      return 'LOST';
    case 'charge_refunded':
      return 'CHARGE_REFUNDED';
    default:
      return s.toUpperCase();
  }
}

export class DisputeService {
  /**
   * Upserts a dispute from a Stripe `charge.dispute.*` event. The charge id
   * is mapped to a PaymentIntent via its provider_payment_id (charges link
   * to payment_intents in Stripe; we resolve via the `payment_intent` field).
   */
  async upsertFromStripe(disputeObj: any, eventType: string): Promise<{ id: string; created: boolean } | null> {
    if (!disputeObj?.id) return null;

    // Stripe's dispute object exposes the related payment_intent (preferred)
    // or charge.payment_intent. Fall back to looking up by charge id.
    const piId: string | undefined =
      disputeObj.payment_intent || disputeObj.charge?.payment_intent;

    let intent: any = null;
    if (piId) {
      intent = await db('payment_intents').where({ provider_payment_id: piId }).first();
    }
    if (!intent && disputeObj.charge) {
      // Some webhooks only carry the charge id; we don't store charge ids,
      // so this branch may be a no-op. Still record the dispute below.
    }
    if (!intent) {
      // We received a dispute for a payment we don't track; skip.
      return null;
    }

    const status = mapStripeStatus(disputeObj.status || 'OPEN');
    const fields = {
      merchant_id: intent.merchant_id,
      payment_intent_id: intent.id,
      mode: intent.mode,
      provider: 'STRIPE',
      provider_dispute_id: disputeObj.id,
      amount: disputeObj.amount,
      currency: (disputeObj.currency || intent.currency).toUpperCase(),
      reason: disputeObj.reason,
      status,
      evidence_due_by: disputeObj.evidence_details?.due_by
        ? new Date(disputeObj.evidence_details.due_by * 1000).toISOString()
        : null,
      provider_payload: JSON.stringify(disputeObj),
    };

    const existing = await db('disputes')
      .where({ provider: 'STRIPE', provider_dispute_id: disputeObj.id })
      .first();

    let id: string;
    let created = false;
    if (existing) {
      const [updated] = await db('disputes').where({ id: existing.id }).update(fields).returning('id');
      id = updated.id;
    } else {
      const [inserted] = await db('disputes').insert(fields).returning('id');
      id = inserted.id;
      created = true;
    }

    // Emit an outbox event so merchants get notified via their webhooks.
    const merchantEventType =
      eventType === 'charge.dispute.created'
        ? 'dispute.created'
        : eventType === 'charge.dispute.closed'
        ? `dispute.${status.toLowerCase()}`
        : 'dispute.updated';

    await db('outbox_events').insert({
      merchant_id: intent.merchant_id,
      event_type: merchantEventType,
      resource_id: id,
      payload: JSON.stringify({
        id,
        paymentIntentId: intent.id,
        amount: fields.amount,
        currency: fields.currency,
        reason: fields.reason,
        status: fields.status,
        evidenceDueBy: fields.evidence_due_by,
      }),
    });

    return { id, created };
  }

  /**
   * Generic insert/update of a dispute record from a non-Stripe provider.
   * The caller resolves the connector and the matching PaymentIntent (if any)
   * and passes them in.
   */
  async upsertGeneric(args: {
    provider: string;
    providerDisputeId: string;
    intent: any | null;
    merchantId: string;
    mode: string;
    amount: number;
    currency: string;
    reason?: string;
    status: string;
    evidenceDueBy?: string | null;
    payload: any;
    eventType: string;
  }): Promise<{ id: string; created: boolean } | null> {
    if (!args.providerDisputeId) return null;

    const fields = {
      merchant_id: args.merchantId,
      payment_intent_id: args.intent?.id || null,
      mode: args.mode,
      provider: args.provider.toUpperCase(),
      provider_dispute_id: args.providerDisputeId,
      amount: args.amount,
      currency: (args.currency || 'USD').toUpperCase(),
      reason: args.reason,
      status: args.status,
      evidence_due_by: args.evidenceDueBy ?? null,
      provider_payload: JSON.stringify(args.payload),
    };

    const existing = await db('disputes')
      .where({ provider: fields.provider, provider_dispute_id: args.providerDisputeId })
      .first();

    let id: string;
    let created = false;
    if (existing) {
      const [updated] = await db('disputes').where({ id: existing.id }).update(fields).returning('id');
      id = updated.id;
    } else {
      const [inserted] = await db('disputes').insert(fields).returning('id');
      id = inserted.id;
      created = true;
    }

    const merchantEventType = created ? 'dispute.created' : `dispute.${args.status.toLowerCase()}`;
    await db('outbox_events').insert({
      merchant_id: args.merchantId,
      event_type: merchantEventType,
      resource_id: id,
      payload: JSON.stringify({
        id,
        paymentIntentId: args.intent?.id || null,
        amount: fields.amount,
        currency: fields.currency,
        reason: fields.reason,
        status: fields.status,
        evidenceDueBy: fields.evidence_due_by,
        provider: fields.provider,
      }),
    });

    return { id, created };
  }

  async list(merchantId: string, mode?: string, page = 0, size = 20) {
    let query = db('disputes').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const [{ count }] = await query.clone().count();
    const content = await query.orderBy('created_at', 'desc').limit(size).offset(page * size);

    return {
      content: content.map((d: any) => this.toResponse(d)),
      totalElements: parseInt(count as string, 10),
      page,
      size,
    };
  }

  async get(merchantId: string, disputeId: string) {
    const dispute = await db('disputes').where({ id: disputeId, merchant_id: merchantId }).first();
    if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 });
    return this.toResponse(dispute);
  }

  private toResponse(d: any) {
    return {
      id: d.id,
      merchantId: d.merchant_id,
      paymentIntentId: d.payment_intent_id,
      mode: d.mode,
      provider: d.provider,
      providerDisputeId: d.provider_dispute_id,
      amount: d.amount,
      currency: d.currency,
      reason: d.reason,
      status: d.status,
      evidenceDueBy: d.evidence_due_by,
      createdAt: d.created_at,
      updatedAt: d.updated_at,
    };
  }
}

export const disputeService = new DisputeService();
