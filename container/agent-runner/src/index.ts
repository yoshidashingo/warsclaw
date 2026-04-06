// Output markers use a per-invocation nonce to prevent LLM output spoofing
let outputNonce: string | undefined;

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

/** Lightweight runtime validation (no Zod dependency in container) */
function validateInput(raw: unknown): ContainerInput {
  if (typeof raw !== 'object' || raw === null) throw new Error('Input must be an object');
  const obj = raw as Record<string, unknown>;
  if (typeof obj.prompt !== 'string' || !obj.prompt) throw new Error('prompt must be a non-empty string');
  if (typeof obj.sessionId !== 'string') throw new Error('sessionId must be a string');
  if (typeof obj.groupFolder !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(obj.groupFolder)) throw new Error('groupFolder must be alphanumeric');
  if (typeof obj.chatJid !== 'string') throw new Error('chatJid must be a string');
  if (typeof obj.isMain !== 'boolean') throw new Error('isMain must be a boolean');
  if (typeof obj.isScheduledTask !== 'boolean') throw new Error('isScheduledTask must be a boolean');
  if (typeof obj.assistantName !== 'string') throw new Error('assistantName must be a string');
  if (obj.script !== undefined && typeof obj.script !== 'string') throw new Error('script must be a string');
  if (obj.timeout !== undefined && (typeof obj.timeout !== 'number' || obj.timeout <= 0 || obj.timeout > 3600)) throw new Error('timeout must be 1-3600');
  return obj as unknown as ContainerInput;
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
  const start = outputNonce ? `<<<OUTPUT_START:${outputNonce}>>>` : '<<<OUTPUT_START>>>';
  const end = outputNonce ? `<<<OUTPUT_END:${outputNonce}>>>` : '<<<OUTPUT_END>>>';
  process.stdout.write(`\n${start}\n${JSON.stringify(output)}\n${end}\n`);
}

async function main(): Promise<void> {
  let input: ContainerInput;
  let apiKey: string | undefined;
  try {
    const raw = await readStdin();
    const parsed = JSON.parse(raw);
    // Extract API key and nonce from stdin envelope (secure: not in docker inspect or args)
    if (typeof parsed._apiKey === 'string' && parsed._apiKey) {
      apiKey = parsed._apiKey;
      delete parsed._apiKey;
    }
    if (typeof parsed._nonce === 'string' && parsed._nonce) {
      outputNonce = parsed._nonce;
      delete parsed._nonce;
    }
    input = validateInput(parsed);
  } catch (err) {
    writeOutput({ status: 'error', result: '', error: `Invalid input: ${(err as Error).message}` });
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

    // Pass API key only to the direct child — not via process.env
    const childEnv: Record<string, string> = { HOME: '/home/agent' };
    if (apiKey) childEnv.ANTHROPIC_API_KEY = apiKey;

    const result = spawnSync('claude', args, {
      cwd: workDir,
      encoding: 'utf-8',
      timeout: (input.timeout ?? 300) * 1000,
      input: prompt,
      env: childEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.error) {
      writeOutput({ status: 'error', result: '', error: result.error.message.slice(0, 1000) });
      return;
    }

    const stdout = result.stdout ?? '';
    const sessionId = input.sessionId || `warsclaw-${input.groupFolder}`;

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
