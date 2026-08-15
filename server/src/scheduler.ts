import dotenv from 'dotenv';
import { processDueFollowUps, processMeetingReminders, runSchedulerOnce } from './services/agentEngine';

dotenv.config();

let intervalHandle: NodeJS.Timeout | null = null;

const INTERVAL_MS = Number(process.env.SCHEDULER_INTERVAL_MS || 30000);

// Durable background worker: executes due follow-ups (Email #2) and sends
// 30-minute meeting reminders with briefings. Uses server-side scheduling, not
// frontend timers.
export function startScheduler() {
  if (process.env.SCHEDULER_ENABLED === 'false') {
    console.log('⏰ Scheduler disabled via SCHEDULER_ENABLED=false');
    return;
  }
  if (intervalHandle) return;

  console.log(`⏰ Scheduler started (interval ${INTERVAL_MS}ms)`);
  intervalHandle = setInterval(async () => {
    try {
      const result = await runSchedulerOnce();
      if (result.followUpsExecuted || result.remindersSent) {
        console.log(`⏰ Scheduler run: ${JSON.stringify(result)}`);
      }
    } catch (err) {
      console.error('⏰ Scheduler run failed:', err);
    }
  }, INTERVAL_MS);
}

export function stopScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

export { processDueFollowUps, processMeetingReminders, runSchedulerOnce };
