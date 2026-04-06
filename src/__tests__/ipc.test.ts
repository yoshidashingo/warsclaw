import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { IpcWatcher } from '../ipc.js';
import type { IpcDeps } from '../types.js';

function makeTmpDir(): string {
  const dir = join(tmpdir(), `ipc-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createMockDeps(ipcDir: string): IpcDeps {
  return {
    db: {
      getRegisteredGroups: vi.fn().mockReturnValue([
        { name: 'main', folder: 'main', trigger: 'warsclaw', is_main: true, requires_trigger: false, timeout: 300, workspace_dir: null, added_at: '' },
      ]),
      registerGroup: vi.fn(),
      getTaskGroupFolder: vi.fn().mockReturnValue('main'),
    } as unknown as IpcDeps['db'],
    router: {
      routeOutbound: vi.fn().mockResolvedValue(undefined),
    } as unknown as IpcDeps['router'],
    scheduler: {
      createTask: vi.fn(),
      pauseTask: vi.fn(),
      resumeTask: vi.fn(),
      cancelTask: vi.fn(),
      updateTask: vi.fn(),
    } as unknown as IpcDeps['scheduler'],
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as IpcDeps['logger'],
    ipcDir,
    groupsDir: join(ipcDir, 'groups'),
  };
}

describe('IpcWatcher', () => {
  let ipcDir: string;
  let deps: IpcDeps;
  let watcher: IpcWatcher;

  beforeEach(() => {
    ipcDir = makeTmpDir();
    deps = createMockDeps(ipcDir);
    watcher = new IpcWatcher(deps);
  });

  afterEach(() => {
    watcher.stop();
  });

  describe('ensureDirs (via start/processFiles)', () => {
    it('creates messages, tasks, errors subdirectories', async () => {
      // processFiles triggers ensureDirs indirectly via start
      watcher.start(999999); // large interval so it doesn't re-trigger
      const dirs = readdirSync(ipcDir);
      expect(dirs).toContain('messages');
      expect(dirs).toContain('tasks');
      expect(dirs).toContain('errors');
    });
  });

  describe('processFiles — messages', () => {
    it('routes a valid IPC message and deletes the file', async () => {
      mkdirSync(join(ipcDir, 'messages'), { recursive: true });
      mkdirSync(join(ipcDir, 'tasks'), { recursive: true });
      const msgFile = join(ipcDir, 'messages', 'msg1.json');
      writeFileSync(msgFile, JSON.stringify({ type: 'message', chatJid: 'slack_C123', text: 'hello' }));

      await watcher.processFiles();

      expect(deps.router.routeOutbound).toHaveBeenCalledWith('slack_C123', 'hello');
      // File should be deleted after processing
      expect(readdirSync(join(ipcDir, 'messages'))).toHaveLength(0);
    });

    it('quarantines invalid message files', async () => {
      mkdirSync(join(ipcDir, 'messages'), { recursive: true });
      mkdirSync(join(ipcDir, 'tasks'), { recursive: true });
      mkdirSync(join(ipcDir, 'errors'), { recursive: true });
      const msgFile = join(ipcDir, 'messages', 'bad.json');
      writeFileSync(msgFile, JSON.stringify({ type: 'message' })); // missing required fields

      await watcher.processFiles();

      expect(deps.router.routeOutbound).not.toHaveBeenCalled();
      expect(readdirSync(join(ipcDir, 'messages'))).toHaveLength(0);
      expect(readdirSync(join(ipcDir, 'errors'))).toHaveLength(1);
    });

    it('ignores non-json files', async () => {
      mkdirSync(join(ipcDir, 'messages'), { recursive: true });
      mkdirSync(join(ipcDir, 'tasks'), { recursive: true });
      writeFileSync(join(ipcDir, 'messages', 'readme.txt'), 'not json');

      await watcher.processFiles();

      expect(deps.router.routeOutbound).not.toHaveBeenCalled();
    });
  });

  describe('processFiles — tasks', () => {
    beforeEach(() => {
      mkdirSync(join(ipcDir, 'messages'), { recursive: true });
      mkdirSync(join(ipcDir, 'tasks'), { recursive: true });
    });

    it('handles schedule_task', async () => {
      const task = {
        type: 'schedule_task',
        source_group: 'main',
        prompt: 'run daily check',
        schedule_type: 'cron',
        schedule_value: '0 9 * * *',
        targetJid: 'slack_C123',
        group_folder: 'test-group',
        context_mode: 'group',
      };
      writeFileSync(join(ipcDir, 'tasks', 'task1.json'), JSON.stringify(task));

      await watcher.processFiles();

      expect(deps.scheduler.createTask).toHaveBeenCalledTimes(1);
      const created = (deps.scheduler.createTask as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(created.prompt).toBe('run daily check');
      expect(created.schedule_type).toBe('cron');
      expect(created.group_folder).toBe('test-group');
    });

    it('handles pause_task from main group', async () => {
      writeFileSync(
        join(ipcDir, 'tasks', 'pause.json'),
        JSON.stringify({ type: 'pause_task', taskId: 'task-123', source_group: 'main' }),
      );

      await watcher.processFiles();

      expect(deps.scheduler.pauseTask).toHaveBeenCalledWith('task-123');
    });

    it('blocks pause_task from non-owning non-main group', async () => {
      (deps.db.getTaskGroupFolder as ReturnType<typeof vi.fn>).mockReturnValue('other-group');

      writeFileSync(
        join(ipcDir, 'tasks', 'pause.json'),
        JSON.stringify({ type: 'pause_task', taskId: 'task-123', source_group: 'attacker' }),
      );

      await watcher.processFiles();

      expect(deps.scheduler.pauseTask).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalled();
    });

    it('handles register_group only from main group', async () => {
      mkdirSync(join(ipcDir, 'groups'), { recursive: true });
      writeFileSync(
        join(ipcDir, 'tasks', 'reg.json'),
        JSON.stringify({
          type: 'register_group',
          jid: 'slack_C456',
          name: 'new-team',
          folder: 'new-team',
          trigger: '@newteam',
          source_group: 'main',
        }),
      );

      await watcher.processFiles();

      expect(deps.db.registerGroup).toHaveBeenCalledTimes(1);
    });

    it('blocks register_group from non-main group', async () => {
      writeFileSync(
        join(ipcDir, 'tasks', 'reg.json'),
        JSON.stringify({
          type: 'register_group',
          jid: 'slack_C456',
          name: 'evil-team',
          folder: 'evil-team',
          trigger: '@evil',
          source_group: 'not-main',
        }),
      );

      await watcher.processFiles();

      expect(deps.db.registerGroup).not.toHaveBeenCalled();
      expect(deps.logger.warn).toHaveBeenCalled();
    });
  });

  describe('start/stop lifecycle', () => {
    it('can start and stop without errors', () => {
      watcher.start(100);
      watcher.stop();
      // Double stop should be safe
      watcher.stop();
    });

    it('handles missing ipcDir gracefully', async () => {
      const missingDir = join(tmpdir(), `nonexistent-${randomUUID()}`);
      const missingDeps = createMockDeps(missingDir);
      const w = new IpcWatcher(missingDeps);

      // processFiles should not throw when directories don't exist
      await w.processFiles();

      expect(missingDeps.logger.error).not.toHaveBeenCalled();
    });
  });
});
