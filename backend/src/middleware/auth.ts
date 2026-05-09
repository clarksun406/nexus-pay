import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import db from '../db/connection';
import { hashSha256 } from '../utils/crypto';

export interface AuthUser {
  userId: string;
  email: string;
}

export interface ApiKeyAuth {
  keyId: string;
  merchantId: string;
  mode: 'TEST' | 'LIVE';
  type: 'SECRET' | 'PUBLISHABLE';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      apiKey?: ApiKeyAuth;
    }
  }
}

export function generateAccessToken(user: AuthUser, tokenVersion: number): string {
  return jwt.sign(
    { userId: user.userId, email: user.email, tokenVersion },
    config.jwt.secret,
    { expiresIn: Math.floor(config.jwt.accessTokenExpiryMs / 1000) },
  );
}

export function generateRefreshToken(user: AuthUser, tokenVersion: number): string {
  return jwt.sign(
    { userId: user.userId, email: user.email, tokenVersion, type: 'refresh' },
    config.jwt.secret,
    { expiresIn: Math.floor(config.jwt.refreshTokenExpiryMs / 1000) },
  );
}

export function verifyToken(token: string): any {
  return jwt.verify(token, config.jwt.secret);
}

// JWT Bearer authentication middleware
export async function authenticateJwt(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ title: 'Unauthorized', detail: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  // Check if it's an API key (sk_xxx or pk_xxx)
  if (token.startsWith('sk_') || token.startsWith('pk_')) {
    return authenticateApiKey(req, res, next, token);
  }

  try {
    const payload = verifyToken(token);
    if (payload.type === 'refresh') {
      return res.status(401).json({ title: 'Unauthorized', detail: 'Use refresh token at /auth/refresh' });
    }

    // Check token version
    const user = await db('users').where({ id: payload.userId }).first();
    if (!user || user.token_version !== payload.tokenVersion) {
      return res.status(401).json({ title: 'Unauthorized', detail: 'Token has been revoked' });
    }

    req.user = { userId: payload.userId, email: payload.email };
    next();
  } catch (err) {
    return res.status(401).json({ title: 'Unauthorized', detail: 'Invalid or expired token' });
  }
}

// API Key authentication middleware
async function authenticateApiKey(req: Request, res: Response, next: NextFunction, rawKey: string) {
  const keyHash = hashSha256(rawKey);

  const apiKey = await db('api_keys')
    .where({ key_hash: keyHash, status: 'ACTIVE' })
    .first();

  if (!apiKey) {
    return res.status(401).json({ title: 'Unauthorized', detail: 'Invalid API key' });
  }

  // Update last_used_at
  await db('api_keys').where({ id: apiKey.id }).update({ last_used_at: new Date() });

  req.apiKey = {
    keyId: apiKey.id,
    merchantId: apiKey.merchant_id,
    mode: apiKey.mode,
    type: apiKey.type,
  };
  next();
}

// Require secret key
export function requireSecretKey(req: Request, res: Response, next: NextFunction) {
  if (!req.apiKey || req.apiKey.type !== 'SECRET') {
    return res.status(403).json({ title: 'Forbidden', detail: 'A secret API key is required for this operation' });
  }
  next();
}

// RBAC middleware
export function requireRole(...roles: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ title: 'Unauthorized' });
    }

    const merchantId = req.params.merchantId;
    if (!merchantId) {
      return res.status(400).json({ title: 'Bad Request', detail: 'Merchant ID required' });
    }

    const membership = await db('merchant_users')
      .where({ user_id: req.user.userId, merchant_id: merchantId, status: 'ACTIVE' })
      .first();

    if (!membership) {
      return res.status(403).json({ title: 'Forbidden', detail: 'Not a member of this merchant' });
    }

    if (!roles.includes(membership.role)) {
      return res.status(403).json({ title: 'Forbidden', detail: 'Insufficient permissions' });
    }

    next();
  };
}
