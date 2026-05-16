import { Router, Request, Response } from 'express';
import { retryService } from '../services/retry.service';
import { declineCodeService } from '../services/decline-code.service';
import { authenticateJwt, requireRole } from '../middleware/auth';

const router = Router();

// Get retry configuration
router.get('/merchants/:merchantId/retry-config', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const config = await retryService.getRetryConfig(req.params.merchantId);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update retry configuration
router.put('/merchants/:merchantId/retry-config', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const config = await retryService.updateRetryConfig(req.params.merchantId, req.body);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get retry statistics
router.get('/merchants/:merchantId/retry-stats', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const from = new Date(req.query.from as string);
    const to = new Date(req.query.to as string);
    const stats = await retryService.getRetryStats(req.params.merchantId, from, to);
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get decline code mappings
router.get('/decline-codes', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const provider = req.query.provider as string;
    const mappings = await declineCodeService.getMapping(provider, '');
    res.json(mappings);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
