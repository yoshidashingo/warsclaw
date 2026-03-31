import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export class Config {
  readonly pollingInterval: number;
  readonly ipcPollingInterval: number;
  readonly maxConcurrentContainers: number;
  readonly maxRetries: number;
  readonly timezone: string;
  readonly dataDir: string;
  readonly groupsDir: string;
  readonly ipcDir: string;
  readonly dbPath: string;
  readonly dockerImage: string;
  readonly assistantName: string;
  readonly logLevel: string;
  readonly workspaceDir: string | undefined;
  readonly discordBotToken: string | undefined;
  readonly slackBotToken: string | undefined;
  readonly slackAppToken: string | undefined;
  readonly anthropicApiKey: string;

  private constructor(env: Record<string, string | undefined>) {
    this.pollingInterval = parseInt(env.MYCLAW_POLLING_INTERVAL ?? '2000', 10);
    this.ipcPollingInterval = parseInt(env.MYCLAW_IPC_INTERVAL ?? '1000', 10);
    this.maxConcurrentContainers = parseInt(env.MYCLAW_MAX_CONTAINERS ?? '5', 10);
    this.maxRetries = parseInt(env.MYCLAW_MAX_RETRIES ?? '5', 10);
    this.timezone = env.MYCLAW_TIMEZONE ?? 'UTC';
    this.dataDir = resolve(env.MYCLAW_DATA_DIR ?? './data');
    this.groupsDir = resolve(env.MYCLAW_GROUPS_DIR ?? './groups');
    this.ipcDir = resolve(env.MYCLAW_IPC_DIR ?? './ipc');
    this.dbPath = resolve(this.dataDir, 'myclaw.db');
    this.dockerImage = env.MYCLAW_DOCKER_IMAGE ?? 'myclaw-agent';
    this.assistantName = env.MYCLAW_ASSISTANT_NAME ?? 'MyClaw';
    this.logLevel = env.MYCLAW_LOG_LEVEL ?? 'info';
    this.workspaceDir = env.MYCLAW_WORKSPACE_DIR ? resolve(env.MYCLAW_WORKSPACE_DIR) : undefined;
    this.discordBotToken = env.DISCORD_BOT_TOKEN || undefined;
    this.slackBotToken = env.SLACK_BOT_TOKEN || undefined;
    this.slackAppToken = env.SLACK_APP_TOKEN || undefined;
    this.anthropicApiKey = env.ANTHROPIC_API_KEY ?? '';
  }

  static fromEnv(): Config {
    const envPath = resolve('.env');
    if (existsSync(envPath)) {
      for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const value = trimmed.slice(eqIdx + 1).trim();
        if (!process.env[key]) process.env[key] = value;
      }
    }
    return new Config(process.env);
  }
}
