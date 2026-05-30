import { Knex } from 'knex';

/**
 * Replaces the in-memory `mfaSessions` Map in auth.service with a database
 * table so MFA mid-login sessions survive restarts and are shared across
 * instances. Sessions are short-lived (default 5 min) and the worker runs
 * a TTL sweep on lookup.
 */
export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('mfa_sessions', (t) => {
    t.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    t.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    // SHA-256 hex of the raw session token; the raw token is returned to the
    // client and never persisted.
    t.string('token_hash', 64).notNullable().unique();
    t.timestamp('expires_at', { useTz: true }).notNullable();
    t.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    t.index('token_hash');
    t.index('expires_at');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('mfa_sessions');
}
