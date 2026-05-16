import { Router, Request, Response } from 'express';
import { reconciliationService } from '../services/reconciliation.service';
import { authenticateJwt, requireRole } from '../middleware/auth';

const router = Router();

// Create reconciliation source
router.post('/merchants/:merchantId/reconciliation/sources', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const sourceId = await reconciliationService.createSource(
      req.params.merchantId,
      req.body.sourceType,
      req.body.sourceName,
      req.body.connectorAccountId,
      req.body.fetchConfig
    );
    res.json({ id: sourceId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import transactions
router.post('/reconciliation/sources/:sourceId/import', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await reconciliationService.importTransactions(req.params.sourceId, req.body.transactions);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run reconciliation
router.post('/merchants/:merchantId/reconciliation/run', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const reportDate = new Date(req.body.date);
    const report = await reconciliationService.runReconciliation(req.params.merchantId, reportDate);
    res.json(report);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get reports
router.get('/merchants/:merchantId/reconciliation/reports', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const from = new Date(req.query.from as string);
    const to = new Date(req.query.to as string);
    const reports = await reconciliationService.getReports(req.params.merchantId, from, to);
    res.json(reports);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get summary
router.get('/merchants/:merchantId/reconciliation/summary', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const from = new Date(req.query.from as string);
    const to = new Date(req.query.to as string);
    const summary = await reconciliationService.getSummary(req.params.merchantId, from, to);
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get discrepancies
router.get('/reconciliation/reports/:reportId/discrepancies', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const discrepancies = await reconciliationService.getDiscrepancies(req.params.reportId);
    res.json(discrepancies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get open discrepancies
router.get('/merchants/:merchantId/reconciliation/discrepancies/open', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const discrepancies = await reconciliationService.getOpenDiscrepancies(req.params.merchantId);
    res.json(discrepancies);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Resolve discrepancy
router.post('/reconciliation/discrepancies/:discrepancyId/resolve', authenticateJwt, requireRole('FINANCE'), async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user.userId;
    await reconciliationService.resolveDiscrepancy(
      req.params.discrepancyId,
      userId,
      req.body.status,
      req.body.notes
    );
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
