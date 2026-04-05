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
  workspaceDir?: string;
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

export type ApprovalMode = 'required' | 'notify_only' | 'auto';

export type TaskRunState =
  | 'planning'
  | 'awaiting_approval'
  | 'rejected'
  | 'executing'
  | 'reporting'
  | 'awaiting_feedback'
  | 'completed'
  | 'error';

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
  // Trust score fields
  trust_score: number;
  consecutive_successes: number;
  total_positive_feedback: number;
  total_runs: number;
  approval_mode: ApprovalMode;
  approval_mode_locked: boolean;
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
  workspace_dir: string | null;
}

// --- IPC Types ---

export interface IpcDeps {
  db: import('./db.js').Database;
  router: import('./router.js').Router;
  scheduler: import('./task-scheduler.js').TaskScheduler;
  logger: import('./logger.js').Logger;
  ipcDir: string;
  groupsDir: string;
}

// --- Skill Types ---

export interface Skill {
  name: string;
  type: 'channel' | 'utility' | 'container';
}

// --- Zod Schemas ---

/** Safe folder name pattern — prevents path traversal */
export const SafeFolderSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Only alphanumeric, hyphens, and underscores');

/** For IPC group registration — additionally rejects reserved names */
export const GroupFolderSchema = SafeFolderSchema
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
    group_folder: GroupFolderSchema,
    script: z.string().optional(),
    context_mode: z.enum(['group', 'isolated']).default('group'),
  }),
  z.object({ type: z.literal('pause_task'), taskId: z.string().min(1), source_group: z.string().min(1) }),
  z.object({ type: z.literal('resume_task'), taskId: z.string().min(1), source_group: z.string().min(1) }),
  z.object({ type: z.literal('cancel_task'), taskId: z.string().min(1), source_group: z.string().min(1) }),
  z.object({
    type: z.literal('update_task'),
    taskId: z.string().min(1),
    source_group: z.string().min(1),
    prompt: z.string().min(1).max(10000).optional(),
    script: z.string().optional(),
    schedule_type: z.enum(['cron', 'interval', 'once']).optional(),
    schedule_value: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('register_group'), jid: z.string().min(1), name: z.string().min(1), folder: GroupFolderSchema, trigger: z.string().min(1), source_group: z.string().min(1), workspace_dir: z.string().optional() }),
  z.object({ type: z.literal('refresh_groups'), source_group: z.string().min(1) }),
]).superRefine((data, ctx) => {
  if (data.type === 'schedule_task') {
    if (data.schedule_type === 'interval') {
      const ms = parseInt(data.schedule_value, 10);
      if (isNaN(ms) || ms < 60000) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Interval must be >= 60000ms (1 minute)', path: ['schedule_value'] });
      }
    }
    if (data.schedule_type === 'once') {
      const ts = Date.parse(data.schedule_value);
      if (isNaN(ts) || ts <= Date.now()) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Once schedule_value must be a future ISO date', path: ['schedule_value'] });
      }
    }
  }
});

export const ContainerOutputSchema = z.object({
  status: z.enum(['success', 'error']),
  result: z.string(),
  newSessionId: z.string().optional(),
  error: z.string().optional(),
});

// --- Task Run Types ---

export interface TaskRun {
  id: string;
  task_id: string;
  state: TaskRunState;
  plan: string | null;
  plan_slack_ts: string | null;
  plan_channel_id: string | null;
  approval_by: string | null;
  approval_at: number | null;
  rejection_reason: string | null;
  result: string | null;
  report: string | null;
  report_slack_ts: string | null;
  feedback_score: number | null;
  feedback_comment: string | null;
  started_at: number;
  finished_at: number | null;
  created_at: number;
}

// --- Report Types ---

export interface ReportData {
  summary: string;
  planDiff: string | null;
  suggestions: string[];
}

// --- Trust / Approval Types ---


export interface TaskTrustFields {
  consecutive_successes: number;
  total_positive_feedback: number;
  total_runs: number;
  trust_score: number;
  approval_mode: ApprovalMode;
  approval_mode_locked: boolean;
}
