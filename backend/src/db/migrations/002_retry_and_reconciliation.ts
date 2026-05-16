import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Retry Configuration ──
  await knex.schema.createTable('retry_configs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.integer('max_attempts').notNullable().defaultTo(3);
    t.integer('initial_delay_minutes').notNullable().defaultTo(5);
    t.integer('max_delay_minutes').notNullable().defaultTo(1440); // 24 hours
    t.decimal('backoff_multiplier', 3, 1).notNullable().defaultTo(2.0);
    t.json('enabled_decline_codes'); // Array of decline codes to retry
    t.json('excluded_decline_codes'); // Array of codes to never retry
    t.json('time_windows'); // { "weekdays": [...], "hours": [...] }
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Retry Attempts ──
  await knex.schema.createTable('retry_attempts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.uuid('original_request_id').references('id').inTable('payment_requests');
    t.integer('attempt_number').notNullable();
    t.uuid('connector_account_id').references('id').inTable('provider_accounts');
    t.string('original_decline_code', 50);
    t.string('original_decline_message', 500);
    t.string('decline_category', 30); // INSUFFICIENT_FUNDS, FRAUD, NETWORK_ERROR, etc.
    t.string('status', 20).notNullable().defaultTo('PENDING'); // PENDING, SCHEDULED, IN_PROGRESS, SUCCEEDED, FAILED, EXHAUSTED
    t.timestamp('scheduled_at', { useTz: true });
    t.timestamp('attempted_at', { useTz: true });
    t.string('failure_code', 100);
    t.string('failure_message', 500);
    t.text('retry_strategy'); // JSON: strategy used
    t.timestamps(true, true);
    t.index('payment_intent_id');
    t.index('status');
    t.index('scheduled_at');
  });

  // ── Decline Code Mappings ──
  await knex.schema.createTable('decline_code_mappings', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('provider', 30).notNullable(); // STRIPE, SQUARE, etc.
    t.string('decline_code', 50).notNullable();
    t.string('category', 30).notNullable(); // INSUFFICIENT_FUNDS, FRAUD, NETWORK_ERROR, INVALID_CARD, EXPIRED, etc.
    t.string('subcategory', 50);
    t.boolean('retryable').notNullable().defaultTo(true);
    t.integer('recommended_delay_minutes').defaultTo(5);
    t.text('description');
    t.timestamps(true, true);
    t.unique(['provider', 'decline_code']);
    t.index('category');
  });

  // ── Provider Health Metrics ──
  await knex.schema.createTable('provider_health_metrics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('connector_account_id').notNullable().references('id').inTable('provider_accounts').onDelete('CASCADE');
    t.timestamp('metric_time', { useTz: true }).notNullable();
    t.integer('total_requests').notNullable().defaultTo(0);
    t.integer('successful_requests').notNullable().defaultTo(0);
    t.integer('failed_requests').notNullable().defaultTo(0);
    t.decimal('success_rate', 5, 2); // percentage
    t.bigInteger('avg_latency_ms');
    t.bigInteger('p95_latency_ms');
    t.bigInteger('p99_latency_ms');
    t.string('health_status', 20).notNullable().defaultTo('HEALTHY'); // HEALTHY, DEGRADED, UNHEALTHY
    t.timestamps(true, true);
    t.index(['connector_account_id', 'metric_time']);
    t.index('health_status');
  });

  // ── Provider Outages ──
  await knex.schema.createTable('provider_outages', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('connector_account_id').notNullable().references('id').inTable('provider_accounts').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE, RESOLVED
    t.string('trigger_reason', 50); // ERROR_RATE, LATENCY, MANUAL
    t.decimal('error_rate_at_trigger', 5, 2);
    t.timestamp('started_at', { useTz: true }).notNullable();
    t.timestamp('resolved_at', { useTz: true });
    t.integer('duration_minutes');
    t.text('notes');
    t.timestamps(true, true);
    t.index(['connector_account_id', 'status']);
  });

  // ── Reconciliation Sources ──
  await knex.schema.createTable('reconciliation_sources', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('source_type', 30).notNullable(); // PSP, BANK
    t.string('source_name', 100).notNullable();
    t.uuid('connector_account_id').references('id').inTable('provider_accounts');
    t.json('fetch_config'); // credentials, endpoints, etc.
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.timestamp('last_fetch_at', { useTz: true });
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Provider Transactions (Raw from PSP) ──
  await knex.schema.createTable('provider_transactions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.uuid('source_id').notNullable().references('id').inTable('reconciliation_sources');
    t.string('provider_transaction_id', 255).notNullable();
    t.uuid('payment_intent_id').references('id').inTable('payment_intents');
    t.string('transaction_type', 30).notNullable(); // PAYMENT, REFUND, CHARGEBACK
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable();
    t.string('status', 30).notNullable();
    t.timestamp('transaction_time', { useTz: true }).notNullable();
    t.bigInteger('fee_amount');
    t.string('fee_currency', 10);
    t.text('raw_data'); // JSON from provider
    t.string('reconciliation_status', 20).defaultTo('PENDING'); // PENDING, MATCHED, UNMATCHED, DISPUTED
    t.timestamp('reconciled_at', { useTz: true });
    t.timestamps(true, true);
    t.unique(['source_id', 'provider_transaction_id']);
    t.index(['merchant_id', 'transaction_time']);
    t.index('reconciliation_status');
  });

  // ── Reconciliation Reports ──
  await knex.schema.createTable('reconciliation_reports', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.date('report_date').notNullable();
    t.integer('total_transactions').notNullable().defaultTo(0);
    t.integer('matched_transactions').notNullable().defaultTo(0);
    t.integer('unmatched_transactions').notNullable().defaultTo(0);
    t.integer('disputed_transactions').notNullable().defaultTo(0);
    t.bigInteger('total_amount');
    t.bigInteger('matched_amount');
    t.bigInteger('discrepancy_amount');
    t.string('status', 20).notNullable().defaultTo('PENDING'); // PENDING, IN_PROGRESS, COMPLETED, FAILED
    t.timestamps(true, true);
    t.unique(['merchant_id', 'report_date']);
    t.index('report_date');
  });

  // ── Reconciliation Discrepancies ──
  await knex.schema.createTable('reconciliation_discrepancies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('report_id').notNullable().references('id').inTable('reconciliation_reports').onDelete('CASCADE');
    t.uuid('payment_intent_id').references('id').inTable('payment_intents');
    t.uuid('provider_transaction_id').references('id').inTable('provider_transactions');
    t.string('discrepancy_type', 30).notNullable(); // AMOUNT_MISMATCH, MISSING_INTERNAL, MISSING_EXTERNAL, STATUS_MISMATCH
    t.bigInteger('internal_amount');
    t.bigInteger('external_amount');
    t.string('currency', 10);
    t.string('status', 20).notNullable().defaultTo('OPEN'); // OPEN, INVESTIGATING, RESOLVED, IGNORED
    t.text('resolution_notes');
    t.uuid('resolved_by').references('id').inTable('users');
    t.timestamp('resolved_at', { useTz: true });
    t.timestamps(true, true);
    t.index(['report_id', 'status']);
  });

  // ── 3DS Sessions ──
  await knex.schema.createTable('three_ds_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.string('three_ds_version', 10); // 1.0, 2.0, 2.1, 2.2
    t.string('status', 30).notNullable().defaultTo('PENDING'); // PENDING, AUTHENTICATED, CHALLENGE_REQUIRED, FAILED, EXPIRED
    t.string('ds_transaction_id', 255);
    t.string('acs_transaction_id', 255);
    t.text('acs_url');
    t.text('challenge_url');
    t.string('authentication_method', 30);
    t.string('eci', 10);
    t.string('cavv', 255);
    t.string('xid', 255);
    t.string('version_specific_data');
    t.timestamp('authenticated_at', { useTz: true });
    t.timestamp('expires_at', { useTz: true });
    t.timestamps(true, true);
    t.index('payment_intent_id');
    t.index('status');
  });

  // ── 3DS Challenges ──
  await knex.schema.createTable('three_ds_challenges', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('session_id').notNullable().references('id').inTable('three_ds_sessions').onDelete('CASCADE');
    t.string('challenge_type', 30); // OTP, BIOMETRIC, OUT_OF_BAND
    t.string('status', 30).notNullable().defaultTo('PENDING'); // PENDING, COMPLETED, FAILED, EXPIRED
    t.text('challenge_data');
    t.integer('attempt_count').notNullable().defaultTo(0);
    t.integer('max_attempts').notNullable().defaultTo(3);
    t.timestamp('completed_at', { useTz: true });
    t.timestamp('expires_at', { useTz: true });
    t.timestamps(true, true);
    t.index('session_id');
  });

  // Insert default decline code mappings for Stripe
  await knex('decline_code_mappings').insert([
    { provider: 'STRIPE', decline_code: 'insufficient_funds', category: 'INSUFFICIENT_FUNDS', retryable: true, recommended_delay_minutes: 60, description: 'Card has insufficient funds' },
    { provider: 'STRIPE', decline_code: 'generic_decline', category: 'GENERIC', retryable: true, recommended_delay_minutes: 5, description: 'Generic decline from issuer' },
    { provider: 'STRIPE', decline_code: 'lost_card', category: 'FRAUD', retryable: false, description: 'Card reported as lost' },
    { provider: 'STRIPE', decline_code: 'stolen_card', category: 'FRAUD', retryable: false, description: 'Card reported as stolen' },
    { provider: 'STRIPE', decline_code: 'expired_card', category: 'EXPIRED', retryable: false, description: 'Card has expired' },
    { provider: 'STRIPE', decline_code: 'incorrect_cvc', category: 'INVALID_CARD', retryable: false, description: 'CVC code is incorrect' },
    { provider: 'STRIPE', decline_code: 'processing_error', category: 'NETWORK_ERROR', retryable: true, recommended_delay_minutes: 1, description: 'Network or processing error' },
    { provider: 'STRIPE', decline_code: 'card_declined', category: 'GENERIC', retryable: true, recommended_delay_minutes: 5, description: 'Card declined by issuer' },
    { provider: 'STRIPE', decline_code: 'do_not_honor', category: 'GENERIC', retryable: true, recommended_delay_minutes: 30, description: 'Issuer declined without specific reason' },
    { provider: 'STRIPE', decline_code: 'invalid_card_type', category: 'INVALID_CARD', retryable: false, description: 'Card type not supported' },
    { provider: 'STRIPE', decline_code: 'approve_with_id', category: 'REQUIRES_AUTH', retryable: true, recommended_delay_minutes: 5, description: 'Transaction requires approval' },
    { provider: 'STRIPE', decline_code: 'call_issuer', category: 'REQUIRES_AUTH', retryable: true, recommended_delay_minutes: 5, description: 'Customer must call issuer' },
    { provider: 'STRIPE', decline_code: 'card_not_supported', category: 'INVALID_CARD', retryable: false, description: 'Card does not support this type of purchase' },
    { provider: 'STRIPE', decline_code: 'currency_not_supported', category: 'INVALID_CARD', retryable: false, description: 'Card does not support this currency' },
    { provider: 'STRIPE', decline_code: 'withdrawal_count_limit_exceeded', category: 'LIMIT_EXCEEDED', retryable: true, recommended_delay_minutes: 1440, description: 'Withdrawal limit exceeded' },
  ]);
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'three_ds_challenges',
    'three_ds_sessions',
    'reconciliation_discrepancies',
    'reconciliation_reports',
    'provider_transactions',
    'reconciliation_sources',
    'provider_outages',
    'provider_health_metrics',
    'decline_code_mappings',
    'retry_attempts',
    'retry_configs',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
