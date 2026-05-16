import db from '../db/connection';
import { routingEngine } from './routing-engine';

export interface HealthMetrics {
  connectorAccountId: string;
  provider: string;
  healthStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
  successRate: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastUpdated: Date;
}

export interface HealthAlert {
  id: string;
  connectorAccountId: string;
  alertType: 'ERROR_RATE' | 'LATENCY' | 'OUTAGE';
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  metrics: Record<string, any>;
  status: 'ACTIVE' | 'RESOLVED';
  createdAt: Date;
}

export interface HealthThreshold {
  errorRateWarning: number; // %
  errorRateCritical: number; // %
  latencyWarningMs: number;
  latencyCriticalMs: number;
  minSampleSize: number;
}

const DEFAULT_THRESHOLDS: HealthThreshold = {
  errorRateWarning: 5,
  errorRateCritical: 15,
  latencyWarningMs: 2000,
  latencyCriticalMs: 5000,
  minSampleSize: 10,
};

class HealthMonitorService {
  private thresholds: Map<string, HealthThreshold> = new Map();

  /**
   * Record a payment request result
   */
  async recordRequest(
    connectorAccountId: string,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    const now = new Date();
    const metricTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    // Upsert hourly metrics
    const existing = await db('provider_health_metrics')
      .where({ connector_account_id: connectorAccountId, metric_time: metricTime })
      .first();

    if (existing) {
      const newTotal = existing.total_requests + 1;
      const newSuccess = existing.successful_requests + (success ? 1 : 0);
      const newFailed = existing.failed_requests + (success ? 0 : 1);
      const successRate = (newSuccess / newTotal) * 100;

      await db('provider_health_metrics').where({ id: existing.id }).update({
        total_requests: newTotal,
        successful_requests: newSuccess,
        failed_requests: newFailed,
        success_rate: successRate,
        health_status: this.calculateHealthStatus(successRate, existing.avg_latency_ms),
        updated_at: now,
      });
    } else {
      await db('provider_health_metrics').insert({
        connector_account_id: connectorAccountId,
        metric_time: metricTime,
        total_requests: 1,
        successful_requests: success ? 1 : 0,
        failed_requests: success ? 0 : 1,
        success_rate: success ? 100 : 0,
        health_status: 'HEALTHY',
      });
    }
  }

  /**
   * Get health metrics for a connector
   */
  async getHealthMetrics(connectorAccountId: string, hours: number = 24): Promise<HealthMetrics | null> {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);

    const metrics = await db('provider_health_metrics')
      .where({ connector_account_id: connectorAccountId })
      .where('metric_time', '>=', since);

    if (metrics.length === 0) return null;

    const account = await db('provider_accounts').where({ id: connectorAccountId }).first();
    if (!account) return null;

    const totalRequests = metrics.reduce((sum, m) => sum + m.total_requests, 0);
    const successfulRequests = metrics.reduce((sum, m) => sum + m.successful_requests, 0);
    const failedRequests = metrics.reduce((sum, m) => sum + m.failed_requests, 0);
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    return {
      connectorAccountId,
      provider: account.provider,
      healthStatus: metrics[metrics.length - 1]?.health_status || 'HEALTHY',
      successRate,
      totalRequests,
      successfulRequests,
      failedRequests,
      avgLatencyMs: 0, // TODO: Calculate from actual data
      p95LatencyMs: 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * Get all unhealthy connectors for a merchant
   */
  async getUnhealthyConnectors(merchantId: string): Promise<HealthMetrics[]> {
    const accounts = await db('provider_accounts').where({ merchant_id: merchantId, status: 'ACTIVE' });

    const results: HealthMetrics[] = [];
    for (const account of accounts) {
      const metrics = await this.getHealthMetrics(account.id);
      if (metrics && metrics.healthStatus !== 'HEALTHY') {
        results.push(metrics);
      }
    }

    return results;
  }

  /**
   * Check health and trigger alerts/demotion
   */
  async checkHealth(merchantId: string): Promise<HealthAlert[]> {
    const thresholds = this.thresholds.get(merchantId) || DEFAULT_THRESHOLDS;
    const accounts = await db('provider_accounts').where({ merchant_id: merchantId, status: 'ACTIVE' });

    const alerts: HealthAlert[] = [];

    for (const account of accounts) {
      const metrics = await this.getHealthMetrics(account.id);

      if (!metrics || metrics.totalRequests < thresholds.minSampleSize) continue;

      // Check error rate
      const errorRate = 100 - metrics.successRate;
      if (errorRate >= thresholds.errorRateCritical) {
        await this.demoteConnector(account.id, 'ERROR_RATE', errorRate);
        alerts.push({
          id: '',
          connectorAccountId: account.id,
          alertType: 'ERROR_RATE',
          severity: 'CRITICAL',
          message: `Error rate ${errorRate.toFixed(2)}% exceeds critical threshold ${thresholds.errorRateCritical}%`,
          metrics: { errorRate, threshold: thresholds.errorRateCritical },
          status: 'ACTIVE',
          createdAt: new Date(),
        });
      } else if (errorRate >= thresholds.errorRateWarning) {
        alerts.push({
          id: '',
          connectorAccountId: account.id,
          alertType: 'ERROR_RATE',
          severity: 'WARNING',
          message: `Error rate ${errorRate.toFixed(2)}% exceeds warning threshold ${thresholds.errorRateWarning}%`,
          metrics: { errorRate, threshold: thresholds.errorRateWarning },
          status: 'ACTIVE',
          createdAt: new Date(),
        });
      }
    }

    return alerts;
  }

  /**
   * Demote a connector (disable or reduce weight)
   */
  private async demoteConnector(
    connectorAccountId: string,
    reason: 'ERROR_RATE' | 'LATENCY' | 'OUTAGE',
    value: number
  ): Promise<void> {
    const account = await db('provider_accounts').where({ id: connectorAccountId }).first();
    if (!account) return;

    // Create outage record
    await db('provider_outages').insert({
      connector_account_id: connectorAccountId,
      status: 'ACTIVE',
      trigger_reason: reason,
      error_rate_at_trigger: value,
      started_at: new Date(),
    });

    // Demote by setting weight to 0 (still ACTIVE but won't be selected)
    await db('provider_accounts').where({ id: connectorAccountId }).update({
      weight: 0,
      updated_at: new Date(),
    });
  }

  /**
   * Restore a demoted connector
   */
  async restoreConnector(connectorAccountId: string): Promise<void> {
    const account = await db('provider_accounts').where({ id: connectorAccountId }).first();
    if (!account) return;

    // Resolve active outages
    await db('provider_outages')
      .where({ connector_account_id: connectorAccountId, status: 'ACTIVE' })
      .update({
        status: 'RESOLVED',
        resolved_at: new Date(),
        duration_minutes: 0, // TODO: Calculate
      });

    // Restore weight
    await db('provider_accounts').where({ id: connectorAccountId }).update({
      weight: 1,
      updated_at: new Date(),
    });
  }

  /**
   * Calculate health status
   */
  private calculateHealthStatus(successRate: number, avgLatencyMs: number): string {
    const thresholds = DEFAULT_THRESHOLDS;
    const errorRate = 100 - successRate;

    if (errorRate >= thresholds.errorRateCritical || avgLatencyMs >= thresholds.latencyCriticalMs) {
      return 'UNHEALTHY';
    }

    if (errorRate >= thresholds.errorRateWarning || avgLatencyMs >= thresholds.latencyWarningMs) {
      return 'DEGRADED';
    }

    return 'HEALTHY';
  }

  /**
   * Set custom thresholds for a merchant
   */
  setThresholds(merchantId: string, thresholds: Partial<HealthThreshold>): void {
    this.thresholds.set(merchantId, { ...DEFAULT_THRESHOLDS, ...thresholds });
  }

  /**
   * Get health dashboard data
   */
  async getDashboard(merchantId: string): Promise<{
    connectors: HealthMetrics[];
    alerts: HealthAlert[];
    outages: any[];
  }> {
    const accounts = await db('provider_accounts').where({ merchant_id: merchantId });

    const connectors: HealthMetrics[] = [];
    for (const account of accounts) {
      const metrics = await this.getHealthMetrics(account.id);
      if (metrics) {
        connectors.push(metrics);
      } else {
        // Return default healthy status for unused connectors
        connectors.push({
          connectorAccountId: account.id,
          provider: account.provider,
          healthStatus: 'HEALTHY',
          successRate: 100,
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          lastUpdated: new Date(),
        });
      }
    }

    const alerts = await this.checkHealth(merchantId);

    const outages = await db('provider_outages')
      .join('provider_accounts', 'provider_accounts.id', 'provider_outages.connector_account_id')
      .where('provider_accounts.merchant_id', merchantId)
      .where('provider_outages.status', 'ACTIVE')
      .select('provider_outages.*');

    return { connectors, alerts, outages };
  }
}

export const healthMonitorService = new HealthMonitorService();
