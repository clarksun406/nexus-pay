import { Router, Request, Response } from 'express';
import { authenticateJwt } from '../middleware/auth';
import { authService } from '../services/auth.service';
import db from '../db/connection';

const router = Router();

// GET /api/v1/me — Get current user info
router.get('/', authenticateJwt, async (req: Request, res: Response) => {
  try {
    const user = await db('users').where({ id: req.user!.userId }).first();
    if (!user) return res.status(404).json({ title: 'Error', detail: 'User not found' });

    const memberships = await authService.getMemberships(user.id);

    res.json({
      id: user.id,
      email: user.email,
      mfaEnabled: user.mfa_enabled,
      memberships,
    });
  } catch (err: any) {
    res.status(500).json({ title: 'Error', detail: err.message });
  }
});

export default router;
