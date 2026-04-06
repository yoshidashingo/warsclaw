import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { ContainerInput, ContainerOutput } from './types.js';
import { ContainerOutputSchema, SafeFolderSchema } from './types.js';

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB

export function parseContainerOutput(stdout: string, nonce?: string): ContainerOutput {
  const startMarker = nonce ? `<<<OUTPUT_START:${nonce}>>>` : '<<<OUTPUT_START>>>';
  const endMarker = nonce ? `<<<OUTPUT_END:${nonce}>>>` : '<<<OUTPUT_END>>>';
  const startIdx = stdout.lastIndexOf(startMarker);
  const endIdx = stdout.indexOf(endMarker, startIdx);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(`Missing output markers in stdout (length=${stdout.length})`);
  }
  const json = stdout.slice(startIdx + startMarker.length, endIdx).trim();
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

    // Validate groupFolder to prevent path traversal
    SafeFolderSchema.parse(input.groupFolder);

    const groupFolder = resolve(this.config.groupsDir, input.groupFolder);
    const ipcDir = resolve(this.config.ipcDir);

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
    ];

    // Group-level workspace_dir takes precedence over global config
    const workspaceDir = input.workspaceDir ?? this.config.workspaceDir;
    if (workspaceDir) {
      const resolvedWs = resolve(workspaceDir);
      if (resolvedWs.includes('..') || !resolvedWs.startsWith('/')) {
        throw new Error(`Invalid workspace_dir: ${resolvedWs}`);
      }
      args.push('-v', `${resolvedWs}:/workspace/repo:rw`);
    }

    args.push('-i', this.config.dockerImage);

    const nonce = randomUUID();
    const proc = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });

    return new Promise<ContainerOutput>((resolveP, reject) => {
      this.activeProcesses.set(input.groupFolder, proc);

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let killed = false;

      const timeout = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new Error(`Container timeout after ${timeoutSec}s`));
      }, timeoutSec * 1000);

      proc.stdout?.on('data', (chunk: Buffer) => {
        stdoutBytes += chunk.length;
        if (stdoutBytes > MAX_OUTPUT_BYTES) {
          if (!killed) {
            killed = true;
            proc.kill('SIGTERM');
            reject(new Error(`Container stdout exceeded ${MAX_OUTPUT_BYTES} bytes, killed`));
          }
          return;
        }
        stdout += chunk.toString();
      });
      proc.stderr?.on('data', (chunk: Buffer) => {
        stderrBytes += chunk.length;
        if (stderrBytes > MAX_OUTPUT_BYTES) {
          if (!killed) {
            killed = true;
            proc.kill('SIGTERM');
            reject(new Error(`Container stderr exceeded ${MAX_OUTPUT_BYTES} bytes, killed`));
          }
          return;
        }
        stderr += chunk.toString();
      });

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.activeProcesses.delete(input.groupFolder);
      };

      proc.on('close', (code) => {
        cleanup();
        if (stderr) this.logger.debug({ groupFolder: input.groupFolder }, `Container stderr: ${stderr.slice(0, 500)}`);
        if (code !== 0) {
          reject(new Error(`Container exited with code ${code}: ${stderr.slice(0, 500)}`));
          return;
        }
        try {
          resolveP(parseContainerOutput(stdout, nonce));
        } catch (err) {
          reject(new Error(`Failed to parse container output: ${(err as Error).message}`));
        }
      });

      proc.on('error', (err) => {
        cleanup();
        reject(err);
      });

      // Pass API key and nonce via stdin (not visible in docker inspect or process list)
      const envelope = { ...input, _apiKey: this.config.anthropicApiKey, _nonce: nonce };
      proc.stdin?.write(JSON.stringify(envelope));
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
