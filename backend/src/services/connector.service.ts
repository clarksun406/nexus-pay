import db from '../db/connection';
import { encrypt, decrypt, isEncryptionConfigured } from '../utils/crypto';

function ensureEncryptionReady() {
  if (!isEncryptionConfigured()) {
    throw Object.assign(
      new Error('Server encryption is not configured (ENCRYPTION_KEY missing); cannot securely store provider credentials.'),
      { status: 503 },
    );
  }
}

export class ConnectorService {
  async create(merchantId: string, body: any) {
    ensureEncryptionReady();
    const encryptedCreds = encrypt(JSON.stringify(body.credentials || {}));

    const [account] = await db('provider_accounts').insert({
      merchant_id: merchantId,
      provider: body.provider.toUpperCase(),
      mode: body.mode || 'TEST',
      label: body.label,
      encrypted_credentials: encryptedCreds,
      provider_config: JSON.stringify(body.config || {}),
      is_primary: body.isPrimary || false,
      weight: body.weight || 1,
      display_order: body.displayOrder || 0,
      fee_config: body.feeConfig ? JSON.stringify(body.feeConfig) : null,
      status: 'ACTIVE',
    }).returning('*');

    return this.toResponse(account);
  }

  async list(merchantId: string) {
    const accounts = await db('provider_accounts')
      .where({ merchant_id: merchantId })
      .orderBy('display_order', 'asc')
      .orderBy('created_at', 'desc');

    return accounts.map((a: any) => this.toResponse(a));
  }

  async get(merchantId: string, accountId: string) {
    const account = await db('provider_accounts')
      .where({ id: accountId, merchant_id: merchantId })
      .first();
    if (!account) throw Object.assign(new Error('Connector not found'), { status: 404 });
    return this.toResponse(account);
  }

  async update(merchantId: string, accountId: string, body: any) {
    const account = await db('provider_accounts')
      .where({ id: accountId, merchant_id: merchantId })
      .first();
    if (!account) throw Object.assign(new Error('Connector not found'), { status: 404 });

    const updates: any = {};
    if (body.label) updates.label = body.label;
    if (body.weight !== undefined) updates.weight = body.weight;
    if (body.displayOrder !== undefined) updates.display_order = body.displayOrder;
    if (body.isPrimary !== undefined) updates.is_primary = body.isPrimary;
    if (body.status) updates.status = body.status;
    if (body.config) updates.provider_config = JSON.stringify(body.config);
    if (body.feeConfig) updates.fee_config = JSON.stringify(body.feeConfig);
    if (body.credentials) {
      ensureEncryptionReady();
      updates.encrypted_credentials = encrypt(JSON.stringify(body.credentials));
    }

    const [updated] = await db('provider_accounts').where({ id: accountId }).update(updates).returning('*');
    return this.toResponse(updated);
  }

  async delete(merchantId: string, accountId: string) {
    const account = await db('provider_accounts')
      .where({ id: accountId, merchant_id: merchantId })
      .first();
    if (!account) throw Object.assign(new Error('Connector not found'), { status: 404 });

    await db('provider_accounts').where({ id: accountId }).update({ status: 'DELETED' });
  }

  async reorder(merchantId: string, items: { id: string; displayOrder: number }[]) {
    for (const item of items) {
      await db('provider_accounts')
        .where({ id: item.id, merchant_id: merchantId })
        .update({ display_order: item.displayOrder });
    }
  }

  private toResponse(account: any) {
    return {
      id: account.id,
      merchantId: account.merchant_id,
      provider: account.provider,
      mode: account.mode,
      label: account.label,
      isPrimary: account.is_primary,
      weight: account.weight,
      displayOrder: account.display_order,
      status: account.status,
      feeConfig: account.fee_config ? JSON.parse(account.fee_config) : null,
      providerConfig: account.provider_config ? JSON.parse(account.provider_config) : null,
      connectorAccountId: account.connector_account_id,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    };
  }
}

export const connectorService = new ConnectorService();
