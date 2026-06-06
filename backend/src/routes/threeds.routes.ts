import { Router, Request, Response } from 'express';
import { threeDsService } from '../services/threeds.service';
import { authenticateJwt, requireSecretKey } from '../middleware/auth';

const router = Router();

// Create 3DS session (API key required) — supports version "1.0" (redirect) or "2.x"
router.post('/payment-intents/:intentId/3ds/session', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const intentId = req.params.intentId as string;
    const session = await threeDsService.createSession(intentId, req.body.version);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get session
router.get('/3ds/sessions/:sessionId', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await threeDsService.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get session by payment intent
router.get('/payment-intents/:intentId/3ds/session', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const intentId = req.params.intentId as string;
    const session = await threeDsService.getSessionByIntent(intentId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update session with 3DS data
router.put('/3ds/sessions/:sessionId', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await threeDsService.updateSession(sessionId, req.body);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create challenge
router.post('/3ds/sessions/:sessionId/challenge', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const challenge = await threeDsService.createChallenge(sessionId, req.body.challengeType, req.body.challengeData);
    res.json(challenge);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get active challenge
router.get('/3ds/sessions/:sessionId/challenge', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const challenge = await threeDsService.getActiveChallenge(sessionId);
    if (!challenge) {
      return res.status(404).json({ error: 'No active challenge' });
    }
    res.json(challenge);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Submit challenge response
router.post('/3ds/challenges/:challengeId/submit', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const challengeId = req.params.challengeId as string;
    const result = await threeDsService.submitChallenge(challengeId, req.body.response);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 3DS 1.0: submit PaRes from issuer ACS
router.post('/3ds/sessions/:sessionId/pares', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await threeDsService.submitPaRes(sessionId, req.body.pares, req.body.md);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Complete authentication
router.post('/3ds/sessions/:sessionId/complete', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    const session = await threeDsService.completeAuthentication(sessionId, req.body);
    res.json(session);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fail authentication
router.post('/3ds/sessions/:sessionId/fail', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params.sessionId as string;
    await threeDsService.failAuthentication(sessionId, req.body.reason);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check if 3DS is required
router.post('/3ds/check-required', requireSecretKey, async (req: Request, res: Response) => {
  try {
    const required = await threeDsService.isRequired(req.body.amount, req.body.currency, req.body.country);
    res.json({ required });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get liability shift records for a payment intent
router.get('/payment-intents/:intentId/3ds/liability-shifts', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const intentId = req.params.intentId as string;
    const records = await threeDsService.getLiabilityShifts(intentId);
    res.json(records);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
