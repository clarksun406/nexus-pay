import { Router, Request, Response } from 'express';
import { authenticateJwt, requireRole } from '../middleware/auth';
import { paymentIntentService } from '../services/payment-intent.service';
import { refundService } from '../services/refund.service';
import { connectorService } from '../services/connector.service';
import { routingRuleService } from '../services/routing-rule.service';
import { apiKeyService } from '../services/apikey.service';
import { webhookService } from '../services/webhook.service';
import { paymentLinkService } from '../services/payment-link.service';
import { memberService } from '../services/member.service';
import { logService } from '../services/log.service';
import { disputeService } from '../services/dispute.service';
import { payoutService } from '../services/payout.service';
import networkTokenRoutes from './network-token.routes';
import feeScheduleRoutes from './fee-schedule.routes';
import riskRoutes from './risk.routes';

const router = Router({ mergeParams: true });

// ── Role groups ──
const READ_ALL = ['OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER'];
const MANAGE = ['OWNER', 'ADMIN'];
const DEVELOP = ['OWNER', 'ADMIN', 'DEVELOPER'];
const FINANCE_WRITE = ['OWNER', 'ADMIN', 'FINANCE'];

// Every merchant route requires an authenticated JWT user.
router.use(authenticateJwt);

// ── Payment Intents (Dashboard) ──
router.get('/:merchantId/payment-intents', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const filters: any = {};
    if (req.query.status) filters.status = req.query.status as string;
    if (req.query.orderId) filters.orderId = req.query.orderId as string;
    if (req.query.minAmount) filters.minAmount = parseInt(req.query.minAmount as string, 10);
    if (req.query.maxAmount) filters.maxAmount = parseInt(req.query.maxAmount as string, 10);
    if (req.query.createdFrom) filters.createdFrom = new Date(req.query.createdFrom as string);
    if (req.query.createdTo) filters.createdTo = new Date(req.query.createdTo as string);
    if (req.query.search) filters.search = req.query.search as string;
    const result = await paymentIntentService.list(merchantId, mode, page, size, filters);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/payment-intents/:id', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const id = req.params.id as string;
    const result = await paymentIntentService.get(merchantId, id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// Capture an authorised payment from the dashboard.
router.post(
  '/:merchantId/payment-intents/:id/capture',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const id = req.params.id as string;
      const result = await paymentIntentService.capture(merchantId, id);
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

// Cancel a payment from the dashboard.
router.post(
  '/:merchantId/payment-intents/:id/cancel',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const id = req.params.id as string;
      const result = await paymentIntentService.cancel(merchantId, id);
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

// Issue a refund from the dashboard (FINANCE / ADMIN / OWNER).
router.post(
  '/:merchantId/payment-intents/:id/refunds',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const id = req.params.id as string;
      const result = await refundService.create(merchantId, id, {
        amount: req.body?.amount,
        reason: req.body?.reason,
      });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

// ── Refunds (Dashboard) ──
router.get('/:merchantId/refunds', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await refundService.list(merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Connectors ──
router.get('/:merchantId/connectors', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await connectorService.list(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/connectors', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await connectorService.create(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// NOTE: /connectors/reorder must be declared BEFORE /connectors/:accountId,
// otherwise Express matches "reorder" as an :accountId path param.
router.put('/:merchantId/connectors/reorder', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await connectorService.reorder(merchantId, req.body.items);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/connectors/:accountId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const accountId = req.params.accountId as string;
    const result = await connectorService.get(merchantId, accountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/connectors/:accountId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const accountId = req.params.accountId as string;
    const result = await connectorService.update(merchantId, accountId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/connectors/:accountId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const accountId = req.params.accountId as string;
    await connectorService.delete(merchantId, accountId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Routing Rules ──
router.get('/:merchantId/routing-rules', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await routingRuleService.list(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/routing-rules', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await routingRuleService.create(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/routing-rules/:ruleId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const ruleId = req.params.ruleId as string;
    const result = await routingRuleService.update(merchantId, ruleId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/routing-rules/:ruleId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const ruleId = req.params.ruleId as string;
    await routingRuleService.delete(merchantId, ruleId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── API Keys ──
router.get('/:merchantId/api-keys', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await apiKeyService.list(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/api-keys', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const { name, mode } = req.body;
    const result = await apiKeyService.create(merchantId, name, mode || 'TEST');
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/api-keys/:keyId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const keyId = req.params.keyId as string;
    await apiKeyService.revoke(merchantId, keyId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// Atomically rotate a key — issues a new active one and revokes the old one.
router.post('/:merchantId/api-keys/:keyId/rotate', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const keyId = req.params.keyId as string;
    const result = await apiKeyService.rotate(merchantId, keyId);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Webhook Endpoints ──
router.get('/:merchantId/webhook-endpoints', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await webhookService.listEndpoints(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/webhook-endpoints', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await webhookService.createEndpoint(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put(
  '/:merchantId/webhook-endpoints/:endpointId',
  requireRole(...DEVELOP),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const endpointId = req.params.endpointId as string;
      const result = await webhookService.updateEndpoint(merchantId, endpointId, req.body);
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

router.delete(
  '/:merchantId/webhook-endpoints/:endpointId',
  requireRole(...DEVELOP),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const endpointId = req.params.endpointId as string;
      await webhookService.deleteEndpoint(merchantId, endpointId);
      res.status(204).send();
    } catch (err: any) {
      res.status(500).json({ title: 'Error', detail: err.message });
    }
  }
);

// ── Webhook Deliveries ──
router.get('/:merchantId/webhook-deliveries', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const endpointId = req.query.endpointId as string;
    const result = await webhookService.listDeliveries(merchantId, endpointId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Payment Links ──
router.get('/:merchantId/payment-links', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const mode = req.query.mode as string;
    const result = await paymentLinkService.list(merchantId, mode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/payment-links', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await paymentLinkService.create(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/payment-links/:linkId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const linkId = req.params.linkId as string;
    const result = await paymentLinkService.update(merchantId, linkId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/payment-links/:linkId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const linkId = req.params.linkId as string;
    await paymentLinkService.deactivate(merchantId, linkId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Members ──
router.get('/:merchantId/members', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await memberService.list(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/members/invite', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await memberService.invite(merchantId, req.body?.email, req.body?.role, req.user!.userId);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/members/:memberId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const memberId = req.params.memberId as string;
    const result = await memberService.updateRole(merchantId, memberId, req.body.role);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/members/:memberId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const memberId = req.params.memberId as string;
    await memberService.remove(merchantId, memberId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Logs ──
router.get('/:merchantId/logs', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 50;
    const type = req.query.type as string;
    const result = await logService.list(merchantId, page, size, type);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Disputes ──
router.get('/:merchantId/disputes', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await disputeService.list(merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/disputes/:disputeId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const disputeId = req.params.disputeId as string;
    const result = await disputeService.get(merchantId, disputeId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// Read / save / submit dispute evidence.
router.get(
  '/:merchantId/disputes/:disputeId/evidence',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const disputeId = req.params.disputeId as string;
      const result = await disputeService.getEvidence(merchantId, disputeId);
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

router.put(
  '/:merchantId/disputes/:disputeId/evidence',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const disputeId = req.params.disputeId as string;
      const result = await disputeService.saveEvidenceDraft(merchantId, disputeId, req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

router.post(
  '/:merchantId/disputes/:disputeId/evidence/submit',
  requireRole(...FINANCE_WRITE),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const disputeId = req.params.disputeId as string;
      const result = await disputeService.submitEvidence(merchantId, disputeId, req.body || {});
      res.json(result);
    } catch (err: any) {
      res.status(err.status || 500).json({ title: 'Error', detail: err.message });
    }
  }
);

// ── Payouts ──
router.get('/:merchantId/payouts', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await payoutService.list(merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/payouts/:payoutId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const payoutId = req.params.payoutId as string;
    const result = await payoutService.get(merchantId, payoutId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Network Tokens ──
router.use('/:merchantId/network-tokens', networkTokenRoutes);

// ── Cost Optimization (Fee Schedules, Cost Reports, Anomalies) ──
router.use('/:merchantId/cost', feeScheduleRoutes);

// ── Risk Engine (Fraud Rules, Blocklists, Alerts, Reviews) ──
router.use('/:merchantId/risk', riskRoutes);

export default router;
