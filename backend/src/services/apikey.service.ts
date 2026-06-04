import db from '../db/connection';
import { generateApiKey, hashSha256 } from '../utils/crypto';

export class ApiKeyService {
  async create(merchantId: string, name: string, mode: 'TEST' | 'LIVE') {
    // Generate secret key
    const secret = generateApiKey('sk');
    const publishable = generateApiKey('pk');

    const [skRow] = await db('api_keys').insert({
      merchant_id: merchantId,
      mode,
      type: 'SECRET',
      key_hash: secret.hash,
      prefix: secret.raw.slice(0, 10),
      name: name ? `${name} (Secret)` : 'Secret Key',
      status: 'ACTIVE',
    }).returning('*');

    const [pkRow] = await db('api_keys').insert({
      merchant_id: merchantId,
      mode,
      type: 'PUBLISHABLE',
      key_hash: publishable.hash,
      prefix: publishable.raw.slice(0, 10),
      name: name ? `${name} (Publishable)` : 'Publishable Key',
      status: 'ACTIVE',
    }).returning('*');

    return {
      secretKey: { id: skRow.id, key: secret.raw, name: skRow.name, mode, type: 'SECRET' },
      publishableKey: { id: pkRow.id, key: publishable.raw, name: pkRow.name, mode, type: 'PUBLISHABLE' },
    };
  }

  async list(merchantId: string) {
    const keys = await db('api_keys')
      .where({ merchant_id: merchantId })
      .whereNot({ status: 'REVOKED' })
      .orderBy('created_at', 'desc');

    return keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      type: k.type,
      mode: k.mode,
      prefix: k.prefix,
      status: k.status,
      lastUsedAt: k.last_used_at,
      createdAt: k.created_at,
    }));
  }

  async revoke(merchantId: string, keyId: string) {
    const key = await db('api_keys').where({ id: keyId, merchant_id: merchantId }).first();
    if (!key) throw Object.assign(new Error('API key not found'), { status: 404 });

    await db('api_keys').where({ id: keyId }).update({
      status: 'REVOKED',
      revoked_at: new Date(),
    });
  }

  /**
   * Atomically issue a new key in the same mode/type and revoke the old one.
   * Returns the freshly-minted raw key (shown to the merchant exactly once)
   * along with its metadata. The old key continues to work until the
   * transaction commits, then immediately stops.
   */
  async rotate(merchantId: string, keyId: string) {
    const existing = await db('api_keys').where({ id: keyId, merchant_id: merchantId }).first();
    if (!existing) throw Object.assign(new Error('API key not found'), { status: 404 });
    if (existing.status === 'REVOKED') {
      throw Object.assign(new Error('Cannot rotate a revoked key'), { status: 400 });
    }

    const prefix = existing.type === 'SECRET' ? 'sk' : 'pk';
    const fresh = generateApiKey(prefix);

    const trx = await db.transaction();
    try {
      const [newRow] = await trx('api_keys').insert({
        merchant_id: merchantId,
        mode: existing.mode,
        type: existing.type,
        key_hash: fresh.hash,
        prefix: fresh.raw.slice(0, 10),
        name: existing.name,
        status: 'ACTIVE',
      }).returning('*');

      await trx('api_keys').where({ id: existing.id }).update({
        status: 'REVOKED',
        revoked_at: new Date(),
      });

      await trx.commit();

      return {
        id: newRow.id,
        key: fresh.raw,
        name: newRow.name,
        mode: newRow.mode,
        type: newRow.type,
        rotatedFromId: existing.id,
      };
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }
}

export const apiKeyService = new ApiKeyService();
