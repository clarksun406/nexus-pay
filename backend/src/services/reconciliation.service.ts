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
   * Run reconciliation for a specific date
   */
  async runReconciliation(merchantId: string, reportDate: Date): Promise<ReconciliationReport> {
    // Create or get report
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

    // Get all transactions for the date
    const startOfDay = new Date(reportDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(reportDate);
    endOfDay.setHours(23, 59, 59, 999);

    // Internal transactions
    const internalPayments = await db('payment_intents')
      .where({ merchant_id: merchantId })
      .whereBetween('created_at', [startOfDay, endOfDay])
      .whereNotNull('provider_payment_id');

    // External transactions from providers
    const externalTransactions = await db('provider_transactions')
      .where({ merchant_id: merchantId })
      .whereBetween('transaction_time', [startOfDay, endOfDay]);

    let matchedTransactions = 0;
    let unmatchedTransactions = 0;
    let disputedTransactions = 0;
    let totalAmount = 0;
    let matchedAmount = 0;
    let discrepancyAmount = 0;

    // Match transactions
    for (const extTx of externalTransactions) {
      totalAmount += extTx.amount;

      // Try to match by provider payment ID
      const internalMatch = internalPayments.find(
        (ip) =>
          ip.provider_payment_id === extTx.provider_transaction_id ||
          ip.id === extTx.payment_intent_id
      );

      if (internalMatch) {
        // Check for amount mismatch
        if (internalMatch.amount !== extTx.amount) {
          // Create discrepancy
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
        // No internal match
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

    // Check for missing external transactions
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

    // Update report
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
   * Create a discrepancy record
   */
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
    const reports = await this.getReports(merchantId, from, to);

    const summary = {
      totalReports: reports.length,
      totalTransactions: reports.reduce((sum, r) => sum + r.total_transactions, 0),
      matchedTransactions: reports.reduce((sum, r) => sum + r.matched_transactions, 0),
      unmatchedTransactions: reports.reduce((sum, r) => sum + r.unmatched_transactions, 0),
      disputedTransactions: reports.reduce((sum, r) => sum + r.disputed_transactions, 0),
      totalAmount: reports.reduce((sum, r) => sum + (r.total_amount || 0), 0),
      matchedAmount: reports.reduce((sum, r) => sum + (r.matched_amount || 0), 0),
      discrepancyAmount: reports.reduce((sum, r) => sum + (r.discrepancy_amount || 0), 0),
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
