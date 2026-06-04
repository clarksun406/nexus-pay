import db from '../db/connection';
import { declineCodeService, DeclineCategory, RetryConfig } from './decline-code.service';
import { providerDispatcher } from './provider-dispatcher';
import { routingEngine } from './routing-engine';
import { binRoutingService } from './bin-routing.service';
import { threeDsService } from './threeds.service';

export interface RetrySchedule {
  paymentIntentId: string;
  attemptNumber: number;
  scheduledAt: Date;
  strategy: RetryStrategy;
}

export interface RetryStrategy {
  type: 'EXPONENTIAL' | 'LINEAR' | 'FIXED' | 'SMART';
  delayMinutes: number;
  useAlternativeProvider: boolean;
  reason: string;
}

export interface RetryResult {
  success: boolean;
  attemptId: string;
  scheduledAt?: Date;
  message: string;
}

class RetryService {
  /**
   * Get retry configuration for a merchant
   */
  async getRetryConfig(merchantId: string): Promise<RetryConfig> {
    let config = await db('retry_configs').where({ merchant_id: merchantId }).first();

    if (!config) {
      // Create default config
      const [created] = await db('retry_configs')
        .insert({ merchant_id: merchantId })
        .returning('*');
      config = created;
    }

    return {
      id: config.id,
      merchantId: config.merchant_id,
      enabled: config.enabled,
      maxAttempts: config.max_attempts,
      initialDelayMinutes: config.initial_delay_minutes,
      maxDelayMinutes: config.max_delay_minutes,
      backoffMultiplier: parseFloat(config.backoff_multiplier),
      enabledDeclineCodes: config.enabled_decline_codes,
      excludedDeclineCodes: config.excluded_decline_codes,
      timeWindows: config.time_windows,
    };
  }

  /**
   * Update retry configuration
   */
  async updateRetryConfig(merchantId: string, updates: Partial<RetryConfig>): Promise<RetryConfig> {
    const config = await this.getRetryConfig(merchantId);
    await db('retry_configs').where({ merchant_id: merchantId }).update({
      enabled: updates.enabled ?? config.enabled,
      max_attempts: updates.maxAttempts ?? config.maxAttempts,
      initial_delay_minutes: updates.initialDelayMinutes ?? config.initialDelayMinutes,
      max_delay_minutes: updates.maxDelayMinutes ?? config.maxDelayMinutes,
      backoff_multiplier: updates.backoffMultiplier ?? config.backoffMultiplier,
      enabled_decline_codes: JSON.stringify(updates.enabledDeclineCodes) ?? null,
      excluded_decline_codes: JSON.stringify(updates.excludedDeclineCodes) ?? null,
      time_windows: JSON.stringify(updates.timeWindows) ?? null,
    });
    return this.getRetryConfig(merchantId);
  }

  /**
   * Determine if a payment should be retried
   */
  async shouldRetry(
    merchantId: string,
    provider: string,
    declineCode: string
  ): Promise<{ retryable: boolean; reason: string }> {
    const config = await this.getRetryConfig(merchantId);

    if (!config.enabled) {
      return { retryable: false, reason: 'Retry disabled for merchant' };
    }

    // Check excluded codes
    if (config.excludedDeclineCodes?.includes(declineCode)) {
      return { retryable: false, reason: 'Decline code excluded by merchant config' };
    }

    // Check if code is retryable
    const isRetryable = await declineCodeService.isRetryable(provider, declineCode);
    if (!isRetryable) {
      return { retryable: false, reason: 'Decline code is not retryable' };
    }

    // Check enabled codes (if specified)
    if (config.enabledDeclineCodes && config.enabledDeclineCodes.length > 0) {
      if (!config.enabledDeclineCodes.includes(declineCode)) {
        return { retryable: false, reason: 'Decline code not in enabled list' };
      }
    }

    return { retryable: true, reason: 'Eligible for retry' };
  }

  /**
   * Calculate retry strategy
   */
  async calculateRetryStrategy(
    merchantId: string,
    attemptNumber: number,
    provider: string,
    declineCode: string,
    cardBin?: string
  ): Promise<RetryStrategy> {
    const config = await this.getRetryConfig(merchantId);
    const category = await declineCodeService.getCategory(provider, declineCode);
    const recommendedDelay = await declineCodeService.getRecommendedDelay(provider, declineCode);

    let delayMinutes: number;
    let useAlternativeProvider = false;
    let strategyType: RetryStrategy['type'] = 'EXPONENTIAL';
    let immediate = false;

    // 1) BIN-based routing: prefer best historical provider for this card
    let binPreferredProvider: string | null = null;
    if (cardBin && cardBin.length >= 6) {
      const available = await routingEngine.availableProviders(merchantId, 'LIVE');
      binPreferredProvider = await binRoutingService.resolveBestProvider(cardBin, available);
      if (binPreferredProvider && binPreferredProvider.toUpperCase() !== provider.toUpperCase()) {
        useAlternativeProvider = true;
        strategyType = 'SMART';
      }
    }

    // 2) 3DS upgrade retry: for soft declines, escalate with 3DS before other strategies
    if (
      !useAlternativeProvider &&
      attemptNumber === 1 &&
      this.isThreeDsUpgradeEligible(category, declineCode)
    ) {
      delayMinutes = 0;
      immediate = true;
      strategyType = 'SMART';
    } else {
      switch (category) {
        case 'INSUFFICIENT_FUNDS':
          delayMinutes = Math.min(recommendedDelay * Math.pow(2, attemptNumber), 1440);
          strategyType = 'SMART';
          break;

        case 'NETWORK_ERROR':
          delayMinutes = 0;
          immediate = true;
          strategyType = 'FIXED';
          break;

        case 'LIMIT_EXCEEDED':
          delayMinutes = 1440;
          strategyType = 'FIXED';
          break;

        case 'REQUIRES_AUTH':
          delayMinutes = config.initialDelayMinutes;
          useAlternativeProvider = true;
          strategyType = 'SMART';
          break;

        default:
          delayMinutes = Math.min(
            config.initialDelayMinutes * Math.pow(config.backoffMultiplier, attemptNumber),
            config.maxDelayMinutes
          );
          strategyType = 'EXPONENTIAL';
      }
    }

    if (!immediate) {
      delayMinutes = Math.max(delayMinutes, recommendedDelay);
    }

    const reason = binPreferredProvider
      ? `${category}: ${declineCode} (BIN routed to ${binPreferredProvider})`
      : `${category}: ${declineCode}`;

    return {
      type: strategyType,
      delayMinutes,
      useAlternativeProvider,
      reason,
    };
  }

  /**
   * Soft-decline categories eligible for 3DS-upgrade retry
   */
  private isThreeDsUpgradeEligible(category: DeclineCategory, declineCode: string): boolean {
    const softDeclineCategories: DeclineCategory[] = ['REQUIRES_AUTH', 'GENERIC'];
    if (!softDeclineCategories.includes(category)) return false;
    const nonUpgradeable = ['lost_card', 'stolen_card', 'expired_card', 'incorrect_cvc'];
    return !nonUpgradeable.includes(declineCode.toLowerCase());
  }

  /**
   * Attempt a 3DS-upgrade retry: re-charge the same PM after initiating a 3DS session.
   * Returns success + new session id when authentication completes (frictionless or challenge).
   */
  async attemptThreeDsUpgrade(
    paymentIntentId: string,
    originalRequestId: string,
    declineCode: string,
    declineMessage: string,
    provider: string,
    connectorAccountId: string,
    cardBin?: string
  ): Promise<{ success: boolean; message: string; sessionId?: string }> {
    const intent = await db('payment_intents').where({ id: paymentIntentId }).first();
    if (!intent) {
      return { success: false, message: 'Payment intent not found' };
    }

    const originalRequest = await db('payment_requests').where({ id: originalRequestId }).first();
    if (!originalRequest) {
      return { success: false, message: 'Original request not found' };
    }

    // Respect cap on 3DS upgrade attempts (max 1 upgrade per intent)
    const upgradeCount = intent.three_ds_upgrade_count || 0;
    if (upgradeCount >= 1) {
      return { success: false, message: '3DS upgrade already attempted' };
    }

    // Create a 3DS session (2.x frictionless preferred; ACS decides flow)
    const session = await threeDsService.createSession(paymentIntentId, '2.0');

    // Record the upgrade attempt
    const [attempt] = await db('retry_attempts')
      .insert({
        payment_intent_id: paymentIntentId,
        original_request_id: originalRequestId,
        attempt_number: upgradeCount + 1,
        connector_account_id: connectorAccountId,
        original_decline_code: declineCode,
        original_decline_message: declineMessage,
        decline_category: 'REQUIRES_AUTH',
        status: 'IN_PROGRESS',
        scheduled_at: new Date(),
        retry_strategy: JSON.stringify({ type: 'SMART', delayMinutes: 0, threeDsUpgrade: true }),
        three_ds_upgrade_attempted: true,
        card_bin: cardBin || null,
      })
      .returning('*');

    await db('payment_intents').where({ id: paymentIntentId }).update({
      three_ds_upgrade_count: upgradeCount + 1,
    });

    // If frictionless authentication completed synchronously, charge now
    if (session.status === 'AUTHENTICATED') {
      const authData = await threeDsService.getAuthenticationData(session.id);
      const result = await providerDispatcher.charge(
        provider,
        {
          intentId: paymentIntentId,
          amount: intent.amount,
          currency: intent.currency,
          paymentMethodType: intent.payment_method_type,
          paymentMethodId: originalRequest.provider_request_id,
          idempotencyKey: `retry-3ds-${attempt.id}`,
          captureMethod: intent.capture_method,
        },
        connectorAccountId
      );

      await db('retry_attempts').where({ id: attempt.id }).update({
        status: result.success ? 'SUCCEEDED' : 'FAILED',
        attempted_at: new Date(),
        failure_code: result.failureCode,
        failure_message: result.failureMessage,
      });

      if (result.success) {
        await db('payment_intents').where({ id: paymentIntentId }).update({
          status: intent.capture_method === 'MANUAL' ? 'REQUIRES_CAPTURE' : 'SUCCEEDED',
          provider_payment_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
        });
        return { success: true, message: '3DS upgrade succeeded (frictionless)', sessionId: session.id };
      }
      return { success: false, message: '3DS upgrade charge failed', sessionId: session.id };
    }

    // Otherwise ACS requires challenge — caller must complete it, then charge
    return {
      success: false,
      message: `3DS challenge required (${session.status})`,
      sessionId: session.id,
    };
  }

  /**
   * Execute immediate retry for transient errors
   */
  async executeImmediateRetry(
    paymentIntentId: string,
    originalRequestId: string,
    declineCode: string,
    declineMessage: string,
    provider: string,
    connectorAccountId: string
  ): Promise<{ success: boolean; message: string }> {
    const intent = await db('payment_intents').where({ id: paymentIntentId }).first();
    if (!intent) {
      return { success: false, message: 'Payment intent not found' };
    }

    // Try with fallback provider if available
    const routing = await routingEngine.resolve(
      intent.merchant_id,
      intent.amount,
      intent.currency,
      null,
      intent.payment_method_type
    );

    const fallbackAccountId = routing?.fallback?.id || connectorAccountId;

    // Create immediate retry attempt
    const [attempt] = await db('retry_attempts')
      .insert({
        payment_intent_id: paymentIntentId,
        original_request_id: originalRequestId,
        attempt_number: 1,
        connector_account_id: fallbackAccountId,
        original_decline_code: declineCode,
        original_decline_message: declineMessage,
        decline_category: 'NETWORK_ERROR',
        status: 'IN_PROGRESS',
        scheduled_at: new Date(),
        retry_strategy: JSON.stringify({ type: 'FIXED', delayMinutes: 0, immediate: true }),
      })
      .returning('*');

    // Get original payment method
    const originalRequest = await db('payment_requests').where({ id: originalRequestId }).first();

    // Execute charge immediately
    try {
      const result = await providerDispatcher.charge(
        provider,
        {
          intentId: paymentIntentId,
          amount: intent.amount,
          currency: intent.currency,
          paymentMethodType: intent.payment_method_type,
          paymentMethodId: originalRequest?.provider_request_id || '',
          idempotencyKey: `retry-immediate-${attempt.id}`,
          captureMethod: intent.capture_method,
        },
        fallbackAccountId
      );

      await db('retry_attempts').where({ id: attempt.id }).update({
        status: result.success ? 'SUCCEEDED' : 'FAILED',
        attempted_at: new Date(),
        failure_code: result.failureCode,
        failure_message: result.failureMessage,
      });

      if (result.success) {
        await db('payment_intents').where({ id: paymentIntentId }).update({
          status: intent.capture_method === 'MANUAL' ? 'REQUIRES_CAPTURE' : 'SUCCEEDED',
          provider_payment_id: result.providerPaymentId,
          provider_response: result.providerResponseJson,
        });
        return { success: true, message: 'Immediate retry succeeded' };
      }

      // If still fails, schedule for later retry
      await this.scheduleRetry(
        paymentIntentId,
        originalRequestId,
        result.failureCode || declineCode,
        result.failureMessage || declineMessage,
        provider,
        fallbackAccountId
      );

      return { success: false, message: 'Immediate retry failed, scheduled for later' };
    } catch (err: any) {
      await db('retry_attempts').where({ id: attempt.id }).update({
        status: 'FAILED',
        attempted_at: new Date(),
        failure_message: err.message,
      });
      return { success: false, message: err.message };
    }
  }

  /**
   * Schedule a retry attempt
   */
  async scheduleRetry(
    paymentIntentId: string,
    originalRequestId: string,
    declineCode: string,
    declineMessage: string,
    provider: string,
    connectorAccountId: string,
    cardBin?: string
  ): Promise<RetryResult> {
    const intent = await db('payment_intents').where({ id: paymentIntentId }).first();
    if (!intent) {
      return { success: false, attemptId: '', message: 'Payment intent not found' };
    }

    const config = await this.getRetryConfig(intent.merchant_id);

    // Check if retry is enabled
    const { retryable, reason } = await this.shouldRetry(intent.merchant_id, provider, declineCode);
    if (!retryable) {
      return { success: false, attemptId: '', message: reason };
    }

    // Get current attempt count
    const existingAttempts = await db('retry_attempts')
      .where({ payment_intent_id: paymentIntentId })
      .count('* as count')
      .first();

    const attemptNumber = parseInt(existingAttempts?.count as string) + 1;

    // Check max attempts
    if (attemptNumber > config.maxAttempts) {
      await this.markAsExhausted(paymentIntentId);
      return { success: false, attemptId: '', message: 'Maximum retry attempts exceeded' };
    }

    // Calculate strategy (with BIN awareness)
    const strategy = await this.calculateRetryStrategy(
      intent.merchant_id,
      attemptNumber,
      provider,
      declineCode,
      cardBin
    );

    // Calculate scheduled time
    const scheduledAt = new Date(Date.now() + strategy.delayMinutes * 60 * 1000);

    // Check time windows
    if (config.timeWindows && !this.isWithinTimeWindow(scheduledAt, config.timeWindows)) {
      // Reschedule to next available window
      const nextWindow = this.getNextAvailableWindow(scheduledAt, config.timeWindows);
      scheduledAt.setTime(nextWindow.getTime());
    }

    // Get category
    const category = await declineCodeService.getCategory(provider, declineCode);

    // Resolve BIN-preferred provider override if any
    let binRoutingProvider: string | null = null;
    if (cardBin && cardBin.length >= 6) {
      const available = await routingEngine.availableProviders(intent.merchant_id, intent.mode || 'LIVE');
      binRoutingProvider = await binRoutingService.resolveBestProvider(cardBin, available);
    }

    // Create retry attempt
    const [attempt] = await db('retry_attempts')
      .insert({
        payment_intent_id: paymentIntentId,
        original_request_id: originalRequestId,
        attempt_number: attemptNumber,
        connector_account_id: strategy.useAlternativeProvider ? null : connectorAccountId,
        original_decline_code: declineCode,
        original_decline_message: declineMessage,
        decline_category: category,
        status: 'SCHEDULED',
        scheduled_at: scheduledAt,
        retry_strategy: JSON.stringify(strategy),
        card_bin: cardBin || null,
        bin_routing_provider: binRoutingProvider,
      })
      .returning('*');

    return {
      success: true,
      attemptId: attempt.id,
      scheduledAt,
      message: `Retry scheduled for attempt ${attemptNumber} at ${scheduledAt.toISOString()}`,
    };
  }

  /**
   * Execute scheduled retries
   */
  async executeRetries(): Promise<{ processed: number; succeeded: number; failed: number }> {
    const now = new Date();

    // Get pending retries that are due
    const retries = await db('retry_attempts')
      .where({ status: 'SCHEDULED' })
      .where('scheduled_at', '<=', now)
      .limit(100);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const retry of retries) {
      processed++;

      try {
        // Mark as in progress
        await db('retry_attempts').where({ id: retry.id }).update({ status: 'IN_PROGRESS' });

        const intent = await db('payment_intents').where({ id: retry.payment_intent_id }).first();

        if (!intent || intent.status === 'SUCCEEDED' || intent.status === 'CANCELED') {
          await db('retry_attempts')
            .where({ id: retry.id })
            .update({ status: 'FAILED', failure_message: 'Payment already completed or canceled' });
          failed++;
          continue;
        }

        const strategy: RetryStrategy = JSON.parse(retry.retry_strategy);

        // Resolve connector account
        let connectorAccountId = retry.connector_account_id;
        if (!connectorAccountId || strategy.useAlternativeProvider) {
          const routing = await routingEngine.resolve(
            intent.merchant_id,
            intent.amount,
            intent.currency,
            null,
            intent.payment_method_type
          );
          if (!routing?.primary) {
            await db('retry_attempts')
              .where({ id: retry.id })
              .update({ status: 'FAILED', failure_message: 'No available connector' });
            failed++;
            continue;
          }
          connectorAccountId = routing.primary.id;
        }

        // Get original payment method
        const originalRequest = await db('payment_requests')
          .where({ id: retry.original_request_id })
          .first();

        if (!originalRequest) {
          await db('retry_attempts')
            .where({ id: retry.id })
            .update({ status: 'FAILED', failure_message: 'Original request not found' });
          failed++;
          continue;
        }

        // Execute charge
        const result = await providerDispatcher.charge(
          intent.resolved_provider,
          {
            intentId: intent.id,
            amount: intent.amount,
            currency: intent.currency,
            paymentMethodType: intent.payment_method_type,
            paymentMethodId: originalRequest.provider_request_id, // Use original PM
            idempotencyKey: `retry-${retry.id}`,
            captureMethod: intent.capture_method,
          },
          connectorAccountId
        );

        await db('retry_attempts').where({ id: retry.id }).update({
          status: result.success ? 'SUCCEEDED' : 'FAILED',
          attempted_at: new Date(),
          failure_code: result.failureCode,
          failure_message: result.failureMessage,
        });

        if (result.success) {
          await db('payment_intents').where({ id: intent.id }).update({
            status: intent.capture_method === 'MANUAL' ? 'REQUIRES_CAPTURE' : 'SUCCEEDED',
            provider_payment_id: result.providerPaymentId,
            provider_response: result.providerResponseJson,
          });
          succeeded++;
        } else {
          // Schedule next retry if possible
          const config = await this.getRetryConfig(intent.merchant_id);
          if (retry.attempt_number < config.maxAttempts) {
            await this.scheduleRetry(
              intent.id,
              retry.original_request_id,
              result.failureCode || retry.original_decline_code,
              result.failureMessage || retry.original_decline_message,
              intent.resolved_provider,
              connectorAccountId
            );
          } else {
            await this.markAsExhausted(intent.id);
          }
          failed++;
        }
      } catch (err: any) {
        await db('retry_attempts')
          .where({ id: retry.id })
          .update({ status: 'FAILED', failure_message: err.message });
        failed++;
      }
    }

    return { processed, succeeded, failed };
  }

  /**
   * Mark payment as exhausted
   */
  private async markAsExhausted(paymentIntentId: string): Promise<void> {
    await db('retry_attempts')
      .where({ payment_intent_id: paymentIntentId })
      .update({ status: 'EXHAUSTED' });

    await db('payment_intents').where({ id: paymentIntentId }).update({ status: 'FAILED' });
  }

  /**
   * Check if time is within allowed windows
   */
  private isWithinTimeWindow(
    time: Date,
    windows: { weekdays?: number[]; hours?: { start: number; end: number }[] }
  ): boolean {
    if (windows.weekdays) {
      const day = time.getDay();
      if (!windows.weekdays.includes(day)) return false;
    }

    if (windows.hours && windows.hours.length > 0) {
      const hour = time.getHours();
      const inWindow = windows.hours.some((h) => hour >= h.start && hour <= h.end);
      if (!inWindow) return false;
    }

    return true;
  }

  /**
   * Get next available time window
   */
  private getNextAvailableWindow(
    time: Date,
    windows: { weekdays?: number[]; hours?: { start: number; end: number }[] }
  ): Date {
    const result = new Date(time);

    // If no specific windows, return current time
    if (!windows.weekdays && !windows.hours) {
      return result;
    }

    // Find next valid time
    for (let i = 0; i < 7 * 24; i++) {
      result.setHours(result.getHours() + 1);

      if (this.isWithinTimeWindow(result, windows)) {
        return result;
      }
    }

    return result;
  }

  /**
   * Get retry statistics
   */
  async getRetryStats(merchantId: string, from: Date, to: Date): Promise<{
    totalRetries: number;
    successful: number;
    failed: number;
    pending: number;
    recoveryRate: number;
    avgAttemptsToSuccess: number;
    byCategory: Record<DeclineCategory, { count: number; successRate: number }>;
  }> {
    const attempts = await db('retry_attempts')
      .join('payment_intents', 'payment_intents.id', 'retry_attempts.payment_intent_id')
      .where('payment_intents.merchant_id', merchantId)
      .whereBetween('retry_attempts.created_at', [from, to])
      .select('retry_attempts.*');

    const totalRetries = attempts.length;
    const successful = attempts.filter((a) => a.status === 'SUCCEEDED').length;
    const failed = attempts.filter((a) => a.status === 'FAILED' || a.status === 'EXHAUSTED').length;
    const pending = attempts.filter((a) => a.status === 'PENDING' || a.status === 'SCHEDULED').length;

    const successfulAttempts = attempts.filter((a) => a.status === 'SUCCEEDED');
    const avgAttemptsToSuccess =
      successfulAttempts.length > 0
        ? successfulAttempts.reduce((sum, a) => sum + a.attempt_number, 0) / successfulAttempts.length
        : 0;

    // By category
    const categories: DeclineCategory[] = [
      'INSUFFICIENT_FUNDS',
      'FRAUD',
      'NETWORK_ERROR',
      'INVALID_CARD',
      'EXPIRED',
      'GENERIC',
      'REQUIRES_AUTH',
      'LIMIT_EXCEEDED',
    ];

    const byCategory: Record<DeclineCategory, { count: number; successRate: number }> = {} as any;
    for (const category of categories) {
      const catAttempts = attempts.filter((a) => a.decline_category === category);
      const catSuccess = catAttempts.filter((a) => a.status === 'SUCCEEDED').length;
      byCategory[category] = {
        count: catAttempts.length,
        successRate: catAttempts.length > 0 ? (catSuccess / catAttempts.length) * 100 : 0,
      };
    }

    return {
      totalRetries,
      successful,
      failed,
      pending,
      recoveryRate: totalRetries > 0 ? (successful / totalRetries) * 100 : 0,
      avgAttemptsToSuccess,
      byCategory,
    };
  }
}

export const retryService = new RetryService();
