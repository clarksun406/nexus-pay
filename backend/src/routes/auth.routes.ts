import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { authenticateJwt } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  merchantName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const refreshSchema = z.object({
  refreshToken: z.string(),
});

const mfaVerifySchema = z.object({
  mfaSessionToken: z.string(),
  code: z.string(),
});

const mfaConfirmSchema = z.object({
  code: z.string(),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).optional(),
});

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response) => {
  try {
    const body = registerSchema.parse(req.body);
    const result = await authService.register(body.email, body.password, body.merchantName);
    res.status(201).json(result);
  } catch (err: any) {
    const status = err.status || (err.name === 'ZodError' ? 400 : 500);
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await authService.login(body.email, body.password);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  try {
    const body = refreshSchema.parse(req.body);
    const result = await authService.refresh(body.refreshToken);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const body = refreshSchema.parse(req.body);
    await authService.logout(body.refreshToken);
    res.status(204).send();
  } catch (err: any) {
    res.status(204).send(); // Always succeed
  }
});

// POST /api/v1/auth/accept-invite
router.post('/accept-invite', async (req: Request, res: Response) => {
  try {
    const body = acceptInviteSchema.parse(req.body);
    const result = await authService.acceptInvite(body.token, body.password);
    res.json(result);
  } catch (err: any) {
    const status = err.status || (err.name === 'ZodError' ? 400 : 500);
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/mfa/verify
router.post('/mfa/verify', async (req: Request, res: Response) => {
  try {
    const body = mfaVerifySchema.parse(req.body);
    const result = await authService.verifyMfa(body.mfaSessionToken, body.code);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/mfa/setup
router.post('/mfa/setup', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const result = await authService.mfaSetup(req.user!.userId);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// POST /api/v1/auth/mfa/confirm
router.post('/mfa/confirm', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const body = mfaConfirmSchema.parse(req.body);
    const result = await authService.mfaConfirm(req.user!.userId, body.code);
    res.json(result);
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// DELETE /api/v1/auth/mfa
router.delete('/mfa', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const body = mfaConfirmSchema.parse(req.body);
    await authService.mfaDisable(req.user!.userId, body.code);
    res.status(204).send();
  } catch (err: any) {
    const status = err.status || 500;
    res.status(status).json({ title: 'Error', detail: err.message });
  }
});

// GET /api/v1/auth/mfa/status
router.get('/mfa/status', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const { default: db } = await import('../db/connection');
    const user = await db('users').where({ id: req.user!.userId }).first();
    res.json({ mfaEnabled: user?.mfa_enabled || false });
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
