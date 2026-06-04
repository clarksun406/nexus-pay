import db from '../db/connection';

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
  p99LatencyMs: number;
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

export interface LatencyTrend {
  period: string; // YYYY-MM-DD or YYYY-MM-DD HH:00
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  sampleCount: number;
}

const DEFAULT_THRESHOLDS: HealthThreshold = {
  errorRateWarning: 5,
  errorRateCritical: 15,
  latencyWarningMs: 2000,
  latencyCriticalMs: 5000,
  minSampleSize: 10,
};

/**
 * Calculate the p-th percentile from a sorted array of numbers using nearest-rank.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

class HealthMonitorService {
  private thresholds: Map<string, HealthThreshold> = new Map();

  /**
   * Record a payment request result, including a latency sample for p95/p99.
   */
  async recordRequest(
    connectorAccountId: string,
    success: boolean,
    latencyMs: number
  ): Promise<void> {
    const now = new Date();
    const metricTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours());

    // Persist latency sample
    await db('request_latency_samples').insert({
      connector_account_id: connectorAccountId,
      latency_ms: latencyMs,
      success,
      recorded_at: now,
    });

    // Upsert hourly metrics
    const existing = await db('provider_health_metrics')
      .where({ connector_account_id: connectorAccountId, metric_time: metricTime })
      .first();

    if (existing) {
      const newTotal = existing.total_requests + 1;
      const newSuccess = existing.successful_requests + (success ? 1 : 0);
      const newFailed = existing.failed_requests + (success ? 0 : 1);
      const successRate = (newSuccess / newTotal) * 100;

      // Compute live p95/p99 from samples within this hour bucket
      const { avgLatency, p95, p99 } = await this.computeLatencyStats(connectorAccountId, metricTime, now);

      await db('provider_health_metrics').where({ id: existing.id }).update({
        total_requests: newTotal,
        successful_requests: newSuccess,
        failed_requests: newFailed,
        success_rate: successRate,
        avg_latency_ms: avgLatency,
        p95_latency_ms: p95,
        p99_latency_ms: p99,
        sample_count: newTotal,
        health_status: this.calculateHealthStatus(successRate, avgLatency),
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
        avg_latency_ms: latencyMs,
        p95_latency_ms: latencyMs,
        p99_latency_ms: latencyMs,
        sample_count: 1,
        health_status: 'HEALTHY',
      });
    }

    // Retention: purge samples older than 7 days
    await db('request_latency_samples')
      .where('recorded_at', '<', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
      .del();
  }

  /**
   * Compute avg / p95 / p99 from latency samples within a window.
   */
  private async computeLatencyStats(
    connectorAccountId: string,
    from: Date,
    to: Date
  ): Promise<{ avgLatency: number; p95: number; p99: number }> {
    const samples = await db('request_latency_samples')
      .where({ connector_account_id: connectorAccountId })
      .whereBetween('recorded_at', [from, to])
      .select('latency_ms');

    if (samples.length === 0) return { avgLatency: 0, p95: 0, p99: 0 };

    const values = samples.map((s: any) => s.latency_ms).sort((a: number, b: number) => a - b);
    const sum = values.reduce((a: number, b: number) => a + b, 0);
    return {
      avgLatency: Math.round(sum / values.length),
      p95: percentile(values, 95),
      p99: percentile(values, 99),
    };
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

    const totalRequests = metrics.reduce((sum: number, m: any) => sum + m.total_requests, 0);
    const successfulRequests = metrics.reduce((sum: number, m: any) => sum + m.successful_requests, 0);
    const failedRequests = metrics.reduce((sum: number, m: any) => sum + m.failed_requests, 0);
    const successRate = totalRequests > 0 ? (successfulRequests / totalRequests) * 100 : 100;

    // Weighted average of persisted percentiles
    let weightedAvg = 0;
    let weightedP95 = 0;
    let weightedP99 = 0;
    let weightSum = 0;
    for (const m of metrics) {
      const w = m.sample_count || m.total_requests || 1;
      weightedAvg += (m.avg_latency_ms || 0) * w;
      weightedP95 += (m.p95_latency_ms || 0) * w;
      weightedP99 += (m.p99_latency_ms || 0) * w;
      weightSum += w;
    }

    return {
      connectorAccountId,
      provider: account.provider,
      healthStatus: metrics[metrics.length - 1]?.health_status || 'HEALTHY',
      successRate,
      totalRequests,
      successfulRequests,
      failedRequests,
      avgLatencyMs: weightSum > 0 ? Math.round(weightedAvg / weightSum) : 0,
      p95LatencyMs: weightSum > 0 ? Math.round(weightedP95 / weightSum) : 0,
      p99LatencyMs: weightSum > 0 ? Math.round(weightedP99 / weightSum) : 0,
      lastUpdated: new Date(),
    };
  }

  /**
   * Latency trend over time (hourly or daily granularity).
   */
  async getLatencyTrend(
    connectorAccountId: string,
    from: Date,
    to: Date,
    granularity: 'hour' | 'day' = 'hour'
  ): Promise<LatencyTrend[]> {
    const fmt = granularity === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
    const rows = await db('provider_health_metrics')
      .where({ connector_account_id: connectorAccountId })
      .whereBetween('metric_time', [from, to])
      .select(
        db.raw(`to_char(metric_time, '${fmt}') as period`),
        db.raw('SUM(total_requests) as sample_count'),
        db.raw('AVG(avg_latency_ms)::int as avg_latency_ms'),
        db.raw('AVG(p95_latency_ms)::int as p95_latency_ms'),
        db.raw('AVG(p99_latency_ms)::int as p99_latency_ms')
      )
      .groupByRaw(`to_char(metric_time, '${fmt}')`)
      .orderBy('period', 'asc');

    return rows.map((r: any) => ({
      period: r.period,
      avgLatencyMs: r.avg_latency_ms || 0,
      p95LatencyMs: r.p95_latency_ms || 0,
      p99LatencyMs: r.p99_latency_ms || 0,
      sampleCount: parseInt(r.sample_count, 10) || 0,
    }));
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

      // Check latency
      if (metrics.p95LatencyMs >= thresholds.latencyCriticalMs) {
        await this.demoteConnector(account.id, 'LATENCY', metrics.p95LatencyMs);
        alerts.push({
          id: '',
          connectorAccountId: account.id,
          alertType: 'LATENCY',
          severity: 'CRITICAL',
          message: `p95 latency ${metrics.p95LatencyMs}ms exceeds critical threshold ${thresholds.latencyCriticalMs}ms`,
          metrics: { p95LatencyMs: metrics.p95LatencyMs, threshold: thresholds.latencyCriticalMs },
          status: 'ACTIVE',
          createdAt: new Date(),
        });
      } else if (metrics.p95LatencyMs >= thresholds.latencyWarningMs) {
        alerts.push({
          id: '',
          connectorAccountId: account.id,
          alertType: 'LATENCY',
          severity: 'WARNING',
          message: `p95 latency ${metrics.p95LatencyMs}ms exceeds warning threshold ${thresholds.latencyWarningMs}ms`,
          metrics: { p95LatencyMs: metrics.p95LatencyMs, threshold: thresholds.latencyWarningMs },
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

    const outage = await db('provider_outages')
      .where({ connector_account_id: connectorAccountId, status: 'ACTIVE' })
      .orderBy('started_at', 'desc')
      .first();

    const durationMinutes = outage
      ? Math.round((Date.now() - new Date(outage.started_at).getTime()) / 60000)
      : 0;

    // Resolve active outages
    await db('provider_outages')
      .where({ connector_account_id: connectorAccountId, status: 'ACTIVE' })
      .update({
        status: 'RESOLVED',
        resolved_at: new Date(),
        duration_minutes: durationMinutes,
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
          p99LatencyMs: 0,
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
