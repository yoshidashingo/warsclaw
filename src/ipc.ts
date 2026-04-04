import { readdirSync, readFileSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { IpcDeps } from './types.js';
import { IpcMessageSchema, IpcTaskSchema } from './types.js';
import { randomUUID } from 'node:crypto';

export class IpcWatcher {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: IpcDeps) {}

  start(intervalMs: number): void {
    this.ensureDirs();
    this.scheduleNext(intervalMs);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(intervalMs: number): void {
    this.timer = setTimeout(async () => {
      try {
        await this.processFiles();
      } catch (err) {
        this.deps.logger.error({}, `IPC processing error: ${(err as Error).message}`);
      }
      if (this.timer !== null) this.scheduleNext(intervalMs);
    }, intervalMs);
  }

  async processFiles(): Promise<void> {
    await this.processDir(join(this.deps.ipcDir, 'messages'), 'message');
    await this.processDir(join(this.deps.ipcDir, 'tasks'), 'task');
  }

  private async processDir(dir: string, type: 'message' | 'task'): Promise<void> {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));
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
          group_folder: task.group_folder,
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
      case 'register_group': {
        // NFR-01.4: Only main group can perform admin operations
        if (!this.isFromMainGroup(task)) {
          this.deps.logger.warn({ folder: task.folder }, 'Unauthorized register_group attempt — not from main group IPC');
          break;
        }
        this.deps.db.registerGroup({
          name: task.name,
          folder: task.folder,
          trigger: task.trigger,
          added_at: new Date().toISOString(),
          is_main: false,
          requires_trigger: true,
          timeout: 300,
        });
        mkdirSync(join(this.deps.groupsDir, task.folder), { recursive: true });
        this.deps.logger.info({ folder: task.folder }, 'Group registered via IPC');
        break;
      }
      case 'refresh_groups':
        // NFR-01.4: Only main group can perform admin operations
        if (!this.isFromMainGroup(task)) {
          this.deps.logger.warn({}, 'Unauthorized refresh_groups attempt — not from main group IPC');
          break;
        }
        this.deps.logger.info({}, 'Groups refresh requested via IPC');
        break;
    }
  }

  /** NFR-01.4: Admin IPC operations require origin from the main group */
  private isFromMainGroup(task: { source_group: string }): boolean {
    const groups = this.deps.db.getRegisteredGroups();
    const mainGroup = groups.find((g) => g.is_main);
    if (!mainGroup) return false;
    return task.source_group === mainGroup.folder;
  }

  private quarantine(filePath: string, fileName: string): void {
    const errDir = join(this.deps.ipcDir, 'errors');
    mkdirSync(errDir, { recursive: true });
    try {
      renameSync(filePath, join(errDir, fileName));
    } catch {
      try { unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  private ensureDirs(): void {
    for (const sub of ['messages', 'tasks', 'errors']) {
      mkdirSync(join(this.deps.ipcDir, sub), { recursive: true });
    }
  }
}
