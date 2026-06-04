import { Knex } from 'knex';

/**
 * Adds:
 *   - `password_reset_tokens` for the forgot-password flow (single-use,
 *     hashed token + TTL).
 *   - `dispute_evidence` for chargeback responses (text fields submitted to
 *     the provider; one open submission per dispute).
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('password_reset_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.boolean('used').notNullable().defaultTo(false);
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
    t.index('token_hash');
    t.index('expires_at');
  });

  await knex.schema.createTable('dispute_evidence', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('dispute_id').notNullable().references('id').inTable('disputes').onDelete('CASCADE');
    // Stripe text fields (subset). Each is optional; the merchant fills in
    // what's relevant. We persist them so they can be edited & resubmitted.
    t.text('product_description');
    t.text('customer_name');
    t.text('customer_email_address');
    t.text('billing_address');
    t.text('shipping_address');
    t.text('shipping_carrier');
    t.text('shipping_tracking_number');
    t.text('service_date');
    t.text('refund_policy');
    t.text('uncategorized_text');
    // SUBMITTED | DRAFT
    t.string('status', 20).notNullable().defaultTo('DRAFT');
    t.text('provider_response');
    t.timestamp('submitted_at', { useTz: true });
    t.timestamps(true, true);
    t.index('dispute_id');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('dispute_evidence');
  await knex.schema.dropTableIfExists('password_reset_tokens');
}
