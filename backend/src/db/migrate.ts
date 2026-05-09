import db from './connection';

async function migrate() {
  try {
    await db.migrate.latest();
    console.log('Migrations completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

migrate();
