import db from '../db/connection';

/**
 * Aggregates settled payments and refunds into per-merchant, per-connector,
 * per-currency payout summaries. This is an internal reconciliation view —
 * actual money movement is handled by the underlying provider (Stripe etc.)
 * via its own payout schedule. We surface the numbers so merchants can
 * reconcile their own books against what the provider will deposit.
 *
 * The aggregation runs as a worker (see PayoutWorker.start()) once a day
 * and can also be triggered on demand for backfill / preview.
 */

export interface RunOptions {
  /** Defaults to 24h ago. */
  periodStart?: Date;
  /** Defaults to now. */
  periodEnd?: Date;
}

export class PayoutService {
  async list(merchantId: string, mode?: string, page = 0, size = 20) {
    let query = db('payouts').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const [{ count }] = await query.clone().count();
    const content = await query.orderBy('period_end', 'desc').limit(size).offset(page * size);

    return {
      content: content.map((p: any) => this.toResponse(p)),
      totalElements: parseInt(count as string, 10),
      page,
      size,
    };
  }

  async get(merchantId: string, payoutId: string) {
    const payout = await db('payouts').where({ id: payoutId, merchant_id: merchantId }).first();
    if (!payout) throw Object.assign(new Error('Payout not found'), { status: 404 });

    const items = await db('payout_items')
      .where({ payout_id: payoutId })
      .orderBy('created_at', 'asc');

    return {
      ...this.toResponse(payout),
      items: items.map((i: any) => ({
        id: i.id,
        type: i.type,
        paymentIntentId: i.payment_intent_id,
        refundId: i.refund_id,
        amount: i.amount,
        feeAmount: i.fee_amount,
        netAmount: i.net_amount,
        currency: i.currency,
        createdAt: i.created_at,
      })),
    };
  }

  /**
   * Build payouts for every merchant/connector/currency triple that had
   * activity inside the window. Idempotent on the (merchant, connector,
   * period_start, period_end) unique constraint — re-running the same window
   * is a no-op.
   */
  async runForAllMerchants(opts: RunOptions = {}): Promise<number> {
    const periodEnd = opts.periodEnd || new Date();
    const periodStart = opts.periodStart || new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);

    // SUCCEEDED payments inside the window.
    const payments: any[] = await db('payment_intents')
      .where('status', 'SUCCEEDED')
      .andWhere('updated_at', '>=', periodStart)
      .andWhere('updated_at', '<', periodEnd);

    // SUCCEEDED refunds inside the window.
    const refunds: any[] = await db('refunds')
      .where('status', 'SUCCEEDED')
      .andWhere('updated_at', '>=', periodStart)
      .andWhere('updated_at', '<', periodEnd);

    // Group by merchant/connector/currency/mode.
    const buckets = new Map<string, {
      merchantId: string;
      connectorAccountId: string | null;
      mode: string;
      currency: string;
      payments: any[];
      refunds: any[];
    }>();
    const key = (m: string, c: string | null, mode: string, cur: string) =>
      `${m}|${c || ''}|${mode}|${cur}`;

    for (const p of payments) {
      const k = key(p.merchant_id, p.connector_account_id, p.mode, p.currency);
      if (!buckets.has(k)) buckets.set(k, {
        merchantId: p.merchant_id,
        connectorAccountId: p.connector_account_id,
        mode: p.mode,
        currency: p.currency,
        payments: [],
        refunds: [],
      });
      buckets.get(k)!.payments.push(p);
    }
    for (const r of refunds) {
      // Best-effort: link the refund to the payment's bucket.
      const intent = payments.find((p) => p.id === r.payment_intent_id)
        || (await db('payment_intents').where({ id: r.payment_intent_id }).first());
      if (!intent) continue;
      const k = key(intent.merchant_id, intent.connector_account_id, r.mode, r.currency);
      if (!buckets.has(k)) buckets.set(k, {
        merchantId: intent.merchant_id,
        connectorAccountId: intent.connector_account_id,
        mode: r.mode,
        currency: r.currency,
        payments: [],
        refunds: [],
      });
      buckets.get(k)!.refunds.push(r);
    }

    let createdCount = 0;
    for (const bucket of buckets.values()) {
      const created = await this.createPayoutForBucket(bucket, periodStart, periodEnd);
      if (created) createdCount += 1;
    }
    return createdCount;
  }

  private async createPayoutForBucket(
    bucket: {
      merchantId: string;
      connectorAccountId: string | null;
      mode: string;
      currency: string;
      payments: any[];
      refunds: any[];
    },
    periodStart: Date,
    periodEnd: Date,
  ): Promise<boolean> {
    const grossAmount = bucket.payments.reduce((s, p) => s + Number(p.amount), 0);
    const refundedAmount = bucket.refunds.reduce((s, r) => s + Number(r.amount), 0);
    const paymentFees = bucket.payments.reduce((s, p) => s + Number(p.fee_amount || 0), 0);
    const refundFees = bucket.refunds.reduce((s, r) => s + Number(r.fee_amount || 0), 0);
    const feeAmount = paymentFees + refundFees;
    const netAmount = grossAmount - refundedAmount - feeAmount;

    if (grossAmount === 0 && refundedAmount === 0) return false;

    const trx = await db.transaction();
    try {
      // Insert the payout (idempotent via unique constraint).
      const [payout] = await trx('payouts')
        .insert({
          merchant_id: bucket.merchantId,
          connector_account_id: bucket.connectorAccountId,
          mode: bucket.mode,
          currency: bucket.currency,
          gross_amount: grossAmount,
          refunded_amount: refundedAmount,
          disputed_amount: 0,
          fee_amount: feeAmount,
          net_amount: netAmount,
          period_start: periodStart,
          period_end: periodEnd,
          status: 'PENDING',
        })
        .onConflict(['merchant_id', 'connector_account_id', 'period_start', 'period_end'])
        .ignore()
        .returning('*');

      if (!payout) {
        await trx.rollback();
        return false; // Already existed.
      }

      // Insert line items.
      for (const p of bucket.payments) {
        const fee = Number(p.fee_amount || 0);
        await trx('payout_items').insert({
          payout_id: payout.id,
          payment_intent_id: p.id,
          type: 'PAYMENT',
          amount: p.amount,
          fee_amount: fee,
          net_amount: Number(p.amount) - fee,
          currency: p.currency,
        });
      }
      for (const r of bucket.refunds) {
        const fee = Number(r.fee_amount || 0);
        await trx('payout_items').insert({
          payout_id: payout.id,
          refund_id: r.id,
          type: 'REFUND',
          amount: -Number(r.amount),
          fee_amount: fee,
          net_amount: -Number(r.amount) + fee,
          currency: r.currency,
        });
      }

      await trx.commit();
      return true;
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }

  private toResponse(p: any) {
    return {
      id: p.id,
      merchantId: p.merchant_id,
      connectorAccountId: p.connector_account_id,
      mode: p.mode,
      currency: p.currency,
      grossAmount: Number(p.gross_amount),
      refundedAmount: Number(p.refunded_amount),
      disputedAmount: Number(p.disputed_amount),
      feeAmount: Number(p.fee_amount),
      netAmount: Number(p.net_amount),
      periodStart: p.period_start,
      periodEnd: p.period_end,
      status: p.status,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }
}

export const payoutService = new PayoutService();

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * ONE_HOUR_MS;

class PayoutWorker {
  private timer?: NodeJS.Timeout;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.safeRun(), ONE_HOUR_MS);
    if (this.timer.unref) this.timer.unref();
    // First pass shortly after boot.
    setTimeout(() => this.safeRun(), 30_000);
    console.log('[payout-worker] started');
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async safeRun() {
    if (this.running) return;
    this.running = true;
    try {
      const end = new Date();
      const start = new Date(end.getTime() - ONE_DAY_MS);
      const created = await payoutService.runForAllMerchants({ periodStart: start, periodEnd: end });
      if (created > 0) console.log(`[payout-worker] created ${created} payout(s)`);
    } catch (err) {
      console.error('[payout-worker] error:', err);
    } finally {
      this.running = false;
    }
  }
}

export const payoutWorker = new PayoutWorker();
