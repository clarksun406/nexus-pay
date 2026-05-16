import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { requestLogger } from './middleware/logging';

// Routes
import authRoutes from './routes/auth.routes';
import paymentIntentRoutes from './routes/payment-intent.routes';
import merchantRoutes from './routes/merchant.routes';
import publicRoutes from './routes/public.routes';
import meRoutes from './routes/me.routes';
import retryRoutes from './routes/retry.routes';
import healthRoutes from './routes/health.routes';
import reconciliationRoutes from './routes/reconciliation.routes';
import threedsRoutes from './routes/threeds.routes';

const app = express();

// Middleware
app.use(helmet());
app.use(cors({ origin: config.cors.origins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('short'));
app.use(requestLogger);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Prometheus metrics stub
app.get('/actuator/prometheus', (_req, res) => {
  res.type('text/plain').send('# Metrics endpoint\n');
});

// API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/payment-intents', paymentIntentRoutes);
app.use('/api/v1/merchants', merchantRoutes);
app.use('/api/v1/me', meRoutes);
app.use('/api/v1', retryRoutes);
app.use('/api/v1', healthRoutes);
app.use('/api/v1', reconciliationRoutes);
app.use('/api/v1', threedsRoutes);

// Public routes
app.use('/pub', publicRoutes);

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ title: 'Not Found', detail: 'The requested resource was not found' });
});

// Error handler
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(err.status || 500).json({
    title: 'Internal Server Error',
    detail: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred' : err.message,
  });
});

// Start server
app.listen(config.port, () => {
  console.log(`NexusPay backend running on port ${config.port}`);
  console.log(`Health: http://localhost:${config.port}/health`);
});

export default app;
