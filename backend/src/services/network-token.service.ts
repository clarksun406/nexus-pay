import crypto from 'crypto';
import db from '../db/connection';
import { encrypt, decrypt } from '../utils/crypto';
import { config } from '../config';

export type TokenStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED' | 'EXPIRED';
export type CardNetwork = 'VISA' | 'MASTERCARD' | 'AMEX';
export type LifecycleEventType =
  | 'ENROLLED'
  | 'ACTIVATED'
  | 'SUSPENDED'
  | 'RESUMED'
  | 'REFRESHED'
  | 'DELETED'
  | 'CRYPTOGRAM_GENERATED';

export interface NetworkToken {
  id: string;
  merchantId: string;
  cardNetwork: CardNetwork;
  tokenType: string;
  cardLastFour: string;
  cardExpiryMonth: string;
  cardExpiryYear: string;
  status: TokenStatus;
  cryptogramProvider: string | null;
  tokenRef: string | null;
  expiresAt: Date | null;
  lastRefreshAt: Date | null;
  refreshCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface CryptogramResult {
  cryptogram: string;
  eci: string;
  tokenValue: string;
}

interface NetworkEnrollResponse {
  tokenValue: string;
  tokenRef: string;
  tokenType: string;
  expiresAt: Date;
  cryptogramProvider: string;
}

interface NetworkRefreshResponse {
  tokenValue: string;
  expiresAt: Date;
}

interface NetworkCryptogramResponse {
  cryptogram: string;
  eci: string;
}

class NetworkTokenService {
  async enroll(
    merchantId: string,
    data: {
      cardNumber: string;
      expiryMonth: string;
      expiryYear: string;
      cardNetwork: CardNetwork;
    }
  ): Promise<NetworkToken> {
    const { cardNumber, expiryMonth, expiryYear, cardNetwork } = data;

    if (!cardNumber || cardNumber.length < 13 || cardNumber.length > 19) {
      throw Object.assign(new Error('Invalid card number'), { status: 400 });
    }
    if (!['VISA', 'MASTERCARD', 'AMEX'].includes(cardNetwork)) {
      throw Object.assign(new Error(`Unsupported card network: ${cardNetwork}`), { status: 400 });
    }

    const networkResponse = await this._networkEnroll(cardNetwork, cardNumber, expiryMonth, expiryYear);

    const lastFour = cardNumber.slice(-4);
    const [row] = await db('network_tokens')
      .insert({
        merchant_id: merchantId,
        card_network: cardNetwork,
        token_value: encrypt(networkResponse.tokenValue),
        token_ref: networkResponse.tokenRef,
        token_type: networkResponse.tokenType,
        card_last_four: lastFour,
        card_expiry_month: expiryMonth,
        card_expiry_year: expiryYear,
        pan_encrypted: encrypt(cardNumber),
        status: 'ACTIVE',
        cryptogram_provider: networkResponse.cryptogramProvider,
        expires_at: networkResponse.expiresAt,
        last_refresh_at: new Date(),
      })
      .returning('*');

    await this._recordEvent(row.id, 'ENROLLED', null, 'ACTIVE', null, null, null);
    await this._recordEvent(row.id, 'ACTIVATED', 'ENROLLED', 'ACTIVE', null, null, null);

    return this._toToken(row);
  }

  async getToken(merchantId: string, tokenId: string): Promise<NetworkToken> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    return this._toToken(row);
  }

  async listTokens(merchantId: string, filters?: { cardNetwork?: string; status?: string }): Promise<NetworkToken[]> {
    let query = db('network_tokens').where({ merchant_id: merchantId });
    if (filters?.cardNetwork) query = query.where({ card_network: filters.cardNetwork });
    if (filters?.status) query = query.where({ status: filters.status });
    const rows = await query.orderBy('created_at', 'desc');
    return rows.map((r: any) => this._toToken(r));
  }

  async deleteToken(merchantId: string, tokenId: string): Promise<void> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (row.status === 'DELETED') return;

    const networkResponse = await this._networkDelete(row.card_network as CardNetwork, row.token_ref);

    await db('network_tokens').where({ id: tokenId }).update({
      status: 'DELETED',
      updated_at: new Date(),
    });

    await this._recordEvent(
      tokenId,
      'DELETED',
      row.status,
      'DELETED',
      null,
      networkResponse?.requestId ?? null,
      networkResponse?.rawResponse ?? null
    );
  }

  async refreshToken(merchantId: string, tokenId: string): Promise<NetworkToken> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (row.status === 'DELETED') {
      throw Object.assign(new Error('Cannot refresh a deleted token'), { status: 400 });
    }

    const previousStatus = row.status;
    const networkResponse = await this._networkRefresh(row.card_network as CardNetwork, row.token_ref);

    await db('network_tokens')
      .where({ id: tokenId })
      .update({
        token_value: encrypt(networkResponse.tokenValue),
        expires_at: networkResponse.expiresAt,
        last_refresh_at: new Date(),
        refresh_count: row.refresh_count + 1,
        status: 'ACTIVE',
        updated_at: new Date(),
      });

    await this._recordEvent(tokenId, 'REFRESHED', previousStatus, 'ACTIVE', null, null, null);

    const updated = await db('network_tokens').where({ id: tokenId }).first();
    return this._toToken(updated);
  }

  async suspendToken(merchantId: string, tokenId: string, reason?: string): Promise<NetworkToken> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (row.status !== 'ACTIVE') {
      throw Object.assign(new Error(`Cannot suspend token in status: ${row.status}`), { status: 400 });
    }

    await db('network_tokens').where({ id: tokenId }).update({
      status: 'SUSPENDED',
      updated_at: new Date(),
    });

    await this._recordEvent(tokenId, 'SUSPENDED', 'ACTIVE', 'SUSPENDED', reason ?? null, null, null);

    const updated = await db('network_tokens').where({ id: tokenId }).first();
    return this._toToken(updated);
  }

  async resumeToken(merchantId: string, tokenId: string): Promise<NetworkToken> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (row.status !== 'SUSPENDED') {
      throw Object.assign(new Error(`Cannot resume token in status: ${row.status}`), { status: 400 });
    }

    await db('network_tokens').where({ id: tokenId }).update({
      status: 'ACTIVE',
      updated_at: new Date(),
    });

    await this._recordEvent(tokenId, 'RESUMED', 'SUSPENDED', 'ACTIVE', null, null, null);

    const updated = await db('network_tokens').where({ id: tokenId }).first();
    return this._toToken(updated);
  }

  async generateCryptogram(
    merchantId: string,
    tokenId: string,
    txData: { amount: number; currency: string; merchantName?: string }
  ): Promise<CryptogramResult> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (row.status !== 'ACTIVE') {
      throw Object.assign(new Error(`Token is not active (status: ${row.status})`), { status: 400 });
    }

    const networkResponse = await this._networkCryptogram(row.card_network as CardNetwork, row.token_ref, txData);

    await this._recordEvent(
      tokenId,
      'CRYPTOGRAM_GENERATED',
      row.status,
      row.status,
      `amount=${txData.amount} currency=${txData.currency}`,
      null,
      null
    );

    return {
      cryptogram: networkResponse.cryptogram,
      eci: networkResponse.eci,
      tokenValue: decrypt(row.token_value),
    };
  }

  async resolveForPayment(
    merchantId: string,
    cardLastFour: string,
    expiryMonth: string,
    expiryYear: string
  ): Promise<{ token: NetworkToken; cryptogram: CryptogramResult } | null> {
    const row = await db('network_tokens')
      .where({
        merchant_id: merchantId,
        card_last_four: cardLastFour,
        card_expiry_month: expiryMonth,
        card_expiry_year: expiryYear,
        status: 'ACTIVE',
      })
      .orderBy('created_at', 'desc')
      .first();

    if (!row) return null;

    const cryptogram = await this.generateCryptogram(merchantId, row.id, {
      amount: 0,
      currency: 'USD',
    });

    return { token: this._toToken(row), cryptogram };
  }

  async getPanFallback(
    merchantId: string,
    tokenId: string
  ): Promise<{
    pan: string;
    expiryMonth: string;
    expiryYear: string;
  }> {
    const row = await db('network_tokens').where({ id: tokenId, merchant_id: merchantId }).first();
    if (!row) throw Object.assign(new Error('Network token not found'), { status: 404 });
    if (!row.pan_encrypted) {
      throw Object.assign(new Error('PAN not available for this token'), { status: 400 });
    }

    return {
      pan: decrypt(row.pan_encrypted),
      expiryMonth: row.card_expiry_month,
      expiryYear: row.card_expiry_year,
    };
  }

  async refreshExpiringTokens(): Promise<{ refreshed: number; failed: number }> {
    const windowDays = config.networkToken.refreshWindowDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + windowDays);

    const expiring = await db('network_tokens')
      .where({ status: 'ACTIVE' })
      .where('expires_at', '<=', cutoff)
      .where('expires_at', '>', new Date())
      .limit(100);

    let refreshed = 0;
    let failed = 0;

    for (const row of expiring) {
      try {
        await this.refreshToken(row.merchant_id, row.id);
        refreshed++;
      } catch {
        failed++;
      }
    }

    return { refreshed, failed };
  }

  async getLifecycleEvents(tokenId: string): Promise<
    Array<{
      id: string;
      eventType: string;
      previousStatus: string | null;
      newStatus: string | null;
      reason: string | null;
      requestId: string | null;
      createdAt: Date;
    }>
  > {
    const rows = await db('token_lifecycle_events').where({ network_token_id: tokenId }).orderBy('created_at', 'desc');
    return rows.map((r: any) => ({
      id: r.id,
      eventType: r.event_type,
      previousStatus: r.previous_status,
      newStatus: r.new_status,
      reason: r.reason,
      requestId: r.request_id,
      createdAt: r.created_at,
    }));
  }

  // ── Network API stubs ──

  private async _networkEnroll(
    network: CardNetwork,
    _cardNumber: string,
    _expiryMonth: string,
    _expiryYear: string
  ): Promise<NetworkEnrollResponse> {
    if (config.networkToken.stubMode) {
      return {
        tokenValue: `NT-${network}-${crypto.randomBytes(16).toString('hex')}`,
        tokenRef: `REF-${crypto.randomBytes(12).toString('hex')}`,
        tokenType: 'CLOUD',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        cryptogramProvider: 'SOFTWARE',
      };
    }

    switch (network) {
      case 'VISA':
        return this._visaEnroll(_cardNumber, _expiryMonth, _expiryYear);
      case 'MASTERCARD':
        return this._mcEnroll(_cardNumber, _expiryMonth, _expiryYear);
      case 'AMEX':
        return this._amexEnroll(_cardNumber, _expiryMonth, _expiryYear);
    }
  }

  private async _networkRefresh(network: CardNetwork, tokenRef: string | null): Promise<NetworkRefreshResponse> {
    if (config.networkToken.stubMode) {
      return {
        tokenValue: `NT-${network}-${crypto.randomBytes(16).toString('hex')}`,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      };
    }

    switch (network) {
      case 'VISA':
        return this._visaRefresh(tokenRef!);
      case 'MASTERCARD':
        return this._mcRefresh(tokenRef!);
      case 'AMEX':
        return this._amexRefresh(tokenRef!);
    }
  }

  private async _networkDelete(
    network: CardNetwork,
    tokenRef: string | null
  ): Promise<{ requestId: string; rawResponse: string } | null> {
    if (config.networkToken.stubMode) {
      return { requestId: `DEL-${crypto.randomBytes(8).toString('hex')}`, rawResponse: '{"status":"DELETED"}' };
    }

    switch (network) {
      case 'VISA':
        return this._visaDelete(tokenRef!);
      case 'MASTERCARD':
        return this._mcDelete(tokenRef!);
      case 'AMEX':
        return this._amexDelete(tokenRef!);
    }
  }

  private async _networkCryptogram(
    network: CardNetwork,
    tokenRef: string | null,
    txData: { amount: number; currency: string; merchantName?: string }
  ): Promise<NetworkCryptogramResponse> {
    if (config.networkToken.stubMode) {
      const eciMap: Record<CardNetwork, string> = { VISA: '05', MASTERCARD: '02', AMEX: '00' };
      return {
        cryptogram: crypto.randomBytes(20).toString('base64'),
        eci: eciMap[network],
      };
    }

    switch (network) {
      case 'VISA':
        return this._visaCryptogram(tokenRef!, txData);
      case 'MASTERCARD':
        return this._mcCryptogram(tokenRef!, txData);
      case 'AMEX':
        return this._amexCryptogram(tokenRef!, txData);
    }
  }

  // ── Visa VTS stubs ──

  private async _visaEnroll(
    _cardNumber: string,
    _expiryMonth: string,
    _expiryYear: string
  ): Promise<NetworkEnrollResponse> {
    // Real: POST to Visa Token Service API with card data
    // Requires: clientCertificate, sharedSecret, keyId
    return {
      tokenValue: `VISA-NT-${crypto.randomBytes(16).toString('hex')}`,
      tokenRef: `VISA-REF-${crypto.randomBytes(12).toString('hex')}`,
      tokenType: 'CLOUD',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      cryptogramProvider: 'HSM',
    };
  }

  private async _visaRefresh(_tokenRef: string): Promise<NetworkRefreshResponse> {
    return {
      tokenValue: `VISA-NT-${crypto.randomBytes(16).toString('hex')}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  private async _visaDelete(_tokenRef: string): Promise<{ requestId: string; rawResponse: string }> {
    return { requestId: `VISA-DEL-${crypto.randomBytes(8).toString('hex')}`, rawResponse: '{"status":"DELETED"}' };
  }

  private async _visaCryptogram(
    _tokenRef: string,
    _txData: { amount: number; currency: string }
  ): Promise<NetworkCryptogramResponse> {
    return { cryptogram: crypto.randomBytes(20).toString('base64'), eci: '05' };
  }

  // ── Mastercard MDES stubs ──

  private async _mcEnroll(
    _cardNumber: string,
    _expiryMonth: string,
    _expiryYear: string
  ): Promise<NetworkEnrollResponse> {
    return {
      tokenValue: `MC-NT-${crypto.randomBytes(16).toString('hex')}`,
      tokenRef: `MC-REF-${crypto.randomBytes(12).toString('hex')}`,
      tokenType: 'CLOUD',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      cryptogramProvider: 'HSM',
    };
  }

  private async _mcRefresh(_tokenRef: string): Promise<NetworkRefreshResponse> {
    return {
      tokenValue: `MC-NT-${crypto.randomBytes(16).toString('hex')}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  private async _mcDelete(_tokenRef: string): Promise<{ requestId: string; rawResponse: string }> {
    return { requestId: `MC-DEL-${crypto.randomBytes(8).toString('hex')}`, rawResponse: '{"status":"DELETED"}' };
  }

  private async _mcCryptogram(
    _tokenRef: string,
    _txData: { amount: number; currency: string }
  ): Promise<NetworkCryptogramResponse> {
    return { cryptogram: crypto.randomBytes(20).toString('base64'), eci: '02' };
  }

  // ── Amex Express Token stubs ──

  private async _amexEnroll(
    _cardNumber: string,
    _expiryMonth: string,
    _expiryYear: string
  ): Promise<NetworkEnrollResponse> {
    return {
      tokenValue: `AMEX-NT-${crypto.randomBytes(16).toString('hex')}`,
      tokenRef: `AMEX-REF-${crypto.randomBytes(12).toString('hex')}`,
      tokenType: 'ISSUER',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      cryptogramProvider: 'NETWORK',
    };
  }

  private async _amexRefresh(_tokenRef: string): Promise<NetworkRefreshResponse> {
    return {
      tokenValue: `AMEX-NT-${crypto.randomBytes(16).toString('hex')}`,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    };
  }

  private async _amexDelete(_tokenRef: string): Promise<{ requestId: string; rawResponse: string }> {
    return { requestId: `AMEX-DEL-${crypto.randomBytes(8).toString('hex')}`, rawResponse: '{"status":"DELETED"}' };
  }

  private async _amexCryptogram(
    _tokenRef: string,
    _txData: { amount: number; currency: string }
  ): Promise<NetworkCryptogramResponse> {
    return { cryptogram: crypto.randomBytes(20).toString('base64'), eci: '00' };
  }

  // ── Internal helpers ──

  private async _recordEvent(
    tokenId: string,
    eventType: LifecycleEventType,
    previousStatus: string | null,
    newStatus: string | null,
    reason: string | null,
    requestId: string | null,
    rawResponse: string | null
  ): Promise<void> {
    await db('token_lifecycle_events').insert({
      network_token_id: tokenId,
      event_type: eventType,
      previous_status: previousStatus,
      new_status: newStatus,
      reason,
      request_id: requestId,
      raw_response: rawResponse,
    });
  }

  private _toToken(row: any): NetworkToken {
    return {
      id: row.id,
      merchantId: row.merchant_id,
      cardNetwork: row.card_network,
      tokenType: row.token_type,
      cardLastFour: row.card_last_four,
      cardExpiryMonth: row.card_expiry_month,
      cardExpiryYear: row.card_expiry_year,
      status: row.status,
      cryptogramProvider: row.cryptogram_provider,
      tokenRef: row.token_ref,
      expiresAt: row.expires_at,
      lastRefreshAt: row.last_refresh_at,
      refreshCount: row.refresh_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const networkTokenService = new NetworkTokenService();
