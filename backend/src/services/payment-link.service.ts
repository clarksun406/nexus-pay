import crypto from 'crypto';
import db from '../db/connection';

export class PaymentLinkService {
  async create(merchantId: string, body: any) {
    const token = crypto.randomBytes(32).toString('hex');

    const [link] = await db('payment_links').insert({
      merchant_id: merchantId,
      token,
      title: body.title,
      description: body.description,
      amount: body.amount,
      currency: body.currency || 'usd',
      mode: body.mode || 'TEST',
      status: 'ACTIVE',
      redirect_url: body.redirectUrl,
      pinned_connector_id: body.pinnedConnectorId,
      expires_at: body.expiresAt,
    }).returning('*');

    return this.toResponse(link);
  }

  async list(merchantId: string, mode?: string) {
    let query = db('payment_links').where({ merchant_id: merchantId });
    if (mode) query = query.where({ mode });

    const links = await query.orderBy('created_at', 'desc');
    return links.map((l: any) => this.toResponse(l));
  }

  async get(merchantId: string, linkId: string) {
    const link = await db('payment_links').where({ id: linkId, merchant_id: merchantId }).first();
    if (!link) throw Object.assign(new Error('Payment link not found'), { status: 404 });
    return this.toResponse(link);
  }

  async getByToken(token: string) {
    const link = await db('payment_links').where({ token, status: 'ACTIVE' }).first();
    if (!link) throw Object.assign(new Error('Payment link not found'), { status: 404 });
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      throw Object.assign(new Error('Payment link has expired'), { status: 410 });
    }
    return this.toResponse(link);
  }

  async update(merchantId: string, linkId: string, body: any) {
    const link = await db('payment_links').where({ id: linkId, merchant_id: merchantId }).first();
    if (!link) throw Object.assign(new Error('Payment link not found'), { status: 404 });

    const updates: any = {};
    if (body.title) updates.title = body.title;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status) updates.status = body.status;
    if (body.redirectUrl !== undefined) updates.redirect_url = body.redirectUrl;

    const [updated] = await db('payment_links').where({ id: linkId }).update(updates).returning('*');
    return this.toResponse(updated);
  }

  async deactivate(merchantId: string, linkId: string) {
    await db('payment_links').where({ id: linkId, merchant_id: merchantId }).update({ status: 'INACTIVE' });
  }

  private toResponse(link: any) {
    return {
      id: link.id,
      merchantId: link.merchant_id,
      token: link.token,
      title: link.title,
      description: link.description,
      amount: link.amount,
      currency: link.currency,
      mode: link.mode,
      status: link.status,
      redirectUrl: link.redirect_url,
      pinnedConnectorId: link.pinned_connector_id,
      payUrl: `${process.env.PAY_BASE_URL || 'http://localhost:5173'}/pay/${link.token}`,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
    };
  }
}

export const paymentLinkService = new PaymentLinkService();
