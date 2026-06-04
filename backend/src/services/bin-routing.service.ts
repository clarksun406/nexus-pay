import db from '../db/connection';

export interface BinInfo {
  binPrefix: string;
  cardNetwork: string;
  cardType?: string;
  issuerName?: string;
  issuerCountry?: string;
  preferredProvider?: string;
  successRate: number;
  providerPerformance: Record<string, { successRate: number; avgLatency: number }>;
}

class BinRoutingService {
  /**
   * Lookup BIN info. Falls back to prefix-6 when prefix-8 not found.
   */
  async lookup(bin: string): Promise<BinInfo | null> {
    if (!bin || bin.length < 6) return null;

    const candidates = [bin.slice(0, 8), bin.slice(0, 6)];
    for (const prefix of candidates) {
      const row = await db('card_bin_registry').where({ bin_prefix: prefix, status: 'ACTIVE' }).first();
      if (row) {
        return this.toBinInfo(row);
      }
    }
    return null;
  }

  /**
   * Register or update a BIN entry (admin use).
   */
  async register(data: {
    binPrefix: string;
    cardNetwork: string;
    cardType?: string;
    issuerName?: string;
    issuerCountry?: string;
    preferredProvider?: string;
  }): Promise<BinInfo> {
    const existing = await db('card_bin_registry').where({ bin_prefix: data.binPrefix }).first();

    if (existing) {
      await db('card_bin_registry').where({ id: existing.id }).update({
        card_network: data.cardNetwork,
        card_type: data.cardType,
        issuer_name: data.issuerName,
        issuer_country: data.issuerCountry,
        preferred_provider: data.preferredProvider,
        updated_at: new Date(),
      });
    } else {
      await db('card_bin_registry').insert({
        bin_prefix: data.binPrefix,
        card_network: data.cardNetwork,
        card_type: data.cardType,
        issuer_name: data.issuerName,
        issuer_country: data.issuerCountry,
        preferred_provider: data.preferredProvider,
      });
    }

    const row = await db('card_bin_registry').where({ bin_prefix: data.binPrefix }).first();
    return this.toBinInfo(row);
  }

  /**
   * Record an outcome for a BIN to keep success rates fresh.
   */
  async recordOutcome(bin: string, provider: string, success: boolean, latencyMs: number): Promise<void> {
    if (!bin || bin.length < 6) return;
    const prefix = bin.length >= 8 ? bin.slice(0, 8) : bin.slice(0, 6);

    const row = await db('card_bin_registry').where({ bin_prefix: prefix }).first();
    if (!row) return;

    const sampleSize = row.sample_size || 0;
    const currentRate = parseFloat(row.success_rate) || 100;
    const newSampleSize = sampleSize + 1;
    const delta = (success ? 100 : 0) - currentRate;
    const newRate = Math.max(0, Math.min(100, currentRate + delta / newSampleSize));

    const perf: Record<string, { successRate: number; avgLatency: number; samples?: number }> = row.provider_performance
      ? typeof row.provider_performance === 'string'
        ? JSON.parse(row.provider_performance)
        : row.provider_performance
      : {};

    const cur = perf[provider] || { successRate: 100, avgLatency: 0, samples: 0 };
    const curSamples = (cur.samples || 0) + 1;
    cur.avgLatency = Math.round(((cur.avgLatency || 0) * (curSamples - 1) + latencyMs) / curSamples);
    cur.successRate = Math.max(
      0,
      Math.min(100, (cur.successRate || 100) + ((success ? 100 : 0) - (cur.successRate || 100)) / curSamples)
    );
    cur.samples = curSamples;
    perf[provider] = cur;

    // Pick provider with best combination of success rate and latency
    let bestProvider = provider;
    let bestScore = -1;
    for (const [p, v] of Object.entries(perf)) {
      // Score: 70% success rate + 30% inverse latency (normalize 3000ms -> 0)
      const score = v.successRate * 0.7 + Math.max(0, 100 - v.avgLatency / 30) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        bestProvider = p;
      }
    }

    await db('card_bin_registry')
      .where({ id: row.id })
      .update({
        success_rate: newRate,
        sample_size: newSampleSize,
        provider_performance: JSON.stringify(perf),
        preferred_provider: bestProvider,
        updated_at: new Date(),
      });
  }

  /**
   * Pick the best provider for this BIN, considering historical performance.
   * Returns null if no info available (caller falls back to rule-based routing).
   */
  async resolveBestProvider(bin: string, availableProviders: string[]): Promise<string | null> {
    const info = await this.lookup(bin);
    if (!info) return null;

    // Filter to available providers
    const perf = info.providerPerformance || {};
    const candidates = availableProviders.filter((p) => perf[p]);

    if (candidates.length === 0) {
      return info.preferredProvider && availableProviders.includes(info.preferredProvider)
        ? info.preferredProvider
        : null;
    }

    let best: string | null = null;
    let bestScore = -1;
    for (const p of candidates) {
      const v = perf[p];
      const score = v.successRate * 0.7 + Math.max(0, 100 - v.avgLatency / 30) * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  /**
   * List BIN entries (with optional network filter).
   */
  async list(filter?: { network?: string; limit?: number; offset?: number }): Promise<BinInfo[]> {
    let query = db('card_bin_registry').where({ status: 'ACTIVE' });
    if (filter?.network) query = query.where({ card_network: filter.network });
    query = query
      .orderBy('bin_prefix')
      .limit(filter?.limit || 50)
      .offset(filter?.offset || 0);
    const rows = await query;
    return rows.map((r: any) => this.toBinInfo(r));
  }

  private toBinInfo(row: any): BinInfo {
    return {
      binPrefix: row.bin_prefix,
      cardNetwork: row.card_network,
      cardType: row.card_type,
      issuerName: row.issuer_name,
      issuerCountry: row.issuer_country,
      preferredProvider: row.preferred_provider,
      successRate: parseFloat(row.success_rate) || 100,
      providerPerformance: row.provider_performance
        ? typeof row.provider_performance === 'string'
          ? JSON.parse(row.provider_performance)
          : row.provider_performance
        : {},
    };
  }
}

export const binRoutingService = new BinRoutingService();
