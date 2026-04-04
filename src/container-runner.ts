import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { ContainerInput, ContainerOutput } from './types.js';
import { ContainerOutputSchema } from './types.js';

const OUTPUT_START = '<<<OUTPUT_START>>>';
const OUTPUT_END = '<<<OUTPUT_END>>>';

export function parseContainerOutput(stdout: string): ContainerOutput {
  const startIdx = stdout.indexOf(OUTPUT_START);
  const endIdx = stdout.indexOf(OUTPUT_END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing output markers in stdout (length=${stdout.length})`);
  }
  const json = stdout.slice(startIdx + OUTPUT_START.length, endIdx).trim();
  return ContainerOutputSchema.parse(JSON.parse(json));
}

export class ContainerRunner {
  private readonly activeProcesses = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  async run(input: ContainerInput): Promise<ContainerOutput> {
    this.logger.debug({ groupFolder: input.groupFolder }, 'ContainerRunner.run() called');
    const groupFolder = resolve(this.config.groupsDir, input.groupFolder);
    const ipcDir = resolve(this.config.ipcDir);

    // Write API key to temp env-file (not visible in docker inspect)
    const { mkdtempSync, writeFileSync, unlinkSync: unlinkTmp, rmdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const envDir = mkdtempSync(join(tmpdir(), 'myclaw-env-'));
    const envFile = join(envDir, '.env');
    writeFileSync(envFile, `ANTHROPIC_API_KEY=${this.config.anthropicApiKey}\n`, { mode: 0o600 });

    const timeoutSec = input.timeout ?? (input.isScheduledTask ? 600 : 300);

    const args = [
      'run', '--rm',
      // Security hardening
      '--network=none',
      '--no-new-privileges',
      '--cap-drop', 'ALL',
      '--pids-limit', '100',
      // Resource limits
      '--memory=512m', '--cpus=1',
      // Volumes: only group folder (rw), IPC (ro)
      '-v', `${groupFolder}:/workspace/groups/${input.groupFolder}:rw`,
      '-v', `${ipcDir}:/workspace/ipc:ro`,
      // API key via env-file
      '--env-file', envFile,
    ];

    if (this.config.workspaceDir) {
      args.push('-v', `${this.config.workspaceDir}:/workspace/repo:rw`);
    }

    args.push('-i', this.config.dockerImage);

    return new Promise<ContainerOutput>((resolveP, reject) => {
      const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.activeProcesses.set(input.groupFolder, proc);

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Container timeout after ${timeoutSec}s`));
      }, timeoutSec * 1000);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.activeProcesses.delete(input.groupFolder);
        try { unlinkTmp(envFile); } catch { /* ignore */ }
        try { rmdirSync(envDir); } catch { /* ignore */ }
      };

      proc.on('close', (code) => {
        cleanup();
        if (stderr) this.logger.debug({ groupFolder: input.groupFolder }, `Container stderr: ${stderr.slice(0, 500)}`);
        if (code !== 0) {
          reject(new Error(`Container exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolveP(parseContainerOutput(stdout));
        } catch (err) {
          reject(new Error(`Failed to parse container output: ${(err as Error).message}`));
        }
      });

      proc.on('error', (err) => {
        cleanup();
        reject(err);
      });

      proc.stdin?.write(JSON.stringify(input));
      proc.stdin?.end();
    });
  }

  getActiveCount(): number {
    return this.activeProcesses.size;
  }

  killGroup(group: string): void {
    this.activeProcesses.get(group)?.kill('SIGTERM');
  }
}
