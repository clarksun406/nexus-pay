import { v4 as uuidv4 } from 'uuid';
import db from '../db/connection';

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

class ThreeDsService {
  /**
   * Create a 3DS session
   */
  async createSession(
    paymentIntentId: string,
    version: string = '2.0'
  ): Promise<ThreeDSSession> {
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    const [session] = await db('three_ds_sessions')
      .insert({
        payment_intent_id: paymentIntentId,
        three_ds_version: version,
        status: 'PENDING',
        expires_at: expiresAt,
      })
      .returning('*');

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
    }
  ): Promise<ThreeDSSession> {
    const updateData: any = { ...data };

    if (data.status === 'AUTHENTICATED') {
      updateData.authenticated_at = new Date();
    }

    const [session] = await db('three_ds_sessions')
      .where({ id: sessionId })
      .update(updateData)
      .returning('*');

    // Update payment intent with 3DS action URL
    if (data.challengeUrl || data.acsUrl) {
      await db('payment_intents')
        .where({ id: session.payment_intent_id })
        .update({
          three_ds_action_url: data.challengeUrl || data.acsUrl,
          status: 'REQUIRES_ACTION',
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
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

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

    // Update session status
    await db('three_ds_sessions')
      .where({ id: sessionId })
      .update({ status: 'CHALLENGE_REQUIRED' });

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

    // Increment attempt count
    const newAttemptCount = challenge.attempt_count + 1;
    await db('three_ds_challenges')
      .where({ id: challengeId })
      .update({ attempt_count: newAttemptCount });

    if (newAttemptCount >= challenge.max_attempts) {
      await db('three_ds_challenges').where({ id: challengeId }).update({ status: 'FAILED' });
      return { success: false, message: 'Maximum attempts exceeded' };
    }

    // In a real implementation, validate the response with the ACS
    // For now, simulate validation
    const isValid = response.length >= 4; // Simplified validation

    if (isValid) {
      const [updated] = await db('three_ds_challenges')
        .where({ id: challengeId })
        .update({
          status: 'COMPLETED',
          completed_at: new Date(),
        })
        .returning('*');

      // Update session
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
   * Complete authentication with 3DS data
   */
  async completeAuthentication(
    sessionId: string,
    data: {
      eci: string;
      cavv: string;
      xid?: string;
      authenticationMethod: string;
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
        authenticated_at: new Date(),
      })
      .returning('*');

    // Update payment intent status
    await db('payment_intents')
      .where({ id: session.payment_intent_id })
      .update({
        status: 'REQUIRES_CONFIRMATION',
        three_ds_action_url: null,
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
  }

  /**
   * Check if 3DS is required for a transaction
   */
  async isRequired(amount: number, currency: string, country?: string): boolean {
    // SCA (Strong Customer Authentication) requirements
    // EUR transactions in EEA require 3DS
    const eeaCountries = [
      'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
      'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
      'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO',
    ];

    if (country && eeaCountries.includes(country.toUpperCase())) {
      return true;
    }

    // High-value transactions
    if (amount > 30000) { // 300 EUR in cents
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
    };
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
