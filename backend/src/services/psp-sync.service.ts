import db from '../db/connection';
import { decrypt } from '../utils/crypto';
import { reconciliationService } from './reconciliation.service';

export interface PspSyncResult {
  imported: number;
  skipped: number;
  from: Date;
  to: Date;
  provider: string;
}

class PspSyncService {
  /**
   * Auto-pull transactions from all active PSP sources of a merchant.
   * Invoked by scheduler.
   */
  async syncAllForMerchant(merchantId: string): Promise<PspSyncResult[]> {
    const sources = await db('reconciliation_sources')
      .where({ merchant_id: merchantId, source_type: 'PSP', status: 'ACTIVE' });

    const results: PspSyncResult[] = [];
    for (const source of sources) {
      try {
        const r = await this.syncSource(source.id);
        results.push(r);
      } catch (err: any) {
        results.push({
          imported: 0,
          skipped: 0,
          from: new Date(),
          to: new Date(),
          provider: source.source_name,
        });
      }
    }
    return results;
  }

  /**
   * Sync one source by dispatching to the provider-specific fetcher.
   * Default window: last 24 hours (or since last_fetch_at).
   */
  async syncSource(sourceId: string): Promise<PspSyncResult> {
    const source = await db('reconciliation_sources').where({ id: sourceId }).first();
    if (!source) throw new Error('Source not found');

    const since = source.last_fetch_at
      ? new Date(source.last_fetch_at)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const until = new Date();

    let transactions: any[] = [];
    const provider = (source.source_name || '').toUpperCase();

    if (source.connector_account_id) {
      const account = await db('provider_accounts')
        .where({ id: source.connector_account_id })
        .first();
      if (account) {
        const creds = this.loadCredentials(account);
        if (provider === 'STRIPE') {
          transactions = await this.fetchStripeTransactions(creds, since, until);
        } else if (provider === 'SQUARE') {
          transactions = await this.fetchSquareTransactions(creds, since, until);
        } else if (provider === 'BRAINTREE') {
          transactions = await this.fetchBraintreeTransactions(creds, since, until);
        }
      }
    }

    const result = await reconciliationService.importTransactions(sourceId, transactions);

    return {
      imported: result.imported,
      skipped: result.skipped,
      from: since,
      to: until,
      provider,
    };
  }

  private loadCredentials(account: any): any {
    if (account.encrypted_credentials) {
      try {
        return JSON.parse(decrypt(account.encrypted_credentials));
      } catch {
        return {};
      }
    }
    if (account.encrypted_secret_key) {
      return { secretKey: decrypt(account.encrypted_secret_key) };
    }
    return {};
  }

  /**
   * Stripe: use /v1/balance_transactions with created[gte]/created[lt].
   */
  private async fetchStripeTransactions(
    creds: any,
    since: Date,
    until: Date
  ): Promise<any[]> {
    if (!creds.secretKey) return [];

    const out: any[] = [];
    let url =
      `https://api.stripe.com/v1/balance_transactions?created[gte]=${Math.floor(since.getTime() / 1000)}` +
      `&created[lt]=${Math.floor(until.getTime() / 1000)}&limit=100`;
    let startingAfter: string | null = null;

    while (url) {
      if (startingAfter) {
        url += `&starting_after=${startingAfter}`;
      }
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${creds.secretKey}` },
      });
      if (!response.ok) break;

      const data: any = await response.json();
      const items = data.data || [];
      for (const tx of items) {
        out.push({
          providerTransactionId: tx.source || tx.id,
          amount: Math.abs(tx.amount || 0),
          currency: (tx.currency || 'usd').toUpperCase(),
          status: tx.status || 'available',
          transactionTime: new Date((tx.created || 0) * 1000),
          transactionType: this.mapStripeType(tx.type),
          feeAmount: Math.abs(tx.fee || 0),
          feeCurrency: (tx.fee_details?.[0]?.currency || tx.currency || 'usd').toUpperCase(),
          rawData: tx,
        });
      }
      if (data.has_more && items.length > 0) {
        startingAfter = items[items.length - 1].id;
      } else {
        url = null as any;
      }
    }
    return out;
  }

  private mapStripeType(type: string): 'PAYMENT' | 'REFUND' | 'CHARGEBACK' {
    if (type === 'charge') return 'PAYMENT';
    if (type === 'refund' || type === 'refund_failure') return 'REFUND';
    if (type === 'charge_dispute' || type === 'adjustment') return 'CHARGEBACK';
    return 'PAYMENT';
  }

  private async fetchSquareTransactions(_creds: any, _since: Date, _until: Date): Promise<any[]> {
    // Square Orders/Payments API stub — implement per connector
    return [];
  }

  private async fetchBraintreeTransactions(_creds: any, _since: Date, _until: Date): Promise<any[]> {
    // Braintree Transaction Search stub
    return [];
  }
}

export const pspSyncService = new PspSyncService();
