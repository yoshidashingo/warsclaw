import { mkdirSync } from 'node:fs';
import { Config } from './config.js';
import { Logger } from './logger.js';
import { Database } from './db.js';
import { ChannelRegistry } from './channels/registry.js';
import { createDiscordChannel } from './channels/discord.js';
import { createSlackChannel } from './channels/slack.js';
import { Router } from './router.js';
import { ContainerRunner } from './container-runner.js';
import { GroupQueue } from './group-queue.js';
import { TaskScheduler } from './task-scheduler.js';
import { IpcWatcher } from './ipc.js';
import { SkillLoader } from './skills/loader.js';
import { randomUUID } from 'node:crypto';
import type { NewMessage, RegisteredGroup } from './types.js';

async function main(): Promise<void> {
  // 1. Initialize core
  const config = Config.fromEnv();
  const logger = new Logger(config.logLevel as any);
  logger.info({}, `MyClaw starting (polling=${config.pollingInterval}ms, maxContainers=${config.maxConcurrentContainers})`);

  // Ensure directories
  for (const dir of [config.dataDir, config.groupsDir, config.ipcDir]) {
    mkdirSync(dir, { recursive: true });
  }

  const db = new Database(config.dbPath);
  db.init();

  // 2. Initialize components
  const registry = new ChannelRegistry();
  registry.register('discord', createDiscordChannel);
  registry.register('slack', createSlackChannel);

  const router = new Router(registry, db);
  const runner = new ContainerRunner(config, logger);
  const queue = new GroupQueue(runner, logger, config.maxConcurrentContainers, config.maxRetries);
  const scheduler = new TaskScheduler(db, queue, logger, config.timezone);
  const ipcWatcher = new IpcWatcher({ db, router, scheduler, logger, ipcDir: config.ipcDir });

  const skillLoader = new SkillLoader('./skills', logger);
  skillLoader.loadAll();

  // 3. Connect channels
  registry.initialize({ config, db, logger });
  await registry.connectAll();

  // 4. Bootstrap main group if none exist
  if (db.getRegisteredGroups().length === 0) {
    logger.info({}, 'No groups found, bootstrapping main group');
    db.registerGroup({
      name: 'main',
      folder: 'main',
      trigger: config.assistantName,
      added_at: new Date().toISOString(),
      is_main: true,
      requires_trigger: false,
      timeout: 300,
    });
  }

  // 5. Bootstrap autonomous loop tasks (if first run)
  if (db.getAllTasks().length === 0) {
    logger.info({}, 'No tasks found, bootstrapping autonomous loop');
    const mainGroup = db.getRegisteredGroups().find((g) => g.is_main);
    if (mainGroup) {
      const baseTasks = [
        { prompt: 'playbook.mdを確認し、今日実行すべきルールを確認してください。中断した作業があれば継続してください。状況をSlackに報告してください。', schedule_value: '0 9 * * 1-5', name: '朝のオペレーション開始' },
        { prompt: '今日の行動ログ(action-log.md)を振り返り、retrospective.mdにKeep/Problem/Tryを記録してください。playbook.mdの更新が必要か検討し、改善提案があればSlackに共有してください。', schedule_value: '0 18 * * 1-5', name: '日次振り返り' },
        { prompt: '今週のaction-log.mdとretrospective.mdを分析し、weekly-summary.mdを作成してください。パターンや傾向を特定し、playbook.mdの改善提案をSlackに投稿してください。', schedule_value: '0 17 * * 5', name: '週次まとめ' },
        { prompt: 'playbook.mdの全ルールを棚卸ししてください。形骸化したルール、矛盾するルール、不足しているルールを特定し、更新案をSlackに提案してください。', schedule_value: '0 10 * * 1', name: '週次playbook見直し' },
      ];
      for (const t of baseTasks) {
        scheduler.createTask({
          id: randomUUID(),
          group_folder: mainGroup.folder,
          chat_jid: '',  // Will use first available channel
          prompt: t.prompt,
          script: null,
          schedule_type: 'cron',
          schedule_value: t.schedule_value,
          context_mode: 'group',
          next_run: null,
          last_run: null,
          last_result: null,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info({ task: t.name }, 'Autonomous task registered');
      }
    }
  }

  // 6. Set up message handling
  //    MyClaw monitors Slack continuously — every message triggers agent processing
  const groups = db.getRegisteredGroups();
  const groupMap = new Map<string, RegisteredGroup>(groups.map((g) => [g.folder, g]));

  for (const channel of registry.getAll()) {
    channel.onInboundMessage((msg: NewMessage) => {
      db.storeMessage(msg);

      // Find matching group
      const group = groups.find((g) => {
        if (!channel.ownsJid(msg.chat_jid)) return false;
        // Check trigger
        if (g.requires_trigger && !msg.content.includes(g.trigger)) return false;
        return true;
      });

      if (!group || msg.is_from_me) return;

      // Get context messages
      const cursor = router.getCursor(msg.chat_jid);
      const contextMessages = db.getNewMessages(msg.chat_jid, cursor);
      const formattedContext = router.formatMessages(contextMessages, group.is_main, group.is_main ? groups : undefined);

      const sessionId = db.getSession(group.folder) ?? '';

      queue.enqueue({
        groupFolder: group.folder,
        input: {
          prompt: formattedContext,
          sessionId,
          groupFolder: group.folder,
          chatJid: msg.chat_jid,
          isMain: group.is_main,
          isScheduledTask: false,
          assistantName: config.assistantName,
        },
        onComplete: async (output) => {
          if (output.newSessionId) db.saveSession(group.folder, output.newSessionId);
          if (output.result) await router.routeOutbound(msg.chat_jid, output.result);
          router.updateCursor(msg.chat_jid, msg.timestamp);
        },
        onError: (error) => {
          logger.error({ groupFolder: group.folder, chatJid: msg.chat_jid }, `Processing failed: ${error.message}`);
          router.routeOutbound(msg.chat_jid, `Error: ${error.message}`).catch(() => {});
        },
      });
    });
  }

  // 7. Start IPC watcher
  ipcWatcher.start(config.ipcPollingInterval);

  // 8. Main polling loop — autonomous loop runs forever
  let running = true;
  const pollLoop = async (): Promise<void> => {
    while (running) {
      try {
        scheduler.checkDueTasks();
      } catch (err) {
        logger.error({}, `Task check failed: ${(err as Error).message}`);
      }
      await new Promise((r) => setTimeout(r, config.pollingInterval));
    }
  };

  // 9. Graceful shutdown
  let shutdownCount = 0;
  const shutdown = async (): Promise<void> => {
    shutdownCount++;
    if (shutdownCount > 1) {
      logger.warn({}, 'Forced shutdown');
      process.exit(1);
    }
    logger.info({}, 'Shutting down gracefully...');
    running = false;
    ipcWatcher.stop();
    await queue.shutdown();
    await registry.disconnectAll();
    db.close();
    logger.info({}, 'Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info({}, 'MyClaw is running');
  await pollLoop();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
