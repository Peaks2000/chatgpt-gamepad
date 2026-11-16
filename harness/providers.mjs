import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { actionSchema } from './actions.mjs';

const run = promisify(execFile);
const ollamaSchema = structuredClone(actionSchema);
ollamaSchema.properties.steps.items.required = ['ms'];

async function runCodex(executable, args, options) {
  const execution = run(executable, args, options);
  execution.child.stdin.on('error', () => {});
  execution.child.stdin.end();
  try {
    return await execution;
  } catch (error) {
    const diagnostic = String(error.stderr ?? '').trim().split('\n').slice(-5).join('\n');
    throw new Error(diagnostic || `Codex failed (${error.killed ? 'timed out' : error.code ?? error.name})`);
  }
}

export function ollamaProvider(model, timeout, signal) {
  return async (prompt, frame) => {
    const response = await fetch('http://127.0.0.1:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]),
      body: JSON.stringify({
        model, stream: false, think: false, keep_alive: '10m', format: ollamaSchema,
        options: { temperature: 0, num_predict: 1024 },
        messages: [{ role: 'user', content: prompt, images: [Buffer.from(frame).toString('base64')] }],
      }),
    });
    if (!response.ok) throw new Error(`Ollama failed (${response.status}): ${await response.text()}`);
    const reply = await response.json();
    if (reply.done_reason === 'length' || !reply.message?.content) {
      throw new Error('Ollama did not return a complete controller plan');
    }
    return reply.message.content;
  };
}

export { ollamaSchema };

export async function codexProvider(executable, model, timeout, signal) {
  const env = { ...process.env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'CODEX_ACCESS_TOKEN']) delete env[key];
  const options = { env, signal, windowsHide: true, timeout, maxBuffer: 1024 * 1024 };
  const status = await runCodex(executable, ['login', 'status'], options);
  if (!/Logged in using ChatGPT/i.test(status.stdout + status.stderr)) {
    throw new Error('Sign in with ChatGPT using codex login before selecting the codex provider');
  }

  return async (prompt, frame) => {
    const scratch = await mkdtemp(join(tmpdir(), 'gamepad-codex-'));
    try {
      const prefix = Buffer.from(frame).subarray(0, 8);
      const image = join(scratch, prefix[0] === 0x89 ? 'frame.png' : 'frame.jpg');
      const schema = join(scratch, 'action.json');
      const output = join(scratch, 'decision.json');
      await Promise.all([writeFile(image, frame), writeFile(schema, JSON.stringify(actionSchema))]);
      const args = [
        '-a', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
        '--sandbox', 'read-only', '--color', 'never', '--image', image,
        '--output-schema', schema, '--output-last-message', output,
      ];
      if (model) args.push('--model', model);
      await runCodex(executable, [...args, 'Return the controller plan directly without using tools.\n' + prompt], {
        ...options, cwd: scratch,
      });
      return await readFile(output, 'utf8');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  };
}
