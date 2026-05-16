import { Router, Request, Response } from 'express';
import { healthMonitorService } from '../services/health-monitor.service';
import { authenticateJwt, requireRole } from '../middleware/auth';

const router = Router();

// Get health dashboard
router.get('/merchants/:merchantId/health', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const dashboard = await healthMonitorService.getDashboard(req.params.merchantId);
    res.json(dashboard);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get health metrics for a connector
router.get('/connectors/:connectorAccountId/health', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const hours = parseInt(req.query.hours as string) || 24;
    const metrics = await healthMonitorService.getHealthMetrics(req.params.connectorAccountId, hours);
    res.json(metrics);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Restore a demoted connector
router.post('/connectors/:connectorAccountId/restore', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    await healthMonitorService.restoreConnector(req.params.connectorAccountId);
    res.json({ success: true, message: 'Connector restored' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Set health thresholds
router.put('/merchants/:merchantId/health-thresholds', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    healthMonitorService.setThresholds(req.params.merchantId, req.body);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
