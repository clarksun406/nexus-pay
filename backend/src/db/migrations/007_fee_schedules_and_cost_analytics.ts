import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Fee Schedules ──
  await knex.schema.createTable('fee_schedules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('provider', 20);                      // null =适用于所有 provider
    t.string('fee_type', 20).notNullable().defaultTo('PERCENTAGE_FLAT'); // PERCENTAGE_FLAT | PERCENTAGE_TIERED | FLAT
    t.text('config').notNullable();                 // JSON: { percentage, fixed, tiers: [{ min, max, percentage, fixed }] }
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Cost Analytics ──
  await knex.schema.createTable('cost_analytics', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('connector_account_id').references('id').inTable('provider_accounts').onDelete('SET NULL');
    t.string('period', 7).notNullable();            // e.g. "2026-06"
    t.bigInteger('total_volume').notNullable().defaultTo(0);
    t.bigInteger('total_fees').notNullable().defaultTo(0);
    t.bigInteger('expected_fees').notNullable().defaultTo(0);
    t.integer('transaction_count').notNullable().defaultTo(0);
    t.decimal('avg_fee_bps', 10, 2).notNullable().defaultTo(0);
    t.decimal('fee_variance', 20, 2).notNullable().defaultTo(0); // actual - expected (cents)
    t.integer('anomaly_count').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['merchant_id', 'connector_account_id', 'period']);
  });

  // ── Routing Rules: add cost_aware and fee_schedule_id ──
  await knex.schema.alterTable('routing_rules', (t) => {
    t.boolean('cost_aware').notNullable().defaultTo(false);
    t.uuid('fee_schedule_id').references('id').inTable('fee_schedules').onDelete('SET NULL');
  });

  // ── Anomaly Log ──
  await knex.schema.createTable('fee_anomalies', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('connector_account_id').references('id').inTable('provider_accounts').onDelete('SET NULL');
    t.uuid('payment_intent_id').references('id').inTable('payment_intents').onDelete('SET NULL');
    t.bigInteger('expected_fee').notNullable();
    t.bigInteger('actual_fee').notNullable();
    t.bigInteger('variance').notNullable();
    t.string('severity', 10).notNullable().defaultTo('WARNING'); // INFO | WARNING | CRITICAL
    t.text('notes');
    t.boolean('resolved').notNullable().defaultTo(false);
    t.timestamp('resolved_at', { useTz: true });
    t.timestamps(true, true);
    t.index('merchant_id');
    t.index('payment_intent_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('fee_anomalies');
  await knex.schema.alterTable('routing_rules', (t) => {
    t.dropColumn('fee_schedule_id');
    t.dropColumn('cost_aware');
  });
  await knex.schema.dropTableIfExists('cost_analytics');
  await knex.schema.dropTableIfExists('fee_schedules');
}
