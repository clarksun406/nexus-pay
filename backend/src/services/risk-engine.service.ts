import db from '../db/connection';

// ── Types ──

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'DECLINED';
export type ReviewStatus = 'PASSED' | 'FLAGGED' | 'PENDING_REVIEW' | 'DECLINED';
export type RuleAction = 'BLOCK' | 'FLAG' | 'REVIEW';
export type ListType = 'BLACK' | 'WHITE';
export type BlocklistType = 'CARD_NUMBER' | 'EMAIL' | 'IP' | 'DEVICE_FINGERPRINT' | 'COUNTRY' | 'CARD_BIN';

export interface RiskFactor {
  factor: string;
  weight: number;
  description: string;
}

export interface RiskResult {
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
  action: 'PROCEED' | 'FLAGGED' | 'REVIEW_REQUIRED' | 'BLOCKED';
  triggeredRules: string[];
}

export interface FraudRule {
  id: string;
  merchantId: string;
  name: string;
  ruleType: string;
  config: any;
  action: RuleAction;
  priority: number;
  enabled: boolean;
  maxDailyHits: number | null;
}

export interface BlocklistEntry {
  id: string;
  merchantId: string;
  type: BlocklistType;
  value: string;
  listType: ListType;
  reason: string | null;
  enabled: boolean;
}

export interface FraudAlert {
  id: string;
  merchantId: string;
  paymentIntentId: string | null;
  ruleId: string | null;
  severity: string;
  actionTaken: string;
  message: string | null;
  resolved: boolean;
  createdAt: string;
}

export interface PaymentReview {
  id: string;
  merchantId: string;
  paymentIntentId: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reason: string | null;
  reviewedBy: string | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

// ── Service ──

class RiskEngineService {
  // ══════════════════════════════════════════════════
  //  Core: evaluate a payment intent for risk
  // ══════════════════════════════════════════════════

  /**
   * Evaluate a payment intent for risk. Called during confirm().
   * Returns the risk result and persists score + alert records.
   */
  async evaluate(
    merchantId: string,
    intentId: string,
    amount: number,
    currency: string,
    billingDetails: any,
    paymentMethodType?: string,
    cardLastFour?: string,
    cardNetwork?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<RiskResult> {
    const factors: RiskFactor[] = [];
    const triggeredRules: string[] = [];
    let score = 0;

    // 1. Check blocklists (black/white)
    const blocklistHit = await this._checkBlocklists(merchantId, billingDetails, cardLastFour, ipAddress, deviceFingerprint);
    if (blocklistHit) {
      if (blocklistHit.listType === 'BLACK') {
        score = 100;
        factors.push({ factor: 'blocklist_hit', weight: 100, description: `Hit blacklist: ${blocklistHit.type}=${blocklistHit.value}` });
        triggeredRules.push('blocklist_black');

        const result: RiskResult = { score: 100, level: 'DECLINED', factors, action: 'BLOCKED', triggeredRules };
        await this._persistResult(merchantId, intentId, result);
        return result;
      }
      // White list: bypass further checks
      score = 0;
      factors.push({ factor: 'whitelist_hit', weight: 0, description: `Hit whitelist: ${blocklistHit.type}=${blocklistHit.value}` });
      const result: RiskResult = { score: 0, level: 'LOW', factors, action: 'PROCEED', triggeredRules: [] };
      await this._persistResult(merchantId, intentId, result);
      return result;
    }

    // 2. Load enabled fraud rules
    const rules = await db('fraud_rules')
      .where({ merchant_id: merchantId, enabled: true })
      .orderBy('priority', 'asc');

    for (const rule of rules) {
      const hit = await this._matchRule(rule, merchantId, amount, currency, billingDetails, paymentMethodType, cardLastFour, cardNetwork, ipAddress, deviceFingerprint);
      if (!hit) continue;

      const ruleWeight = this._ruleWeight(rule.action);
      factors.push({ factor: `rule_${rule.rule_type}`, weight: ruleWeight, description: `${rule.name}: ${hit}` });
      triggeredRules.push(rule.id);

      // Record alert
      await db('fraud_alerts').insert({
        merchant_id: merchantId,
        payment_intent_id: intentId,
        rule_id: rule.id,
        severity: rule.action === 'BLOCK' ? 'CRITICAL' : rule.action === 'REVIEW' ? 'WARNING' : 'INFO',
        action_taken: rule.action === 'BLOCK' ? 'BLOCKED' : rule.action === 'REVIEW' ? 'REVIEW_REQUIRED' : 'FLAGGED',
        message: `${rule.name}: ${hit}`,
      });

      if (rule.action === 'BLOCK') {
        score += 60;
      } else if (rule.action === 'REVIEW') {
        score += 40;
      } else {
        score += 20;
      }
    }

    // 3. Velocity check
    const velocityScore = await this._checkVelocity(merchantId, billingDetails, cardLastFour, ipAddress);
    if (velocityScore > 0) {
      factors.push({ factor: 'velocity', weight: velocityScore, description: 'High transaction frequency detected' });
      score += velocityScore;
    }

    // 4. Merchant-level scoring heuristics
    const heuristicFactors = await this._scoreHeuristics(merchantId, amount, billingDetails);
    for (const f of heuristicFactors) {
      factors.push(f);
      score += f.weight;
    }

    // Cap at 100
    score = Math.min(100, score);

    // Determine level
    let level: RiskLevel;
    let action: RiskResult['action'];

    if (score >= 80) {
      level = 'DECLINED';
      action = 'BLOCKED';
    } else if (score >= 50) {
      level = 'HIGH';
      action = 'REVIEW_REQUIRED';
    } else if (score >= 25) {
      level = 'MEDIUM';
      action = 'FLAGGED';
    } else {
      level = 'LOW';
      action = 'PROCEED';
    }

    const result: RiskResult = { score, level, factors, action, triggeredRules };

    // Create review record if action is REVIEW_REQUIRED
    if (action === 'REVIEW_REQUIRED') {
      await db('payment_reviews').insert({
        merchant_id: merchantId,
        payment_intent_id: intentId,
        status: 'PENDING',
        reason: factors.map(f => f.description).join('; '),
      });
    }

    await this._persistResult(merchantId, intentId, result);
    return result;
  }

  // ══════════════════════════════════════════════════
  //  Fraud Rules CRUD
  // ══════════════════════════════════════════════════

  async createRule(merchantId: string, body: any): Promise<FraudRule> {
    const [row] = await db('fraud_rules').insert({
      merchant_id: merchantId,
      name: body.name,
      rule_type: body.ruleType,
      config: JSON.stringify(body.config || {}),
      action: body.action || 'FLAG',
      priority: body.priority || 0,
      enabled: body.enabled !== false,
      max_daily_hits: body.maxDailyHits ?? null,
    }).returning('*');
    return this._toRule(row);
  }

  async listRules(merchantId: string): Promise<FraudRule[]> {
    const rows = await db('fraud_rules')
      .where({ merchant_id: merchantId })
      .orderBy('priority', 'asc');
    return rows.map(r => this._toRule(r));
  }

  async getRule(merchantId: string, ruleId: string): Promise<FraudRule> {
    const row = await db('fraud_rules').where({ id: ruleId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Fraud rule not found'), { status: 404 });
    return this._toRule(row);
  }

  async updateRule(merchantId: string, ruleId: string, body: any): Promise<FraudRule> {
    const row = await db('fraud_rules').where({ id: ruleId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Fraud rule not found'), { status: 404 });

    const updates: any = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.ruleType !== undefined) updates.rule_type = body.ruleType;
    if (body.config !== undefined) updates.config = JSON.stringify(body.config);
    if (body.action !== undefined) updates.action = body.action;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.enabled !== undefined) updates.enabled = body.enabled;
    if (body.maxDailyHits !== undefined) updates.max_daily_hits = body.maxDailyHits;

    const [updated] = await db('fraud_rules').where({ id: ruleId }).update(updates).returning('*');
    return this._toRule(updated);
  }

  async deleteRule(merchantId: string, ruleId: string): Promise<void> {
    await db('fraud_rules').where({ id: ruleId, merchant_id: merchantId }).delete();
  }

  // ══════════════════════════════════════════════════
  //  Blocklists CRUD
  // ══════════════════════════════════════════════════

  async createBlocklistEntry(merchantId: string, body: any): Promise<BlocklistEntry> {
    const [row] = await db('blocklists').insert({
      merchant_id: merchantId,
      type: body.type,
      value: body.value,
      list_type: body.listType || 'BLACK',
      reason: body.reason || null,
      enabled: body.enabled !== false,
    }).returning('*');
    return this._toBlocklist(row);
  }

  async listBlocklist(merchantId: string, type?: string): Promise<BlocklistEntry[]> {
    const query = db('blocklists').where({ merchant_id: merchantId });
    if (type) query.where({ type });
    const rows = await query.orderBy('created_at', 'desc');
    return rows.map(r => this._toBlocklist(r));
  }

  async deleteBlocklistEntry(merchantId: string, entryId: string): Promise<void> {
    await db('blocklists').where({ id: entryId, merchant_id: merchantId }).delete();
  }

  // ══════════════════════════════════════════════════
  //  Alerts & Reviews
  // ══════════════════════════════════════════════════

  async listAlerts(
    merchantId: string,
    filters?: { severity?: string; resolved?: boolean }
  ): Promise<FraudAlert[]> {
    const query = db('fraud_alerts').where({ merchant_id: merchantId });
    if (filters?.severity) query.where({ severity: filters.severity });
    if (filters?.resolved !== undefined) query.where({ resolved: filters.resolved });
    const rows = await query.orderBy('created_at', 'desc').limit(100);
    return rows.map(r => this._toAlert(r));
  }

  async resolveAlert(merchantId: string, alertId: string): Promise<void> {
    const updated = await db('fraud_alerts')
      .where({ id: alertId, merchant_id: merchantId })
      .update({ resolved: true, resolved_at: new Date() });
    if (!updated) throw Object.assign(new Error('Alert not found'), { status: 404 });
  }

  async listReviews(
    merchantId: string,
    status?: string
  ): Promise<PaymentReview[]> {
    const query = db('payment_reviews').where({ merchant_id: merchantId });
    if (status) query.where({ status });
    const rows = await query.orderBy('created_at', 'desc').limit(100);
    return rows.map(r => this._toReview(r));
  }

  async approveReview(merchantId: string, reviewId: string, userId: string, notes?: string): Promise<void> {
    const review = await db('payment_reviews').where({ id: reviewId, merchant_id: merchantId }).first();
    if (!review) throw Object.assign(new Error('Review not found'), { status: 404 });

    await db('payment_reviews').where({ id: reviewId }).update({
      status: 'APPROVED',
      reviewed_by: userId,
      review_notes: notes || null,
      reviewed_at: new Date(),
    });
    await db('payment_intents').where({ id: review.payment_intent_id }).update({
      review_status: 'PASSED',
    });
  }

  async rejectReview(merchantId: string, reviewId: string, userId: string, notes?: string): Promise<void> {
    const review = await db('payment_reviews').where({ id: reviewId, merchant_id: merchantId }).first();
    if (!review) throw Object.assign(new Error('Review not found'), { status: 404 });

    await db('payment_reviews').where({ id: reviewId }).update({
      status: 'REJECTED',
      reviewed_by: userId,
      review_notes: notes || null,
      reviewed_at: new Date(),
    });
    await db('payment_intents').where({ id: review.payment_intent_id }).update({
      risk_level: 'DECLINED',
      review_status: 'DECLINED',
      status: 'FAILED',
    });
  }

  // ══════════════════════════════════════════════════
  //  Internal: rule matching
  // ══════════════════════════════════════════════════

  private async _checkBlocklists(
    merchantId: string,
    billingDetails: any,
    cardLastFour?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<BlocklistEntry | null> {
    const checks: { type: BlocklistType; value: string | undefined }[] = [
      { type: 'EMAIL', value: billingDetails?.email },
      { type: 'COUNTRY', value: billingDetails?.country },
      { type: 'IP', value: ipAddress },
      { type: 'DEVICE_FINGERPRINT', value: deviceFingerprint },
    ];
    if (cardLastFour) checks.push({ type: 'CARD_NUMBER', value: cardLastFour });
    if (billingDetails?.cardBin) checks.push({ type: 'CARD_BIN', value: billingDetails.cardBin });

    for (const check of checks) {
      if (!check.value) continue;
      const entry = await db('blocklists')
        .where({ merchant_id: merchantId, type: check.type, value: check.value, enabled: true })
        .first();
      if (entry) return this._toBlocklist(entry);
    }
    return null;
  }

  private async _matchRule(
    rule: any,
    merchantId: string,
    amount: number,
    currency: string,
    billingDetails: any,
    paymentMethodType?: string,
    cardLastFour?: string,
    cardNetwork?: string,
    ipAddress?: string,
    deviceFingerprint?: string,
  ): Promise<string | null> {
    let cfg: any = {};
    try { cfg = JSON.parse(rule.config); } catch { return null; }

    switch (rule.rule_type) {
      case 'AMOUNT_THRESHOLD': {
        const maxAmount = Number(cfg.maxAmount);
        const minAmount = Number(cfg.minAmount);
        if ((maxAmount && amount > maxAmount) || (minAmount && amount < minAmount)) {
          return `amount=${amount} exceeds threshold (min=${minAmount}, max=${maxAmount})`;
        }
        return null;
      }

      case 'COUNTRY_BLOCK': {
        const countries = (cfg.countries || []).map((c: string) => c.toUpperCase());
        const country = (billingDetails?.country || '').toUpperCase();
        if (countries.includes(country)) {
          return `country=${country} is blocked`;
        }
        return null;
      }

      case 'CARD_BIN': {
        const bins = cfg.bins || [];
        if (cardLastFour && bins.some((b: string) => cardLastFour?.startsWith(b))) {
          return `card BIN prefix matched blocked list`;
        }
        return null;
      }

      case 'EMAIL_DOMAIN': {
        const domains = cfg.domains || [];
        const email = billingDetails?.email || '';
        const domain = email.split('@')[1]?.toLowerCase();
        if (domain && domains.includes(domain)) {
          return `email domain=${domain} is blocked`;
        }
        return null;
      }

      case 'IP_RANGE': {
        const ranges = cfg.ranges || [];
        if (!ipAddress) return null;
        for (const range of ranges) {
          if (this._ipInRange(ipAddress, range)) {
            return `IP ${ipAddress} is in blocked range ${range}`;
          }
        }
        return null;
      }

      case 'CUSTOM_METADATA': {
        // Check a specific metadata field against a pattern
        const field = cfg.field;
        const pattern = cfg.pattern;
        if (!field || !pattern) return null;
        const actual = billingDetails?.[field] || '';
        if (typeof actual === 'string' && actual.match(new RegExp(pattern))) {
          return `metadata.${field} matched pattern=${pattern}`;
        }
        return null;
      }

      default:
        return null;
    }
  }

  private async _checkVelocity(
    merchantId: string,
    billingDetails: any,
    cardLastFour?: string,
    ipAddress?: string,
  ): Promise<number> {
    const windowMinutes = 15;
    const windowStart = new Date(Date.now() - windowMinutes * 60 * 1000);
    let score = 0;

    // Same email in last 15 minutes
    if (billingDetails?.email) {
      const emailCount = await db('payment_intents')
        .where({ merchant_id: merchantId })
        .where('created_at', '>=', windowStart)
        .where('billing_details->>email', billingDetails.email)
        .count('* as count')
        .first();
      const cnt = Number((emailCount as any)?.count || 0);
      if (cnt >= 5) score += 30;
      else if (cnt >= 3) score += 15;
    }

    // Same card (last 4) in last 15 minutes
    if (cardLastFour) {
      const cardCount = await db('payment_intents')
        .where({ merchant_id: merchantId })
        .where('created_at', '>=', windowStart)
        .where('billing_details->>cardLastFour', cardLastFour)
        .count('* as count')
        .first();
      const cnt = Number((cardCount as any)?.count || 0);
      if (cnt >= 5) score += 30;
      else if (cnt >= 3) score += 15;
    }

    // Same IP in last 15 minutes
    if (ipAddress) {
      const ipCount = await db('payment_intents')
        .where({ merchant_id: merchantId })
        .where('created_at', '>=', windowStart)
        .where('billing_details->>ip', ipAddress)
        .count('* as count')
        .first();
      const cnt = Number((ipCount as any)?.count || 0);
      if (cnt >= 10) score += 20;
      else if (cnt >= 5) score += 10;
    }

    return score;
  }

  private async _scoreHeuristics(
    merchantId: string,
    amount: number,
    billingDetails: any,
  ): Promise<RiskFactor[]> {
    const factors: RiskFactor[] = [];

    // High amount (top 5% of merchant's historical payments)
    if (amount > 0) {
      const stats = await db('payment_intents')
        .where({ merchant_id: merchantId, status: 'SUCCEEDED' })
        .avg('amount as avg_amount')
        .first();
      const avgAmount = Number((stats as any)?.avg_amount || 0);
      if (avgAmount > 0 && amount > avgAmount * 3) {
        factors.push({ factor: 'amount_anomaly', weight: 15, description: `Amount ${amount} is >3x avg (${avgAmount})` });
      }
      if (avgAmount > 0 && amount > avgAmount * 10) {
        factors.push({ factor: 'amount_extreme', weight: 25, description: `Amount ${amount} is >10x avg (${avgAmount})` });
      }
    }

    // Missing billing details
    if (!billingDetails?.email) {
      factors.push({ factor: 'missing_email', weight: 10, description: 'No billing email provided' });
    }

    return factors;
  }

  private _ruleWeight(action: string): number {
    switch (action) {
      case 'BLOCK': return 60;
      case 'REVIEW': return 40;
      case 'FLAG': return 20;
      default: return 20;
    }
  }

  private _ipInRange(ip: string, range: string): boolean {
    // Simple CIDR match (v4 only)
    if (!range.includes('/')) return ip === range;
    const [base, bitsStr] = range.split('/');
    const bits = parseInt(bitsStr, 10);
    if (!bits) return false;

    const ipInt = this._ipToInt(ip);
    const baseInt = this._ipToInt(base);
    if (ipInt === null || baseInt === null) return false;

    const mask = ~(2 ** (32 - bits) - 1);
    return (ipInt & mask) === (baseInt & mask);
  }

  private _ipToInt(ip: string): number | null {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  // ══════════════════════════════════════════════════
  //  Persistence
  // ══════════════════════════════════════════════════

  private async _persistResult(merchantId: string, intentId: string, result: RiskResult): Promise<void> {
    // Write fraud_score record
    await db('fraud_scores').insert({
      merchant_id: merchantId,
      payment_intent_id: intentId,
      score: result.score,
      level: result.level,
      factors: JSON.stringify(result.factors),
    });

    // Update payment_intents risk columns
    const reviewStatus: ReviewStatus =
      result.action === 'BLOCKED' ? 'DECLINED' :
      result.action === 'REVIEW_REQUIRED' ? 'PENDING_REVIEW' :
      result.action === 'FLAGGED' ? 'FLAGGED' : 'PASSED';

    await db('payment_intents').where({ id: intentId }).update({
      risk_score: result.score,
      risk_level: result.level,
      review_status: reviewStatus,
    });
  }

  // ══════════════════════════════════════════════════
  //  Serializers
  // ══════════════════════════════════════════════════

  private _toRule(row: any): FraudRule {
    let config: any = {};
    try { config = JSON.parse(row.config); } catch { /* ignore */ }
    return {
      id: row.id,
      merchantId: row.merchant_id,
      name: row.name,
      ruleType: row.rule_type,
      config,
      action: row.action,
      priority: row.priority,
      enabled: row.enabled,
      maxDailyHits: row.max_daily_hits,
    };
  }

  private _toBlocklist(row: any): BlocklistEntry {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      type: row.type,
      value: row.value,
      listType: row.list_type,
      reason: row.reason,
      enabled: row.enabled,
    };
  }

  private _toAlert(row: any): FraudAlert {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      paymentIntentId: row.payment_intent_id,
      ruleId: row.rule_id,
      severity: row.severity,
      actionTaken: row.action_taken,
      message: row.message,
      resolved: row.resolved,
      createdAt: row.created_at,
    };
  }

  private _toReview(row: any): PaymentReview {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      paymentIntentId: row.payment_intent_id,
      status: row.status,
      reason: row.reason,
      reviewedBy: row.reviewed_by,
      reviewNotes: row.review_notes,
      reviewedAt: row.reviewed_at,
      createdAt: row.created_at,
    };
  }
}

export const riskEngine = new RiskEngineService();
