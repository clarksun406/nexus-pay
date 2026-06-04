import { Router, Request, Response } from 'express';
import { retryService } from '../services/retry.service';
import { declineCodeService } from '../services/decline-code.service';
import { binRoutingService } from '../services/bin-routing.service';
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

// ── Card BIN routing ──

// Lookup a card BIN (returns preferred provider and performance stats)
router.get('/bin/:bin', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const info = await binRoutingService.lookup(req.params.bin);
    if (!info) return res.status(404).json({ error: 'BIN not found' });
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List registered BINs
router.get('/bin', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const network = req.query.network as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;
    const list = await binRoutingService.list({ network, limit, offset });
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Register or update a BIN entry
router.post('/bin', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const info = await binRoutingService.register(req.body);
    res.json(info);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3DS upgrade retry ──

// Trigger a 3DS-upgrade retry on a failed payment intent
router.post('/payment-intents/:intentId/3ds-upgrade-retry', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await retryService.attemptThreeDsUpgrade(
      req.params.intentId,
      req.body.originalRequestId,
      req.body.declineCode,
      req.body.declineMessage,
      req.body.provider,
      req.body.connectorAccountId,
      req.body.cardBin
    );
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
