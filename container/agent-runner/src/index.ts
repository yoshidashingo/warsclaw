import { execSync } from 'node:child_process';

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

  const workDir = `/workspace/groups/${input.groupFolder}`;

  try {
    // Build claude command
    const args = ['--print', '--output-format', 'text'];
    if (input.sessionId) {
      args.push('--resume', input.sessionId);
    }

    const prompt = input.script
      ? `Execute this script:\n${input.script}\n\nContext:\n${input.prompt}`
      : input.prompt;

    // Execute claude CLI
    const result = execSync(`echo ${JSON.stringify(prompt)} | claude ${args.join(' ')}`, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: 300_000, // 5 minutes
      env: { ...process.env, HOME: workDir },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    writeOutput({
      status: 'success',
      result: result.trim(),
    });
  } catch (err) {
    const error = err as Error & { stderr?: string };
    writeOutput({
      status: 'error',
      result: '',
      error: error.stderr?.slice(0, 1000) || error.message.slice(0, 1000),
    });
  }
}

main();
