import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openGamepad } from '../gamepad-control/scripts/session.mjs';
import { buildPrompt, parseAction } from './actions.mjs';
import { codexProvider, ollamaProvider, ollamaSchema } from './providers.mjs';

const { values: config } = parseArgs({ options: {
  provider: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
  codex: { type: 'string', default: 'codex' },
  python: { type: 'string', default: 'python' },
  target: { type: 'string' },
  goal: { type: 'string' },
  turns: { type: 'string', default: '10' },
  'timeout-ms': { type: 'string', default: '30000' },
  'max-frame-age-ms': { type: 'string' },
  'frame-width': { type: 'string', default: '1280' },
  'dry-run': { type: 'boolean' },
  frame: { type: 'string' },
  help: { type: 'boolean' },
} });

function startCapture(signal, width) {
  const worker = spawn(config.python, [
    '-u', fileURLToPath(new URL('./capture.py', import.meta.url)), config.target, String(width),
  ], { signal, windowsHide: true, stdio: ['pipe', 'pipe', 'inherit'] });
  let failure;
  worker.on('error', error => { failure = error; });
  worker.stdin.on('error', error => { failure = error; });
  const lines = createInterface({ input: worker.stdout });
  const frames = lines[Symbol.asyncIterator]();
  async function request(command) {
    worker.stdin.write(command + '\n');
    const next = await frames.next();
    if (next.done) throw failure ?? new Error('Capture worker stopped');
    const reply = JSON.parse(next.value);
    if (reply.error) throw new Error(reply.error);
    return reply;
  }
  return {
    async frame() {
      const reply = await request('capture');
      return Buffer.from(reply.frame, 'base64');
    },
    async checkFocus() {
      await request('check');
    },
    stop() {
      lines.close();
      worker.kill();
    },
  };
}

async function main() {
  if (config.help) {
    console.log('node harness/play.mjs --provider ollama|codex --goal "..." [--model NAME] [--codex PATH] [--python PATH] [--target GAME.exe] [--turns N] [--timeout-ms MS] [--max-frame-age-ms MS] [--frame-width PX] [--dry-run --frame IMAGE]');
    return;
  }
  const turns = Number(config.turns);
  const timeout = Number(config['timeout-ms']);
  const width = Number(config['frame-width']);
  const maxAge = config['max-frame-age-ms'] === undefined ? Infinity : Number(config['max-frame-age-ms']);
  if (!config.goal?.trim() || !['ollama', 'codex'].includes(config.provider) ||
      (config.provider === 'ollama' && !config.model) ||
      (config['dry-run'] ? !config.frame : !/^[^/\\]+\.exe$/i.test(config.target ?? '') || config.frame) ||
      !Number.isSafeInteger(turns) || turns < 1 ||
      !Number.isInteger(timeout) || timeout < 1000 || timeout > 300000 ||
      (config['max-frame-age-ms'] !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 20)) ||
      !Number.isInteger(width) || width < 640 || width > 1920) {
    throw new Error('Invalid arguments. See --help. Live mode needs --target, and dry run needs --frame.');
  }

  const controller = new AbortController();
  const { signal } = controller;
  let pad;
  let camera;
  const stop = () => {
    controller.abort();
    pad?.stop();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const decide = config.provider === 'ollama'
      ? ollamaProvider(config.model, timeout, signal)
      : await codexProvider(config.codex, config.model, timeout, signal);
    const schema = config.provider === 'ollama' ? ollamaSchema : undefined;
    const fixture = config.frame && await readFile(config.frame);
    if (!fixture) {
      console.error(`Bring ${config.target} to the foreground. Starting in 5 seconds. Ctrl+C stops the harness.`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      signal.throwIfAborted();
      camera = startCapture(signal, width);
    }
    pad = await openGamepad({ python: config.python, targetExe: config.target, dryRun: config['dry-run'] });
    let previous = [];
    for (let turn = 1; turn <= turns; turn++) {
      signal.throwIfAborted();
      const started = performance.now();
      const frame = fixture ?? await camera.frame();
      const captured = performance.now();
      const steps = parseAction(await decide(buildPrompt(config.goal, previous, schema), frame));
      signal.throwIfAborted();
      const decided = performance.now();
      const stale = decided - started > maxAge;
      if (steps.length && !stale) {
        await camera?.checkFocus();
        signal.throwIfAborted();
        await pad.play(steps);
      }
      console.log(JSON.stringify({
        turn, steps, stale, captureMs: Math.round(captured - started),
        decisionMs: Math.round(decided - captured), controllerMs: Math.round(performance.now() - decided),
      }));
      previous = stale ? [] : steps;
    }
  } finally {
    camera?.stop();
    pad?.stop();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
