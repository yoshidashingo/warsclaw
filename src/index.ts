import { mkdirSync, chmodSync } from 'node:fs';
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
import { TrustScorer } from './trust-scorer.js';
import { TaskLifecycleManager } from './task-lifecycle.js';
import { SlackInteraction } from './channels/slack-interaction.js';
import type { SlackChannel } from './channels/slack.js';
import type { NewMessage, RegisteredGroup } from './types.js';

async function main(): Promise<void> {
  // 1. Initialize core
  const config = Config.fromEnv();
  const logLevel = (['debug', 'info', 'warn', 'error'].includes(config.logLevel) ? config.logLevel : 'info') as 'debug' | 'info' | 'warn' | 'error';
  const logger = new Logger(logLevel);
  logger.info({}, `WarsClaw starting (polling=${config.pollingInterval}ms, maxContainers=${config.maxConcurrentContainers})`);

  // Ensure directories
  for (const dir of [config.dataDir, config.groupsDir, config.ipcDir]) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const db = new Database(config.dbPath);
  db.init();
  try { chmodSync(config.dbPath, 0o600); } catch { /* first run */ }

  // 2. Initialize components
  const registry = new ChannelRegistry();
  registry.register('discord', createDiscordChannel);
  registry.register('slack', createSlackChannel);

  const router = new Router(registry, db);
  const runner = new ContainerRunner(config, logger);
  const queue = new GroupQueue(runner, logger, config.maxConcurrentContainers, config.maxRetries);
  const scheduler = new TaskScheduler(db, queue, logger, config.timezone);
  const ipcWatcher = new IpcWatcher({ db, router, scheduler, logger, ipcDir: config.ipcDir, groupsDir: config.groupsDir });

  const skillLoader = new SkillLoader('./skills', logger);
  skillLoader.loadAll();

  // 2b. Initialize lifecycle components
  registry.initialize({ config, db, logger });

  const trustScorer = new TrustScorer();
  const slackChannel = registry.getAll().find((c) => c.name === 'slack') as SlackChannel | undefined;
  let lifecycleManager: TaskLifecycleManager | null = null;

  if (slackChannel) {
    const slackInteraction = new SlackInteraction(slackChannel.getApp(), logger);
    lifecycleManager = new TaskLifecycleManager(db, queue, slackInteraction, trustScorer, logger, {
      slackBotToken: config.slackBotToken!,
      approvalTimeoutMs: 3600000,
      feedbackTimeoutMs: 86400000,
    });
    scheduler.setLifecycleManager(lifecycleManager);

    slackInteraction.registerHandlers({
      onApprove: (runId, userId) => lifecycleManager!.handleApproval(runId, userId),
      onReject: (runId, userId, reason) => lifecycleManager!.handleRejection(runId, userId, reason),
      onRevise: (runId, userId, instruction) => lifecycleManager!.handleRevisionRequest(runId, userId, instruction),
      onFeedbackScore: (runId, score) => lifecycleManager!.handleFeedback(runId, score),
      onFeedbackComment: (runId, comment) => lifecycleManager!.handleFeedback(runId, 0, comment),
    });

    logger.info({}, 'Task lifecycle manager initialized with Slack interaction');
  }

  // 3. Connect channels
  await registry.connectAll();

  // 3b. Recover pending lifecycle runs from previous session
  if (lifecycleManager) {
    await lifecycleManager.recoverPendingRuns();
  }

  // 4. Bootstrap main group if none exist
  let groups = db.getRegisteredGroups();
  if (groups.length === 0) {
    logger.info({}, 'No groups found, bootstrapping main group');
    db.registerGroup({
      name: 'main',
      folder: 'main',
      trigger: config.assistantName,
      added_at: new Date().toISOString(),
      is_main: true,
      requires_trigger: false,
      timeout: 300,
      workspace_dir: null,
    });
  }

  // 5. Bootstrap autonomous loop tasks (if first run)
  if (db.getAllTasks().length === 0) {
    logger.info({}, 'No tasks found, bootstrapping autonomous loop');
    groups = db.getRegisteredGroups();
    const mainGroup = groups.find((g) => g.is_main);
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
          trust_score: 0,
          consecutive_successes: 0,
          total_positive_feedback: 0,
          total_runs: 0,
          approval_mode: 'required',
          approval_mode_locked: false,
        });
        logger.info({ task: t.name }, 'Autonomous task registered');
      }
    }
  }

  // 6. Set up message handling with rate limiting
  const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
  const RATE_LIMIT_MAX = 10; // max messages per window per channel
  const rateLimitMap = new Map<string, number[]>();

  function isRateLimited(chatJid: string): boolean {
    const now = Date.now();
    const timestamps = rateLimitMap.get(chatJid) ?? [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX) {
      rateLimitMap.set(chatJid, recent);
      return true;
    }
    recent.push(now);
    rateLimitMap.set(chatJid, recent);
    return false;
  }

  groups = db.getRegisteredGroups();
  for (const channel of registry.getAll()) {
    channel.onInboundMessage((msg: NewMessage) => {
      logger.debug({ chatJid: msg.chat_jid, sender: msg.sender, is_from_me: msg.is_from_me, is_dm: msg.is_dm }, `Inbound message: ${msg.content.slice(0, 80)}`);
      db.storeMessage(msg);

      // Find matching group — DMs always route to main group without trigger
      const group = groups.find((g) => {
        if (!channel.ownsJid(msg.chat_jid)) return false;
        if (msg.is_dm) return g.is_main;
        if (g.requires_trigger && !msg.content.includes(g.trigger)) return false;
        return true;
      });

      logger.debug({ group: group?.folder, is_from_me: msg.is_from_me, groupCount: groups.length }, 'Group match result');

      if (!group || msg.is_from_me) return;

      // Rate limit: prevent message flooding per channel
      if (isRateLimited(msg.chat_jid)) {
        logger.warn({ chatJid: msg.chat_jid }, 'Rate limited — too many messages in window');
        return;
      }

      logger.info({ groupFolder: group.folder, chatJid: msg.chat_jid }, 'Enqueuing message for processing');

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
          timeout: group.timeout,
          workspaceDir: group.workspace_dir ?? undefined,
        },
        onComplete: async (output) => {
          if (output.newSessionId) db.saveSession(group.folder, output.newSessionId);
          if (output.result) await router.routeOutbound(msg.chat_jid, output.result);
          router.updateCursor(msg.chat_jid, msg.timestamp);
        },
        onError: (error) => {
          logger.error({ groupFolder: group.folder, chatJid: msg.chat_jid }, `Processing failed: ${error.message}`);
          router.routeOutbound(msg.chat_jid, '処理中にエラーが発生しました。しばらく経ってから再度お試しください。').catch(() => {});
        },
      });
    });
  }

  // 7. Start IPC watcher
  ipcWatcher.start(config.ipcPollingInterval);

  // 8. Main polling loop — autonomous loop runs forever
  let running = true;
  let lastPrune = 0;
  const PRUNE_INTERVAL = 24 * 60 * 60 * 1000; // daily

  const pollLoop = async (): Promise<void> => {
    while (running) {
      try {
        scheduler.checkDueTasks();
        // Refresh groups for dynamic registration
        groups = db.getRegisteredGroups();
      } catch (err) {
        logger.error({}, `Task check failed: ${(err as Error).message}`);
      }
      // Daily message pruning
      const now = Date.now();
      if (now - lastPrune > PRUNE_INTERVAL) {
        db.pruneOldMessages();
        lastPrune = now;
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
    if (lifecycleManager) lifecycleManager.shutdown();
    ipcWatcher.stop();
    await queue.shutdown();
    await registry.disconnectAll();
    db.close();
    logger.info({}, 'Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.info({}, 'WarsClaw is running');
  await pollLoop();
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
