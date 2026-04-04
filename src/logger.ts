type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SECRET_PATTERNS = [
  /sk-ant-[a-zA-Z0-9-]+/g,                                       // Anthropic API keys
  /xoxb-[a-zA-Z0-9-]+/g,                                         // Slack bot tokens
  /xapp-[a-zA-Z0-9-]+/g,                                         // Slack app tokens
  /[A-Za-z0-9]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,   // Discord bot tokens
  /AKIA[0-9A-Z]{16}/g,                                           // AWS access key IDs
  /ghp_[a-zA-Z0-9]{36}/g,                                        // GitHub PATs
  /glpat-[a-zA-Z0-9_-]{20,}/g,                                   // GitLab PATs
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,                             // Bearer tokens
];

export function maskSecrets(str: string): string {
  let result = str;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(new RegExp(pattern.source, pattern.flags), (m) =>
      m.length <= 8 ? '***' : m.slice(0, 4) + '...' + m.slice(-4),
    );
  }
  return result;
}

export class Logger {
  private readonly minLevel: number;

  constructor(level: LogLevel = 'info') {
    this.minLevel = LEVELS[level] ?? LEVELS.info;
  }

  debug(context: Record<string, unknown>, message: string): void {
    this.log('debug', context, message);
  }

  info(context: Record<string, unknown>, message: string): void {
    this.log('info', context, message);
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.log('warn', context, message);
  }

  error(context: Record<string, unknown>, message: string): void {
    this.log('error', context, message);
  }

  private log(level: LogLevel, context: Record<string, unknown>, message: string): void {
    if (LEVELS[level] < this.minLevel) return;
    const raw = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...context,
      message,
    });
    const entry = maskSecrets(raw);
    if (level === 'error') {
      process.stderr.write(entry + '\n');
    } else {
      process.stdout.write(entry + '\n');
    }
  }
}
