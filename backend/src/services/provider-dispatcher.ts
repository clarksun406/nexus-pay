import db from '../db/connection';
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
  providerPaymentId?: string;
  providerResponseJson?: string;
  failureCode?: string;
  failureMessage?: string;
}

export interface RefundRequest {
  providerPaymentId: string;
  amount?: number;
}

export interface RefundResult {
  success: boolean;
  providerRefundId?: string;
  providerResponseJson?: string;
  failureCode?: string;
  failureMessage?: string;
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
        return this.squareCharge(req, credentials);
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
        default:
          return true;
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
        default:
          return true;
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
      params.append('idempotency_key', req.idempotencyKey);
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

      if (response.ok) {
        return {
          success: true,
          providerPaymentId: data.id,
          providerResponseJson: JSON.stringify(data),
        };
      }

      return {
        success: false,
        failureCode: data.code || 'STRIPE_ERROR',
        failureMessage: data.message || 'Stripe charge failed',
        providerResponseJson: JSON.stringify(data),
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

  private async squareCharge(req: ChargeRequest, creds: any): Promise<ChargeResult> {
    // Square implementation stub
    return { success: false, failureCode: 'NOT_IMPLEMENTED', failureMessage: 'Square integration not yet configured' };
  }

  private async braintreeCharge(req: ChargeRequest, creds: any): Promise<ChargeResult> {
    // Braintree implementation stub
    return { success: false, failureCode: 'NOT_IMPLEMENTED', failureMessage: 'Braintree integration not yet configured' };
  }
}

export const providerDispatcher = new ProviderDispatcher();
