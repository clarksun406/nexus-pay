import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticateJwt, requireSecretKey } from '../middleware/auth';
import { paymentIntentService } from '../services/payment-intent.service';
import { refundService } from '../services/refund.service';

const router = Router();

const createSchema = z.object({
  amount: z.number().int().positive(),
  currency: z.string().min(3).max(10),
  idempotencyKey: z.string().min(1),
  captureMethod: z.enum(['AUTOMATIC', 'MANUAL']).optional(),
  metadata: z.record(z.string()).optional(),
  orderId: z.string().optional(),
  description: z.string().optional(),
  billingDetails: z.any().optional(),
  shippingDetails: z.any().optional(),
  successUrl: z.string().optional(),
  cancelUrl: z.string().optional(),
  failureUrl: z.string().optional(),
});

const confirmSchema = z.object({
  paymentMethodId: z.string().min(1),
  paymentMethodType: z.string().optional(),
  billingDetails: z.any().optional(),
  shippingDetails: z.any().optional(),
});

const createRefundSchema = z.object({
  amount: z.number().int().positive().optional(),
  reason: z.string().optional(),
});

// POST /api/v1/payment-intents
router.post('/', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey || req.apiKey.type !== 'SECRET') {
      return res.status(403).json({ title: 'Forbidden', detail: 'Secret key required' });
    }
    const body = createSchema.parse(req.body);
    const result = await paymentIntentService.create(req.apiKey.merchantId, req.apiKey.mode, body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.status || (err.name === 'ZodError' ? 400 : 500);
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// GET /api/v1/payment-intents/:id
router.get('/:id', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey) {
      return res.status(403).json({ title: 'Forbidden', detail: 'API key required' });
    }
    const result = await paymentIntentService.get(req.apiKey.merchantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/payment-intents/:id/confirm
router.post('/:id/confirm', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey || req.apiKey.type !== 'SECRET') {
      return res.status(403).json({ title: 'Forbidden', detail: 'Secret key required' });
    }
    const body = confirmSchema.parse(req.body);
    const result = await paymentIntentService.confirm(req.apiKey.merchantId, req.params.id, body, req.apiKey.mode);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/payment-intents/:id/cancel
router.post('/:id/cancel', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey || req.apiKey.type !== 'SECRET') {
      return res.status(403).json({ title: 'Forbidden', detail: 'Secret key required' });
    }
    const result = await paymentIntentService.cancel(req.apiKey.merchantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/payment-intents/:id/capture
router.post('/:id/capture', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey || req.apiKey.type !== 'SECRET') {
      return res.status(403).json({ title: 'Forbidden', detail: 'Secret key required' });
    }
    const result = await paymentIntentService.capture(req.apiKey.merchantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/payment-intents/:id/refunds
router.post('/:id/refunds', authenticateJwt, async (req: Request, res: Response) => {
  try {
    if (!req.apiKey) return res.status(403).json({ title: 'Forbidden' });
    const body = createRefundSchema.parse(req.body);
    const result = await refundService.create(req.apiKey.merchantId, req.params.id, body);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

export default router;
