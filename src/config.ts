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
    this.pollingInterval = parseInt(env.WARSCLAW_POLLING_INTERVAL ?? '2000', 10);
    this.ipcPollingInterval = parseInt(env.WARSCLAW_IPC_INTERVAL ?? '1000', 10);
    this.maxConcurrentContainers = parseInt(env.WARSCLAW_MAX_CONTAINERS ?? '5', 10);
    this.maxRetries = parseInt(env.WARSCLAW_MAX_RETRIES ?? '5', 10);
    this.timezone = env.WARSCLAW_TIMEZONE ?? 'UTC';
    this.dataDir = resolve(env.WARSCLAW_DATA_DIR ?? './data');
    this.groupsDir = resolve(env.WARSCLAW_GROUPS_DIR ?? './groups');
    this.ipcDir = resolve(env.WARSCLAW_IPC_DIR ?? './ipc');
    this.dbPath = resolve(this.dataDir, 'warsclaw.db');
    this.dockerImage = env.WARSCLAW_DOCKER_IMAGE ?? 'warsclaw-agent';
    this.assistantName = env.WARSCLAW_ASSISTANT_NAME ?? 'WarsClaw';
    this.logLevel = env.WARSCLAW_LOG_LEVEL ?? 'info';
    this.workspaceDir = env.WARSCLAW_WORKSPACE_DIR ? resolve(env.WARSCLAW_WORKSPACE_DIR) : undefined;
    this.discordBotToken = env.DISCORD_BOT_TOKEN || undefined;
    this.slackBotToken = env.SLACK_BOT_TOKEN || undefined;
    this.slackAppToken = env.SLACK_APP_TOKEN || undefined;
    const apiKey = env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required. Set it in .env or as an environment variable.');
    }
    this.anthropicApiKey = apiKey;
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
        let value = trimmed.slice(eqIdx + 1).trim();
        // Strip surrounding quotes
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = value;
      }
    }
    return new Config(process.env);
  }
}
