import { z } from 'zod';

// --- Message Types ---

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: number;
  is_from_me: boolean;
  is_bot_message: boolean;
}

// --- Channel Types ---

export interface Channel {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  sendMessage(jid: string, text: string): Promise<void>;
  onInboundMessage(callback: (msg: NewMessage) => void): void;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncGroups?(isForce: boolean): Promise<void>;
  onChatMetadata?(callback: (jid: string, name: string, metadata: unknown) => void): void;
}

export type ChannelFactory = (opts: ChannelOpts) => Channel | null;

export interface ChannelOpts {
  config: import('./config.js').Config;
  db: import('./db.js').Database;
  logger: import('./logger.js').Logger;
}

// --- Container Types ---

export interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  script?: string;
  timeout?: number;
}

export interface ContainerOutput {
  status: 'success' | 'error';
  result: string;
  newSessionId?: string;
  error?: string;
}

// --- Queue Types ---

export interface QueueTask {
  groupFolder: string;
  input: ContainerInput;
  onComplete: (output: ContainerOutput) => Promise<void>;
  onError: (error: Error) => void;
}

// --- Task Types ---

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script: string | null;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'success' | 'error' | 'timeout';
  result: string | null;
  error: string | null;
}

// --- Group Types ---

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  is_main: boolean;
  requires_trigger: boolean;
  timeout: number;
}

// --- IPC Types ---

export interface IpcDeps {
  db: import('./db.js').Database;
  router: import('./router.js').Router;
  scheduler: import('./task-scheduler.js').TaskScheduler;
  logger: import('./logger.js').Logger;
  ipcDir: string;
}

// --- Skill Types ---

export interface Skill {
  name: string;
  type: 'channel' | 'utility' | 'container';
}

// --- Zod Schemas ---

export const GroupFolderSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, hyphens, and underscores')
  .refine((name) => !['main', 'global', '.', '..'].includes(name), 'Reserved name');

export const IpcMessageSchema = z.object({
  type: z.literal('message'),
  chatJid: z.string().min(1),
  text: z.string().min(1),
});

export const IpcTaskSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('schedule_task'),
    prompt: z.string().min(1).max(10000),
    schedule_type: z.enum(['cron', 'interval', 'once']),
    schedule_value: z.string().min(1),
    targetJid: z.string().min(1),
    script: z.string().optional(),
    context_mode: z.enum(['group', 'isolated']).default('group'),
  }),
  z.object({ type: z.literal('pause_task'), taskId: z.string().min(1) }),
  z.object({ type: z.literal('resume_task'), taskId: z.string().min(1) }),
  z.object({ type: z.literal('cancel_task'), taskId: z.string().min(1) }),
  z.object({
    type: z.literal('update_task'),
    taskId: z.string().min(1),
    prompt: z.string().min(1).max(10000).optional(),
    script: z.string().optional(),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
    schedule_value: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('register_group'), jid: z.string().min(1), name: z.string().min(1), folder: GroupFolderSchema, trigger: z.string().min(1) }),
  z.object({ type: z.literal('refresh_groups') }),
]);

export const ContainerOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  result: z.string(),
  newSessionId: z.string().optional(),
  error: z.string().optional(),
});
