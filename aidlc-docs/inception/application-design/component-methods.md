# Component Methods

## Channel Interface (共通)

```typescript
interface Channel {
  readonly name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  sendMessage(jid: string, text: string): Promise<void>;
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  syncGroups?(isForce: boolean): Promise<void>;
  onInboundMessage(callback: (msg: NewMessage) => void): void;
  onChatMetadata?(callback: (jid: string, name: string, metadata: any) => void): void;
}
```

## ChannelRegistry

```typescript
class ChannelRegistry {
  register(name: string, factory: ChannelFactory): void;
  getAll(): Channel[];
  findByJid(jid: string): Channel | undefined;
  connectAll(): Promise<void>;
  disconnectAll(): Promise<void>;
}

type ChannelFactory = (opts: ChannelOpts) => Channel | null;

interface ChannelOpts {
  config: Config;
  db: Database;
  logger: Logger;
}
```

## Router

```typescript
class Router {
  constructor(registry: ChannelRegistry, db: Database);
  formatMessages(messages: NewMessage[], isMain: boolean): string;
  routeOutbound(jid: string, text: string): Promise<void>;
  getLastCursor(chatJid: string): number;
  updateCursor(chatJid: string, timestamp: number): void;
}
```

## GroupQueue

```typescript
class GroupQueue {
  constructor(opts: { maxConcurrent: number; maxRetries: number; runner: ContainerRunner });
  enqueue(group: string, task: QueueTask): void;
  getQueueLength(group: string): number;
  getActiveCount(): number;
  shutdown(): Promise<void>;
}

interface QueueTask {
  input: ContainerInput;
  onComplete: (output: ContainerOutput) => Promise<void>;
  onError: (error: Error) => void;
}
```

## ContainerRunner

```typescript
class ContainerRunner {
  constructor(config: Config, logger: Logger);
  run(input: ContainerInput): Promise<ContainerOutput>;
  getActiveProcesses(): Map<string, ChildProcess>;
  killGroup(group: string): void;
}

interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  script?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string;
  newSessionId?: string;
  error?: string;
}
```

## IpcWatcher

```typescript
class IpcWatcher {
  constructor(deps: IpcDeps);
  start(): void;
  stop(): void;
  processFiles(): Promise<void>;
}

interface IpcDeps {
  db: Database;
  router: Router;
  scheduler: TaskScheduler;
  logger: Logger;
  ipcDir: string;
}
```

## TaskScheduler

```typescript
class TaskScheduler {
  constructor(db: Database, queue: GroupQueue, logger: Logger, timezone: string);
  checkDueTasks(): Promise<void>;
  createTask(task: CreateTaskInput): string;
  pauseTask(taskId: string): void;
  resumeTask(taskId: string): void;
  cancelTask(taskId: string): void;
  updateTask(taskId: string, updates: Partial<CreateTaskInput>): void;
  computeNextRun(task: ScheduledTask): string | null;
}
```

## Database

```typescript
class Database {
  constructor(dbPath: string);
  init(): void;
  // Messages
  storeMessage(msg: NewMessage): void;
  getNewMessages(chatJid: string, since: number): NewMessage[];
  getLastBotMessageTimestamp(chatJid: string): number | null;
  // Chat metadata
  storeChatMetadata(jid: string, name: string, metadata: any): void;
  // Tasks
  getAllTasks(): ScheduledTask[];
  getDueTasks(): ScheduledTask[];
  createTask(task: ScheduledTask): void;
  updateTask(taskId: string, updates: Partial<ScheduledTask>): void;
  deleteTask(taskId: string): void;
  logTaskRun(log: TaskRunLog): void;
  // Groups
  getRegisteredGroups(): RegisteredGroup[];
  registerGroup(group: RegisteredGroup): void;
  // Sessions
  getSession(groupFolder: string): string | null;
  saveSession(groupFolder: string, sessionId: string): void;
  // Router state
  getCursor(chatJid: string): number;
  setCursor(chatJid: string, timestamp: number): void;
}
```

## Config

```typescript
class Config {
  readonly pollingInterval: number;       // default: 2000ms
  readonly ipcPollingInterval: number;    // default: 1000ms
  readonly maxConcurrentContainers: number; // default: 5
  readonly maxRetries: number;            // default: 5
  readonly timezone: string;              // IANA timezone
  readonly dataDir: string;               // data/
  readonly groupsDir: string;             // groups/
  readonly ipcDir: string;                // workspace/ipc/
  readonly dbPath: string;                // data/myclaw.db
  readonly dockerImage: string;           // myclaw-agent
  readonly assistantName: string;         // default: "MyClaw"

  static fromEnv(): Config;
}
```

## Logger

```typescript
class Logger {
  info(context: Record<string, any>, message: string): void;
  warn(context: Record<string, any>, message: string): void;
  error(context: Record<string, any>, message: string): void;
  debug(context: Record<string, any>, message: string): void;
}
```

## SkillLoader

```typescript
class SkillLoader {
  constructor(skillsDir: string, logger: Logger);
  loadAll(): Skill[];
  getChannelSkills(): ChannelSkill[];
  getContainerSkills(): ContainerSkill[];
}

interface Skill {
  name: string;
  type: 'channel' | 'utility' | 'container';
}
```

**Note**: 各メソッドの詳細なビジネスルールは Construction Phase の Functional Design で定義します。
