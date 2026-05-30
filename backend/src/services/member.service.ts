import db from '../db/connection';
import { config } from '../config';
import { generateToken, hashSha256, INVITE_PASSWORD_SENTINEL } from '../utils/crypto';
import { emailService } from './email.service';

const VALID_ROLES = ['OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER'];

export class MemberService {
  async list(merchantId: string) {
    const members = await db('merchant_users')
      .join('users', 'users.id', 'merchant_users.user_id')
      .where('merchant_users.merchant_id', merchantId)
      .select('merchant_users.*', 'users.email')
      .orderBy('merchant_users.created_at', 'asc');

    return members.map((m: any) => ({
      id: m.id,
      userId: m.user_id,
      email: m.email,
      role: m.role,
      status: m.status,
      invitedBy: m.invited_by,
      createdAt: m.created_at,
    }));
  }

  async invite(merchantId: string, emailRaw: string, role: string, invitedBy: string) {
    const email = (emailRaw || '').toLowerCase().trim();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw Object.assign(new Error('A valid email is required'), { status: 400 });
    }
    if (!VALID_ROLES.includes(role)) {
      throw Object.assign(new Error('Invalid role'), { status: 400 });
    }
    if (role === 'OWNER') {
      throw Object.assign(new Error('Cannot invite a member as OWNER'), { status: 400 });
    }

    // Find or create the target user.
    let user = await db('users').where({ email }).first();
    let isNewUser = false;
    if (!user) {
      [user] = await db('users')
        .insert({ email, password_hash: INVITE_PASSWORD_SENTINEL, status: 'PENDING_INVITE' })
        .returning('*');
      isNewUser = true;
    }

    // Find or (re)create the membership.
    const existing = await db('merchant_users')
      .where({ user_id: user.id, merchant_id: merchantId })
      .first();
    if (existing && existing.status === 'ACTIVE') {
      throw Object.assign(new Error('User is already an active member'), { status: 409 });
    }

    let membership: any;
    if (existing) {
      [membership] = await db('merchant_users')
        .where({ id: existing.id })
        .update({ role, status: 'PENDING_INVITE', invited_by: invitedBy })
        .returning('*');
    } else {
      [membership] = await db('merchant_users')
        .insert({
          user_id: user.id,
          merchant_id: merchantId,
          role,
          status: 'PENDING_INVITE',
          invited_by: invitedBy,
        })
        .returning('*');
    }

    // Issue a fresh invite token, invalidating any prior pending ones.
    await db('invite_tokens')
      .where({ merchant_user_id: membership.id, used: false })
      .update({ used: true });

    const rawToken = generateToken();
    await db('invite_tokens').insert({
      merchant_user_id: membership.id,
      token_hash: hashSha256(rawToken),
      expires_at: new Date(Date.now() + config.invite.tokenExpiryMs),
    });

    const inviteUrl = `${config.payBaseUrl}/accept-invite?token=${rawToken}`;

    // Best-effort email delivery; we still return the URL so the dashboard
    // can display it (useful in dev / when SMTP isn't configured).
    let inviterEmail: string | null = null;
    try {
      const inviter = await db('users').where({ id: invitedBy }).first();
      inviterEmail = inviter?.email || null;
    } catch { /* ignore */ }
    let merchantName = 'this merchant';
    try {
      const merchant = await db('merchants').where({ id: merchantId }).first();
      if (merchant?.name) merchantName = merchant.name;
    } catch { /* ignore */ }
    const emailResult = await emailService.sendInvite(email, inviteUrl, inviterEmail, merchantName);

    return {
      id: membership.id,
      userId: user.id,
      email,
      role,
      status: membership.status,
      isNewUser,
      inviteToken: rawToken,
      inviteUrl,
      emailDelivered: emailResult.delivered,
      expiresAt: new Date(Date.now() + config.invite.tokenExpiryMs).toISOString(),
    };
  }

  async updateRole(merchantId: string, memberId: string, role: string) {
    const member = await db('merchant_users')
      .where({ id: memberId, merchant_id: merchantId })
      .first();
    if (!member) throw Object.assign(new Error('Member not found'), { status: 404 });

    const validRoles = ['OWNER', 'ADMIN', 'DEVELOPER', 'FINANCE', 'VIEWER'];
    if (!validRoles.includes(role)) {
      throw Object.assign(new Error('Invalid role'), { status: 400 });
    }

    const [updated] = await db('merchant_users')
      .where({ id: memberId })
      .update({ role })
      .returning('*');

    return { id: updated.id, role: updated.role };
  }

  async remove(merchantId: string, memberId: string) {
    const member = await db('merchant_users')
      .where({ id: memberId, merchant_id: merchantId })
      .first();
    if (!member) throw Object.assign(new Error('Member not found'), { status: 404 });
    if (member.role === 'OWNER') {
      throw Object.assign(new Error('Cannot remove the owner'), { status: 400 });
    }

    await db('merchant_users').where({ id: memberId }).delete();
  }
}

export const memberService = new MemberService();
