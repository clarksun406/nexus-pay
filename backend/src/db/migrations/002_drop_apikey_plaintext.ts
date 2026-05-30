import { Knex } from 'knex';

/**
 * Security hardening: API keys must never be recoverable from the database.
 * We only persist the SHA-256 hash (`key_hash`); the raw key is shown to the
 * user exactly once at creation time. This migration removes the legacy
 * `plaintext_key` column (nulling it first as defence-in-depth).
 */
export async function up(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('api_keys', 'plaintext_key');
  if (hasColumn) {
    await knex('api_keys').update({ plaintext_key: null });
    await knex.schema.alterTable('api_keys', (t) => {
      t.dropColumn('plaintext_key');
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  const hasColumn = await knex.schema.hasColumn('api_keys', 'plaintext_key');
  if (!hasColumn) {
    await knex.schema.alterTable('api_keys', (t) => {
      t.string('plaintext_key', 255);
    });
  }
}
