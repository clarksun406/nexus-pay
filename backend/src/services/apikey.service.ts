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
      plaintext_key: secret.raw,
      prefix: secret.raw.slice(0, 10),
      name: name ? `${name} (Secret)` : 'Secret Key',
      status: 'ACTIVE',
    }).returning('*');

    const [pkRow] = await db('api_keys').insert({
      merchant_id: merchantId,
      mode,
      type: 'PUBLISHABLE',
      key_hash: publishable.hash,
      plaintext_key: publishable.raw,
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
      plaintextKey: k.plaintext_key,
    }));
  }

  async revoke(merchantId: string, keyId: string) {
    const key = await db('api_keys').where({ id: keyId, merchant_id: merchantId }).first();
    if (!key) throw Object.assign(new Error('API key not found'), { status: 404 });

    await db('api_keys').where({ id: keyId }).update({
      status: 'REVOKED',
      revoked_at: new Date(),
      plaintext_key: null,
    });
  }
}

export const apiKeyService = new ApiKeyService();
