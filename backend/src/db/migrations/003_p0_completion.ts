import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Card BIN Registry ──
  // BIN (Bank Identification Number) 表，用于卡 BIN 路由优化
  await knex.schema.createTable('card_bin_registry', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.string('bin_prefix', 8).notNullable(); // 6 or 8 digit BIN
    t.string('card_network', 20).notNullable(); // VISA, MASTERCARD, AMEX, JCB, etc.
    t.string('card_type', 20); // CREDIT, DEBIT, PREPAID
    t.string('issuer_name', 100);
    t.string('issuer_country', 5);
    t.string('preferred_provider', 30); // STRIPE, ADYEN, etc.
    t.decimal('success_rate', 5, 2).defaultTo(100);
    t.integer('sample_size').defaultTo(0);
    t.json('provider_performance'); // { stripe: { successRate: 95, avgLatency: 200 } }
    t.string('status', 20).notNullable().defaultTo('ACTIVE');
    t.timestamps(true, true);
    t.index('bin_prefix');
    t.index('card_network');
  });

  // retry_attempts: 记录 3DS 升级重试与 BIN 路由决策
  await knex.schema.alterTable('retry_attempts', (t) => {
    t.string('card_bin', 8);
    t.boolean('three_ds_upgrade_attempted').defaultTo(false);
    t.string('bin_routing_provider', 30);
  });

  // ── Settlement Records (Bank Reconciliation) ──
  // 银行结算数据导入
  await knex.schema.createTable('settlement_records', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('source_id').references('id').inTable('reconciliation_sources');
    t.string('settlement_reference', 255);
    t.bigInteger('settlement_amount').notNullable();
    t.string('settlement_currency', 10).notNullable();
    t.bigInteger('fee_amount');
    t.bigInteger('net_amount');
    t.date('value_date').notNullable();
    t.string('status', 20).notNullable().defaultTo('PENDING'); // PENDING, MATCHED, UNMATCHED
    t.integer('matched_transactions_count').defaultTo(0);
    t.bigInteger('discrepancy_amount').defaultTo(0);
    t.text('raw_data');
    t.text('file_reference');
    t.timestamps(true, true);
    t.index(['merchant_id', 'value_date']);
    t.index('settlement_reference');
  });

  // ── Request Latency Samples (for p95/p99) ──
  // 保留最近 N 天的延迟样本，用于精准分位数计算
  await knex.schema.createTable('request_latency_samples', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('connector_account_id').notNullable().references('id').inTable('provider_accounts').onDelete('CASCADE');
    t.integer('latency_ms').notNullable();
    t.boolean('success').notNullable();
    t.string('request_type', 30).defaultTo('CHARGE'); // CHARGE, CAPTURE, REFUND
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index(['connector_account_id', 'recorded_at']);
  });

  // provider_health_metrics: 补齐 p99
  await knex.schema.alterTable('provider_health_metrics', (t) => {
    t.bigInteger('p99_latency_ms');
    t.bigInteger('sample_count').defaultTo(0);
  });

  // ── 3DS Liability Shift ──
  // 责任转移记录
  await knex.schema.createTable('three_ds_liability_shifts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('session_id').notNullable().references('id').inTable('three_ds_sessions').onDelete('CASCADE');
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.string('liability_shift', 20).notNullable(); // TO_ISSUER, TO_MERCHANT, NO_SHIFT
    t.string('eci', 10);
    t.string('authentication_method', 30); // FRICTIONLESS, CHALLENGE, FALLBACK
    t.boolean('chargeback_protected').defaultTo(false);
    t.text('reason');
    t.timestamp('recorded_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('payment_intent_id');
    t.index('session_id');
  });

  // three_ds_sessions: 补齐 1.0 与 frictionless 相关字段
  await knex.schema.alterTable('three_ds_sessions', (t) => {
    t.boolean('frictionless_flow').defaultTo(false);
    t.string('flow_type', 20); // CHALLENGE, FRICTIONLESS, REDIRECT (1.0)
    t.text('pareq'); // 3DS 1.0 PaReq
    t.text('pares'); // 3DS 1.0 PaRes
    t.string('md'); // 3DS 1.0 Merchant Data
    t.text('authentication_value'); // CAVV for 1.0
  });

  // payment_intents: 记录 3DS 升级尝试次数
  await knex.schema.alterTable('payment_intents', (t) => {
    t.integer('three_ds_upgrade_count').defaultTo(0);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payment_intents', (t) => {
    t.dropColumn('three_ds_upgrade_count');
  });
  await knex.schema.alterTable('three_ds_sessions', (t) => {
    t.dropColumn('frictionless_flow');
    t.dropColumn('flow_type');
    t.dropColumn('pareq');
    t.dropColumn('pares');
    t.dropColumn('md');
    t.dropColumn('authentication_value');
  });
  await knex.schema.alterTable('provider_health_metrics', (t) => {
    t.dropColumn('p99_latency_ms');
    t.dropColumn('sample_count');
  });
  await knex.schema.alterTable('retry_attempts', (t) => {
    t.dropColumn('card_bin');
    t.dropColumn('three_ds_upgrade_attempted');
    t.dropColumn('bin_routing_provider');
  });
  await knex.schema.dropTableIfExists('three_ds_liability_shifts');
  await knex.schema.dropTableIfExists('request_latency_samples');
  await knex.schema.dropTableIfExists('settlement_records');
  await knex.schema.dropTableIfExists('card_bin_registry');
}
