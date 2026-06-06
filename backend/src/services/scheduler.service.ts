import { retryService } from '../services/retry.service';
import { healthMonitorService } from '../services/health-monitor.service';
import { pspSyncService } from '../services/psp-sync.service';
import { networkTokenService } from '../services/network-token.service';
import { refundSyncService } from '../services/refund-sync.service';
import { config } from '../config';
import db from '../db/connection';

class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private healthCheckIntervalId: NodeJS.Timeout | null = null;
  private pspSyncIntervalId: NodeJS.Timeout | null = null;
  private settlementCheckIntervalId: NodeJS.Timeout | null = null;
  private tokenRefreshIntervalId: NodeJS.Timeout | null = null;
  private refundSyncIntervalId: NodeJS.Timeout | null = null;
  private refundRetryIntervalId: NodeJS.Timeout | null = null;
  private refundTimeoutIntervalId: NodeJS.Timeout | null = null;

  /**
   * Start the scheduler
   */
  start(intervalMs: number = 60000): void {
    console.log('Starting scheduler...');

    // Retry executor — every minute
    this.intervalId = setInterval(async () => {
      try {
        const result = await retryService.executeRetries();
        if (result.processed > 0) {
          console.log(`Retry execution: ${result.processed} processed, ${result.succeeded} succeeded, ${result.failed} failed`);
        }
      } catch (err) {
        console.error('Retry execution error:', err);
      }
    }, intervalMs);

    // Health check — every 5 minutes
    this.healthCheckIntervalId = setInterval(async () => {
      try {
        const merchants = await db('merchants').where({ status: 'ACTIVE' });
        for (const merchant of merchants) {
          const alerts = await healthMonitorService.checkHealth(merchant.id);
          if (alerts.length > 0) {
            console.log(`Health alerts for merchant ${merchant.id}: ${alerts.length}`);
          }
        }
      } catch (err) {
        console.error('Health check error:', err);
      }
    }, intervalMs * 5);

    // PSP auto-sync — every 15 minutes
    this.pspSyncIntervalId = setInterval(async () => {
      try {
        const sources = await db('reconciliation_sources')
          .where({ source_type: 'PSP', status: 'ACTIVE' });
        const merchantIds = [...new Set(sources.map((s: any) => s.merchant_id))];
        let totalImported = 0;
        for (const merchantId of merchantIds) {
          const results = await pspSyncService.syncAllForMerchant(merchantId);
          totalImported += results.reduce((s, r) => s + r.imported, 0);
        }
        if (totalImported > 0) {
          console.log(`PSP sync: ${totalImported} transactions imported across ${merchantIds.length} merchants`);
        }
      } catch (err) {
        console.error('PSP sync error:', err);
      }
    }, intervalMs * 15);

    // Settlement freshness check — every 6 hours
    this.settlementCheckIntervalId = setInterval(async () => {
      try {
        // Detect settlements that have been PENDING for over 24 hours (stale)
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const stale = await db('settlement_records')
          .where({ status: 'PENDING' })
          .where('created_at', '<', cutoff)
          .count('* as count')
          .first();
        if (stale && parseInt(stale.count as string, 10) > 0) {
          console.log(`Settlement freshness: ${stale.count} stale pending settlements`);
        }
      } catch (err) {
        console.error('Settlement check error:', err);
      }
    }, intervalMs * 60 * 6);

    // Network token refresh — every 30 minutes
    this.tokenRefreshIntervalId = setInterval(async () => {
      try {
        if (!config.networkToken.enabled) return;
        const result = await networkTokenService.refreshExpiringTokens();
        if (result.refreshed > 0 || result.failed > 0) {
          console.log(`Network token refresh: ${result.refreshed} refreshed, ${result.failed} failed`);
        }
      } catch (err) {
        console.error('Network token refresh error:', err);
      }
    }, intervalMs * 30);

    // Refund status sync — every 10 minutes (P1-8)
    this.refundSyncIntervalId = setInterval(async () => {
      try {
        const merchants = await db('merchants').where({ status: 'ACTIVE' });
        let totalSynced = 0;
        let totalChanged = 0;
        for (const merchant of merchants) {
          const result = await refundSyncService.syncPendingRefunds(merchant.id);
          totalSynced += result.synced;
          totalChanged += result.changed;
        }
        if (totalSynced > 0) {
          console.log(`Refund sync: ${totalSynced} synced, ${totalChanged} status changes across ${merchants.length} merchants`);
        }
      } catch (err) {
        console.error('Refund sync error:', err);
      }
    }, intervalMs * 10);

    // Refund retry — every 5 minutes (P1-8)
    this.refundRetryIntervalId = setInterval(async () => {
      try {
        const result = await refundSyncService.retryEligibleRefunds();
        if (result.attempted > 0) {
          console.log(`Refund retry: ${result.attempted} attempted, ${result.succeeded} succeeded, ${result.failed} failed`);
        }
      } catch (err) {
        console.error('Refund retry error:', err);
      }
    }, intervalMs * 5);

    // Refund timeout — every 30 minutes (P1-8)
    this.refundTimeoutIntervalId = setInterval(async () => {
      try {
        const count = await refundSyncService.timeoutPendingRefunds(120);
        if (count > 0) {
          console.log(`Refund timeout: ${count} stale PENDING refunds marked as FAILED`);
        }
      } catch (err) {
        console.error('Refund timeout error:', err);
      }
    }, intervalMs * 30);

    console.log('Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }
    if (this.pspSyncIntervalId) {
      clearInterval(this.pspSyncIntervalId);
      this.pspSyncIntervalId = null;
    }
    if (this.settlementCheckIntervalId) {
      clearInterval(this.settlementCheckIntervalId);
      this.settlementCheckIntervalId = null;
    }
    if (this.tokenRefreshIntervalId) {
      clearInterval(this.tokenRefreshIntervalId);
      this.tokenRefreshIntervalId = null;
    }
    if (this.refundSyncIntervalId) {
      clearInterval(this.refundSyncIntervalId);
      this.refundSyncIntervalId = null;
    }
    if (this.refundRetryIntervalId) {
      clearInterval(this.refundRetryIntervalId);
      this.refundRetryIntervalId = null;
    }
    if (this.refundTimeoutIntervalId) {
      clearInterval(this.refundTimeoutIntervalId);
      this.refundTimeoutIntervalId = null;
    }
    console.log('Scheduler stopped');
  }
}

export const schedulerService = new SchedulerService();
