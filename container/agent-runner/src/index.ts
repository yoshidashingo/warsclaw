const OUTPUT_START = '<<<OUTPUT_START>>>';
const OUTPUT_END = '<<<OUTPUT_END>>>';

interface ContainerInput {
  prompt: string;
  sessionId: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask: boolean;
  assistantName: string;
  script?: string;
  timeout?: number;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string;
  newSessionId?: string;
  error?: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
  });
}

function writeOutput(output: ContainerOutput): void {
  process.stdout.write(`\n${OUTPUT_START}\n${JSON.stringify(output)}\n${OUTPUT_END}\n`);
}

async function main(): Promise<void> {
  let input: ContainerInput;
  try {
    const raw = await readStdin();
    input = JSON.parse(raw);
  } catch (err) {
    writeOutput({ status: 'error', result: '', error: `Failed to parse input: ${(err as Error).message}` });
    return;
  }

  const { existsSync } = await import('node:fs');
  const repoDir = '/workspace/repo';
  const workDir = existsSync(repoDir) ? repoDir : `/workspace/groups/${input.groupFolder}`;

  try {
    const { spawnSync } = await import('node:child_process');

    const args = ['--print', '--output-format', 'text'];
    if (input.sessionId) {
      args.push('--resume', input.sessionId);
    }

    const prompt = input.script
      ? `Execute this script:\n${input.script}\n\nContext:\n${input.prompt}`
      : input.prompt;

    const result = spawnSync('claude', args, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: (input.timeout ?? 300) * 1000,
      input: prompt,
      env: { ...process.env, HOME: workDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      writeOutput({ status: 'error', result: '', error: result.error.message.slice(0, 1000) });
      return;
    }

    const stdout = result.stdout ?? '';
    const sessionId = input.sessionId || `myclaw-${input.groupFolder}`;

    writeOutput({
      status: result.status === 0 ? 'success' : 'error',
      result: stdout.trim(),
      newSessionId: sessionId,
      error: result.status !== 0 ? (result.stderr ?? '').slice(0, 1000) : undefined,
    });
  } catch (err) {
    writeOutput({ status: 'error', result: '', error: (err as Error).message.slice(0, 1000) });
  }
}

main();
