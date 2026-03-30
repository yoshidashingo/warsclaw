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

  // 4. Set up message handling
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

  // 5. Start IPC watcher
  ipcWatcher.start(config.ipcPollingInterval);

  // 6. Main polling loop for scheduled tasks
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

  // 7. Graceful shutdown
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
