import db from '../db/connection';
import crypto from 'crypto';
import { decrypt } from '../utils/crypto';

export interface ChargeRequest {
  intentId: string;
  amount: number;
  currency: string;
  paymentMethodType: string;
  paymentMethodId: string;
  idempotencyKey: string;
  captureMethod: string;
}

export interface ChargeResult {
  success: boolean;
  /** Customer authentication (e.g. 3DS) is required before the payment can complete. */
  requiresAction?: boolean;
  actionUrl?: string;
  /** Provider accepted the charge but the outcome is still being determined. */
  pending?: boolean;
  providerStatus?: string;
  providerPaymentId?: string;
  providerResponseJson?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface RefundRequest {
  providerPaymentId: string;
  amount?: number;
  currency?: string;
}

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
  providerResponseJson?: string;
  failureCode?: string;
  failureMessage?: string;
}

const SQUARE_API_VERSION = '2024-06-04';

function squareBaseUrl(mode: string): string {
  return mode === 'LIVE' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
}

class ProviderDispatcher {
  async charge(provider: string, req: ChargeRequest, accountId: string): Promise<ChargeResult> {
    const account = await db('provider_accounts').where({ id: accountId }).first();
    if (!account) return { success: false, failureCode: 'ACCOUNT_NOT_FOUND', failureMessage: 'Connector account not found' };

    const credentials = this.loadCredentials(account);

    switch (provider.toUpperCase()) {
      case 'STRIPE':
        return this.stripeCharge(req, credentials);
      case 'SQUARE':
        return this.squareCharge(req, credentials, account.mode);
      case 'BRAINTREE':
        return this.braintreeCharge(req, credentials);
      default:
        return { success: false, failureCode: 'UNSUPPORTED_PROVIDER', failureMessage: `Provider ${provider} not supported` };
    }
  }

  async capture(provider: string, providerPaymentId: string, accountId: string): Promise<boolean> {
    const account = await db('provider_accounts').where({ id: accountId }).first();
    if (!account) return false;
    const credentials = this.loadCredentials(account);

    try {
      switch (provider.toUpperCase()) {
        case 'STRIPE':
          return this.stripeCapture(providerPaymentId, credentials);
        case 'SQUARE':
          return this.squareComplete(providerPaymentId, credentials, account.mode);
        default:
          // Honest failure for providers without a capture implementation.
          return false;
      }
    } catch {
      return false;
    }
  }

  async cancel(provider: string, providerPaymentId: string, accountId: string): Promise<boolean> {
    const account = await db('provider_accounts').where({ id: accountId }).first();
    if (!account) return false;
    const credentials = this.loadCredentials(account);

    try {
      switch (provider.toUpperCase()) {
        case 'STRIPE':
          return this.stripeCancel(providerPaymentId, credentials);
        case 'SQUARE':
          return this.squareCancel(providerPaymentId, credentials, account.mode);
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  async refund(provider: string, req: RefundRequest, accountId: string): Promise<RefundResult> {
    const account = await db('provider_accounts').where({ id: accountId }).first();
    if (!account) return { success: false, failureCode: 'ACCOUNT_NOT_FOUND', failureMessage: 'Connector account not found' };
    if (!req.providerPaymentId) {
      return { success: false, failureCode: 'NO_PROVIDER_PAYMENT', failureMessage: 'Payment has no provider payment id to refund' };
    }

    const credentials = this.loadCredentials(account);

    switch ((provider || '').toUpperCase()) {
      case 'STRIPE':
        return this.stripeRefund(req, credentials);
      case 'SQUARE':
        return this.squareRefund(req, credentials, account.mode);
      case 'BRAINTREE':
        return { success: false, failureCode: 'NOT_IMPLEMENTED', failureMessage: `Refunds for ${provider} are not yet implemented` };
      default:
        return { success: false, failureCode: 'UNSUPPORTED_PROVIDER', failureMessage: `Provider ${provider} not supported` };
    }
  }

  private loadCredentials(account: any): any {
    if (account.encrypted_credentials) {
      try {
        return JSON.parse(decrypt(account.encrypted_credentials));
      } catch {
        return {};
      }
    }
    // Legacy format
    if (account.encrypted_secret_key) {
      return { secretKey: decrypt(account.encrypted_secret_key) };
    }
    return {};
  }

  // ── Stripe ──

  private async stripeCharge(req: ChargeRequest, creds: any): Promise<ChargeResult> {
    if (!creds.secretKey) {
      return { success: false, failureCode: 'NO_CREDENTIALS', failureMessage: 'Stripe secret key not configured' };
    }

    try {
      const params = new URLSearchParams();
      params.append('amount', req.amount.toString());
      params.append('currency', req.currency.toLowerCase());
      params.append('payment_method', req.paymentMethodId);
      params.append('confirm', 'true');
      if (req.captureMethod === 'MANUAL') {
        params.append('capture_method', 'manual');
      }

      const response = await fetch('https://api.stripe.com/v1/payment_intents', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Idempotency-Key': req.idempotencyKey,
        },
        body: params,
      });

      const data = await response.json();
      const providerResponseJson = JSON.stringify(data);

      if (response.ok) {
        const status: string = data.status;
        // Authorised (manual capture) or fully captured.
        if (status === 'succeeded' || status === 'requires_capture') {
          return { success: true, providerStatus: status, providerPaymentId: data.id, providerResponseJson };
        }
        // 3DS / Strong Customer Authentication needed.
        if (status === 'requires_action') {
          return {
            success: false,
            requiresAction: true,
            actionUrl: data.next_action?.redirect_to_url?.url,
            providerStatus: status,
            providerPaymentId: data.id,
            providerResponseJson,
          };
        }
        // Async processing — final state arrives via webhook.
        if (status === 'processing') {
          return { success: false, pending: true, providerStatus: status, providerPaymentId: data.id, providerResponseJson };
        }
        // requires_payment_method / canceled / etc.
        return {
          success: false,
          providerStatus: status,
          providerPaymentId: data.id,
          providerResponseJson,
          failureCode: data.last_payment_error?.code || `STRIPE_${status}`,
          failureMessage: data.last_payment_error?.message || `PaymentIntent status: ${status}`,
        };
      }

      return {
        success: false,
        failureCode: data.error?.code || data.code || 'STRIPE_ERROR',
        failureMessage: data.error?.message || data.message || 'Stripe charge failed',
        providerResponseJson,
      };
    } catch (err: any) {
      return { success: false, failureCode: 'NETWORK_ERROR', failureMessage: err.message };
    }
  }

  private async stripeCapture(paymentId: string, creds: any): Promise<boolean> {
    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.ok;
  }

  private async stripeCancel(paymentId: string, creds: any): Promise<boolean> {
    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${creds.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.ok;
  }

  private async stripeRefund(req: RefundRequest, creds: any): Promise<RefundResult> {
    if (!creds.secretKey) {
      return { success: false, failureCode: 'NO_CREDENTIALS', failureMessage: 'Stripe secret key not configured' };
    }

    try {
      const params = new URLSearchParams();
      params.append('payment_intent', req.providerPaymentId);
      if (req.amount != null) params.append('amount', req.amount.toString());

      const response = await fetch('https://api.stripe.com/v1/refunds', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${creds.secretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
      });

      const data = await response.json();

      if (response.ok) {
        // Stripe refund status: succeeded | pending | failed | canceled | requires_action
        const ok = data.status === 'succeeded' || data.status === 'pending';
        return {
          success: ok,
          providerRefundId: data.id,
          providerResponseJson: JSON.stringify(data),
          failureCode: ok ? undefined : (data.failure_reason || `REFUND_${data.status}`),
          failureMessage: ok ? undefined : `Refund status: ${data.status}`,
        };
      }

      return {
        success: false,
        failureCode: data.error?.code || 'STRIPE_ERROR',
        failureMessage: data.error?.message || 'Stripe refund failed',
        providerResponseJson: JSON.stringify(data),
      };
    } catch (err: any) {
      return { success: false, failureCode: 'NETWORK_ERROR', failureMessage: err.message };
    }
  }

  // ── Square (REST Payments API) ──

  private squareToken(creds: any): string | undefined {
    return creds.accessToken || creds.secretKey;
  }

  private async squareCharge(req: ChargeRequest, creds: any, mode: string): Promise<ChargeResult> {
    const token = this.squareToken(creds);
    if (!token) {
      return { success: false, failureCode: 'NO_CREDENTIALS', failureMessage: 'Square access token not configured' };
    }

    try {
      const body: any = {
        source_id: req.paymentMethodId,
        idempotency_key: req.idempotencyKey,
        amount_money: { amount: req.amount, currency: req.currency.toUpperCase() },
        autocomplete: req.captureMethod !== 'MANUAL',
      };
      if (creds.locationId) body.location_id = creds.locationId;

      const response = await fetch(`${squareBaseUrl(mode)}/v2/payments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Square-Version': SQUARE_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const providerResponseJson = JSON.stringify(data);

      if (response.ok && data.payment) {
        const status: string = data.payment.status;
        // COMPLETED = captured, APPROVED = authorised (awaiting capture).
        if (status === 'COMPLETED' || status === 'APPROVED') {
          return { success: true, providerStatus: status, providerPaymentId: data.payment.id, providerResponseJson };
        }
        if (status === 'PENDING') {
          return { success: false, pending: true, providerStatus: status, providerPaymentId: data.payment.id, providerResponseJson };
        }
        return {
          success: false,
          providerStatus: status,
          providerPaymentId: data.payment.id,
          providerResponseJson,
          failureCode: `SQUARE_${status}`,
          failureMessage: `Square payment status: ${status}`,
        };
      }

      const error = data.errors?.[0];
      return {
        success: false,
        failureCode: error?.code || 'SQUARE_ERROR',
        failureMessage: error?.detail || 'Square charge failed',
        providerResponseJson,
      };
    } catch (err: any) {
      return { success: false, failureCode: 'NETWORK_ERROR', failureMessage: err.message };
    }
  }

  private async squareComplete(paymentId: string, creds: any, mode: string): Promise<boolean> {
    const token = this.squareToken(creds);
    if (!token) return false;
    const response = await fetch(`${squareBaseUrl(mode)}/v2/payments/${paymentId}/complete`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': SQUARE_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    return response.ok;
  }

  private async squareCancel(paymentId: string, creds: any, mode: string): Promise<boolean> {
    const token = this.squareToken(creds);
    if (!token) return false;
    const response = await fetch(`${squareBaseUrl(mode)}/v2/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Square-Version': SQUARE_API_VERSION,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    return response.ok;
  }

  private async squareRefund(req: RefundRequest, creds: any, mode: string): Promise<RefundResult> {
    const token = this.squareToken(creds);
    if (!token) {
      return { success: false, failureCode: 'NO_CREDENTIALS', failureMessage: 'Square access token not configured' };
    }
    if (!req.currency) {
      return { success: false, failureCode: 'MISSING_CURRENCY', failureMessage: 'Currency is required for a Square refund' };
    }

    try {
      const response = await fetch(`${squareBaseUrl(mode)}/v2/refunds`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Square-Version': SQUARE_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          idempotency_key: crypto.randomUUID(),
          payment_id: req.providerPaymentId,
          amount_money: { amount: req.amount, currency: req.currency.toUpperCase() },
        }),
      });

      const data = await response.json();

      if (response.ok && data.refund) {
        const status: string = data.refund.status;
        const ok = status === 'COMPLETED' || status === 'PENDING';
        return {
          success: ok,
          providerRefundId: data.refund.id,
          providerResponseJson: JSON.stringify(data),
          failureCode: ok ? undefined : `SQUARE_${status}`,
          failureMessage: ok ? undefined : `Square refund status: ${status}`,
        };
      }

      const error = data.errors?.[0];
      return {
        success: false,
        failureCode: error?.code || 'SQUARE_ERROR',
        failureMessage: error?.detail || 'Square refund failed',
        providerResponseJson: JSON.stringify(data),
      };
    } catch (err: any) {
      return { success: false, failureCode: 'NETWORK_ERROR', failureMessage: err.message };
    }
  }

  // ── Braintree (not yet implemented) ──

  private async braintreeCharge(_req: ChargeRequest, _creds: any): Promise<ChargeResult> {
    return { success: false, failureCode: 'NOT_IMPLEMENTED', failureMessage: 'Braintree integration not yet configured' };
  }
}

export const providerDispatcher = new ProviderDispatcher();
