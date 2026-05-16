import db from '../db/connection';

export interface DeclineCodeMapping {
  id: string;
  provider: string;
  declineCode: string;
  category: DeclineCategory;
  subcategory?: string;
  retryable: boolean;
  recommendedDelayMinutes: number;
  description?: string;
}

export type DeclineCategory =
  | 'INSUFFICIENT_FUNDS'
  | 'FRAUD'
  | 'NETWORK_ERROR'
  | 'INVALID_CARD'
  | 'EXPIRED'
  | 'GENERIC'
  | 'REQUIRES_AUTH'
  | 'LIMIT_EXCEEDED';

export interface RetryConfig {
  id: string;
  merchantId: string;
  enabled: boolean;
  maxAttempts: number;
  initialDelayMinutes: number;
  maxDelayMinutes: number;
  backoffMultiplier: number;
  enabledDeclineCodes?: string[];
  excludedDeclineCodes?: string[];
  timeWindows?: {
    weekdays?: number[];
    hours?: { start: number; end: number }[];
  };
}

export interface RetryAttempt {
  id: string;
  paymentIntentId: string;
  originalRequestId?: string;
  attemptNumber: number;
  connectorAccountId?: string;
  originalDeclineCode?: string;
  originalDeclineMessage?: string;
  declineCategory?: DeclineCategory;
  status: 'PENDING' | 'SCHEDULED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXHAUSTED';
  scheduledAt?: Date;
  attemptedAt?: Date;
  failureCode?: string;
  failureMessage?: string;
  retryStrategy?: string;
}

class DeclineCodeService {
  private cache = new Map<string, DeclineCodeMapping>();

  async getMapping(provider: string, declineCode: string): Promise<DeclineCodeMapping | null> {
    const key = `${provider}:${declineCode}`;
    if (this.cache.has(key)) {
      return this.cache.get(key)!;
    }

    const mapping = await db('decline_code_mappings')
      .where({ provider: provider.toUpperCase(), decline_code: declineCode.toLowerCase() })
      .first();

    if (mapping) {
      const result: DeclineCodeMapping = {
        id: mapping.id,
        provider: mapping.provider,
        declineCode: mapping.decline_code,
        category: mapping.category,
        subcategory: mapping.subcategory,
        retryable: mapping.retryable,
        recommendedDelayMinutes: mapping.recommended_delay_minutes,
        description: mapping.description,
      };
      this.cache.set(key, result);
      return result;
    }

    // Default mapping for unknown codes
    return {
      id: '',
      provider: provider.toUpperCase(),
      declineCode: declineCode,
      category: 'GENERIC',
      retryable: true,
      recommendedDelayMinutes: 5,
    };
  }

  async isRetryable(provider: string, declineCode: string): Promise<boolean> {
    const mapping = await this.getMapping(provider, declineCode);
    return mapping?.retryable ?? false;
  }

  async getCategory(provider: string, declineCode: string): Promise<DeclineCategory> {
    const mapping = await this.getMapping(provider, declineCode);
    return mapping?.category ?? 'GENERIC';
  }

  async getRecommendedDelay(provider: string, declineCode: string): Promise<number> {
    const mapping = await this.getMapping(provider, declineCode);
    return mapping?.recommendedDelayMinutes ?? 5;
  }

  async createMapping(
    provider: string,
    declineCode: string,
    category: DeclineCategory,
    retryable: boolean,
    recommendedDelayMinutes: number = 5,
    description?: string
  ): Promise<DeclineCodeMapping> {
    const [created] = await db('decline_code_mappings')
      .insert({
        provider: provider.toUpperCase(),
        decline_code: declineCode.toLowerCase(),
        category,
        retryable,
        recommended_delay_minutes: recommendedDelayMinutes,
        description,
      })
      .returning('*');

    const key = `${provider}:${declineCode}`;
    const result: DeclineCodeMapping = {
      id: created.id,
      provider: created.provider,
      declineCode: created.decline_code,
      category: created.category,
      retryable: created.retryable,
      recommendedDelayMinutes: created.recommended_delay_minutes,
      description: created.description,
    };
    this.cache.set(key, result);
    return result;
  }

  clearCache() {
    this.cache.clear();
  }
}

export const declineCodeService = new DeclineCodeService();
