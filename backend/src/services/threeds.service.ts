import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';

export type ThreeDsFlowType = 'CHALLENGE' | 'FRICTIONLESS' | 'REDIRECT';
export type LiabilityShift = 'TO_ISSUER' | 'TO_MERCHANT' | 'NO_SHIFT';

export interface ThreeDSSession {
  id: string;
  paymentIntentId: string;
  threeDsVersion: string;
  status: 'PENDING' | 'AUTHENTICATED' | 'CHALLENGE_REQUIRED' | 'FAILED' | 'EXPIRED';
  dsTransactionId?: string;
  acsTransactionId?: string;
  acsUrl?: string;
  challengeUrl?: string;
  authenticationMethod?: string;
  eci?: string;
  cavv?: string;
  xid?: string;
  authenticatedAt?: Date;
  expiresAt?: Date;
  frictionlessFlow?: boolean;
  flowType?: ThreeDsFlowType;
  pareq?: string;
  pares?: string;
  md?: string;
}

export interface ThreeDSChallenge {
  id: string;
  sessionId: string;
  challengeType: 'OTP' | 'BIOMETRIC' | 'OUT_OF_BAND' | 'APP_BASED';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';
  challengeData?: string;
  attemptCount: number;
  maxAttempts: number;
  completedAt?: Date;
  expiresAt?: Date;
}

export interface LiabilityShiftRecord {
  id: string;
  sessionId: string;
  paymentIntentId: string;
  liabilityShift: LiabilityShift;
  eci?: string;
  authenticationMethod: string;
  chargebackProtected: boolean;
  reason?: string;
  recordedAt: Date;
}

class ThreeDsService {
  /**
   * Create a 3DS session. Version can be '1.0' (legacy redirect) or '2.x' (modern).
   */
  async createSession(
    paymentIntentId: string,
    version: string = '2.0'
  ): Promise<ThreeDSSession> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const is1_0 = version.startsWith('1');
    const flowType: ThreeDsFlowType = is1_0 ? 'REDIRECT' : 'CHALLENGE';

    const [session] = await db('three_ds_sessions')
      .insert({
        payment_intent_id: paymentIntentId,
        three_ds_version: version,
        status: 'PENDING',
        expires_at: expiresAt,
        flow_type: flowType,
        frictionless_flow: false,
      })
      .returning('*');

    // For 1.0, generate a placeholder PaReq (merchant must redirect cardholder to ACS URL)
    if (is1_0) {
      const md = uuidv4();
      const pareq = Buffer.from(
        JSON.stringify({ paymentIntentId, sessionId: session.id, md, createdAt: new Date().toISOString() })
      ).toString('base64');

      await db('three_ds_sessions').where({ id: session.id }).update({ pareq, md });
      session.pareq = pareq;
      session.md = md;
    }

    return this.toResponse(session);
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ThreeDSSession | null> {
    const session = await db('three_ds_sessions').where({ id: sessionId }).first();
    if (!session) return null;
    return this.toResponse(session);
  }

  /**
   * Get session by payment intent
   */
  async getSessionByIntent(paymentIntentId: string): Promise<ThreeDSSession | null> {
    const session = await db('three_ds_sessions')
      .where({ payment_intent_id: paymentIntentId })
      .orderBy('created_at', 'desc')
      .first();
    if (!session) return null;
    return this.toResponse(session);
  }

  /**
   * Update session with 3DS data
   */
  async updateSession(
    sessionId: string,
    data: {
      status?: ThreeDSSession['status'];
      dsTransactionId?: string;
      acsTransactionId?: string;
      acsUrl?: string;
      challengeUrl?: string;
      authenticationMethod?: string;
      eci?: string;
      cavv?: string;
      xid?: string;
      frictionlessFlow?: boolean;
      flowType?: ThreeDsFlowType;
    }
  ): Promise<ThreeDSSession> {
    const updateData: any = { ...data };
    delete updateData.frictionlessFlow;
    delete updateData.flowType;
    if (data.frictionlessFlow !== undefined) updateData.frictionless_flow = data.frictionlessFlow;
    if (data.flowType !== undefined) updateData.flow_type = data.flowType;

    if (data.status === 'AUTHENTICATED') {
      updateData.authenticated_at = new Date();
    }

    const [session] = await db('three_ds_sessions')
      .where({ id: sessionId })
      .update(updateData)
      .returning('*');

    if (data.challengeUrl || data.acsUrl) {
      await db('payment_intents')
        .where({ id: session.payment_intent_id })
        .update({
          three_ds_action_url: data.challengeUrl || data.acsUrl,
          status: 'REQUIRES_ACTION',
        });
    }

    // Frictionless: record liability shift immediately
    if (data.frictionlessFlow && data.status === 'AUTHENTICATED' && data.eci) {
      await this.recordLiabilityShift({
        sessionId,
        paymentIntentId: session.payment_intent_id,
        liabilityShift: this.deriveLiabilityShift(data.eci),
        eci: data.eci,
        authenticationMethod: 'FRICTIONLESS',
        chargebackProtected: this.isLiabilityToIssuer(data.eci),
        reason: 'Frictionless authentication completed',
      });
    }

    return this.toResponse(session);
  }

  /**
   * Create a challenge for a session
   */
  async createChallenge(
    sessionId: string,
    challengeType: ThreeDSChallenge['challengeType'],
    challengeData?: string
  ): Promise<ThreeDSChallenge> {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    const [challenge] = await db('three_ds_challenges')
      .insert({
        session_id: sessionId,
        challenge_type: challengeType,
        status: 'PENDING',
        challenge_data: challengeData,
        max_attempts: 3,
        expires_at: expiresAt,
      })
      .returning('*');

    await db('three_ds_sessions')
      .where({ id: sessionId })
      .update({ status: 'CHALLENGE_REQUIRED', flow_type: 'CHALLENGE' });

    return this.toChallengeResponse(challenge);
  }

  /**
   * Get challenge by ID
   */
  async getChallenge(challengeId: string): Promise<ThreeDSChallenge | null> {
    const challenge = await db('three_ds_challenges').where({ id: challengeId }).first();
    if (!challenge) return null;
    return this.toChallengeResponse(challenge);
  }

  /**
   * Get active challenge for a session
   */
  async getActiveChallenge(sessionId: string): Promise<ThreeDSChallenge | null> {
    const challenge = await db('three_ds_challenges')
      .where({ session_id: sessionId, status: 'PENDING' })
      .where('expires_at', '>', new Date())
      .first();

    if (!challenge) return null;
    return this.toChallengeResponse(challenge);
  }

  /**
   * Submit challenge response
   */
  async submitChallenge(
    challengeId: string,
    response: string
  ): Promise<{ success: boolean; message: string; challenge?: ThreeDSChallenge }> {
    const challenge = await db('three_ds_challenges').where({ id: challengeId }).first();
    if (!challenge) {
      return { success: false, message: 'Challenge not found' };
    }

    if (challenge.status !== 'PENDING') {
      return { success: false, message: 'Challenge already completed' };
    }

    if (challenge.expires_at < new Date()) {
      await db('three_ds_challenges').where({ id: challengeId }).update({ status: 'EXPIRED' });
      return { success: false, message: 'Challenge expired' };
    }

    const newAttemptCount = challenge.attempt_count + 1;
    await db('three_ds_challenges')
      .where({ id: challengeId })
      .update({ attempt_count: newAttemptCount });

    if (newAttemptCount >= challenge.max_attempts) {
      await db('three_ds_challenges').where({ id: challengeId }).update({ status: 'FAILED' });
      return { success: false, message: 'Maximum attempts exceeded' };
    }

    const isValid = response.length >= 4;

    if (isValid) {
      const [updated] = await db('three_ds_challenges')
        .where({ id: challengeId })
        .update({
          status: 'COMPLETED',
          completed_at: new Date(),
        })
        .returning('*');

      await db('three_ds_sessions')
        .where({ id: challenge.session_id })
        .update({
          status: 'AUTHENTICATED',
          authenticated_at: new Date(),
        });

      return { success: true, message: 'Authentication successful', challenge: this.toChallengeResponse(updated) };
    }

    return { success: false, message: 'Invalid challenge response' };
  }

  /**
   * 3DS 1.0 PaRes submission — parses the base64 PaRes payload from the
   * issuer's ACS, marks the session authenticated, and records liability shift.
   */
  async submitPaRes(sessionId: string, pares: string, md?: string): Promise<ThreeDSSession> {
    const session = await db('three_ds_sessions').where({ id: sessionId }).first();
    if (!session) throw new Error('Session not found');
    if (session.flow_type !== 'REDIRECT') throw new Error('Not a 3DS 1.0 session');
    if (session.md && md && session.md !== md) throw new Error('MD mismatch');

    // Decode PaRes (simulated — real impl would verify ACS signature)
    let parsed: any = {};
    try {
      parsed = JSON.parse(Buffer.from(pares, 'base64').toString('utf8'));
    } catch {
      parsed = { raw: pares };
    }

    const eci = parsed.eci || '07';
    const cavv = parsed.cavv || parsed.authenticationValue;
    const xid = parsed.xid;

    const [updated] = await db('three_ds_sessions')
      .where({ id: sessionId })
      .update({
        status: 'AUTHENTICATED',
        pares,
        eci,
        cavv,
        xid,
        authentication_method: 'REDIRECT',
        authenticated_at: new Date(),
        flow_type: 'REDIRECT',
      })
      .returning('*');

    // Update payment intent
    await db('payment_intents')
      .where({ id: session.payment_intent_id })
      .update({ status: 'REQUIRES_CONFIRMATION', three_ds_action_url: null });

    await this.recordLiabilityShift({
      sessionId,
      paymentIntentId: session.payment_intent_id,
      liabilityShift: this.deriveLiabilityShift(eci),
      eci,
      authenticationMethod: 'REDIRECT',
      chargebackProtected: this.isLiabilityToIssuer(eci),
      reason: '3DS 1.0 PaRes received',
    });

    return this.toResponse(updated);
  }

  /**
   * Complete authentication with 3DS data
   */
  async completeAuthentication(
    sessionId: string,
    data: {
      eci: string;
      cavv: string;
      xid?: string;
      authenticationMethod: string;
      frictionless?: boolean;
    }
  ): Promise<ThreeDSSession> {
    const [session] = await db('three_ds_sessions')
      .where({ id: sessionId })
      .update({
        status: 'AUTHENTICATED',
        eci: data.eci,
        cavv: data.cavv,
        xid: data.xid,
        authentication_method: data.authenticationMethod,
        frictionless_flow: data.frictionless || false,
        flow_type: data.frictionless ? 'FRICTIONLESS' : 'CHALLENGE',
        authenticated_at: new Date(),
      })
      .returning('*');

    await db('payment_intents')
      .where({ id: session.payment_intent_id })
      .update({
        status: 'REQUIRES_CONFIRMATION',
        three_ds_action_url: null,
      });

    await this.recordLiabilityShift({
      sessionId,
      paymentIntentId: session.payment_intent_id,
      liabilityShift: this.deriveLiabilityShift(data.eci),
      eci: data.eci,
      authenticationMethod: data.authenticationMethod,
      chargebackProtected: this.isLiabilityToIssuer(data.eci),
      reason: data.frictionless ? 'Frictionless authentication' : 'Challenge completed',
    });

    return this.toResponse(session);
  }

  /**
   * Fail authentication
   */
  async failAuthentication(sessionId: string, reason?: string): Promise<void> {
    await db('three_ds_sessions').where({ id: sessionId }).update({ status: 'FAILED' });

    const session = await db('three_ds_sessions').where({ id: sessionId }).first();

    await db('payment_intents')
      .where({ id: session.payment_intent_id })
      .update({ status: 'FAILED' });

    // Record no-shift on failure
    await this.recordLiabilityShift({
      sessionId,
      paymentIntentId: session.payment_intent_id,
      liabilityShift: 'TO_MERCHANT',
      authenticationMethod: 'FAILED',
      chargebackProtected: false,
      reason: reason || 'Authentication failed',
    });
  }

  /**
   * Check if 3DS is required for a transaction
   */
  async isRequired(amount: number, currency: string, country?: string): Promise<boolean> {
    const eeaCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
    ];

    if (country && eeaCountries.includes(country.toUpperCase())) {
      return true;
    }

    if (amount > 30000) {
      return true;
    }

    return false;
  }

  /**
   * Get 3DS authentication data for payment processing
   */
  async getAuthenticationData(sessionId: string): Promise<{
    eci?: string;
    cavv?: string;
    xid?: string;
    version: string;
    flowType?: ThreeDsFlowType;
  } | null> {
    const session = await db('three_ds_sessions').where({ id: sessionId }).first();

    if (!session || session.status !== 'AUTHENTICATED') {
      return null;
    }

    return {
      eci: session.eci,
      cavv: session.cavv,
      xid: session.xid,
      version: session.three_ds_version,
      flowType: session.flow_type,
    };
  }

  /**
   * Get all liability shift records for a payment intent.
   */
  async getLiabilityShifts(paymentIntentId: string): Promise<LiabilityShiftRecord[]> {
    const rows = await db('three_ds_liability_shifts')
      .where({ payment_intent_id: paymentIntentId })
      .orderBy('recorded_at', 'desc');

    return rows.map((r: any) => ({
      id: r.id,
      sessionId: r.session_id,
      paymentIntentId: r.payment_intent_id,
      liabilityShift: r.liability_shift,
      eci: r.eci,
      authenticationMethod: r.authentication_method,
      chargebackProtected: Boolean(r.chargeback_protected),
      reason: r.reason,
      recordedAt: r.recorded_at,
    }));
  }

  /**
   * Record a liability shift event.
   */
  async recordLiabilityShift(data: {
    sessionId: string;
    paymentIntentId: string;
    liabilityShift: LiabilityShift;
    eci?: string;
    authenticationMethod: string;
    chargebackProtected: boolean;
    reason?: string;
  }): Promise<LiabilityShiftRecord> {
    const [row] = await db('three_ds_liability_shifts')
      .insert({
        session_id: data.sessionId,
        payment_intent_id: data.paymentIntentId,
        liability_shift: data.liabilityShift,
        eci: data.eci,
        authentication_method: data.authenticationMethod,
        chargeback_protected: data.chargebackProtected,
        reason: data.reason,
      })
      .returning('*');

    return {
      id: row.id,
      sessionId: row.session_id,
      paymentIntentId: row.payment_intent_id,
      liabilityShift: row.liability_shift,
      eci: row.eci,
      authenticationMethod: row.authentication_method,
      chargebackProtected: Boolean(row.chargeback_protected),
      reason: row.reason,
      recordedAt: row.recorded_at,
    };
  }

  /**
   * ECI-based liability shift derivation.
   * - Visa: 05 = full auth (issuer), 06 = attempt (issuer), 07 = no auth (merchant)
   * - MC: 02 = full auth (issuer), 01 = attempt (issuer), 00 = no auth (merchant)
   */
  private deriveLiabilityShift(eci: string): LiabilityShift {
    const eciClean = (eci || '').replace(/^0+/, '');
    const issuerShiftEci = ['5', '6', '2', '1'];
    if (issuerShiftEci.includes(eciClean)) return 'TO_ISSUER';
    return 'TO_MERCHANT';
  }

  private isLiabilityToIssuer(eci: string): boolean {
    return this.deriveLiabilityShift(eci) === 'TO_ISSUER';
  }

  private toResponse(row: any): ThreeDSSession {
    return {
      id: row.id,
      paymentIntentId: row.payment_intent_id,
      threeDsVersion: row.three_ds_version,
      status: row.status,
      dsTransactionId: row.ds_transaction_id,
      acsTransactionId: row.acs_transaction_id,
      acsUrl: row.acs_url,
      challengeUrl: row.challenge_url,
      authenticationMethod: row.authentication_method,
      eci: row.eci,
      cavv: row.cavv,
      xid: row.xid,
      authenticatedAt: row.authenticated_at,
      expiresAt: row.expires_at,
      frictionlessFlow: Boolean(row.frictionless_flow),
      flowType: row.flow_type,
      pareq: row.pareq,
      pares: row.pares,
      md: row.md,
    };
  }

  private toChallengeResponse(row: any): ThreeDSChallenge {
    return {
      id: row.id,
      sessionId: row.session_id,
      challengeType: row.challenge_type,
      status: row.status,
      challengeData: row.challenge_data,
      attemptCount: row.attempt_count,
      maxAttempts: row.max_attempts,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
    };
  }
}

export const threeDsService = new ThreeDsService();
