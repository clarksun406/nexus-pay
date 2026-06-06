import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Fraud Rules ──
  await knex.schema.createTable('fraud_rules', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('name', 100).notNullable();
    t.string('rule_type', 30).notNullable();
    // AMOUNT_THRESHOLD | VELOCITY | COUNTRY_BLOCK | CARD_BIN | EMAIL_DOMAIN |
    // DEVICE_FINGERPRINT | IP_RANGE | CUSTOM_METADATA
    t.text('config').notNullable(); // JSON: { field, operator, value, threshold, windowMinutes, etc. }
    t.string('action', 20).notNullable().defaultTo('FLAG'); // BLOCK | FLAG | REVIEW
    t.integer('priority').notNullable().defaultTo(0);
    t.boolean('enabled').notNullable().defaultTo(true);
    t.bigInteger('max_daily_hits'); // 0 = unlimited
    t.timestamps(true, true);
    t.index('merchant_id');
  });

  // ── Blocklists ──
  await knex.schema.createTable('blocklists', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('type', 30).notNullable(); // CARD_NUMBER | EMAIL | IP | DEVICE_FINGERPRINT | COUNTRY | CARD_BIN
    t.string('value', 255).notNullable();
    t.string('list_type', 10).notNullable().defaultTo('BLACK'); // BLACK | WHITE
    t.text('reason');
    t.boolean('enabled').notNullable().defaultTo(true);
    t.timestamps(true, true);
    t.unique(['merchant_id', 'type', 'value']);
  });

  // ── Fraud Scores (per payment intent) ──
  await knex.schema.createTable('fraud_scores', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.integer('score').notNullable(); // 0-100
    t.string('level', 10).notNullable(); // LOW | MEDIUM | HIGH | DECLINED
    t.text('factors'); // JSON array: [{ factor: 'amount_anomaly', weight: 20, description: '…' }]
    t.timestamps(true, true);
    t.index('payment_intent_id');
  });

  // ── Fraud Alerts ──
  await knex.schema.createTable('fraud_alerts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('payment_intent_id').references('id').inTable('payment_intents').onDelete('SET NULL');
    t.uuid('rule_id').references('id').inTable('fraud_rules').onDelete('SET NULL');
    t.string('severity', 10).notNullable(); // INFO | WARNING | CRITICAL
    t.string('action_taken', 20).notNullable(); // BLOCKED | FLAGGED | REVIEW_REQUIRED
    t.text('message');
    t.boolean('resolved').notNullable().defaultTo(false);
    t.timestamp('resolved_at', { useTz: true });
    t.timestamps(true, true);
    t.index('merchant_id');
    t.index('payment_intent_id');
  });

  // ── Payment Reviews (manual review queue) ──
  await knex.schema.createTable('payment_reviews', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.uuid('payment_intent_id').notNullable().references('id').inTable('payment_intents').onDelete('CASCADE');
    t.string('status', 20).notNullable().defaultTo('PENDING'); // PENDING | APPROVED | REJECTED
    t.text('reason');
    t.uuid('reviewed_by').references('id').inTable('users').onDelete('SET NULL');
    t.text('review_notes');
    t.timestamp('reviewed_at', { useTz: true });
    t.timestamps(true, true);
    t.index('merchant_id');
    t.index('payment_intent_id');
    t.index('status');
  });

  // ── payment_intents: add risk columns ──
  await knex.schema.alterTable('payment_intents', (t) => {
    t.integer('risk_score');
    t.string('risk_level', 10); // LOW | MEDIUM | HIGH | DECLINED
    t.string('review_status', 20); // PASSED | FLAGGED | PENDING_REVIEW | DECLINED
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('payment_intents', (t) => {
    t.dropColumn('risk_score');
    t.dropColumn('risk_level');
    t.dropColumn('review_status');
  });
  await knex.schema.dropTableIfExists('payment_reviews');
  await knex.schema.dropTableIfExists('fraud_alerts');
  await knex.schema.dropTableIfExists('fraud_scores');
  await knex.schema.dropTableIfExists('blocklists');
  await knex.schema.dropTableIfExists('fraud_rules');
}
