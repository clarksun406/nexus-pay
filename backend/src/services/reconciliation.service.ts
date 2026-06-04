import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';

export interface ReconciliationReport {
  id: string;
  merchantId: string;
  reportDate: Date;
  totalTransactions: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  disputedTransactions: number;
  totalAmount: number;
  matchedAmount: number;
  discrepancyAmount: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
}

export interface Discrepancy {
  id: string;
  reportId: string;
  paymentIntentId?: string;
  providerTransactionId?: string;
  discrepancyType: 'AMOUNT_MISMATCH' | 'MISSING_INTERNAL' | 'MISSING_EXTERNAL' | 'STATUS_MISMATCH';
  internalAmount?: number;
  externalAmount?: number;
  currency?: string;
  status: 'OPEN' | 'INVESTIGATING' | 'RESOLVED' | 'IGNORED';
  resolutionNotes?: string;
  resolvedBy?: string;
  resolvedAt?: Date;
}

export interface ProviderTransaction {
  id: string;
  merchantId: string;
  sourceId: string;
  providerTransactionId: string;
  paymentIntentId?: string;
  transactionType: 'PAYMENT' | 'REFUND' | 'CHARGEBACK';
  amount: number;
  currency: string;
  status: string;
  transactionTime: Date;
  feeAmount?: number;
  feeCurrency?: string;
  rawData?: string;
  reconciliationStatus: 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'DISPUTED';
}

export interface SettlementRecord {
  id: string;
  merchantId: string;
  settlementReference?: string;
  settlementAmount: number;
  settlementCurrency: string;
  feeAmount?: number;
  netAmount?: number;
  valueDate: Date;
  matchedTransactionsCount: number;
  discrepancyAmount: number;
  status: 'PENDING' | 'MATCHED' | 'UNMATCHED';
  rawData?: string;
}

class ReconciliationService {
  /**
   * Create reconciliation source
   */
  async createSource(
    merchantId: string,
    sourceType: 'PSP' | 'BANK',
    sourceName: string,
    connectorAccountId?: string,
    fetchConfig?: Record<string, any>
  ): Promise<string> {
    const [source] = await db('reconciliation_sources')
      .insert({
        merchant_id: merchantId,
        source_type: sourceType,
        source_name: sourceName,
        connector_account_id: connectorAccountId,
        fetch_config: JSON.stringify(fetchConfig),
      })
      .returning('*');

    return source.id;
  }

  /**
   * Import provider transactions
   */
  async importTransactions(
    sourceId: string,
    transactions: Array<{
      providerTransactionId: string;
      amount: number;
      currency: string;
      status: string;
      transactionTime: Date;
      transactionType: 'PAYMENT' | 'REFUND' | 'CHARGEBACK';
      feeAmount?: number;
      feeCurrency?: string;
      rawData?: any;
    }>
  ): Promise<{ imported: number; skipped: number }> {
    const source = await db('reconciliation_sources').where({ id: sourceId }).first();
    if (!source) throw new Error('Source not found');

    let imported = 0;
    let skipped = 0;

    for (const tx of transactions) {
      const existing = await db('provider_transactions')
        .where({ source_id: sourceId, provider_transaction_id: tx.providerTransactionId })
        .first();

      if (existing) {
        skipped++;
        continue;
      }

      await db('provider_transactions').insert({
        merchant_id: source.merchant_id,
        source_id: sourceId,
        provider_transaction_id: tx.providerTransactionId,
        transaction_type: tx.transactionType,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        transaction_time: tx.transactionTime,
        fee_amount: tx.feeAmount,
        fee_currency: tx.feeCurrency,
        raw_data: tx.rawData ? JSON.stringify(tx.rawData) : null,
        reconciliation_status: 'PENDING',
      });

      imported++;
    }

    await db('reconciliation_sources').where({ id: sourceId }).update({
      last_fetch_at: new Date(),
    });

    return { imported, skipped };
  }

  /**
   * Import a bank settlement file. Creates a settlement record and auto-matches
   * against provider_transactions / payment_intents for the same value date.
   */
  async importBankSettlement(
    merchantId: string,
    payload: {
      settlementReference?: string;
      settlementAmount: number;
      settlementCurrency: string;
      feeAmount?: number;
      netAmount?: number;
      valueDate: Date;
      transactions?: Array<{
        providerTransactionId: string;
        amount: number;
        currency: string;
        status?: string;
        transactionTime?: Date;
      }>;
      rawData?: any;
    }
  ): Promise<SettlementRecord> {
    const sourceId = await this.ensureBankSource(merchantId);

    const [record] = await db('settlement_records')
      .insert({
        merchant_id: merchantId,
        source_id: sourceId,
        settlement_reference: payload.settlementReference,
        settlement_amount: payload.settlementAmount,
        settlement_currency: payload.settlementCurrency,
        fee_amount: payload.feeAmount,
        net_amount: payload.netAmount,
        value_date: payload.valueDate,
        raw_data: payload.rawData ? JSON.stringify(payload.rawData) : null,
        status: 'PENDING',
      })
      .returning('*');

    if (payload.transactions && payload.transactions.length > 0) {
      await this.importTransactions(
        sourceId,
        payload.transactions.map((t) => ({
          providerTransactionId: t.providerTransactionId,
          amount: t.amount,
          currency: t.currency,
          status: t.status || 'settled',
          transactionTime: t.transactionTime || payload.valueDate,
          transactionType: 'PAYMENT',
        }))
      );
    }

    const valueDayStart = new Date(payload.valueDate);
    valueDayStart.setHours(0, 0, 0, 0);
    const valueDayEnd = new Date(payload.valueDate);
    valueDayEnd.setHours(23, 59, 59, 999);

    const matchedTxs = await db('provider_transactions')
      .where({ merchant_id: merchantId })
      .whereBetween('transaction_time', [valueDayStart, valueDayEnd]);

    const matchedSum = matchedTxs.reduce((s: number, t: any) => s + (t.amount || 0), 0);
    const discrepancy = Math.abs(payload.settlementAmount - matchedSum);

    const finalStatus = discrepancy === 0 ? 'MATCHED' : 'UNMATCHED';

    await db('settlement_records').where({ id: record.id }).update({
      matched_transactions_count: matchedTxs.length,
      discrepancy_amount: discrepancy,
      status: finalStatus,
    });

    return {
      id: record.id,
      merchantId: record.merchant_id,
      settlementReference: record.settlement_reference,
      settlementAmount: record.settlement_amount,
      settlementCurrency: record.settlement_currency,
      feeAmount: record.fee_amount,
      netAmount: record.net_amount,
      valueDate: record.value_date,
      matchedTransactionsCount: matchedTxs.length,
      discrepancyAmount: discrepancy,
      status: finalStatus,
      rawData: record.raw_data,
    };
  }

  /**
   * List bank settlements for a merchant within a date range.
   */
  async listSettlements(merchantId: string, from: Date, to: Date): Promise<SettlementRecord[]> {
    const rows = await db('settlement_records')
      .where({ merchant_id: merchantId })
      .whereBetween('value_date', [from, to])
      .orderBy('value_date', 'desc');

    return rows.map((r: any) => ({
      id: r.id,
      merchantId: r.merchant_id,
      settlementReference: r.settlement_reference,
      settlementAmount: r.settlement_amount,
      settlementCurrency: r.settlement_currency,
      feeAmount: r.fee_amount,
      netAmount: r.net_amount,
      valueDate: r.value_date,
      matchedTransactionsCount: r.matched_transactions_count,
      discrepancyAmount: r.discrepancy_amount,
      status: r.status,
      rawData: r.raw_data,
    }));
  }

  private async ensureBankSource(merchantId: string): Promise<string> {
    const existing = await db('reconciliation_sources')
      .where({ merchant_id: merchantId, source_type: 'BANK' })
      .first();
    if (existing) return existing.id;
    return this.createSource(merchantId, 'BANK', 'Default Bank Settlement');
  }

  /**
   * Run reconciliation for a specific date
   */
  async runReconciliation(merchantId: string, reportDate: Date): Promise<ReconciliationReport> {
    let report = await db('reconciliation_reports')
      .where({ merchant_id: merchantId, report_date: reportDate })
      .first();

    if (!report) {
      const [created] = await db('reconciliation_reports')
        .insert({
          merchant_id: merchantId,
          report_date: reportDate,
          status: 'IN_PROGRESS',
        })
        .returning('*');
      report = created;
    } else if (report.status === 'COMPLETED') {
      return report;
    }

    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    const internalPayments = await db('payment_intents')
      .where({ merchant_id: merchantId })
      .whereBetween('created_at', [startOfDay, endOfDay])
      .whereNotNull('provider_payment_id');

    const externalTransactions = await db('provider_transactions')
      .where({ merchant_id: merchantId })
      .whereBetween('transaction_time', [startOfDay, endOfDay]);

    let matchedTransactions = 0;
    let unmatchedTransactions = 0;
    let disputedTransactions = 0;
    let totalAmount = 0;
    let matchedAmount = 0;
    let discrepancyAmount = 0;

    for (const extTx of externalTransactions) {
      totalAmount += extTx.amount;

      const internalMatch = internalPayments.find(
        (ip) =>
          ip.provider_payment_id === extTx.provider_transaction_id ||
          ip.id === extTx.payment_intent_id
      );

      if (internalMatch) {
        if (internalMatch.amount !== extTx.amount) {
          await this.createDiscrepancy({
            reportId: report.id,
            paymentIntentId: internalMatch.id,
            providerTransactionId: extTx.id,
            discrepancyType: 'AMOUNT_MISMATCH',
            internalAmount: internalMatch.amount,
            externalAmount: extTx.amount,
            currency: extTx.currency,
          });

          disputedTransactions++;
          discrepancyAmount += Math.abs(internalMatch.amount - extTx.amount);
        } else {
          matchedTransactions++;
          matchedAmount += extTx.amount;

          await db('provider_transactions').where({ id: extTx.id }).update({
            payment_intent_id: internalMatch.id,
            reconciliation_status: 'MATCHED',
            reconciled_at: new Date(),
          });
        }
      } else {
        await this.createDiscrepancy({
          reportId: report.id,
          providerTransactionId: extTx.id,
          discrepancyType: 'MISSING_INTERNAL',
          externalAmount: extTx.amount,
          currency: extTx.currency,
        });

        unmatchedTransactions++;
        await db('provider_transactions').where({ id: extTx.id }).update({
          reconciliation_status: 'UNMATCHED',
        });
      }
    }

    for (const intTx of internalPayments) {
      const externalMatch = externalTransactions.find(
        (et) =>
          et.provider_transaction_id === intTx.provider_payment_id ||
          et.payment_intent_id === intTx.id
      );

      if (!externalMatch) {
        await this.createDiscrepancy({
          reportId: report.id,
          paymentIntentId: intTx.id,
          discrepancyType: 'MISSING_EXTERNAL',
          internalAmount: intTx.amount,
          currency: intTx.currency,
        });

        unmatchedTransactions++;
      }
    }

    const [updated] = await db('reconciliation_reports')
      .where({ id: report.id })
      .update({
        total_transactions: externalTransactions.length,
        matched_transactions: matchedTransactions,
        unmatched_transactions: unmatchedTransactions,
        disputed_transactions: disputedTransactions,
        total_amount: totalAmount,
        matched_amount: matchedAmount,
        discrepancy_amount: discrepancyAmount,
        status: 'COMPLETED',
      })
      .returning('*');

    return updated;
  }

  /**
   * Historical backfill: run reconciliation for every day in [fromDate, toDate].
   * Caps at 366 days to bound work; supports forceRerun to rebuild completed reports.
   */
  async runHistoricalReconciliation(
    merchantId: string,
    fromDate: Date,
    toDate: Date,
    options: { forceRerun?: boolean } = {}
  ): Promise<{
    reportsGenerated: number;
    reportsSkipped: number;
    reportsFailed: number;
    reports: ReconciliationReport[];
  }> {
    if (fromDate > toDate) {
      throw new Error('fromDate must be before or equal toDate');
    }
    const spanMs = toDate.getTime() - fromDate.getTime();
    if (spanMs > 366 * 24 * 60 * 60 * 1000) {
      throw new Error('Historical backfill range cannot exceed 366 days');
    }

    const reports: ReconciliationReport[] = [];
    let reportsGenerated = 0;
    let reportsSkipped = 0;
    let reportsFailed = 0;

    const cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(0, 0, 0, 0);

    while (cursor <= end) {
      const day = new Date(cursor);
      try {
        const existing = await db('reconciliation_reports')
          .where({ merchant_id: merchantId, report_date: day })
          .first();

        if (existing && existing.status === 'COMPLETED' && !options.forceRerun) {
          reportsSkipped++;
          reports.push(existing);
        } else if (existing && options.forceRerun) {
          await db('reconciliation_discrepancies').where({ report_id: existing.id }).del();
          await db('reconciliation_reports').where({ id: existing.id }).del();
          const r = await this.runReconciliation(merchantId, day);
          reports.push(r);
          reportsGenerated++;
        } else {
          const r = await this.runReconciliation(merchantId, day);
          reports.push(r);
          reportsGenerated++;
        }
      } catch (err) {
        reportsFailed++;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return { reportsGenerated, reportsSkipped, reportsFailed, reports };
  }

  private async createDiscrepancy(data: {
    reportId: string;
    paymentIntentId?: string;
    providerTransactionId?: string;
    discrepancyType: Discrepancy['discrepancyType'];
    internalAmount?: number;
    externalAmount?: number;
    currency?: string;
  }): Promise<void> {
    await db('reconciliation_discrepancies').insert({
      report_id: data.reportId,
      payment_intent_id: data.paymentIntentId,
      provider_transaction_id: data.providerTransactionId,
      discrepancy_type: data.discrepancyType,
      internal_amount: data.internalAmount,
      external_amount: data.externalAmount,
      currency: data.currency,
      status: 'OPEN',
    });
  }

  /**
   * Resolve a discrepancy
   */
  async resolveDiscrepancy(
    discrepancyId: string,
    userId: string,
    resolution: 'RESOLVED' | 'IGNORED',
    notes?: string
  ): Promise<void> {
    await db('reconciliation_discrepancies').where({ id: discrepancyId }).update({
      status: resolution,
      resolution_notes: notes,
      resolved_by: userId,
      resolved_at: new Date(),
    });
  }

  /**
   * Get reconciliation reports
   */
  async getReports(
    merchantId: string,
    from: Date,
    to: Date
  ): Promise<ReconciliationReport[]> {
    return db('reconciliation_reports')
      .where({ merchant_id: merchantId })
      .whereBetween('report_date', [from, to])
      .orderBy('report_date', 'desc');
  }

  /**
   * Get discrepancies for a report
   */
  async getDiscrepancies(reportId: string): Promise<Discrepancy[]> {
    const rows = await db('reconciliation_discrepancies').where({ report_id: reportId });

    return rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      paymentIntentId: r.payment_intent_id,
      providerTransactionId: r.provider_transaction_id,
      discrepancyType: r.discrepancy_type,
      internalAmount: r.internal_amount,
      externalAmount: r.external_amount,
      currency: r.currency,
      status: r.status,
      resolutionNotes: r.resolution_notes,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
    }));
  }

  /**
   * Get open discrepancies
   */
  async getOpenDiscrepancies(merchantId: string): Promise<Discrepancy[]> {
    const rows = await db('reconciliation_discrepancies')
      .join('reconciliation_reports', 'reconciliation_reports.id', 'reconciliation_discrepancies.report_id')
      .where('reconciliation_reports.merchant_id', merchantId)
      .where('reconciliation_discrepancies.status', 'OPEN')
      .select('reconciliation_discrepancies.*');

    return rows.map((r) => ({
      id: r.id,
      reportId: r.report_id,
      paymentIntentId: r.payment_intent_id,
      providerTransactionId: r.provider_transaction_id,
      discrepancyType: r.discrepancy_type,
      internalAmount: r.internal_amount,
      externalAmount: r.external_amount,
      currency: r.currency,
      status: r.status,
      resolutionNotes: r.resolution_notes,
      resolvedBy: r.resolved_by,
      resolvedAt: r.resolved_at,
    }));
  }

  /**
   * Calculate reconciliation summary
   */
  async getSummary(merchantId: string, from: Date, to: Date): Promise<{
    totalReports: number;
    totalTransactions: number;
    matchedTransactions: number;
    unmatchedTransactions: number;
    disputedTransactions: number;
    totalAmount: number;
    matchedAmount: number;
    discrepancyAmount: number;
    matchRate: number;
  }> {
    const rawReports = await db('reconciliation_reports')
      .where({ merchant_id: merchantId })
      .whereBetween('report_date', [from, to]);

    const summary = {
      totalReports: rawReports.length,
      totalTransactions: rawReports.reduce((sum: number, r: any) => sum + (r.total_transactions || 0), 0),
      matchedTransactions: rawReports.reduce((sum: number, r: any) => sum + (r.matched_transactions || 0), 0),
      unmatchedTransactions: rawReports.reduce((sum: number, r: any) => sum + (r.unmatched_transactions || 0), 0),
      disputedTransactions: rawReports.reduce((sum: number, r: any) => sum + (r.disputed_transactions || 0), 0),
      totalAmount: rawReports.reduce((sum: number, r: any) => sum + (r.total_amount || 0), 0),
      matchedAmount: rawReports.reduce((sum: number, r: any) => sum + (r.matched_amount || 0), 0),
      discrepancyAmount: rawReports.reduce((sum: number, r: any) => sum + (r.discrepancy_amount || 0), 0),
      matchRate: 0,
    };

    summary.matchRate =
      summary.totalTransactions > 0
        ? (summary.matchedTransactions / summary.totalTransactions) * 100
        : 0;

    return summary;
  }
}

export const reconciliationService = new ReconciliationService();
