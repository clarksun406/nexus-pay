import { v4 as uuidv4 } from 'uuid';
import { authenticator } from 'otplib';
import db from '../db/connection';
import { hashPassword, comparePassword, hashSha256, generateToken, INVITE_PASSWORD_SENTINEL } from '../utils/crypto';
import {
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  AuthUser,
} from '../middleware/auth';
import { config } from '../config';

export class AuthService {
  async register(email: string, password: string, merchantName?: string) {
    const existing = await db('users').where({ email }).first();
    if (existing) {
      throw Object.assign(new Error('Email already registered'), { status: 409 });
    }

    const passwordHash = await hashPassword(password);
    const trx = await db.transaction();
    try {
      const [user] = await trx('users')
        .insert({ email, password_hash: passwordHash, status: 'ACTIVE' })
        .returning('*');

      const orgName = merchantName || `${email.split('@')[0]}'s Organization`;
      const [org] = await trx('organizations')
        .insert({ name: orgName })
        .returning('*');

      const [merchant] = await trx('merchants')
        .insert({ name: merchantName || email.split('@')[0], organization_id: org.id })
        .returning('*');

      await trx('organization_users').insert({
        user_id: user.id,
        organization_id: org.id,
        role: 'ORG_OWNER',
        status: 'ACTIVE',
      });

      await trx('merchant_users').insert({
        user_id: user.id,
        merchant_id: merchant.id,
        role: 'OWNER',
        status: 'ACTIVE',
      });

      await trx.commit();
      return this.buildAuthResponse(user);
    } catch (err) {
      await trx.rollback();
      throw err;
    }
  }

  async login(email: string, password: string) {
    const user = await db('users').where({ email, status: 'ACTIVE' }).first();
    if (!user) {
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      throw Object.assign(new Error('Invalid credentials'), { status: 401 });
    }

    // If MFA is enabled, return a session token instead of full auth
    if (user.mfa_enabled) {
      const mfaSessionToken = generateToken();
      // Store temporarily (5 min TTL) - using a simple in-memory store for now
      this.mfaSessions.set(mfaSessionToken, { userId: user.id, expires: Date.now() + 300000 });
      return { mfaRequired: true, mfaSessionToken };
    }

    return this.buildAuthResponse(user);
  }

  private mfaSessions = new Map<string, { userId: string; expires: number }>();

  async verifyMfa(mfaSessionToken: string, code: string) {
    const session = this.mfaSessions.get(mfaSessionToken);
    if (!session || session.expires < Date.now()) {
      this.mfaSessions.delete(mfaSessionToken);
      throw Object.assign(new Error('MFA session expired'), { status: 401 });
    }

    const user = await db('users').where({ id: session.userId }).first();
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }

    // Try TOTP code first
    const isValid = authenticator.verify({ token: code, secret: user.mfa_secret });
    if (!isValid) {
      // Try backup codes
      const backupCode = await db('mfa_backup_codes')
        .where({ user_id: user.id, used: false })
        .whereRaw('code_hash = ?', [hashSha256(code)])
        .first();

      if (backupCode) {
        await db('mfa_backup_codes').where({ id: backupCode.id }).update({ used: true });
      } else {
        throw Object.assign(new Error('Invalid MFA code'), { status: 401 });
      }
    }

    this.mfaSessions.delete(mfaSessionToken);
    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string) {
    let payload: any;
    try {
      payload = verifyToken(refreshToken);
    } catch {
      throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
    }
    if (payload.type !== 'refresh') {
      throw Object.assign(new Error('Invalid refresh token'), { status: 401 });
    }

    const user = await db('users').where({ id: payload.userId, status: 'ACTIVE' }).first();
    if (!user || user.token_version !== payload.tokenVersion) {
      throw Object.assign(new Error('Refresh token revoked'), { status: 401 });
    }

    // Verify the token exists, is not revoked and is not expired.
    const tokenHash = hashSha256(refreshToken);
    const stored = await db('refresh_tokens').where({ token_hash: tokenHash }).first();
    if (!stored || stored.revoked || new Date(stored.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error('Refresh token revoked or expired'), { status: 401 });
    }

    // Rotation: invalidate the presented token before issuing a new one.
    await db('refresh_tokens').where({ id: stored.id }).update({ revoked: true });

    return this.buildAuthResponse(user);
  }

  async logout(refreshToken: string) {
    try {
      const payload = verifyToken(refreshToken);
      // Revoke the presented refresh token and invalidate all access tokens.
      await db('refresh_tokens').where({ token_hash: hashSha256(refreshToken) }).update({ revoked: true });
      await db('users').where({ id: payload.userId }).increment('token_version', 1);
    } catch {
      // Ignore invalid tokens
    }
  }

  async acceptInvite(token: string, password?: string) {
    const tokenHash = hashSha256(token);
    const invite = await db('invite_tokens').where({ token_hash: tokenHash, used: false }).first();
    if (!invite) {
      throw Object.assign(new Error('Invalid or already-used invite token'), { status: 400 });
    }
    if (new Date(invite.expires_at).getTime() < Date.now()) {
      throw Object.assign(new Error('Invite token has expired'), { status: 400 });
    }

    const membership = await db('merchant_users').where({ id: invite.merchant_user_id }).first();
    if (!membership) {
      throw Object.assign(new Error('Invitation target no longer exists'), { status: 404 });
    }
    const user = await db('users').where({ id: membership.user_id }).first();
    if (!user) {
      throw Object.assign(new Error('User not found'), { status: 404 });
    }

    const needsPassword =
      user.password_hash === INVITE_PASSWORD_SENTINEL || user.status === 'PENDING_INVITE';

    const trx = await db.transaction();
    try {
      if (needsPassword) {
        if (!password || password.length < 8) {
          throw Object.assign(new Error('A password of at least 8 characters is required'), { status: 400 });
        }
        const passwordHash = await hashPassword(password);
        await trx('users').where({ id: user.id }).update({ password_hash: passwordHash, status: 'ACTIVE' });
      }
      await trx('merchant_users').where({ id: membership.id }).update({ status: 'ACTIVE' });
      await trx('invite_tokens').where({ id: invite.id }).update({ used: true });
      await trx.commit();
    } catch (err) {
      await trx.rollback();
      throw err;
    }

    const freshUser = await db('users').where({ id: user.id }).first();
    return this.buildAuthResponse(freshUser);
  }

  async buildAuthResponse(user: any) {
    const authUser: AuthUser = { userId: user.id, email: user.email };
    const accessToken = generateAccessToken(authUser, user.token_version);
    const refreshToken = generateRefreshToken(authUser, user.token_version);

    // Persist the refresh token (hashed) so it can be rotated/revoked.
    await db('refresh_tokens').insert({
      user_id: user.id,
      token_hash: hashSha256(refreshToken),
      expires_at: new Date(Date.now() + config.jwt.refreshTokenExpiryMs),
      revoked: false,
    });

    // Get memberships
    const memberships = await this.getMemberships(user.id);

    return {
      user: { id: user.id, email: user.email, mfaEnabled: user.mfa_enabled },
      accessToken,
      refreshToken,
      memberships,
    };
  }

  async getMemberships(userId: string) {
    const orgUsers = await db('organization_users')
      .join('organizations', 'organizations.id', 'organization_users.organization_id')
      .where('organization_users.user_id', userId)
      .where('organization_users.status', 'ACTIVE')
      .select('organization_users.*', 'organizations.name as organization_name');

    const result = [];
    for (const ou of orgUsers) {
      const merchants = await db('merchant_users')
        .join('merchants', 'merchants.id', 'merchant_users.merchant_id')
        .where('merchant_users.user_id', userId)
        .where('merchants.organization_id', ou.organization_id)
        .where('merchant_users.status', 'ACTIVE')
        .select('merchant_users.*', 'merchants.name as merchant_name');

      result.push({
        organizationId: ou.organization_id,
        organizationName: ou.organization_name,
        orgRole: ou.role,
        merchants: merchants.map((m: any) => ({
          merchantId: m.merchant_id,
          merchantName: m.merchant_name,
          role: m.role,
        })),
      });
    }
    return result;
  }

  // MFA setup
  async mfaSetup(userId: string) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(user.email, 'NexusPay', secret);

    // Temporarily store the secret (will be confirmed on verify)
    await db('users').where({ id: userId }).update({ mfa_secret: secret });

    return { secret, qrCode: otpauth };
  }

  async mfaConfirm(userId: string, code: string) {
    const user = await db('users').where({ id: userId }).first();
    if (!user || !user.mfa_secret) {
      throw Object.assign(new Error('MFA setup not initiated'), { status: 400 });
    }

    const isValid = authenticator.verify({ token: code, secret: user.mfa_secret });
    if (!isValid) {
      throw Object.assign(new Error('Invalid MFA code'), { status: 400 });
    }

    // Generate backup codes
    const backupCodes: string[] = [];
    for (let i = 0; i < 8; i++) {
      const code = generateToken().slice(0, 8);
      backupCodes.push(code);
      await db('mfa_backup_codes').insert({
        user_id: userId,
        code_hash: hashSha256(code),
      });
    }

    await db('users').where({ id: userId }).update({ mfa_enabled: true });
    return { backupCodes };
  }

  async mfaDisable(userId: string, code: string) {
    const user = await db('users').where({ id: userId }).first();
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });

    // Verify TOTP or backup code
    let isValid = false;
    if (user.mfa_secret) {
      isValid = authenticator.verify({ token: code, secret: user.mfa_secret });
    }
    if (!isValid) {
      const backupCode = await db('mfa_backup_codes')
        .where({ user_id: userId, used: false })
        .whereRaw('code_hash = ?', [hashSha256(code)])
        .first();
      if (backupCode) {
        await db('mfa_backup_codes').where({ id: backupCode.id }).update({ used: true });
        isValid = true;
      }
    }

    if (!isValid) {
      throw Object.assign(new Error('Invalid MFA code'), { status: 400 });
    }

    await db('users').where({ id: userId }).update({ mfa_enabled: false, mfa_secret: null });
    await db('mfa_backup_codes').where({ user_id: userId }).delete();
  }
}

export const authService = new AuthService();
