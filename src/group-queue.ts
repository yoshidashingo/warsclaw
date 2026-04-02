import type { ContainerRunner } from './container-runner.js';
import type { Logger } from './logger.js';
import type { QueueTask } from './types.js';

const MAX_QUEUE_DEPTH = 20;

function getBackoffMs(retryCount: number): number {
  return 5000 * Math.pow(2, retryCount - 1);
}

export class GroupQueue {
  private readonly queues = new Map<string, QueueTask[]>();
  private readonly activeGroups = new Set<string>();
  private activeCount = 0;
  private accepting = true;

  constructor(
    private readonly runner: ContainerRunner,
    private readonly logger: Logger,
    private readonly maxConcurrent: number = 5,
    private readonly maxRetries: number = 5,
  ) {}

  enqueue(task: QueueTask): void {
    if (!this.accepting) return;
    const group = task.groupFolder;
    if (!this.queues.has(group)) this.queues.set(group, []);
    const queue = this.queues.get(group)!;
    if (queue.length >= MAX_QUEUE_DEPTH) {
      task.onError(new Error(`Queue full for group ${group} (max=${MAX_QUEUE_DEPTH})`));
      return;
    }
    queue.push(task);
    this.processNext();
  }

  getQueueLength(group: string): number {
    return this.queues.get(group)?.length ?? 0;
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  getTotalQueued(): number {
    let total = 0;
    for (const q of this.queues.values()) total += q.length;
    return total;
  }

  async shutdown(timeoutMs = 30_000): Promise<void> {
    this.accepting = false;
    const dropped = this.getTotalQueued();
    if (dropped > 0) {
      this.logger.warn({}, `Shutdown: dropping ${dropped} queued task(s)`);
    }
    const deadline = Date.now() + timeoutMs;
    while (this.activeCount > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
    }
    if (this.activeCount > 0) {
      this.logger.warn({}, `Shutdown timeout: force-killing ${this.activeCount} active container(s)`);
      for (const group of this.activeGroups) {
        this.runner.killGroup(group);
      }
    }
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;
    for (const [group, queue] of this.queues) {
      if (queue.length === 0 || this.activeGroups.has(group)) continue;
      const task = queue.shift()!;
      this.activeGroups.add(group);
      this.activeCount++;
      this.executeWithRetry(task);
      if (this.activeCount >= this.maxConcurrent) break;
    }
  }

  private async executeWithRetry(task: QueueTask): Promise<void> {
    const group = task.groupFolder;
    try {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const output = await this.runner.run(task.input);
          try {
            await task.onComplete(output);
          } catch (cbErr) {
            this.logger.error({ groupFolder: group }, `onComplete callback failed: ${(cbErr as Error).message}`);
          }
          return;
        } catch (err) {
          if (attempt >= this.maxRetries) {
            this.logger.error({ groupFolder: group, attempts: attempt + 1 }, `Container failed after max retries: ${(err as Error).message}`);
            task.onError(err as Error);
            return;
          }
          const backoff = getBackoffMs(attempt + 1);
          this.logger.warn({ groupFolder: group, attempt: attempt + 1, backoffMs: backoff }, `Container failed, retrying: ${(err as Error).message}`);
          await new Promise((r) => setTimeout(r, backoff));
        }
      }
    } finally {
      this.activeGroups.delete(group);
      this.activeCount--;
      this.processNext();
    }
  }
}

export { getBackoffMs };
