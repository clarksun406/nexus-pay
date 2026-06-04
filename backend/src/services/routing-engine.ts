import db from '../db/connection';
import { computeFee } from './fee-calculator';

export interface RoutingResult {
  primary: any;
  fallback: any | null;
}

/**
 * Routing rule selection with cost awareness.
 *
 * Selection order:
 *   1. Filter rules to those whose currency / amount / country / payment-method
 *      criteria match the request.
 *   2. For each remaining rule, look up the target connector and compute the
 *      per-transaction fee from its fee_config = { fixed, percentage }. Drop
 *      any rule whose fee in bps exceeds rule.max_cost_bps (when set).
 *   3. Pick the survivor by weighted-random across rule.weight (the existing
 *      behaviour). When `costAware: true` is requested by the caller, pick
 *      the cheapest survivor instead.
 *
 * Routing is preserved through `resolveAccountForProvider` (used by the
 * embedded checkout / tokenize endpoints) — those callers don't care about
 * cost so they keep weighted-random.
 */
export class RoutingEngine {
  async resolve(
    merchantId: string,
    amount: number,
    currency: string,
    countryCode?: string | null,
    paymentMethodType?: string,
    opts: { costAware?: boolean } = {},
  ): Promise<RoutingResult | null> {
    const rules = await db('routing_rules')
      .where({ merchant_id: merchantId, enabled: true })
      .orderBy('priority', 'asc');

    const matching = rules.filter((r: any) =>
      this.matches(r, amount, currency, countryCode || undefined, paymentMethodType),
    );
    if (matching.length === 0) return null;

    // Pre-load the candidate accounts so we can apply the cost filter.
    const candidates: { rule: any; account: any; feeBps: number }[] = [];
    for (const rule of matching) {
      if (!rule.target_account_id) continue;
      const account = await db('provider_accounts')
        .where({ id: rule.target_account_id, status: 'ACTIVE' })
        .first();
      if (!account) continue;

      const feeBps = this.feeBpsFor(account, amount);
      // max_cost_bps is the per-rule ceiling. Stripe's typical 2.9% + 30¢ on
      // a $10 charge is ~600bps; merchants can set max_cost_bps below that
      // to keep premium PSPs out of low-margin lanes.
      if (rule.max_cost_bps != null && feeBps > rule.max_cost_bps) continue;

      candidates.push({ rule, account, feeBps });
    }
    if (candidates.length === 0) return null;

    const winner = opts.costAware
      ? candidates.reduce((cheapest, c) => (c.feeBps < cheapest.feeBps ? c : cheapest))
      : this.pickByWeight(candidates);

    const fallback = winner.rule.fallback_account_id
      ? await db('provider_accounts')
          .where({ id: winner.rule.fallback_account_id, status: 'ACTIVE' })
          .first()
      : null;

    return { primary: winner.account, fallback };
  }

  async resolveAnyAccount(merchantId: string, mode: string): Promise<any | null> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, mode, status: 'ACTIVE' })
      .orderBy('created_at', 'desc');
    if (accounts.length === 0) return null;
    return accounts.find((a: any) => a.is_primary) || accounts[0];
  }

  async resolveAccountForProvider(merchantId: string, provider: string, mode: string): Promise<any | null> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, provider, mode, status: 'ACTIVE' });
    if (accounts.length === 0) return null;
    if (accounts.length === 1) return accounts[0];
    return this.weightedSelectAccounts(accounts);
  }

  async availableProviders(merchantId: string, mode: string): Promise<string[]> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, mode, status: 'ACTIVE' })
      .whereNotNull('provider_config');
    return [...new Set(accounts.map((a: any) => a.provider))];
  }

  // ── Helpers ──

  private feeBpsFor(account: any, amount: number): number {
    if (amount <= 0) return 0;
    let cfg: any = null;
    if (account.fee_config) {
      try { cfg = JSON.parse(account.fee_config); } catch { cfg = null; }
    }
    const fee = computeFee(amount, cfg);
    return Math.round((fee * 10_000) / amount);
  }

  private pickByWeight<T extends { rule: { weight?: number } }>(items: T[]): T {
    const total = items.reduce((s, i) => s + (i.rule.weight || 1), 0);
    let pick = Math.floor(Math.random() * total);
    for (const item of items) {
      pick -= item.rule.weight || 1;
      if (pick < 0) return item;
    }
    return items[items.length - 1];
  }

  private weightedSelectAccounts(accounts: any[]): any {
    const total = accounts.reduce((s, a) => s + (a.weight || 1), 0);
    let pick = Math.floor(Math.random() * total);
    for (const account of accounts) {
      pick -= account.weight || 1;
      if (pick < 0) return account;
    }
    return accounts[accounts.length - 1];
  }

  private matches(
    rule: any,
    amount: number,
    currency: string,
    countryCode?: string,
    paymentMethodType?: string,
  ): boolean {
    if (rule.currencies) {
      const currencies = rule.currencies.split(',').map((c: string) => c.trim().toUpperCase()).filter(Boolean);
      if (currencies.length > 0 && !currencies.includes(currency.toUpperCase())) return false;
    }
    if (rule.amount_min != null && amount < Number(rule.amount_min)) return false;
    if (rule.amount_max != null && amount > Number(rule.amount_max)) return false;
    if (rule.country_codes && countryCode) {
      const codes = rule.country_codes.split(',').map((c: string) => c.trim().toUpperCase()).filter(Boolean);
      if (codes.length > 0 && !codes.includes(countryCode.toUpperCase())) return false;
    }
    if (rule.payment_method_types && paymentMethodType) {
      const types = rule.payment_method_types.split(',').map((t: string) => t.trim().toLowerCase()).filter(Boolean);
      if (types.length > 0 && !types.includes(paymentMethodType.toLowerCase())) return false;
    }
    return true;
  }
}

export const routingEngine = new RoutingEngine();
