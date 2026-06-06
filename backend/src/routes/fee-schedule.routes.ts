import { Router, Request, Response } from 'express';
import { authenticateJwt, requireRole } from '../middleware/auth';
import { feeScheduleService } from '../services/fee-schedule.service';

const router = Router();

const READ_ALL = ['OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER'];
const MANAGE = ['OWNER', 'ADMIN'];
const FINANCE_WRITE = ['OWNER', 'ADMIN', 'FINANCE'];

// ── Fee Schedules CRUD ──

router.get('/schedules', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await feeScheduleService.list(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/schedules/:scheduleId', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await feeScheduleService.get(merchantId, req.params.scheduleId as string);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/schedules', authenticateJwt, requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await feeScheduleService.create(merchantId, req.body);
    res.status(201).json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.put('/schedules/:scheduleId', authenticateJwt, requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await feeScheduleService.update(merchantId, req.params.scheduleId as string, req.body);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/schedules/:scheduleId', authenticateJwt, requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await feeScheduleService.delete(merchantId, req.params.scheduleId as string);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Cost Preview ──

router.post('/cost-preview', authenticateJwt, requireRole(...READ_ALL), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const { amount, currency, scheduleId, connectorAccountId } = req.body;
    const result = await feeScheduleService.previewCost(merchantId, amount, currency, scheduleId, connectorAccountId);
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Cost Report ──

router.get('/cost-report', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const from = req.query.from as string;
    const to = req.query.to as string;
    if (!from || !to) {
      res.status(400).json({ title: 'Error', detail: 'from and to query params required (format: YYYY-MM)' });
      return;
    }
    const result = await feeScheduleService.getCostReport(merchantId, from, to);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

// ── Fee Anomalies ──

router.get('/cost-anomalies', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const filters: any = {};
    if (req.query.severity) filters.severity = req.query.severity as string;
    if (req.query.resolved !== undefined) filters.resolved = req.query.resolved === 'true';
    const result = await feeScheduleService.listAnomalies(merchantId, filters);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/cost-anomalies/detect', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const result = await feeScheduleService.detectAnomalies(merchantId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/cost-anomalies/:anomalyId/resolve', authenticateJwt, requireRole(...FINANCE_WRITE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    await feeScheduleService.resolveAnomaly(merchantId, req.params.anomalyId as string);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

// ── Manual monthly aggregation trigger ──

router.post('/cost-aggregate', authenticateJwt, requireRole(...MANAGE), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const period = req.body.period || (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    })();
    await feeScheduleService.aggregateMonthly(merchantId, period);
    res.status(204).send();
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
