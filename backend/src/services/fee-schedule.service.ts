import db from '../db/connection';
import { computeFee } from './fee-calculator';

// ── Types ──

export interface FeeSchedule {
  id: string;
  merchantId: string;
  name: string;
  provider: string | null;
  feeType: 'PERCENTAGE_FLAT' | 'PERCENTAGE_TIERED' | 'FLAT';
  config: FeeScheduleConfig;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FeeScheduleConfig {
  /** Flat percentage (e.g. 2.9 = 2.9%) */
  percentage?: number;
  /** Flat fee in minor units (e.g. 30 = 30¢) */
  fixed?: number;
  /** Volume-based tiers: each tier is a bracket */
  tiers?: FeeTier[];
}

export interface FeeTier {
  /** Min amount in minor units (inclusive), null = no floor */
  min?: number | null;
  /** Max amount in minor units (exclusive), null = no ceiling */
  max?: number | null;
  /** Percentage for this tier */
  percentage: number;
  /** Fixed fee in minor units */
  fixed?: number;
}

export interface CostPreview {
  amount: number;
  currency: string;
  feeBps: number;
  feeAmount: number;
  netAmount: number;
  scheduleName: string;
  breakdown: {
    percentage: number;
    fixed: number;
    variableAmount: number;
  };
}

export interface CostReportEntry {
  connectorAccountId: string;
  connectorName: string;
  provider: string;
  period: string;
  totalVolume: number;
  totalFees: number;
  expectedFees: number;
  transactionCount: number;
  avgFeeBps: number;
  feeVariance: number;
  anomalyCount: number;
}

export interface FeeAnomaly {
  id: string;
  merchantId: string;
  connectorAccountId: string | null;
  paymentIntentId: string | null;
  expectedFee: number;
  actualFee: number;
  variance: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  notes: string | null;
  resolved: boolean;
  createdAt: string;
}

// ── Service ──

class FeeScheduleService {
  // ══════════════════════════════════════════════════
  //  Fee Schedule CRUD
  // ══════════════════════════════════════════════════

  async create(merchantId: string, body: any): Promise<FeeSchedule> {
    const [row] = await db('fee_schedules').insert({
      merchant_id: merchantId,
      name: body.name,
      provider: body.provider || null,
      fee_type: body.feeType || 'PERCENTAGE_FLAT',
      config: JSON.stringify(body.config || { percentage: 0, fixed: 0 }),
      enabled: body.enabled !== false,
    }).returning('*');

    return this._toSchedule(row);
  }

  async list(merchantId: string): Promise<FeeSchedule[]> {
    const rows = await db('fee_schedules')
      .where({ merchant_id: merchantId })
      .orderBy('created_at', 'desc');
    return rows.map(r => this._toSchedule(r));
  }

  async get(merchantId: string, scheduleId: string): Promise<FeeSchedule> {
    const row = await db('fee_schedules')
      .where({ id: scheduleId, merchant_id: merchantId })
      .first();
    if (!row) throw Object.assign(new Error('Fee schedule not found'), { status: 404 });
    return this._toSchedule(row);
  }

  async update(merchantId: string, scheduleId: string, body: any): Promise<FeeSchedule> {
    const row = await db('fee_schedules')
      .where({ id: scheduleId, merchant_id: merchantId })
      .first();
    if (!row) throw Object.assign(new Error('Fee schedule not found'), { status: 404 });

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.provider !== undefined) updates.provider = body.provider || null;
    if (body.feeType !== undefined) updates.fee_type = body.feeType;
    if (body.config !== undefined) updates.config = JSON.stringify(body.config);
    if (body.enabled !== undefined) updates.enabled = body.enabled;

    const [updated] = await db('fee_schedules')
      .where({ id: scheduleId })
      .update(updates)
      .returning('*');
    return this._toSchedule(updated);
  }

  async delete(merchantId: string, scheduleId: string): Promise<void> {
    await db('fee_schedules').where({ id: scheduleId, merchant_id: merchantId }).delete();
  }

  // ══════════════════════════════════════════════════
  //  Cost Preview
  // ══════════════════════════════════════════════════

  /**
   * Preview the cost for a given amount using a fee schedule or connector.
   */
  async previewCost(
    merchantId: string,
    amount: number,
    currency: string,
    scheduleId?: string,
    connectorAccountId?: string
  ): Promise<CostPreview> {
    let cfg: FeeScheduleConfig | null = null;
    let scheduleName = '';

    if (scheduleId) {
      const schedule = await this.get(merchantId, scheduleId);
      cfg = schedule.config;
      scheduleName = schedule.name;
    } else if (connectorAccountId) {
      const account = await db('provider_accounts')
        .where({ id: connectorAccountId, merchant_id: merchantId })
        .first();
      if (!account) throw Object.assign(new Error('Connector account not found'), { status: 404 });
      if (account.fee_config) {
        try { cfg = JSON.parse(account.fee_config); } catch { cfg = null; }
      }
      scheduleName = account.name || account.provider || 'Unknown';
    } else {
      throw Object.assign(new Error('Either scheduleId or connectorAccountId is required'), { status: 400 });
    }

    const fee = this._computeFeeFromConfig(amount, cfg);
    const feeBps = amount > 0 ? Math.round((fee * 10_000) / amount) : 0;
    const breakdown = this._breakdown(amount, cfg);

    return {
      amount,
      currency,
      feeBps,
      feeAmount: fee,
      netAmount: Math.max(0, amount - fee),
      scheduleName,
      breakdown,
    };
  }

  // ══════════════════════════════════════════════════
  //  Cost Report
  // ══════════════════════════════════════════════════

  /**
   * Aggregate cost analytics for a merchant over a date range.
   * Groups by connector_account_id per month.
   */
  async getCostReport(
    merchantId: string,
    from: string,  // "2026-01"
    to: string     // "2026-06"
  ): Promise<CostReportEntry[]> {
    const rows = await db('cost_analytics')
      .where({ merchant_id: merchantId })
      .where('period', '>=', from)
      .where('period', '<=', to)
      .orderBy('period', 'asc');

    const accountIds = [...new Set(rows.map((r: any) => r.connector_account_id))];
    const accounts: any[] = accountIds.length
      ? await db('provider_accounts').whereIn('id', accountIds)
      : [];

    const accountMap = new Map(accounts.map((a: any) => [a.id, a]));

    return rows.map((r: any) => ({
      connectorAccountId: r.connector_account_id,
      connectorName: accountMap.get(r.connector_account_id)?.name || r.connector_account_id || 'N/A',
      provider: accountMap.get(r.connector_account_id)?.provider || '',
      period: r.period,
      totalVolume: Number(r.total_volume),
      totalFees: Number(r.total_fees),
      expectedFees: Number(r.expected_fees),
      transactionCount: Number(r.transaction_count),
      avgFeeBps: Number(r.avg_fee_bps),
      feeVariance: Number(r.fee_variance),
      anomalyCount: Number(r.anomaly_count),
    }));
  }

  // ══════════════════════════════════════════════════
  //  Anomaly Detection
  // ══════════════════════════════════════════════════

  /**
   * Detect fee anomalies by comparing PSP-reported fees against expected fees
   * for recent transactions where fee data is available.
   */
  async detectAnomalies(merchantId: string): Promise<{ anomalies: FeeAnomaly[]; created: number }> {
    // Scan recent provider_transactions that have fee_amount set
    const transactions = await db('provider_transactions')
      .where('merchant_id', merchantId)
      .whereNotNull('fee_amount')
      .where('transaction_time', '>=', db.raw("now() - interval '7 days'"))
      .orderBy('transaction_time', 'desc')
      .limit(200);

    let created = 0;
    const anomalies: FeeAnomaly[] = [];

    for (const tx of transactions) {
      // Compute expected fee based on the connector's fee_config
      const account = await db('provider_accounts')
        .where({ id: tx.connector_account_id })
        .first();
      if (!account?.fee_config) continue;

      let feeConfig: any = null;
      try { feeConfig = JSON.parse(account.fee_config); } catch { continue; }

      const expectedFee = computeFee(Number(tx.amount), feeConfig);
      const actualFee = Number(tx.fee_amount);
      const variance = Math.abs(actualFee - expectedFee);

      // Only flag if variance > 20% of expected and > 10 cents
      if (expectedFee <= 0 || variance <= 10 || variance <= expectedFee * 0.2) continue;

      const severity: 'INFO' | 'WARNING' | 'CRITICAL' =
        variance > expectedFee * 0.5 ? 'CRITICAL' :
        variance > expectedFee * 0.3 ? 'WARNING' : 'INFO';

      // Check if already logged
      const existing = await db('fee_anomalies')
        .where({ payment_intent_id: tx.payment_intent_id })
        .first();
      if (existing) continue;

      const notes = `Tx ${tx.provider_transaction_id || tx.id}: expected ${expectedFee}, actual ${actualFee} (${actualFee > expectedFee ? 'over' : 'under'} by ${variance})`;

      const [row] = await db('fee_anomalies').insert({
        merchant_id: merchantId,
        connector_account_id: tx.connector_account_id,
        payment_intent_id: tx.payment_intent_id,
        expected_fee: expectedFee,
        actual_fee: actualFee,
        variance,
        severity,
        notes,
      }).returning('*');

      created++;
      anomalies.push(this._toAnomaly(row));
    }

    return { anomalies, created };
  }

  async listAnomalies(
    merchantId: string,
    filters?: { severity?: string; resolved?: boolean }
  ): Promise<FeeAnomaly[]> {
    const query = db('fee_anomalies').where({ merchant_id: merchantId });
    if (filters?.severity) query.where({ severity: filters.severity });
    if (filters?.resolved !== undefined) query.where({ resolved: filters.resolved });

    const rows = await query.orderBy('created_at', 'desc').limit(100);
    return rows.map(r => this._toAnomaly(r));
  }

  async resolveAnomaly(merchantId: string, anomalyId: string): Promise<void> {
    const updated = await db('fee_anomalies')
      .where({ id: anomalyId, merchant_id: merchantId })
      .update({ resolved: true, resolved_at: new Date() });
    if (!updated) throw Object.assign(new Error('Anomaly not found'), { status: 404 });
  }

  // ══════════════════════════════════════════════════
  //  Aggregation (called by scheduler)
  // ══════════════════════════════════════════════════

  /**
   * Run monthly cost aggregation for a merchant. Reads from payment_intents
   * that have fee_amount set and writes/updates cost_analytics rows.
   */
  async aggregateMonthly(merchantId: string, period: string): Promise<void> {
    // group by connector_account_id for the given period
    const [year, month] = period.split('-');
    const startDate = `${year}-${month}-01`;
    const endDateRaw = month === '12' ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;

    const groups = await db('payment_intents')
      .select('connector_account_id')
      .sum('amount as total_volume')
      .sum('fee_amount as total_fees')
      .count('* as tx_count')
      .where({ merchant_id: merchantId })
      .whereNotNull('fee_amount')
      .where('created_at', '>=', startDate)
      .where('created_at', '<', endDateRaw)
      .groupBy('connector_account_id');

    for (const g of groups) {
      const accountId: string | null = (g as any).connector_account_id;
      const totalVolume = Number((g as any).total_volume || 0);
      const totalFees = Number((g as any).total_fees || 0);
      const txCount = Number((g as any).tx_count || 0);
      const avgFeeBps = totalVolume > 0 ? Math.round((totalFees * 10_000) / totalVolume) : 0;

      // Compute expected fees for these transactions
      let expectedFees = 0;
      if (accountId) {
        const account = await db('provider_accounts').where({ id: accountId }).first();
        if (account?.fee_config) {
          let cfg: any = null;
          try { cfg = JSON.parse(account.fee_config); } catch { /* ignore */ }
          if (cfg) {
            const txs = await db('payment_intents')
              .select('amount')
              .where({ merchant_id: merchantId, connector_account_id: accountId })
              .whereNotNull('fee_amount')
              .where('created_at', '>=', startDate)
              .where('created_at', '<', endDateRaw);
            expectedFees = txs.reduce((sum: number, tx: any) => sum + computeFee(Number(tx.amount), cfg), 0);
          }
        }
      }

      const feeVariance = totalFees - expectedFees;
      const anomalyCount = await db('fee_anomalies')
        .where({ merchant_id: merchantId, connector_account_id: accountId })
        .where('created_at', '>=', startDate)
        .where('created_at', '<', endDateRaw)
        .count('* as count')
        .first();

      await db('cost_analytics')
        .insert({
          merchant_id: merchantId,
          connector_account_id: accountId,
          period,
          total_volume: totalVolume,
          total_fees: totalFees,
          expected_fees: expectedFees,
          transaction_count: txCount,
          avg_fee_bps: avgFeeBps,
          fee_variance: feeVariance,
          anomaly_count: Number((anomalyCount as any)?.count || 0),
        })
        .onConflict(['merchant_id', 'connector_account_id', 'period'])
        .merge();
    }
  }

  // ══════════════════════════════════════════════════
  //  Internal helpers
  // ══════════════════════════════════════════════════

  private _computeFeeFromConfig(amount: number, cfg: FeeScheduleConfig | null): number {
    if (!cfg || amount <= 0) return 0;

    // Tiered: find matching tier
    if (cfg.tiers?.length) {
      const tier = cfg.tiers.find(t => {
        const minOk = t.min == null || amount >= t.min;
        const maxOk = t.max == null || amount < t.max;
        return minOk && maxOk;
      });
      if (tier) {
        const fixed = tier.fixed || 0;
        const variable = Math.round((amount * tier.percentage) / 100);
        const total = fixed + variable;
        return total > amount ? amount : total;
      }
    }

    // Flat percentage + fixed
    return computeFee(amount, { fixed: cfg.fixed || 0, percentage: cfg.percentage || 0 });
  }

  private _breakdown(amount: number, cfg: FeeScheduleConfig | null): { percentage: number; fixed: number; variableAmount: number } {
    if (!cfg) return { percentage: 0, fixed: 0, variableAmount: 0 };

    if (cfg.tiers?.length) {
      const tier = cfg.tiers.find(t => {
        const minOk = t.min == null || amount >= t.min;
        const maxOk = t.max == null || amount < t.max;
        return minOk && maxOk;
      });
      if (tier) {
        return {
          percentage: tier.percentage,
          fixed: tier.fixed || 0,
          variableAmount: Math.round((amount * tier.percentage) / 100),
        };
      }
    }

    const pct = cfg.percentage || 0;
    const fixed = cfg.fixed || 0;
    return { percentage: pct, fixed, variableAmount: Math.round((amount * pct) / 100) };
  }

  private _toSchedule(row: any): FeeSchedule {
    let config: FeeScheduleConfig = {};
    try { config = JSON.parse(row.config); } catch { /* ignore */ }
    return {
      id: row.id,
      merchantId: row.merchant_id,
      name: row.name,
      provider: row.provider,
      feeType: row.fee_type,
      config,
      enabled: row.enabled,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private _toAnomaly(row: any): FeeAnomaly {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      connectorAccountId: row.connector_account_id,
      paymentIntentId: row.payment_intent_id,
      expectedFee: Number(row.expected_fee),
      actualFee: Number(row.actual_fee),
      variance: Number(row.variance),
      severity: row.severity,
      notes: row.notes,
      resolved: row.resolved,
      createdAt: row.created_at,
    };
  }
}

export const feeScheduleService = new FeeScheduleService();
