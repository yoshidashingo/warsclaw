import BetterSqlite3 from 'better-sqlite3';
import type { NewMessage, ScheduledTask, TaskRunLog, RegisteredGroup } from './types.js';

export class Database {
  private readonly db: BetterSqlite3.Database;

  constructor(dbPath: string) {
    this.db = new BetterSqlite3(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        chat_jid TEXT NOT NULL,
        sender TEXT NOT NULL,
        sender_name TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        is_from_me INTEGER NOT NULL DEFAULT 0,
        is_bot_message INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_messages_jid_ts ON messages(chat_jid, timestamp);

      CREATE TABLE IF NOT EXISTS chat_metadata (
        jid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        metadata_json TEXT,
        last_activity INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_chat_activity ON chat_metadata(last_activity);

      CREATE TABLE IF NOT EXISTS registered_groups (
        name TEXT PRIMARY KEY,
        folder TEXT UNIQUE NOT NULL,
        trigger_word TEXT NOT NULL,
        added_at TEXT NOT NULL,
        is_main INTEGER NOT NULL DEFAULT 0,
        requires_trigger INTEGER NOT NULL DEFAULT 1,
        timeout INTEGER NOT NULL DEFAULT 300
      );

      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        group_folder TEXT NOT NULL,
        chat_jid TEXT NOT NULL,
        prompt TEXT NOT NULL,
        script TEXT,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('cron','interval','once')),
        schedule_value TEXT NOT NULL,
        context_mode TEXT NOT NULL DEFAULT 'group',
        next_run TEXT,
        last_run TEXT,
        last_result TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed')),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_due ON scheduled_tasks(next_run, status);

      CREATE TABLE IF NOT EXISTS task_run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS sessions (
        group_folder TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS router_state (
        chat_jid TEXT PRIMARY KEY,
        last_processed_timestamp INTEGER NOT NULL
      );
    `);
  }

  // --- Messages ---
  storeMessage(msg: NewMessage): void {
    this.db.prepare(`INSERT OR IGNORE INTO messages (id, chat_jid, sender, sender_name, content, timestamp, is_from_me, is_bot_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(msg.id, msg.chat_jid, msg.sender, msg.sender_name, msg.content, msg.timestamp, msg.is_from_me ? 1 : 0, msg.is_bot_message ? 1 : 0);
  }

  getNewMessages(chatJid: string, since: number, limit = 50): NewMessage[] {
    return this.db.prepare(`SELECT id, chat_jid, sender, sender_name, content, timestamp,
      is_from_me as is_from_me, is_bot_message as is_bot_message
      FROM messages WHERE chat_jid = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT ?`)
      .all(chatJid, since, limit)
      .map((r: any) => ({ ...r, is_from_me: !!r.is_from_me, is_bot_message: !!r.is_bot_message })) as NewMessage[];
  }

  getLastBotMessageTimestamp(chatJid: string): number | null {
    const row = this.db.prepare(`SELECT MAX(timestamp) as ts FROM messages WHERE chat_jid = ? AND is_bot_message = 1`).get(chatJid) as any;
    return row?.ts ?? null;
  }

  // --- Chat Metadata ---
  storeChatMetadata(jid: string, name: string, metadata: unknown): void {
    this.db.prepare(`INSERT OR REPLACE INTO chat_metadata (jid, name, metadata_json, last_activity) VALUES (?, ?, ?, ?)`)
      .run(jid, name, JSON.stringify(metadata), Date.now());
  }

  // --- Registered Groups ---
  getRegisteredGroups(): RegisteredGroup[] {
    return this.db.prepare(`SELECT name, folder, trigger_word as trigger, added_at, is_main, requires_trigger, timeout FROM registered_groups`)
      .all()
      .map((r: any) => ({ ...r, is_main: !!r.is_main, requires_trigger: !!r.requires_trigger })) as RegisteredGroup[];
  }

  registerGroup(group: RegisteredGroup): void {
    this.db.prepare(`INSERT OR REPLACE INTO registered_groups (name, folder, trigger_word, added_at, is_main, requires_trigger, timeout)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(group.name, group.folder, group.trigger, group.added_at, group.is_main ? 1 : 0, group.requires_trigger ? 1 : 0, group.timeout);
  }

  // --- Scheduled Tasks ---
  getAllTasks(): ScheduledTask[] {
    return this.db.prepare(`SELECT * FROM scheduled_tasks`).all() as ScheduledTask[];
  }

  getDueTasks(): ScheduledTask[] {
    return this.db.prepare(`SELECT * FROM scheduled_tasks WHERE status = 'active' AND next_run IS NOT NULL AND next_run <= ?`)
      .all(new Date().toISOString()) as ScheduledTask[];
  }

  createTask(task: ScheduledTask): void {
    this.db.prepare(`INSERT INTO scheduled_tasks (id, group_folder, chat_jid, prompt, script, schedule_type, schedule_value, context_mode, next_run, last_run, last_result, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(task.id, task.group_folder, task.chat_jid, task.prompt, task.script, task.schedule_type, task.schedule_value, task.context_mode, task.next_run, task.last_run, task.last_result, task.status, task.created_at);
  }

  /** Static map of allowed column names — prevents SQL identifier injection */
  private static readonly TASK_COLUMN_SQL = new Map<string, string>([
    ['prompt', 'UPDATE scheduled_tasks SET prompt = ? WHERE id = ?'],
    ['script', 'UPDATE scheduled_tasks SET script = ? WHERE id = ?'],
    ['schedule_type', 'UPDATE scheduled_tasks SET schedule_type = ? WHERE id = ?'],
    ['schedule_value', 'UPDATE scheduled_tasks SET schedule_value = ? WHERE id = ?'],
    ['context_mode', 'UPDATE scheduled_tasks SET context_mode = ? WHERE id = ?'],
    ['next_run', 'UPDATE scheduled_tasks SET next_run = ? WHERE id = ?'],
    ['last_run', 'UPDATE scheduled_tasks SET last_run = ? WHERE id = ?'],
    ['last_result', 'UPDATE scheduled_tasks SET last_result = ? WHERE id = ?'],
    ['status', 'UPDATE scheduled_tasks SET status = ? WHERE id = ?'],
  ]);

  updateTask(taskId: string, updates: Partial<ScheduledTask>): void {
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;
      const sql = Database.TASK_COLUMN_SQL.get(key);
      if (!sql) continue;
      this.db.prepare(sql).run(value, taskId);
    }
  }

  deleteTask(taskId: string): void {
    this.db.prepare(`DELETE FROM scheduled_tasks WHERE id = ?`).run(taskId);
  }

  logTaskRun(log: TaskRunLog): void {
    this.db.prepare(`INSERT INTO task_run_logs (task_id, started_at, finished_at, status, result, error) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(log.task_id, log.started_at, log.finished_at, log.status, log.result, log.error);
    // Retain only last 10k logs
    this.db.prepare(`DELETE FROM task_run_logs WHERE id NOT IN (SELECT id FROM task_run_logs ORDER BY id DESC LIMIT 10000)`).run();
  }

  pruneOldMessages(retentionDays = 30): void {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    this.db.prepare(`DELETE FROM messages WHERE timestamp < ?`).run(cutoff);
  }

  // --- Sessions ---
  getSession(groupFolder: string): string | null {
    const row = this.db.prepare(`SELECT session_id FROM sessions WHERE group_folder = ?`).get(groupFolder) as any;
    return row?.session_id ?? null;
  }

  saveSession(groupFolder: string, sessionId: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO sessions (group_folder, session_id, updated_at) VALUES (?, ?, ?)`)
      .run(groupFolder, sessionId, new Date().toISOString());
  }

  // --- Router State ---
  getCursor(chatJid: string): number {
    const row = this.db.prepare(`SELECT last_processed_timestamp FROM router_state WHERE chat_jid = ?`).get(chatJid) as any;
    return row?.last_processed_timestamp ?? 0;
  }

  setCursor(chatJid: string, timestamp: number): void {
    this.db.prepare(`INSERT OR REPLACE INTO router_state (chat_jid, last_processed_timestamp) VALUES (?, ?)`)
      .run(chatJid, timestamp);
  }

  close(): void {
    this.db.close();
  }
}
