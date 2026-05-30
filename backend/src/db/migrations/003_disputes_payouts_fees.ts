import { Knex } from 'knex';

/**
 * Adds the data model for:
 *   - Disputes (chargebacks) sourced from provider webhooks.
 *   - Payouts: periodic settlement summaries with line items.
 *   - Per-attempt fee/net amounts so we can reconcile and aggregate.
 */
export async function up(knex: Knex): Promise<void> {
  // ── Disputes ──
  await knex.schema.createTable('disputes', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.uuid('payment_intent_id').references('id').inTable('payment_intents');
    t.string('mode', 10).notNullable();
    t.string('provider', 30).notNullable();
    t.string('provider_dispute_id', 255).notNullable();
    t.bigInteger('amount').notNullable();
    t.string('currency', 10).notNullable();
    t.string('reason', 100);
    // OPEN | UNDER_REVIEW | WON | LOST | WARNING_NEEDS_RESPONSE | CHARGE_REFUNDED
    t.string('status', 40).notNullable();
    t.text('evidence_due_by');
    t.text('provider_payload');
    t.timestamps(true, true);
    t.unique(['provider', 'provider_dispute_id']);
    t.index('merchant_id');
    t.index('status');
  });

  // ── Payouts (settlement summaries) ──
  await knex.schema.createTable('payouts', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants');
    t.uuid('connector_account_id').references('id').inTable('provider_accounts');
    t.string('mode', 10).notNullable();
    t.string('currency', 10).notNullable();
    t.bigInteger('gross_amount').notNullable().defaultTo(0);
    t.bigInteger('refunded_amount').notNullable().defaultTo(0);
    t.bigInteger('disputed_amount').notNullable().defaultTo(0);
    t.bigInteger('fee_amount').notNullable().defaultTo(0);
    t.bigInteger('net_amount').notNullable().defaultTo(0);
    t.timestamp('period_start', { useTz: true }).notNullable();
    t.timestamp('period_end', { useTz: true }).notNullable();
    // PENDING | PAID | FAILED
    t.string('status', 20).notNullable().defaultTo('PENDING');
    t.timestamps(true, true);
    t.index(['merchant_id', 'period_end']);
    t.unique(['merchant_id', 'connector_account_id', 'period_start', 'period_end']);
  });

  // ── Per-payment line items rolled into a payout ──
  await knex.schema.createTable('payout_items', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('payout_id').notNullable().references('id').inTable('payouts').onDelete('CASCADE');
    t.uuid('payment_intent_id').references('id').inTable('payment_intents');
    t.uuid('refund_id').references('id').inTable('refunds');
    // PAYMENT | REFUND | DISPUTE | FEE | ADJUSTMENT
    t.string('type', 20).notNullable();
    t.bigInteger('amount').notNullable();
    t.bigInteger('fee_amount').notNullable().defaultTo(0);
    t.bigInteger('net_amount').notNullable();
    t.string('currency', 10).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('payout_id');
    t.index('payment_intent_id');
  });

  // ── Per-attempt fee/net columns on payment_intents and refunds ──
  await knex.schema.alterTable('payment_intents', (t) => {
    t.bigInteger('fee_amount');
    t.bigInteger('net_amount');
  });
  await knex.schema.alterTable('refunds', (t) => {
    t.bigInteger('fee_amount');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('refunds', (t) => {
    t.dropColumn('fee_amount');
  });
  await knex.schema.alterTable('payment_intents', (t) => {
    t.dropColumn('fee_amount');
    t.dropColumn('net_amount');
  });
  await knex.schema.dropTableIfExists('payout_items');
  await knex.schema.dropTableIfExists('payouts');
  await knex.schema.dropTableIfExists('disputes');
}
