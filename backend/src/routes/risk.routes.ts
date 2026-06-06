import { Router, Request, Response } from 'express';
import { authenticateJwt, requireRole } from '../middleware/auth';
import { riskEngine } from '../services/risk-engine.service';

const router = Router();

const READ_ALL = ['OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER'];
const MANAGE = ['OWNER', 'ADMIN'];
const FINANCE_WRITE = ['OWNER', 'ADMIN', 'FINANCE'];
const RISK_MANAGE = ['OWNER', 'ADMIN', 'FINANCE'];

// ── Fraud Rules CRUD ──

router.get('/fraud-rules', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await riskEngine.listRules(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/fraud-rules', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await riskEngine.createRule(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/fraud-rules/:ruleId', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await riskEngine.getRule(merchantId, req.params.ruleId as string);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/fraud-rules/:ruleId', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await riskEngine.updateRule(merchantId, req.params.ruleId as string, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/fraud-rules/:ruleId', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await riskEngine.deleteRule(merchantId, req.params.ruleId as string);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Blocklists ──

router.get('/blocklists', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const type = req.query.type as string | undefined;
    const result = await riskEngine.listBlocklist(merchantId, type);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/blocklists', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await riskEngine.createBlocklistEntry(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/blocklists/:entryId', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await riskEngine.deleteBlocklistEntry(merchantId, req.params.entryId as string);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Fraud Alerts ──

router.get('/alerts', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const filters: any = {};
    if (req.query.severity) filters.severity = req.query.severity as string;
    if (req.query.resolved !== undefined) filters.resolved = req.query.resolved === 'true';
    const result = await riskEngine.listAlerts(merchantId, filters);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/alerts/:alertId/resolve', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await riskEngine.resolveAlert(merchantId, req.params.alertId as string);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Payment Reviews ──

router.get('/reviews', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const status = req.query.status as string | undefined;
    const result = await riskEngine.listReviews(merchantId, status);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/reviews/:reviewId/approve', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ title: 'Error', detail: 'Not authenticated' }); return; }
    await riskEngine.approveReview(merchantId, req.params.reviewId as string, userId, req.body.notes);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/reviews/:reviewId/reject', authenticateJwt, requireRole(...RISK_MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const userId = (req as any).user?.id;
    if (!userId) { res.status(401).json({ title: 'Error', detail: 'Not authenticated' }); return; }
    await riskEngine.rejectReview(merchantId, req.params.reviewId as string, userId, req.body.notes);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
