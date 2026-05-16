import { retryService } from '../services/retry.service';
import { healthMonitorService } from '../services/health-monitor.service';
import db from '../db/connection';

class SchedulerService {
  private intervalId: NodeJS.Timeout | null = null;
  private healthCheckIntervalId: NodeJS.Timeout | null = null;

  /**
   * Start the scheduler
   */
  start(intervalMs: number = 60000): void {
    console.log('Starting scheduler...');

    // Retry executor
    this.intervalId = setInterval(async () => {
      try {
        const result = await retryService.executeRetries();
        if (result.processed > 0) {
          console.log(`Retry execution: ${result.processed} processed, ${result.succeeded} succeeded, ${result.failed} failed`);
        }
      } catch (err) {
        console.error('Retry execution error:', err);
      }
    }, intervalMs);

    // Health check
    this.healthCheckIntervalId = setInterval(async () => {
      try {
        const merchants = await db('merchants').where({ status: 'ACTIVE' });
        for (const merchant of merchants) {
          const alerts = await healthMonitorService.checkHealth(merchant.id);
          if (alerts.length > 0) {
            console.log(`Health alerts for merchant ${merchant.id}: ${alerts.length}`);
          }
        }
      } catch (err) {
        console.error('Health check error:', err);
      }
    }, intervalMs * 5); // Check every 5 minutes

    console.log('Scheduler started');
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
      this.healthCheckIntervalId = null;
    }
    console.log('Scheduler stopped');
  }
}

export const schedulerService = new SchedulerService();
