import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/auth';
import { paymentIntentService } from '../services/payment-intent.service';
import { refundService } from '../services/refund.service';
import { connectorService } from '../services/connector.service';
import { routingRuleService } from '../services/routing-rule.service';
import { apiKeyService } from '../services/apikey.service';
import { webhookService } from '../services/webhook.service';
import { paymentLinkService } from '../services/payment-link.service';
import { memberService } from '../services/member.service';
import { logService } from '../services/log.service';

const router = Router({ mergeParams: true });

// ── Payment Intents (Dashboard) ──
router.get('/:merchantId/payment-intents', authenticateJwt, async (req: Request, res: Response) => {
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

// ── Refunds (Dashboard) ──
router.get('/:merchantId/refunds', authenticateJwt, async (req: Request, res: Response) => {
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
router.get('/:merchantId/connectors', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await connectorService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/connectors', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await connectorService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:merchantId/connectors/:accountId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await connectorService.get(req.params.merchantId, req.params.accountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/connectors/:accountId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await connectorService.update(req.params.merchantId, req.params.accountId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/connectors/:accountId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await connectorService.delete(req.params.merchantId, req.params.accountId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/connectors/reorder', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await connectorService.reorder(req.params.merchantId, req.body.items);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Routing Rules ──
router.get('/:merchantId/routing-rules', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/routing-rules', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/routing-rules/:ruleId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await routingRuleService.update(req.params.merchantId, req.params.ruleId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/routing-rules/:ruleId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await routingRuleService.delete(req.params.merchantId, req.params.ruleId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── API Keys ──
router.get('/:merchantId/api-keys', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await apiKeyService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/api-keys', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { name, mode } = req.body;
    const result = await apiKeyService.create(req.params.merchantId, name, mode || 'TEST');
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/api-keys/:keyId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await apiKeyService.revoke(req.params.merchantId, req.params.keyId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Webhook Endpoints ──
router.get('/:merchantId/webhook-endpoints', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await webhookService.listEndpoints(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/webhook-endpoints', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await webhookService.createEndpoint(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/webhook-endpoints/:endpointId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await webhookService.updateEndpoint(req.params.merchantId, req.params.endpointId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/webhook-endpoints/:endpointId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await webhookService.deleteEndpoint(req.params.merchantId, req.params.endpointId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Webhook Deliveries ──
router.get('/:merchantId/webhook-deliveries', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const endpointId = req.query.endpointId as string;
    const result = await webhookService.listDeliveries(req.params.merchantId, endpointId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Payment Links ──
router.get('/:merchantId/payment-links', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const mode = req.query.mode as string;
    const result = await paymentLinkService.list(req.params.merchantId, mode);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:merchantId/payment-links', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await paymentLinkService.create(req.params.merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/payment-links/:linkId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await paymentLinkService.update(req.params.merchantId, req.params.linkId, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/payment-links/:linkId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await paymentLinkService.deactivate(req.params.merchantId, req.params.linkId);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Members ──
router.get('/:merchantId/members', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await memberService.list(req.params.merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/:merchantId/members/:memberId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await memberService.updateRole(req.params.merchantId, req.params.memberId, req.body.role);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:merchantId/members/:memberId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    await memberService.remove(req.params.merchantId, req.params.memberId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Logs ──
router.get('/:merchantId/logs', authenticateJwt, async (req: Request, res: Response) => {
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

export default router;
