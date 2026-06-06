import { Router, Request, Response } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import db from '../db/connection';
import { paymentLinkService } from '../services/payment-link.service';
import { paymentIntentService } from '../services/payment-intent.service';
import { routingEngine } from '../services/routing-engine';
import { authenticateJwt } from '../middleware/auth';

const router = Router();

// GET /pub/pay/:token — Get payment link info (public)
router.get('/pay/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const link = await paymentLinkService.getByToken(token);
    res.json({
      token: link.token,
      title: link.title,
      description: link.description,
      amount: link.amount,
      currency: link.currency,
      mode: link.mode,
    });
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// POST /pub/pay/:token/checkout — Create payment from link (public)
const checkoutSchema = z.object({
  paymentMethodId: z.string().min(1),
  paymentMethodType: z.string().optional(),
});

router.post('/pay/:token/checkout', async (req: Request, res: Response) => {
  try {
    const token = req.params.token as string;
    const link = await paymentLinkService.getByToken(token);
    const body = checkoutSchema.parse(req.body);

    // Create payment intent from the link
    const intent = await paymentIntentService.create(link.merchantId, link.mode, {
      amount: link.amount,
      currency: link.currency,
      idempotencyKey: `pl-${link.id}-${crypto.randomUUID()}`,
      successUrl: link.redirectUrl,
    });

    // Confirm it
    const result = await paymentIntentService.confirm(link.merchantId, intent.id, body, link.mode);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /pub/tokenize — Create a payment token (public, for embedded checkout)
const tokenizeSchema = z.object({
  publishableKey: z.string().min(1),
  provider: z.string().min(1),
  paymentMethodId: z.string().min(1),
});

router.post('/tokenize', async (req: Request, res: Response) => {
  try {
    const body = tokenizeSchema.parse(req.body);

    // Verify publishable key
    const keyHash = crypto.createHash('sha256').update(body.publishableKey).digest('hex');
    const apiKey = await db('api_keys').where({ key_hash: keyHash, type: 'PUBLISHABLE', status: 'ACTIVE' }).first();
    if (!apiKey) {
      return res.status(401).json({ title: 'Unauthorized', detail: 'Invalid publishable key' });
    }

    // Find connector account for this provider
    const account = await routingEngine.resolveAccountForProvider(
      apiKey.merchant_id,
      body.provider.toUpperCase(),
      apiKey.mode
    );
    if (!account) {
      return res.status(400).json({ title: 'Error', detail: 'No active connector for this provider' });
    }

    // Create token
    const tokenId = crypto.randomUUID();
    await db('payment_tokens').insert({
      id: tokenId,
      merchant_id: apiKey.merchant_id,
      provider: body.provider.toUpperCase(),
      account_id: account.id,
      provider_pm_id: body.paymentMethodId,
      expires_at: new Date(Date.now() + 3600000), // 1 hour
    });

    res.json({ gatewayToken: `gw_tok_${tokenId}` });
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// GET /pub/providers — Get available providers for a publishable key (public)
router.get('/providers', async (req: Request, res: Response) => {
  try {
    const pk = req.query.key as string;
    if (!pk) return res.status(400).json({ title: 'Error', detail: 'Missing key parameter' });

    const keyHash = crypto.createHash('sha256').update(pk).digest('hex');
    const apiKey = await db('api_keys').where({ key_hash: keyHash, type: 'PUBLISHABLE', status: 'ACTIVE' }).first();
    if (!apiKey) return res.status(401).json({ title: 'Unauthorized', detail: 'Invalid publishable key' });

    const providers = await routingEngine.availableProviders(apiKey.merchant_id, apiKey.mode);

    // Get provider configs (publishable keys)
    const providerConfigs: Record<string, any> = {};
    for (const provider of providers) {
      const account = await routingEngine.resolveAccountForProvider(apiKey.merchant_id, provider, apiKey.mode);
      if (account?.provider_config) {
        providerConfigs[provider] = JSON.parse(account.provider_config);
      }
    }

    res.json({ providers, configs: providerConfigs });
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// POST /pub/checkout-session — Create a checkout session (public)
router.post('/checkout-session', async (req: Request, res: Response) => {
  try {
    const { publishableKey, amount, currency, paymentMethodType } = req.body;
    if (!publishableKey) return res.status(400).json({ title: 'Error', detail: 'Missing publishable key' });

    const keyHash = crypto.createHash('sha256').update(publishableKey).digest('hex');
    const apiKey = await db('api_keys').where({ key_hash: keyHash, type: 'PUBLISHABLE', status: 'ACTIVE' }).first();
    if (!apiKey) return res.status(401).json({ title: 'Unauthorized', detail: 'Invalid publishable key' });

    const providers = await routingEngine.availableProviders(apiKey.merchant_id, apiKey.mode);

    const providerConfigs: Record<string, any> = {};
    for (const provider of providers) {
      const account = await routingEngine.resolveAccountForProvider(apiKey.merchant_id, provider, apiKey.mode);
      if (account?.provider_config) {
        providerConfigs[provider] = JSON.parse(account.provider_config);
      }
    }

    res.json({ providers, configs: providerConfigs });
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
