import type { ContainerRunner } from './container-runner.js';
import type { Logger } from './logger.js';
import type { QueueTask } from './types.js';

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
    this.queues.get(group)!.push(task);
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

  async shutdown(): Promise<void> {
    this.accepting = false;
    // Wait for active containers to finish
    while (this.activeCount > 0) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  private processNext(): void {
    if (this.activeCount >= this.maxConcurrent) return;

    // Find a group with pending tasks that doesn't have an active container
    for (const [group, queue] of this.queues) {
      if (queue.length === 0 || this.activeGroups.has(group)) continue;
      const task = queue.shift()!;
      this.activeGroups.add(group);
      this.activeCount++;
      this.executeWithRetry(task, 0);
      if (this.activeCount >= this.maxConcurrent) break;
    }
  }

  private async executeWithRetry(task: QueueTask, attempt: number): Promise<void> {
    const group = task.groupFolder;
    try {
      const output = await this.runner.run(task.input);
      await task.onComplete(output);
    } catch (err) {
      const error = err as Error;
      if (attempt < this.maxRetries) {
        const backoff = getBackoffMs(attempt + 1);
        this.logger.warn({ groupFolder: group, attempt: attempt + 1, backoffMs: backoff }, `Container failed, retrying: ${error.message}`);
        await new Promise((r) => setTimeout(r, backoff));
        await this.executeWithRetry(task, attempt + 1);
        return;
      }
      this.logger.error({ groupFolder: group, attempts: attempt + 1 }, `Container failed after max retries: ${error.message}`);
      task.onError(error);
    } finally {
      this.activeGroups.delete(group);
      this.activeCount--;
      this.processNext();
    }
  }
}

export { getBackoffMs };
