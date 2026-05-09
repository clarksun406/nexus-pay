import db from '../db/connection';

export class RoutingRuleService {
  async create(merchantId: string, body: any) {
    const [rule] = await db('routing_rules').insert({
      merchant_id: merchantId,
      priority: body.priority,
      enabled: body.enabled !== false,
      currencies: body.currencies?.join(','),
      amount_min: body.amountMin,
      amount_max: body.amountMax,
      country_codes: body.countryCodes?.join(','),
      payment_method_types: body.paymentMethodTypes?.join(','),
      target_provider: body.targetProvider,
      target_account_id: body.targetAccountId,
      fallback_provider: body.fallbackProvider,
      fallback_account_id: body.fallbackAccountId,
      weight: body.weight || 1,
      max_cost_bps: body.maxCostBps,
    }).returning('*');

    return this.toResponse(rule);
  }

  async list(merchantId: string) {
    const rules = await db('routing_rules')
      .where({ merchant_id: merchantId })
      .orderBy('priority', 'asc');
    return rules.map((r: any) => this.toResponse(r));
  }

  async get(merchantId: string, ruleId: string) {
    const rule = await db('routing_rules').where({ id: ruleId, merchant_id: merchantId }).first();
    if (!rule) throw Object.assign(new Error('Routing rule not found'), { status: 404 });
    return this.toResponse(rule);
  }

  async update(merchantId: string, ruleId: string, body: any) {
    const rule = await db('routing_rules').where({ id: ruleId, merchant_id: merchantId }).first();
    if (!rule) throw Object.assign(new Error('Routing rule not found'), { status: 404 });

    const updates: any = {};
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.currencies) updates.currencies = body.currencies.join(',');
    if (body.amountMin !== undefined) updates.amount_min = body.amountMin;
    if (body.amountMax !== undefined) updates.amount_max = body.amountMax;
    if (body.countryCodes) updates.country_codes = body.countryCodes.join(',');
    if (body.paymentMethodTypes) updates.payment_method_types = body.paymentMethodTypes.join(',');
    if (body.targetProvider) updates.target_provider = body.targetProvider;
    if (body.targetAccountId) updates.target_account_id = body.targetAccountId;
    if (body.fallbackProvider) updates.fallback_provider = body.fallbackProvider;
    if (body.fallbackAccountId) updates.fallback_account_id = body.fallbackAccountId;
    if (body.weight !== undefined) updates.weight = body.weight;
    if (body.maxCostBps !== undefined) updates.max_cost_bps = body.maxCostBps;

    const [updated] = await db('routing_rules').where({ id: ruleId }).update(updates).returning('*');
    return this.toResponse(updated);
  }

  async delete(merchantId: string, ruleId: string) {
    await db('routing_rules').where({ id: ruleId, merchant_id: merchantId }).delete();
  }

  private toResponse(rule: any) {
    return {
      id: rule.id,
      merchantId: rule.merchant_id,
      priority: rule.priority,
      enabled: rule.enabled,
      currencies: rule.currencies?.split(',') || [],
      amountMin: rule.amount_min,
      amountMax: rule.amount_max,
      countryCodes: rule.country_codes?.split(',') || [],
      paymentMethodTypes: rule.payment_method_types?.split(',') || [],
      targetProvider: rule.target_provider,
      targetAccountId: rule.target_account_id,
      fallbackProvider: rule.fallback_provider,
      fallbackAccountId: rule.fallback_account_id,
      weight: rule.weight,
      maxCostBps: rule.max_cost_bps,
      createdAt: rule.created_at,
      updatedAt: rule.updated_at,
    };
  }
}

export const routingRuleService = new RoutingRuleService();
