import db from '../db/connection';

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
