import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // Enable pgcrypto for UUID generation
  await knex.raw('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

  // ── Users ──
  await knex.schema.createTable('users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('email', 255).notNullable().unique();
    t.string('password_hash', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.string('mfa_secret', 64);
    t.integer('token_version').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index('email');
  });

  // ── Organizations ──
  await knex.schema.createTable('organizations', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('name', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.timestamps(true, true);
    t.index('status');
  });

  // ── Merchants ──
  await knex.schema.createTable('merchants', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('name', 255).notNullable();
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.timestamps(true, true);
    t.index('organization_id');
  });

  // ── Organization Users ──
  await knex.schema.createTable('organization_users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.uuid('organization_id').notNullable().references('id').inTable('organizations');
    t.string('role', 20).notNullable().defaultTo('ORG_MEMBER');
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.timestamps(true, true);
    t.unique(['user_id', 'organization_id']);
    t.index('user_id');
    t.index('organization_id');
  });

  // ── Merchant Users ──
  await knex.schema.createTable('merchant_users', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users');
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('role', 20).notNullable();
    t.uuid('invited_by').references('id').inTable('users');
    t.string('status', 20).notNullable().defaultTo('PENDING_INVITE');
    t.timestamps(true, true);
    t.unique(['user_id', 'merchant_id']);
    t.index('user_id');
    t.index('merchant_id');
  });

  // ── Refresh Tokens ──
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('revoked').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('token_hash');
    t.index('user_id');
  });

  // ── Invite Tokens ──
  await knex.schema.createTable('invite_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_user_id').notNullable().references('id').inTable('merchant_users').onDelete('CASCADE');
    t.string('token_hash', 255).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('token_hash');
  });

  // ── API Keys ──
  await knex.schema.createTable('api_keys', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('mode', 10).notNullable(); // TEST | LIVE
    t.string('type', 15).notNullable(); // SECRET | PUBLISHABLE
    t.string('key_hash', 64).notNullable().unique();
    t.string('plaintext_key', 255);
    t.string('prefix', 20).notNullable();
    t.string('name', 100);
    t.string('status', 10).notNullable().defaultTo('ACTIVE');
    t.timestamp('last_used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('revoked_at', { useTz: true });
    t.index('merchant_id');
    t.index('key_hash');
  });

  // ── Provider Accounts (Connectors) ──
  await knex.schema.createTable('provider_accounts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('provider', 30).notNullable(); // STRIPE | SQUARE | BRAINTREE
    t.string('mode', 10).notNullable().defaultTo('TEST');
    t.string('label', 100).notNullable();
    t.text('encrypted_secret_key');
    t.text('encrypted_publishable_key');
    t.text('encrypted_credentials');
    t.text('provider_config');
    t.string('secret_key_hint', 20);
    t.boolean('is_primary').notNullable().defaultTo(false);
    t.integer('weight').notNullable().defaultTo(1);
    t.integer('display_order').notNullable().defaultTo(0);
    t.text('fee_config'); // JSON: { fixed: 30, percentage: 2.9 }
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.string('connector_account_id', 255);
    t.timestamps(true, true);
    t.index('merchant_id');
    t.index(['merchant_id', 'provider']);
  });

  // ── Routing Rules ──
  await knex.schema.createTable('routing_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.integer('priority').notNullable();
    t.boolean('enabled').notNullable().defaultTo(true);
    t.text('currencies');
    t.bigInteger('amount_min');
    t.bigInteger('amount_max');
    t.text('country_codes');
    t.text('payment_method_types');
    t.string('target_provider', 20).notNullable();
    t.uuid('target_account_id').references('id').inTable('provider_accounts');
    t.string('fallback_provider', 20);
    t.uuid('fallback_account_id').references('id').inTable('provider_accounts');
    t.integer('weight').notNullable().defaultTo(1);
    t.integer('max_cost_bps');
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Payment Intents ──
  await knex.schema.createTable('payment_intents', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('mode', 10).notNullable();
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable();
    t.string('status', 30).notNullable().defaultTo('REQUIRES_PAYMENT_METHOD');
    t.string('capture_method', 20).notNullable().defaultTo('AUTOMATIC');
    t.string('idempotency_key', 255).notNullable();
    t.string('resolved_provider', 20);
    t.uuid('connector_account_id').references('id').inTable('provider_accounts');
    t.string('provider_payment_id', 255);
    t.text('provider_response');
    t.string('payment_method_type', 50);
    t.text('metadata');
    t.string('order_id', 255);
    t.text('description');
    t.json('billing_details');
    t.json('shipping_details');
    t.string('success_url', 500);
    t.string('cancel_url', 500);
    t.string('failure_url', 500);
    t.string('three_ds_action_url', 1000);
    t.string('trace_id', 64);
    t.timestamp('expires_at', { useTz: true });
    t.timestamps(true, true);
    t.unique(['merchant_id', 'idempotency_key']);
    t.index('merchant_id');
    t.index('status');
  });

  // ── Payment Requests (attempts) ──
  await knex.schema.createTable('payment_requests', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.uuid('connector_account_id').references('id').inTable('provider_accounts');
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable();
    t.string('payment_method_type', 50).notNullable();
    t.string('status', 20).notNullable().defaultTo('PENDING');
    t.string('provider_request_id', 255);
    t.text('provider_response');
    t.string('failure_code', 100);
    t.string('failure_message', 500);
    t.timestamps(true, true);
    t.index('payment_intent_id');
  });

  // ── Refunds ──
  await knex.schema.createTable('refunds', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents');
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('mode', 10).notNullable();
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable();
    t.string('status', 20).notNullable().defaultTo('PENDING');
    t.string('reason', 30);
    t.string('provider_refund_id', 255);
    t.text('failure_reason');
    t.timestamps(true, true);
    t.index('payment_intent_id');
    t.index('merchant_id');
  });

  // ── Payment Links ──
  await knex.schema.createTable('payment_links', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('token', 64).notNullable().unique();
    t.string('title', 200).notNullable();
    t.text('description');
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable().defaultTo('usd');
    t.string('mode', 10).notNullable().defaultTo('TEST');
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.string('redirect_url', 500);
    t.uuid('pinned_connector_id').references('id').inTable('provider_accounts');
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.timestamp('expires_at', { useTz: true });
    t.index(['merchant_id', 'mode']);
    t.index('token');
  });

  // ── Payment Tokens ──
  await knex.schema.createTable('payment_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('provider', 30).notNullable();
    t.uuid('account_id').notNullable().references('id').inTable('provider_accounts');
    t.text('provider_pm_id').notNullable();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('used_at', { useTz: true });
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('merchant_id');
    t.index('expires_at');
  });

  // ── Webhook Endpoints ──
  await knex.schema.createTable('webhook_endpoints', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.text('url').notNullable();
    t.string('signing_secret', 64).notNullable();
    t.text('description');
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.text('subscribed_events').notNullable().defaultTo('payment_intent.succeeded,payment_intent.failed,payment_intent.canceled');
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Gateway Events ──
  await knex.schema.createTable('gateway_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('event_type', 100).notNullable();
    t.uuid('resource_id').notNullable();
    t.text('payload').notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('merchant_id');
  });

  // ── Webhook Deliveries ──
  await knex.schema.createTable('webhook_deliveries', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('gateway_event_id').notNullable().references('id').inTable('gateway_events');
    t.uuid('webhook_endpoint_id').notNullable().references('id').inTable('webhook_endpoints');
    t.string('status', 20).notNullable().defaultTo('PENDING');
    t.integer('http_status');
    t.text('response_body');
    t.integer('attempt_count').notNullable().defaultTo(0);
    t.timestamp('next_retry_at', { useTz: true });
    t.timestamp('last_attempted_at', { useTz: true });
    t.timestamps(true, true);
  });

  // ── Gateway Logs ──
  await knex.schema.createTable('gateway_logs', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').references('id').inTable('merchants');
    t.uuid('api_key_id').references('id').inTable('api_keys');
    t.string('request_id', 64);
    t.string('type', 30).notNullable();
    t.string('method', 10);
    t.text('path');
    t.text('request_headers');
    t.text('request_body');
    t.integer('response_status');
    t.text('response_body');
    t.bigInteger('duration_ms');
    t.string('trace_id', 64);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['merchant_id', 'created_at']);
    t.index('type');
  });

  // ── Outbox Events ──
  await knex.schema.createTable('outbox_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.string('event_type', 100).notNullable();
    t.uuid('resource_id').notNullable();
    t.text('payload').notNullable();
    t.boolean('processed').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['processed', 'created_at']);
  });

  // ── Processed Webhook Events ──
  await knex.schema.createTable('processed_webhook_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('event_id', 255).notNullable().unique();
    t.timestamp('processed_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('event_id');
  });

  // ── MFA Backup Codes ──
  await knex.schema.createTable('mfa_backup_codes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('code_hash', 255).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  const tables = [
    'mfa_backup_codes', 'processed_webhook_events', 'outbox_events',
    'gateway_logs', 'webhook_deliveries', 'gateway_events', 'webhook_endpoints',
    'payment_tokens', 'payment_links', 'refunds', 'payment_requests',
    'payment_intents', 'routing_rules', 'provider_accounts', 'api_keys',
    'invite_tokens', 'refresh_tokens', 'merchant_users', 'organization_users',
    'merchants', 'organizations', 'users',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
}
