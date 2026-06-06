import db from '../db/connection';
import { providerDispatcher, QueryRefundResult } from './provider-dispatcher';
import { retryService } from './retry.service';
import { computeFeeForConnector } from './fee-calculator';

export interface RefundStats {
  total: number;
  succeeded: number;
  failed: number;
  pending: number;
  totalAmount: number;
  succeededAmount: number;
  failedAmount: number;
  pendingAmount: number;
  currency: string;
  syncPending: number;
}

export interface SyncResult {
  refundId: string;
  previousStatus: string;
  newStatus: string;
  changed: boolean;
  error?: string;
}

class RefundSyncService {
  // ══════════════════════════════════════════════════
  //  Sync a single refund's status from the PSP
  // ══════════════════════════════════════════════════

  async syncRefundStatus(refundId: string): Promise<SyncResult> {
    const refund = await db('refunds').where({ id: refundId }).first();
    if (!refund) {
      return { refundId, previousStatus: 'UNKNOWN', newStatus: 'UNKNOWN', changed: false, error: 'Refund not found' };
    }

    // Only sync PENDING refunds (SUCCEEDED/FAILED are terminal states from webhook)
    if (refund.status !== 'PENDING') {
      return {
        refundId,
        previousStatus: refund.status,
        newStatus: refund.status,
        changed: false,
      };
    }

    if (!refund.provider_refund_id) {
      // No provider ID yet — mark as not syncable
      await db('refunds').where({ id: refundId }).update({
        sync_status: 'SYNC_FAILED',
        last_synced_at: new Date(),
        last_sync_error: 'No provider_refund_id',
        sync_attempts: db.raw('sync_attempts + 1'),
      });
      return {
        refundId,
        previousStatus: refund.status,
        newStatus: refund.status,
        changed: false,
        error: 'No provider_refund_id',
      };
    }

    // Mark as syncing
    await db('refunds').where({ id: refundId }).update({
      sync_status: 'SYNCING',
      sync_attempts: db.raw('sync_attempts + 1'),
    });

    // Determine the provider and connector account
    const intent = await db('payment_intents')
      .where({ id: refund.payment_intent_id })
      .first();
    const provider = intent?.resolved_provider || 'STRIPE';
    const accountId = intent?.connector_account_id;

    if (!accountId) {
      await db('refunds').where({ id: refundId }).update({
        sync_status: 'SYNC_FAILED',
        last_synced_at: new Date(),
        last_sync_error: 'No connector_account_id on PaymentIntent',
      });
      return {
        refundId,
        previousStatus: refund.status,
        newStatus: refund.status,
        changed: false,
        error: 'No connector_account_id',
      };
    }

    // Query PSP for actual refund status
    let result: QueryRefundResult;
    try {
      result = await providerDispatcher.queryRefundStatus(
        provider,
        refund.provider_refund_id,
        accountId,
      );
    } catch (err: any) {
      await db('refunds').where({ id: refundId }).update({
        sync_status: 'SYNC_FAILED',
        last_synced_at: new Date(),
        last_sync_error: err.message,
      });
      return {
        refundId,
        previousStatus: refund.status,
        newStatus: refund.status,
        changed: false,
        error: err.message,
      };
    }

    if (!result.found) {
      // Refund not found at PSP — might have been deleted or never created
      await db('refunds').where({ id: refundId }).update({
        sync_status: 'SYNC_FAILED',
        last_synced_at: new Date(),
        last_sync_error: 'Refund not found at provider',
      });
      return {
        refundId,
        previousStatus: refund.status,
        newStatus: refund.status,
        changed: false,
        error: 'Refund not found at provider',
      };
    }

    // Map PSP status to internal status
    const newStatus = result.status;
    const changed = newStatus !== refund.status;

    if (changed) {
      await this.applyStatusChange(refund, newStatus, result.failureReason);
    }

    await db('refunds').where({ id: refundId }).update({
      sync_status: 'SYNCED',
      last_synced_at: new Date(),
      last_sync_error: null,
      ...(changed ? { status: newStatus, failure_reason: result.failureReason || null } : {}),
    });

    return {
      refundId,
      previousStatus: refund.status,
      newStatus,
      changed,
    };
  }

  // ══════════════════════════════════════════════════
  //  Apply a status change (SUCCEEDED or FAILED)
  // ══════════════════════════════════════════════════

  private async applyStatusChange(refund: any, newStatus: string, failureReason?: string) {
    if (newStatus === 'SUCCEEDED') {
      // Recompute fee for payouts
      const fee = await computeFeeForConnector(refund.amount, refund.payment_intent_id
        ? (await db('payment_intents').where({ id: refund.payment_intent_id }).first())?.connector_account_id
        : null);
      if (fee > 0) {
        await db('refunds').where({ id: refund.id }).update({ fee_amount: fee });
      }

      // Emit outbox event
      await db('outbox_events').insert({
        merchant_id: refund.merchant_id,
        event_type: 'refund.succeeded',
        resource_id: refund.id,
        payload: JSON.stringify(this.refundToPayload(refund)),
      });
    } else if (newStatus === 'FAILED') {
      // Emit outbox event
      await db('outbox_events').insert({
        merchant_id: refund.merchant_id,
        event_type: 'refund.failed',
        resource_id: refund.id,
        payload: JSON.stringify({
          ...this.refundToPayload(refund),
          failureReason: failureReason || refund.failure_reason,
        }),
      });

      // Schedule retry if appropriate
      await this.scheduleRetryIfNeeded(refund);
    }
  }

  // ══════════════════════════════════════════════════
  //  Retry failed refunds
  // ══════════════════════════════════════════════════

  private async scheduleRetryIfNeeded(refund: any) {
    const maxRetries = 3;
    if ((refund.retry_count || 0) >= maxRetries) return;

    // Exponential backoff: 5min, 30min, 2h
    const delays = [5, 30, 120];
    const delayMinutes = delays[refund.retry_count || 0] || 120;

    const nextRetry = new Date(Date.now() + delayMinutes * 60_000);
    await db('refunds').where({ id: refund.id }).update({
      retry_count: db.raw('retry_count + 1'),
      next_retry_at: nextRetry,
    });
  }

  async retryFailedRefund(refundId: string): Promise<SyncResult> {
    const refund = await db('refunds').where({ id: refundId }).first();
    if (!refund || refund.status !== 'FAILED') {
      return { refundId, previousStatus: refund?.status || 'UNKNOWN', newStatus: refund?.status || 'UNKNOWN', changed: false };
    }

    const maxRetries = 3;
    if ((refund.retry_count || 0) >= maxRetries) {
      return {
        refundId,
        previousStatus: 'FAILED',
        newStatus: 'FAILED',
        changed: false,
        error: `Max retries (${maxRetries}) exceeded`,
      };
    }

    // Attempt to re-create the refund at the provider
    const intent = await db('payment_intents')
      .where({ id: refund.payment_intent_id })
      .first();

    if (!intent?.connector_account_id || !intent?.provider_payment_id) {
      return {
        refundId,
        previousStatus: 'FAILED',
        newStatus: 'FAILED',
        changed: false,
        error: 'Missing PaymentIntent connector data',
      };
    }

    try {
      const result = await providerDispatcher.refund(
        intent.resolved_provider,
        {
          providerPaymentId: intent.provider_payment_id,
          amount: refund.amount,
          currency: refund.currency,
        },
        intent.connector_account_id,
      );

      if (result.success) {
        await db('refunds').where({ id: refundId }).update({
          status: 'PENDING',
          sync_status: 'NOT_SYNCED',
          provider_refund_id: result.providerRefundId,
          failure_reason: null,
          next_retry_at: null,
        });

        return {
          refundId,
          previousStatus: 'FAILED',
          newStatus: 'PENDING',
          changed: true,
        };
      }

      // Retry failed — schedule next
      await this.scheduleRetryIfNeeded(refund);
      return {
        refundId,
        previousStatus: 'FAILED',
        newStatus: 'FAILED',
        changed: false,
        error: result.failureMessage || result.failureCode,
      };
    } catch (err: any) {
      await this.scheduleRetryIfNeeded(refund);
      return {
        refundId,
        previousStatus: 'FAILED',
        newStatus: 'FAILED',
        changed: false,
        error: err.message,
      };
    }
  }

  // ══════════════════════════════════════════════════
  //  Batch sync: all PENDING refunds for a merchant
  // ══════════════════════════════════════════════════

  async syncPendingRefunds(merchantId: string): Promise<{ total: number; synced: number; changed: number; failed: number }> {
    const pending = await db('refunds')
      .where({ merchant_id: merchantId, status: 'PENDING' })
      .whereNotNull('provider_refund_id')
      .where('sync_status', '!=', 'SYNCED')
      .orderBy('created_at', 'asc');

    let synced = 0;
    let changed = 0;
    let failed = 0;

    for (const refund of pending) {
      try {
        const result = await this.syncRefundStatus(refund.id);
        synced++;
        if (result.changed) changed++;
        if (result.error) failed++;
      } catch {
        failed++;
      }
    }

    return { total: pending.length, synced, changed, failed };
  }

  // ══════════════════════════════════════════════════
  //  Retry eligible failed refunds (for scheduler)
  // ══════════════════════════════════════════════════

  async retryEligibleRefunds(): Promise<{ attempted: number; succeeded: number; failed: number }> {
    const eligible = await db('refunds')
      .where({ status: 'FAILED' })
      .where('retry_count', '<', 3)
      .where('next_retry_at', '<=', new Date())
      .whereNotNull('next_retry_at');

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    for (const refund of eligible) {
      attempted++;
      const result = await this.retryFailedRefund(refund.id);
      if (result.changed) succeeded++;
      else failed++;
    }

    return { attempted, succeeded, failed };
  }

  // ══════════════════════════════════════════════════
  //  Refund statistics for dashboard
  // ══════════════════════════════════════════════════

  async getStats(merchantId: string, mode?: string): Promise<RefundStats> {
    let query = db('refunds').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const refunds = await query.select('status', 'amount', 'currency', 'sync_status');

    const stats: RefundStats = {
      total: refunds.length,
      succeeded: 0,
      failed: 0,
      pending: 0,
      totalAmount: 0,
      succeededAmount: 0,
      failedAmount: 0,
      pendingAmount: 0,
      currency: refunds[0]?.currency || 'USD',
      syncPending: 0,
    };

    for (const r of refunds) {
      const amount = parseInt(String(r.amount), 10) || 0;
      stats.totalAmount += amount;

      if (r.status === 'SUCCEEDED') {
        stats.succeeded++;
        stats.succeededAmount += amount;
      } else if (r.status === 'FAILED') {
        stats.failed++;
        stats.failedAmount += amount;
      } else if (r.status === 'PENDING') {
        stats.pending++;
        stats.pendingAmount += amount;
      }

      if (r.sync_status !== 'SYNCED' && r.status === 'PENDING') {
        stats.syncPending++;
      }
    }

    return stats;
  }

  // ══════════════════════════════════════════════════
  //  Mark a PENDING refund as FAILED after timeout
  // ══════════════════════════════════════════════════

  async timeoutPendingRefunds(maxAgeMinutes: number = 120): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const stale = await db('refunds')
      .where({ status: 'PENDING' })
      .where('created_at', '<', cutoff)
      .whereNull('provider_refund_id');

    for (const refund of stale) {
      await db('refunds').where({ id: refund.id }).update({
        status: 'FAILED',
        failure_reason: `Refund timed out after ${maxAgeMinutes} minutes without provider confirmation`,
        sync_status: 'SYNC_FAILED',
        last_sync_error: 'Timed out — no provider_refund_id received',
        last_synced_at: new Date(),
      });

      await db('outbox_events').insert({
        merchant_id: refund.merchant_id,
        event_type: 'refund.failed',
        resource_id: refund.id,
        payload: JSON.stringify({
          ...this.refundToPayload(refund),
          failureReason: `Refund timed out after ${maxAgeMinutes} minutes`,
        }),
      });
    }

    return stale.length;
  }

  // ── Helpers ──

  private refundToPayload(refund: any) {
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

export const refundSyncService = new RefundSyncService();