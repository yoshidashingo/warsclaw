# Component Dependencies

## Dependency Matrix

| Component | Depends On | Depended By |
|-----------|-----------|-------------|
| Orchestrator | ChannelRegistry, GroupQueue, TaskScheduler, IpcWatcher, Database, Config, Logger | — (top-level) |
| ChannelRegistry | Config, Logger | Orchestrator, Router |
| DiscordChannel | Config, Database, Logger | ChannelRegistry |
| SlackChannel | Config, Database, Logger | ChannelRegistry |
| Router | ChannelRegistry, Database | Orchestrator, IpcWatcher |
| GroupQueue | ContainerRunner, Logger | Orchestrator, TaskScheduler |
| ContainerRunner | Config, Logger | GroupQueue |
| IpcWatcher | Database, Router, TaskScheduler, Logger | Orchestrator |
| TaskScheduler | Database, GroupQueue, Logger | Orchestrator, IpcWatcher |
| Database | Config | 全コンポーネント |
| Config | — | 全コンポーネント |
| Logger | — | 全コンポーネント |
| SkillLoader | Logger | Orchestrator |

## Dependency Graph

```mermaid
graph TD
    ORCH[Orchestrator] --> REG[ChannelRegistry]
    ORCH --> GQ[GroupQueue]
    ORCH --> SCHED[TaskScheduler]
    ORCH --> IPC[IpcWatcher]
    ORCH --> DB[Database]
    ORCH --> CFG[Config]
    ORCH --> LOG[Logger]
    ORCH --> SKILL[SkillLoader]

    REG --> CFG
    REG --> LOG
    REG --> DISC[DiscordChannel]
    REG --> SLCK[SlackChannel]

    DISC --> CFG
    DISC --> DB
    DISC --> LOG

    SLCK --> CFG
    SLCK --> DB
    SLCK --> LOG

    ROUTER[Router] --> REG
    ROUTER --> DB

    GQ --> CR[ContainerRunner]
    GQ --> LOG

    CR --> CFG
    CR --> LOG

    IPC --> DB
    IPC --> ROUTER
    IPC --> SCHED
    IPC --> LOG

    SCHED --> DB
    SCHED --> GQ
    SCHED --> LOG

    DB --> CFG
    SKILL --> LOG
```

## Communication Patterns

### 1. 同期呼び出し (Direct Call)
すべてのコンポーネント間通信は同期的なメソッド呼び出し（または async/await）。

```
Orchestrator → ChannelRegistry.connectAll()
Router → ChannelRegistry.findByJid(jid)
GroupQueue → ContainerRunner.run(input)
TaskScheduler → Database.getDueTasks()
```

### 2. コールバック (Event Callback)
チャネルからのインバウンドメッセージはコールバックパターン。

```
channel.onInboundMessage((msg) => {
  db.storeMessage(msg)
  queue.enqueue(msg.chat_jid, task)
})
```

### 3. ファイルシステムIPC (Async File Polling)
コンテナ ↔ メインプロセス間はJSONファイルで非同期通信。

```
Container writes → /workspace/ipc/messages/msg_001.json
IpcWatcher reads → processes → deletes file
```

### 4. stdin/stdout (Container I/O)
メインプロセス → Docker コンテナは stdin/stdout で通信。

```
Main Process → stdin: JSON(ContainerInput)
Container → stdout: <<<OUTPUT_START>>>JSON(ContainerOutput)<<<OUTPUT_END>>>
```

## Data Flow Diagram

```mermaid
graph LR
    subgraph External
        DISC_API[Discord API]
        SLACK_API[Slack API]
        DOCKER[Docker Daemon]
    end

    subgraph MyClaw
        CH[Channels]
        RT[Router]
        GQ[GroupQueue]
        CR[ContainerRunner]
        IPC[IpcWatcher]
        DB[(SQLite)]
    end

    subgraph Container
        CLAUDE[Claude Code CLI]
        IPC_FS[/workspace/ipc/]
    end

    DISC_API <--> CH
    SLACK_API <--> CH
    CH --> DB
    CH --> RT --> GQ
    GQ --> CR
    CR <-->|stdin/stdout| DOCKER
    DOCKER <-->|mount| Container
    CLAUDE --> IPC_FS
    IPC_FS --> IPC
    IPC --> RT
    IPC --> DB
```

## Initialization Order

```
1. Config.fromEnv()
2. Logger (依存なし)
3. Database.init() (Config)
4. ChannelRegistry (Config, Logger)
5. Router (ChannelRegistry, Database)
6. ContainerRunner (Config, Logger)
7. GroupQueue (ContainerRunner, Logger)
8. TaskScheduler (Database, GroupQueue, Logger)
9. IpcWatcher (Database, Router, TaskScheduler, Logger)
10. SkillLoader (Logger)
11. Channel Registration (DiscordChannel, SlackChannel)
12. Orchestrator.start() — connects channels, starts polling
```
