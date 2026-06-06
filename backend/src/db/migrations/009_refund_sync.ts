import { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  // ── Refund sync tracking columns ──
  await knex.schema.alterTable('refunds', (t) => {
    t.string('sync_status', 20).notNullable().defaultTo('NOT_SYNCED');
    // NOT_SYNCED | SYNCING | SYNCED | SYNC_FAILED
    t.timestamp('last_synced_at', { useTz: true });
    t.integer('sync_attempts').notNullable().defaultTo(0);
    t.integer('retry_count').notNullable().defaultTo(0);
    t.timestamp('next_retry_at', { useTz: true });
    t.text('last_sync_error');
  });

  // Index for the scheduler to quickly find PENDING refunds that need syncing
  await knex.schema.raw(
    'CREATE INDEX IF NOT EXISTS idx_refunds_pending_sync ON refunds (sync_status, status) WHERE status = \'PENDING\' AND sync_status != \'SYNCED\'',
  );
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.raw('DROP INDEX IF EXISTS idx_refunds_pending_sync');
  await knex.schema.alterTable('refunds', (t) => {
    t.dropColumn('last_sync_error');
    t.dropColumn('next_retry_at');
    t.dropColumn('retry_count');
    t.dropColumn('sync_attempts');
    t.dropColumn('last_synced_at');
    t.dropColumn('sync_status');
  });
}