type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

const SECRET_PATTERNS = [/sk-ant-[a-zA-Z0-9-]+/g, /xoxb-[a-zA-Z0-9-]+/g, /xapp-[a-zA-Z0-9-]+/g];

function maskSecrets(str: string): string {
  let result = str;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (m) => (m.length <= 8 ? '***' : m.slice(0, 4) + '...' + m.slice(-4)));
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
    const entry = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      ...context,
      message: maskSecrets(message),
    });
    if (level === 'error') {
      process.stderr.write(entry + '\n');
    } else {
      process.stdout.write(entry + '\n');
    }
  }
}
