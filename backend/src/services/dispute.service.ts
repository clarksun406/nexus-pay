import db from '../db/connection';
import { decrypt } from '../utils/crypto';

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

  /** Returns the latest evidence draft (or null) for a dispute. */
  async getEvidence(merchantId: string, disputeId: string) {
    const dispute = await db('disputes').where({ id: disputeId, merchant_id: merchantId }).first();
    if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 });

    const evidence = await db('dispute_evidence')
      .where({ dispute_id: disputeId })
      .orderBy('created_at', 'desc')
      .first();
    return evidence ? this.evidenceResponse(evidence) : null;
  }

  /** Save a draft of the evidence text fields without submitting. */
  async saveEvidenceDraft(merchantId: string, disputeId: string, fields: any) {
    const dispute = await db('disputes').where({ id: disputeId, merchant_id: merchantId }).first();
    if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 });

    const draft = await db('dispute_evidence')
      .where({ dispute_id: disputeId, status: 'DRAFT' })
      .first();
    const updates = this.evidenceFromBody(fields);

    if (draft) {
      const [updated] = await db('dispute_evidence').where({ id: draft.id }).update(updates).returning('*');
      return this.evidenceResponse(updated);
    }
    const [inserted] = await db('dispute_evidence').insert({
      dispute_id: disputeId,
      ...updates,
      status: 'DRAFT',
    }).returning('*');
    return this.evidenceResponse(inserted);
  }

  /**
   * Submit the evidence to the provider. Currently only Stripe — Square's
   * dispute evidence flow uses a different file-upload model and Braintree
   * needs the SDK; we record the submission attempt either way so the UI
   * reflects state.
   */
  async submitEvidence(merchantId: string, disputeId: string, fields: any) {
    const dispute = await db('disputes').where({ id: disputeId, merchant_id: merchantId }).first();
    if (!dispute) throw Object.assign(new Error('Dispute not found'), { status: 404 });

    const updates = this.evidenceFromBody(fields);

    // Persist the submission attempt before calling the provider.
    const draft = await db('dispute_evidence').where({ dispute_id: disputeId }).orderBy('created_at', 'desc').first();
    let evidenceId: string;
    if (draft) {
      const [row] = await db('dispute_evidence').where({ id: draft.id }).update({
        ...updates,
        status: 'SUBMITTED',
        submitted_at: new Date(),
      }).returning('id');
      evidenceId = row.id;
    } else {
      const [row] = await db('dispute_evidence').insert({
        dispute_id: disputeId,
        ...updates,
        status: 'SUBMITTED',
        submitted_at: new Date(),
      }).returning('id');
      evidenceId = row.id;
    }

    let providerResponse: string | null = null;
    let success = true;
    let errorMessage: string | null = null;

    if (dispute.provider === 'STRIPE') {
      // Resolve the Stripe secret for the connector that took the original payment.
      const intent = dispute.payment_intent_id
        ? await db('payment_intents').where({ id: dispute.payment_intent_id }).first()
        : null;
      const account = intent?.connector_account_id
        ? await db('provider_accounts').where({ id: intent.connector_account_id }).first()
        : null;
      let secretKey: string | undefined;
      if (account?.encrypted_credentials) {
        try { secretKey = JSON.parse(decrypt(account.encrypted_credentials)).secretKey; } catch {}
      }

      if (!secretKey) {
        success = false;
        errorMessage = 'Stripe credentials not available for this dispute';
      } else {
        const params = new URLSearchParams();
        const map: Record<string, string> = {
          product_description: 'evidence[product_description]',
          customer_name: 'evidence[customer_name]',
          customer_email_address: 'evidence[customer_email_address]',
          billing_address: 'evidence[billing_address]',
          shipping_address: 'evidence[shipping_address]',
          shipping_carrier: 'evidence[shipping_carrier]',
          shipping_tracking_number: 'evidence[shipping_tracking_number]',
          service_date: 'evidence[service_date]',
          refund_policy: 'evidence[refund_policy]',
          uncategorized_text: 'evidence[uncategorized_text]',
        };
        for (const [k, stripeKey] of Object.entries(map)) {
          const v = (updates as any)[k];
          if (v) params.append(stripeKey, v);
        }
        params.append('submit', 'true');

        try {
          const response = await fetch(`https://api.stripe.com/v1/disputes/${dispute.provider_dispute_id}`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${secretKey}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: params,
          });
          const data = await response.json();
          providerResponse = JSON.stringify(data);
          if (!response.ok) {
            success = false;
            errorMessage = data?.error?.message || `Stripe responded ${response.status}`;
          } else {
            // Refresh our local status from Stripe's response.
            await db('disputes').where({ id: disputeId }).update({
              status: data.status === 'under_review' ? 'UNDER_REVIEW' : dispute.status,
              provider_payload: providerResponse,
            });
          }
        } catch (err: any) {
          success = false;
          errorMessage = err?.message || 'Network error';
        }
      }
    } else {
      // Non-Stripe: record locally only.
      success = true;
      errorMessage = null;
      providerResponse = null;
    }

    await db('dispute_evidence').where({ id: evidenceId }).update({
      status: success ? 'SUBMITTED' : 'DRAFT',
      provider_response: providerResponse || (errorMessage ? JSON.stringify({ error: errorMessage }) : null),
    });

    if (!success) {
      throw Object.assign(new Error(errorMessage || 'Failed to submit evidence'), { status: 502 });
    }

    return this.getEvidence(merchantId, disputeId);
  }

  private evidenceFromBody(b: any) {
    return {
      product_description: b.productDescription ?? null,
      customer_name: b.customerName ?? null,
      customer_email_address: b.customerEmailAddress ?? null,
      billing_address: b.billingAddress ?? null,
      shipping_address: b.shippingAddress ?? null,
      shipping_carrier: b.shippingCarrier ?? null,
      shipping_tracking_number: b.shippingTrackingNumber ?? null,
      service_date: b.serviceDate ?? null,
      refund_policy: b.refundPolicy ?? null,
      uncategorized_text: b.uncategorizedText ?? null,
    };
  }

  private evidenceResponse(e: any) {
    return {
      id: e.id,
      disputeId: e.dispute_id,
      productDescription: e.product_description,
      customerName: e.customer_name,
      customerEmailAddress: e.customer_email_address,
      billingAddress: e.billing_address,
      shippingAddress: e.shipping_address,
      shippingCarrier: e.shipping_carrier,
      shippingTrackingNumber: e.shipping_tracking_number,
      serviceDate: e.service_date,
      refundPolicy: e.refund_policy,
      uncategorizedText: e.uncategorized_text,
      status: e.status,
      submittedAt: e.submitted_at,
      providerResponse: e.provider_response,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    };
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
