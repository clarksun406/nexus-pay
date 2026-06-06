import { Router, Request, Response } from 'express';
import { authenticateJwt, requireRole } from '../middleware/auth';
import { networkTokenService, CardNetwork } from '../services/network-token.service';

const router = Router();

const DEVELOP = ['OWNER', 'ADMIN', 'DEVELOPER'];

router.post('/', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const { cardNumber, expiryMonth, expiryYear, cardNetwork } = req.body;
    const token = await networkTokenService.enroll(merchantId, {
      cardNumber,
      expiryMonth,
      expiryYear,
      cardNetwork: cardNetwork as CardNetwork,
    });
    res.status(201).json(token);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const cardNetwork = req.query.cardNetwork as string | undefined;
    const status = req.query.status as string | undefined;
    const tokens = await networkTokenService.listTokens(merchantId, { cardNetwork, status });
    res.json(tokens);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:tokenId', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const token = await networkTokenService.getToken(merchantId, tokenId);
    res.json(token);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:tokenId/events', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const tokenId = req.params.tokenId as string;
    const events = await networkTokenService.getLifecycleEvents(tokenId);
    res.json(events);
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

router.delete('/:tokenId', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    await networkTokenService.deleteToken(merchantId, tokenId);
    res.status(204).send();
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:tokenId/refresh', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const token = await networkTokenService.refreshToken(merchantId, tokenId);
    res.json(token);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:tokenId/suspend', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const token = await networkTokenService.suspendToken(merchantId, tokenId, req.body.reason);
    res.json(token);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:tokenId/resume', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const token = await networkTokenService.resumeToken(merchantId, tokenId);
    res.json(token);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.post('/:tokenId/cryptogram', authenticateJwt, requireRole(...DEVELOP), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const result = await networkTokenService.generateCryptogram(merchantId, tokenId, {
      amount: req.body.amount,
      currency: req.body.currency,
      merchantName: req.body.merchantName,
    });
    res.json(result);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

router.get('/:tokenId/pan-fallback', authenticateJwt, requireRole('ADMIN'), async (req: Request, res: Response) => {
  try {
    const merchantId = req.params.merchantId as string;
    const tokenId = req.params.tokenId as string;
    const fallback = await networkTokenService.getPanFallback(merchantId, tokenId);
    res.json(fallback);
  } catch (err: any) {
    res.status(err.status || 500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
