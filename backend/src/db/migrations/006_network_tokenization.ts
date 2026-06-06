import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('network_tokens', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('merchant_id').notNullable().references('id').inTable('merchants').onDelete('CASCADE');
    t.string('card_network', 20).notNullable(); // VISA, MASTERCARD, AMEX
    t.text('token_value').notNullable(); // network token (encrypted)
    t.string('token_ref', 255); // network-side reference ID
    t.string('token_type', 20).notNullable(); // CLOUD, ISSUER, ACQUIRER
    t.string('card_last_four', 4);
    t.string('card_expiry_month', 2);
    t.string('card_expiry_year', 4);
    t.text('pan_encrypted'); // original PAN (encrypted, for fallback)
    t.string('status', 20).notNullable().defaultTo('ACTIVE'); // ACTIVE, SUSPENDED, DELETED, EXPIRED
    t.string('cryptogram_provider', 30); // HSM, NETWORK, SOFTWARE
    t.timestamp('expires_at', { useTz: true });
    t.timestamp('last_refresh_at', { useTz: true });
    t.integer('refresh_count').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.index(['merchant_id', 'status']);
    t.index('token_ref');
  });

  await knex.schema.createTable('token_lifecycle_events', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('network_token_id').notNullable().references('id').inTable('network_tokens').onDelete('CASCADE');
    t.string('event_type', 30).notNullable(); // ENROLLED, ACTIVATED, SUSPENDED, RESUMED, REFRESHED, DELETED, CRYPTOGRAM_GENERATED
    t.string('previous_status', 20);
    t.string('new_status', 20);
    t.text('reason');
    t.string('request_id', 255); // network correlation ID
    t.text('raw_response'); // network response JSON
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('network_token_id');
    t.index('event_type');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('token_lifecycle_events');
  await knex.schema.dropTableIfExists('network_tokens');
}
