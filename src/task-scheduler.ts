import { CronExpressionParser } from 'cron-parser';
import type { Database } from './db.js';
import type { GroupQueue } from './group-queue.js';
import type { Logger } from './logger.js';
import type { ScheduledTask } from './types.js';

export class TaskScheduler {
  constructor(
    private readonly db: Database,
    private readonly queue: GroupQueue,
    private readonly logger: Logger,
    private readonly timezone: string,
  ) {}

  checkDueTasks(): void {
    const tasks = this.db.getDueTasks();
    for (const task of tasks) {
      this.logger.info({ taskId: task.id, groupFolder: task.group_folder }, 'Executing due task');

      this.queue.enqueue({
        groupFolder: task.group_folder,
        input: {
          prompt: task.prompt,
          sessionId: '',
          groupFolder: task.group_folder,
          chatJid: task.chat_jid,
          isMain: false,
          isScheduledTask: true,
          assistantName: 'WarsClaw',
          script: task.script ?? undefined,
        },
        onComplete: async (output) => {
          const now = new Date().toISOString();
          this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'success', result: output.result.slice(0, 1000), error: null });
          this.db.updateTask(task.id, {
            last_run: now,
            last_result: output.result.slice(0, 1000),
            next_run: this.computeNextRun(task),
            status: task.schedule_type === 'once' ? 'completed' : 'active',
          });
        },
        onError: (error) => {
          const now = new Date().toISOString();
          this.db.logTaskRun({ task_id: task.id, started_at: now, finished_at: now, status: 'error', result: null, error: error.message.slice(0, 1000) });
          this.db.updateTask(task.id, { last_run: now, next_run: this.computeNextRun(task) });
        },
      });
    }
  }

  createTask(task: ScheduledTask): string {
    task.next_run = this.computeNextRun(task);
    this.db.createTask(task);
    this.logger.info({ taskId: task.id, type: task.schedule_type }, 'Task created');
    return task.id;
  }

  pauseTask(taskId: string): void {
    this.db.updateTask(taskId, { status: 'paused' });
    this.logger.info({ taskId }, 'Task paused');
  }

  resumeTask(taskId: string): void {
    this.db.updateTask(taskId, { status: 'active' });
    this.logger.info({ taskId }, 'Task resumed');
  }

  cancelTask(taskId: string): void {
    this.db.deleteTask(taskId);
    this.logger.info({ taskId }, 'Task cancelled');
  }

  updateTask(taskId: string, updates: Partial<ScheduledTask>): void {
    this.db.updateTask(taskId, updates);
    this.logger.info({ taskId }, 'Task updated');
  }

  computeNextRun(task: Pick<ScheduledTask, 'schedule_type' | 'schedule_value' | 'last_run'>): string | null {
    switch (task.schedule_type) {
      case 'cron': {
        const interval = CronExpressionParser.parse(task.schedule_value, { tz: this.timezone });
        return interval.next().toISOString();
      }
      case 'interval': {
        const ms = parseInt(task.schedule_value, 10);
        if (isNaN(ms) || ms < 60000) return null;
        const base = task.last_run ? new Date(task.last_run).getTime() : Date.now();
        return new Date(base + ms).toISOString();
      }
      case 'once': {
        if (task.last_run) return null; // Already executed
        return task.schedule_value; // ISO date string
      }
      default:
        return null;
    }
  }
}
