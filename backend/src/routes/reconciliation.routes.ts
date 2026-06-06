import { Router, Request, Response } from 'express';
import { reconciliationService } from '../services/reconciliation.service';
import { pspSyncService } from '../services/psp-sync.service';
import { authenticateJwt, requireRole } from '../middleware/auth';

const router = Router();

// Create reconciliation source
router.post(
  '/merchants/:merchantId/reconciliation/sources',
  authenticateJwt,
  requireRole('ADMIN'),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const sourceId = await reconciliationService.createSource(
        merchantId,
        req.body.sourceType,
        req.body.sourceName,
        req.body.connectorAccountId,
        req.body.fetchConfig
      );
      res.json({ id: sourceId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Import transactions
router.post('/reconciliation/sources/:sourceId/import', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const sourceId = req.params.sourceId as string;
    const result = await reconciliationService.importTransactions(sourceId, req.body.transactions);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run reconciliation
router.post('/merchants/:merchantId/reconciliation/run', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const reportDate = new Date(req.body.date);
    const report = await reconciliationService.runReconciliation(merchantId, reportDate);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Historical backfill
router.post(
  '/merchants/:merchantId/reconciliation/backfill',
  authenticateJwt,
  requireRole('FINANCE'),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const from = new Date(req.body.from);
      const to = new Date(req.body.to);
      const result = await reconciliationService.runHistoricalReconciliation(merchantId, from, to, {
        forceRerun: Boolean(req.body.forceRerun),
      });
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get reports
router.get('/merchants/:merchantId/reconciliation/reports', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const from = new Date(req.query.from as string);
    const to = new Date(req.query.to as string);
    const reports = await reconciliationService.getReports(merchantId, from, to);
    res.json(reports);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get summary
router.get('/merchants/:merchantId/reconciliation/summary', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const from = new Date(req.query.from as string);
    const to = new Date(req.query.to as string);
    const summary = await reconciliationService.getSummary(merchantId, from, to);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get discrepancies
router.get('/reconciliation/reports/:reportId/discrepancies', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const reportId = req.params.reportId as string;
    const discrepancies = await reconciliationService.getDiscrepancies(reportId);
    res.json(discrepancies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get open discrepancies
router.get(
  '/merchants/:merchantId/reconciliation/discrepancies/open',
  authenticateJwt,
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const discrepancies = await reconciliationService.getOpenDiscrepancies(merchantId);
      res.json(discrepancies);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Resolve discrepancy
router.post(
  '/reconciliation/discrepancies/:discrepancyId/resolve',
  authenticateJwt,
  requireRole('FINANCE'),
  async (req: Request, res: Response) => {
    try {
      const discrepancyId = req.params.discrepancyId as string;
      const userId = (req as any).user.userId;
      await reconciliationService.resolveDiscrepancy(discrepancyId, userId, req.body.status, req.body.notes);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── PSP auto-sync ──

// Trigger manual sync for a merchant
router.post(
  '/merchants/:merchantId/reconciliation/sync',
  authenticateJwt,
  requireRole('FINANCE'),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const results = await pspSyncService.syncAllForMerchant(merchantId);
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Trigger manual sync for a specific source
router.post('/reconciliation/sources/:sourceId/sync', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const sourceId = req.params.sourceId as string;
    const result = await pspSyncService.syncSource(sourceId);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bank settlement import ──

// Import bank settlement file
router.post(
  '/merchants/:merchantId/reconciliation/settlements',
  authenticateJwt,
  requireRole('FINANCE'),
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const record = await reconciliationService.importBankSettlement(merchantId, {
        ...req.body,
        valueDate: new Date(req.body.valueDate),
      });
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// List settlements
router.get(
  '/merchants/:merchantId/reconciliation/settlements',
  authenticateJwt,
  async (req: Request, res: Response) => {
    try {
      const merchantId = req.params.merchantId as string;
      const from = new Date(req.query.from as string);
      const to = new Date(req.query.to as string);
      const records = await reconciliationService.listSettlements(merchantId, from, to);
      res.json(records);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

export default router;
