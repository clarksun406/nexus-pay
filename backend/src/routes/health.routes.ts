import { Router, Request, Response } from 'express';
import { healthMonitorService } from '../services/health-monitor.service';
import { authenticateJwt, requireRole } from '../middleware/auth';

const router = Router();

// Get health dashboard
router.get('/merchants/:merchantId/health', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const dashboard = await healthMonitorService.getDashboard(merchantId);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get health metrics for a connector
router.get('/connectors/:connectorAccountId/health', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const connectorAccountId = req.params.connectorAccountId as string;
    const hours = parseInt(req.query.hours as string) || 24;
    const metrics = await healthMonitorService.getHealthMetrics(connectorAccountId, hours);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get latency trend
router.get('/connectors/:connectorAccountId/health/trend', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const connectorAccountId = req.params.connectorAccountId as string;
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    const granularity = (req.query.granularity as 'hour' | 'day') || 'hour';
    const trend = await healthMonitorService.getLatencyTrend(connectorAccountId, from, to, granularity);
    res.json(trend);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a demoted connector
router.post(
  '/connectors/:connectorAccountId/restore',
  authenticateJwt,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const connectorAccountId = req.params.connectorAccountId as string;
      await healthMonitorService.restoreConnector(connectorAccountId);
      res.json({ success: true, message: 'Connector restored' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Set health thresholds
router.put(
  '/merchants/:merchantId/health-thresholds',
  authenticateJwt,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      healthMonitorService.setThresholds(merchantId, req.body);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
