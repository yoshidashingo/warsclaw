import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Database } from '../db.js';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

function createTestDb(): { db: Database; path: string } {
  const dir = join(tmpdir(), 'warsclaw-test-' + randomUUID());
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'test.db');
  const db = new Database(path);
  db.init();
  return { db, path };
}

describe('Database', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    const t = createTestDb();
    db = t.db;
    dbPath = t.path;
  });

  afterEach(() => {
    db.close();
    if (existsSync(dbPath)) unlinkSync(dbPath);
  });

  describe('messages', () => {
    it('stores and retrieves messages', () => {
      db.storeMessage({ id: 'm1', chat_jid: 'g1', sender: 'u1', sender_name: 'User', content: 'hello', timestamp: 1000, is_from_me: false, is_bot_message: false, is_dm: false });
      db.storeMessage({ id: 'm2', chat_jid: 'g1', sender: 'bot', sender_name: 'Bot', content: 'hi', timestamp: 2000, is_from_me: true, is_bot_message: true, is_dm: false });

      const msgs = db.getNewMessages('g1', 0);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe('hello');
      expect(msgs[1].is_bot_message).toBe(true);
    });

    it('respects since parameter', () => {
      db.storeMessage({ id: 'm1', chat_jid: 'g1', sender: 'u1', sender_name: 'User', content: 'old', timestamp: 1000, is_from_me: false, is_bot_message: false, is_dm: false });
      db.storeMessage({ id: 'm2', chat_jid: 'g1', sender: 'u1', sender_name: 'User', content: 'new', timestamp: 2000, is_from_me: false, is_bot_message: false, is_dm: false });

      const msgs = db.getNewMessages('g1', 1500);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].content).toBe('new');
    });

    it('returns last bot message timestamp', () => {
      db.storeMessage({ id: 'm1', chat_jid: 'g1', sender: 'bot', sender_name: 'Bot', content: 'hi', timestamp: 5000, is_from_me: true, is_bot_message: true, is_dm: false });
      expect(db.getLastBotMessageTimestamp('g1')).toBe(5000);
      expect(db.getLastBotMessageTimestamp('g2')).toBeNull();
    });
  });

  describe('registered groups', () => {
    it('registers and retrieves groups', () => {
      db.registerGroup({ name: 'dev', folder: 'dev-team', trigger: '@bot', added_at: '2026-01-01T00:00:00Z', is_main: false, requires_trigger: true, timeout: 300, workspace_dir: null });
      const groups = db.getRegisteredGroups();
      expect(groups).toHaveLength(1);
      expect(groups[0].folder).toBe('dev-team');
      expect(groups[0].requires_trigger).toBe(true);
    });
  });

  describe('scheduled tasks', () => {
    it('creates and retrieves due tasks', () => {
      const task = { id: 't1', group_folder: 'dev', chat_jid: 'g1', prompt: 'test', script: null, schedule_type: 'once' as const, schedule_value: '2020-01-01T00:00:00Z', context_mode: 'group' as const, next_run: '2020-01-01T00:00:00Z', last_run: null, last_result: null, status: 'active' as const, created_at: '2020-01-01T00:00:00Z' };
      db.createTask(task);

      const due = db.getDueTasks();
      expect(due).toHaveLength(1);
      expect(due[0].prompt).toBe('test');
    });

    it('updates task status', () => {
      const task = { id: 't2', group_folder: 'dev', chat_jid: 'g1', prompt: 'test', script: null, schedule_type: 'cron' as const, schedule_value: '* * * * *', context_mode: 'group' as const, next_run: null, last_run: null, last_result: null, status: 'active' as const, created_at: '2020-01-01T00:00:00Z' };
      db.createTask(task);
      db.updateTask('t2', { status: 'paused' });

      const all = db.getAllTasks();
      expect(all[0].status).toBe('paused');
    });
  });

  describe('sessions', () => {
    it('saves and retrieves sessions', () => {
      db.saveSession('dev', 'session-123');
      expect(db.getSession('dev')).toBe('session-123');
      expect(db.getSession('unknown')).toBeNull();
    });
  });

  describe('router state', () => {
    it('manages cursor', () => {
      expect(db.getCursor('g1')).toBe(0);
      db.setCursor('g1', 5000);
      expect(db.getCursor('g1')).toBe(5000);
    });
  });
});
