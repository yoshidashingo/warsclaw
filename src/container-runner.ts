import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
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
    const projectRoot = resolve('.');
    const groupFolder = resolve(this.config.groupsDir, input.groupFolder);
    const ipcDir = resolve(this.config.ipcDir);

    const args = [
      'run', '--rm',
      '-v', `${projectRoot}:/workspace:ro`,
      '-v', `${groupFolder}:/workspace/groups/${input.groupFolder}:rw`,
      '-v', `${ipcDir}:/workspace/ipc:rw`,
      '-v', '/dev/null:/workspace/.env:ro',
      '-e', `ANTHROPIC_API_KEY=${this.config.anthropicApiKey}`,
      '--memory=512m', '--cpus=1',
    ];

    // Mount workspace repository (the target repo to work on)
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
        reject(new Error(`Container timeout after ${input.isScheduledTask ? 600 : 300}s`));
      }, (input.isScheduledTask ? 600 : 300) * 1000);

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        this.activeProcesses.delete(input.groupFolder);

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
        clearTimeout(timeout);
        this.activeProcesses.delete(input.groupFolder);
        reject(err);
      });

      // Send input via stdin
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
