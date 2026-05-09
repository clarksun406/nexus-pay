import db from '../db/connection';

export interface RoutingResult {
  primary: any;
  fallback: any | null;
}

export class RoutingEngine {
  private successRateCache = new Map<string, { rate: number; updated: number }>();

  async resolve(merchantId: string, amount: number, currency: string, countryCode?: string, paymentMethodType?: string): Promise<RoutingResult | null> {
    const rules = await db('routing_rules')
      .where({ merchant_id: merchantId, enabled: true })
      .orderBy('priority', 'asc');

    const matching = rules.filter((r: any) => this.matches(r, amount, currency, countryCode, paymentMethodType));

    if (matching.length === 0) return null;

    // Pick by weight
    const winner = matching.length === 1 ? matching[0] : this.pickByWeight(matching);

    const primary = await db('provider_accounts').where({ id: winner.target_account_id, status: 'ACTIVE' }).first();
    if (!primary) return null;

    const fallback = winner.fallback_account_id
      ? await db('provider_accounts').where({ id: winner.fallback_account_id, status: 'ACTIVE' }).first()
      : null;

    return { primary, fallback };
  }

  async resolveAnyAccount(merchantId: string, mode: string): Promise<any | null> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, mode, status: 'ACTIVE' })
      .orderBy('created_at', 'desc');

    if (accounts.length === 0) return null;

    // Prefer primary
    const primary = accounts.find((a: any) => a.is_primary);
    return primary || accounts[0];
  }

  async resolveAccountForProvider(merchantId: string, provider: string, mode: string): Promise<any | null> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, provider, mode, status: 'ACTIVE' });

    if (accounts.length === 0) return null;
    if (accounts.length === 1) return accounts[0];

    return this.weightedSelect(accounts);
  }

  async availableProviders(merchantId: string, mode: string): Promise<string[]> {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId, mode, status: 'ACTIVE' })
      .whereNotNull('provider_config');

    return [...new Set(accounts.map((a: any) => a.provider))];
  }

  private pickByWeight(rules: any[]): any {
    const totalWeight = rules.reduce((sum, r) => sum + (r.weight || 1), 0);
    let pick = Math.floor(Math.random() * totalWeight);
    for (const rule of rules) {
      pick -= rule.weight || 1;
      if (pick < 0) return rule;
    }
    return rules[rules.length - 1];
  }

  private weightedSelect(accounts: any[]): any {
    const totalWeight = accounts.reduce((sum, a) => sum + (a.weight || 1), 0);
    let pick = Math.floor(Math.random() * totalWeight);
    for (const account of accounts) {
      pick -= account.weight || 1;
      if (pick < 0) return account;
    }
    return accounts[accounts.length - 1];
  }

  private matches(rule: any, amount: number, currency: string, countryCode?: string, paymentMethodType?: string): boolean {
    if (rule.currencies) {
      const currencies = rule.currencies.split(',').map((c: string) => c.trim().toUpperCase());
      if (currencies.length > 0 && !currencies.includes(currency.toUpperCase())) return false;
    }
    if (rule.amount_min != null && amount < rule.amount_min) return false;
    if (rule.amount_max != null && amount > rule.amount_max) return false;
    if (rule.country_codes && countryCode) {
      const codes = rule.country_codes.split(',').map((c: string) => c.trim().toUpperCase());
      if (codes.length > 0 && !codes.includes(countryCode.toUpperCase())) return false;
    }
    if (rule.payment_method_types && paymentMethodType) {
      const types = rule.payment_method_types.split(',').map((t: string) => t.trim().toLowerCase());
      if (types.length > 0 && !types.includes(paymentMethodType.toLowerCase())) return false;
    }
    return true;
  }
}

export const routingEngine = new RoutingEngine();
