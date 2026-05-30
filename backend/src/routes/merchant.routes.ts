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
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await paymentIntentService.list(req.params.merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/payment-intents/:id', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await paymentIntentService.get(req.params.merchantId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// Issue a refund from the dashboard (FINANCE / ADMIN / OWNER).
router.post('/:merchantId/payment-intents/:id/refunds', requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const result = await refundService.create(req.params.merchantId, req.params.id, {
      amount: req.body?.amount,
      reason: req.body?.reason,
    });
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Refunds (Dashboard) ──
router.get('/:merchantId/refunds', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await refundService.list(req.params.merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Connectors ──
router.get('/:merchantId/connectors', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await connectorService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/connectors', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await connectorService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// NOTE: /connectors/reorder must be declared BEFORE /connectors/:accountId,
// otherwise Express matches "reorder" as an :accountId path param.
router.put('/:merchantId/connectors/reorder', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    await connectorService.reorder(req.params.merchantId, req.body.items);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/connectors/:accountId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await connectorService.get(req.params.merchantId, req.params.accountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/connectors/:accountId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await connectorService.update(req.params.merchantId, req.params.accountId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/connectors/:accountId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    await connectorService.delete(req.params.merchantId, req.params.accountId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Routing Rules ──
router.get('/:merchantId/routing-rules', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/routing-rules', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/routing-rules/:ruleId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.update(req.params.merchantId, req.params.ruleId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/routing-rules/:ruleId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    await routingRuleService.delete(req.params.merchantId, req.params.ruleId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── API Keys ──
router.get('/:merchantId/api-keys', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await apiKeyService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/api-keys', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const { name, mode } = req.body;
    const result = await apiKeyService.create(req.params.merchantId, name, mode || 'TEST');
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/api-keys/:keyId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    await apiKeyService.revoke(req.params.merchantId, req.params.keyId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Webhook Endpoints ──
router.get('/:merchantId/webhook-endpoints', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await webhookService.listEndpoints(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/webhook-endpoints', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await webhookService.createEndpoint(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/webhook-endpoints/:endpointId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await webhookService.updateEndpoint(req.params.merchantId, req.params.endpointId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/webhook-endpoints/:endpointId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    await webhookService.deleteEndpoint(req.params.merchantId, req.params.endpointId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Webhook Deliveries ──
router.get('/:merchantId/webhook-deliveries', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const endpointId = req.query.endpointId as string;
    const result = await webhookService.listDeliveries(req.params.merchantId, endpointId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Payment Links ──
router.get('/:merchantId/payment-links', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const result = await paymentLinkService.list(req.params.merchantId, mode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/payment-links', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await paymentLinkService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/payment-links/:linkId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const result = await paymentLinkService.update(req.params.merchantId, req.params.linkId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/payment-links/:linkId', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    await paymentLinkService.deactivate(req.params.merchantId, req.params.linkId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Members ──
router.get('/:merchantId/members', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await memberService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/members/invite', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await memberService.invite(
      req.params.merchantId,
      req.body?.email,
      req.body?.role,
      req.user!.userId,
    );
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/members/:memberId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const result = await memberService.updateRole(req.params.merchantId, req.params.memberId, req.body.role);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/members/:memberId', requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    await memberService.remove(req.params.merchantId, req.params.memberId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Logs ──
router.get('/:merchantId/logs', requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 50;
    const type = req.query.type as string;
    const result = await logService.list(req.params.merchantId, page, size, type);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Disputes ──
router.get('/:merchantId/disputes', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await disputeService.list(req.params.merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/disputes/:disputeId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await disputeService.get(req.params.merchantId, req.params.disputeId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Payouts ──
router.get('/:merchantId/payouts', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const page = parseInt(req.query.page as string) || 0;
    const size = parseInt(req.query.size as string) || 20;
    const result = await payoutService.list(req.params.merchantId, mode, page, size);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/payouts/:payoutId', requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const result = await payoutService.get(req.params.merchantId, req.params.payoutId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
