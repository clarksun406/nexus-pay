import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'nexuspay',
    user: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'change-me-in-production-must-be-at-least-256-bits-long-secret-key',
    accessTokenExpiryMs: parseInt(process.env.ACCESS_TOKEN_EXPIRY_MS || '86400000'), // 24h
    refreshTokenExpiryMs: parseInt(process.env.REFRESH_TOKEN_EXPIRY_MS || '604800000'), // 7d
  },
  invite: {
    tokenExpiryMs: parseInt(process.env.INVITE_TOKEN_EXPIRY_MS || '172800000'), // 48h
    baseUrl: process.env.APP_BASE_URL || 'http://localhost:3001',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || '',
  },
  cors: {
    origins: (process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:5173').split(','),
  },
  payBaseUrl: process.env.PAY_BASE_URL || 'http://localhost:5173',
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  },
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587'),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'NexusPay <no-reply@nexuspay.local>',
  },
  passwordReset: {
    tokenExpiryMs: parseInt(process.env.PASSWORD_RESET_TOKEN_EXPIRY_MS || '3600000'), // 1h
  },
  logs: {
    retentionPeriods: parseInt(process.env.LOG_RETENTION_PERIODS || '4'),
  },
};
