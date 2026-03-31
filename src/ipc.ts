import { readdirSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcDeps } from './types.js';
import { IpcMessageSchema, IpcTaskSchema } from './types.js';
import { randomUUID } from 'node:crypto';

export class IpcWatcher {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: IpcDeps) {}

  start(intervalMs: number): void {
    this.ensureDirs();
    this.timer = setInterval(() => this.processFiles(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async processFiles(): Promise<void> {
    await this.processDir(join(this.deps.ipcDir, 'messages'), 'message');
    await this.processDir(join(this.deps.ipcDir, 'tasks'), 'task');
  }

  private async processDir(dir: string, type: 'message' | 'task'): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      this.deps.logger.error({ dir, type }, `Failed to read IPC dir: ${(err as Error).message}`);
      return;
    }

    await Promise.allSettled(files.map((file) => this.processFile(join(dir, file), file, type)));
  }

  private async processFile(filePath: string, fileName: string, type: 'message' | 'task'): Promise<void> {
    try {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      if (type === 'message') {
        await this.handleMessage(raw);
      } else {
        await this.handleTask(raw);
      }
      unlinkSync(filePath);
    } catch (err) {
      this.deps.logger.error({ file: fileName, type }, `IPC processing failed: ${(err as Error).message}`);
      this.quarantine(filePath, fileName);
    }
  }

  private async handleMessage(raw: unknown): Promise<void> {
    const msg = IpcMessageSchema.parse(raw);
    await this.deps.router.routeOutbound(msg.chatJid, msg.text);
  }

  private async handleTask(raw: unknown): Promise<void> {
    const task = IpcTaskSchema.parse(raw);

    switch (task.type) {
      case 'schedule_task':
        this.deps.scheduler.createTask({
          id: randomUUID(),
          group_folder: '', // set by caller context
          chat_jid: task.targetJid,
          prompt: task.prompt,
          script: task.script ?? null,
          schedule_type: task.schedule_type,
          schedule_value: task.schedule_value,
          context_mode: task.context_mode,
          next_run: null,
          last_run: null,
          last_result: null,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        break;
      case 'pause_task':
        this.deps.scheduler.pauseTask(task.taskId);
        break;
      case 'resume_task':
        this.deps.scheduler.resumeTask(task.taskId);
        break;
      case 'cancel_task':
        this.deps.scheduler.cancelTask(task.taskId);
        break;
      case 'update_task': {
        const { taskId, type: _, ...updates } = task;
        this.deps.scheduler.updateTask(taskId, updates);
        break;
      }
      case 'register_group':
      case 'refresh_groups':
        this.deps.logger.info({ type: task.type }, 'Group management IPC received');
        break;
    }
  }

  private quarantine(filePath: string, fileName: string): void {
    const errDir = join(this.deps.ipcDir, 'errors');
    mkdirSync(errDir, { recursive: true });
    try {
      renameSync(filePath, join(errDir, fileName));
    } catch {
      // If rename fails, just try to remove the file
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  private ensureDirs(): void {
    for (const sub of ['messages', 'tasks', 'errors']) {
      mkdirSync(join(this.deps.ipcDir, sub), { recursive: true });
    }
  }
}
