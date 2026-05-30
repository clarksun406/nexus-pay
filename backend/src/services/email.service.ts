import { config } from '../config';

/**
 * Lightweight email service.
 *
 * Uses nodemailer when SMTP is configured; otherwise logs the message to
 * stdout (dev mode) so flows like invites and password resets still work
 * end-to-end without infrastructure. Callers always get back a `delivered`
 * flag so they can decide what to expose to the user.
 *
 * nodemailer is loaded dynamically so the dependency stays optional — if
 * it's not installed, we silently fall back to console-only delivery.
 */

export interface SendOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  delivered: boolean;
  reason?: string;
}

class EmailService {
  private transporter: any | null = null;
  private initPromise: Promise<void> | null = null;

  private async init(): Promise<void> {
    if (this.transporter !== null || !config.smtp.host) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = (async () => {
      try {
        // Optional dep: only required when SMTP is configured.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodemailer = require('nodemailer');
        this.transporter = nodemailer.createTransport({
          host: config.smtp.host,
          port: config.smtp.port,
          secure: config.smtp.port === 465,
          auth: config.smtp.user
            ? { user: config.smtp.user, pass: config.smtp.password }
            : undefined,
        });
      } catch (err) {
        console.warn('[email] SMTP configured but nodemailer is not installed; falling back to console-only.');
        this.transporter = null;
      }
    })();
    return this.initPromise;
  }

  async send(opts: SendOptions): Promise<SendResult> {
    await this.init();
    if (!this.transporter) {
      // Dev / no-SMTP path: log so flows are still observable.
      console.log(`[email] would send to=${opts.to} subject=${JSON.stringify(opts.subject)}\n${opts.text}`);
      return { delivered: false, reason: 'SMTP not configured (logged to console)' };
    }
    try {
      await this.transporter.sendMail({
        from: config.smtp.from,
        to: opts.to,
        subject: opts.subject,
        text: opts.text,
        html: opts.html,
      });
      return { delivered: true };
    } catch (err: any) {
      console.error('[email] send failed:', err);
      return { delivered: false, reason: err.message || 'send failed' };
    }
  }

  async sendInvite(to: string, inviteUrl: string, inviterEmail: string | null, merchantName: string): Promise<SendResult> {
    const inviter = inviterEmail ? `${inviterEmail} ` : '';
    return this.send({
      to,
      subject: `You've been invited to ${merchantName} on NexusPay`,
      text: `${inviter}invited you to join ${merchantName} on NexusPay.

Accept the invitation by visiting:
${inviteUrl}

This link expires in 48 hours. If you weren't expecting this email, you can safely ignore it.`,
      html: `<p>${inviter}invited you to join <strong>${merchantName}</strong> on NexusPay.</p>
<p><a href="${inviteUrl}">Accept the invitation</a> — link expires in 48 hours.</p>`,
    });
  }

  async sendPasswordReset(to: string, resetUrl: string): Promise<SendResult> {
    return this.send({
      to,
      subject: 'Reset your NexusPay password',
      text: `We received a request to reset your NexusPay password.

Reset it here:
${resetUrl}

This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email — your password won't change.`,
      html: `<p>We received a request to reset your NexusPay password.</p>
<p><a href="${resetUrl}">Reset password</a> — link expires in 1 hour.</p>
<p>If you didn't request this, you can safely ignore this email.</p>`,
    });
  }
}

export const emailService = new EmailService();
