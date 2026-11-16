import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { openGamepad } from '../gamepad-control/scripts/session.mjs';
import { buildPrompt, parseAction } from './actions.mjs';
import { codexProvider, ollamaProvider, ollamaSchema } from './providers.mjs';
import { createPresets, loadPresets } from './presets.mjs';
import { actionFeedback, frameChangePercent } from './feedback.mjs';
import { loadReplay } from './replay.mjs';

const { values: config } = parseArgs({ options: {
  provider: { type: 'string', default: 'ollama' },
  model: { type: 'string' },
  codex: { type: 'string', default: 'codex' },
  python: { type: 'string', default: 'python' },
  target: { type: 'string' },
  goal: { type: 'string' },
  controls: { type: 'string' },
  'preset-file': { type: 'string' },
  turns: { type: 'string', default: '10' },
  'timeout-ms': { type: 'string', default: '30000' },
  'max-frame-age-ms': { type: 'string' },
  'frame-width': { type: 'string', default: '1280' },
  'dry-run': { type: 'boolean' },
  frame: { type: 'string' },
  replay: { type: 'string' },
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
      return {
        frame: Buffer.from(reply.frame, 'base64'),
        signature: Buffer.from(reply.signature, 'base64'),
      };
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
    console.log('node harness/play.mjs --provider ollama|codex --goal "..." [--controls direct|presets] [--preset-file PATH] [--model NAME] [--codex PATH] [--python PATH] [--turns N] [--timeout-ms MS] [--max-frame-age-ms MS] [--frame-width PX] [[--dry-run] --target GAME.exe | --dry-run --frame IMAGE | --replay MANIFEST]');
    return;
  }
  const turns = Number(config.turns);
  const timeout = Number(config['timeout-ms']);
  const width = Number(config['frame-width']);
  const maxAge = config['max-frame-age-ms'] === undefined ? Infinity : Number(config['max-frame-age-ms']);
  const replayFile = config.replay;
  const dryRun = Boolean(config['dry-run'] || replayFile);
  const sources = [config.target, config.frame, replayFile].filter(Boolean);
  if (!config.goal?.trim() || !['ollama', 'codex'].includes(config.provider) ||
      !['direct', 'presets'].includes(config.controls ?? 'direct') ||
      (config['preset-file'] && config.controls === 'direct') ||
      (config.provider === 'ollama' && !config.model) ||
      sources.length !== 1 ||
      (config.target && !/^[^/\\]+\.exe$/i.test(config.target)) ||
      (config.frame && !dryRun) ||
      (replayFile && config.controls === 'direct') ||
      !Number.isSafeInteger(turns) || turns < 1 ||
      !Number.isInteger(timeout) || timeout < 1000 || timeout > 300000 ||
      (config['max-frame-age-ms'] !== undefined && (!Number.isSafeInteger(maxAge) || maxAge < 20)) ||
      !Number.isInteger(width) || width < 640 || width > 1920) {
    throw new Error('Invalid arguments. See --help for live window, dry-run frame, and replay modes.');
  }

  const presetFile = config['preset-file'];
  const customActions = presetFile ? loadPresets(await readFile(presetFile, 'utf8')) : undefined;
  const presets = presetFile || replayFile || config.controls === 'presets' ? createPresets(customActions) : undefined;
  const replay = replayFile && await loadReplay(replayFile, presets.schema.properties.action.enum);
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
    const schema = presets?.schema ?? (config.provider === 'ollama' ? ollamaSchema : undefined);
    const local = config.provider === 'ollama' ? ollamaProvider(config.model, timeout, signal, schema) : undefined;
    const decide = local?.decide ?? await codexProvider(config.codex, config.model, timeout, signal, schema);
    const fixture = config.frame && await readFile(config.frame);
    if (config.target) {
      if (local) {
        console.error(`Loading Ollama model ${config.model} before game capture.`);
        await local.preload();
      }
      console.error(`Bring ${config.target} to the foreground. Starting in 5 seconds. Ctrl+C stops the harness.`);
      await new Promise(resolve => {
        const timer = setTimeout(resolve, 5000);
        signal.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
      });
      signal.throwIfAborted();
      camera = startCapture(signal, width);
    }
    pad = await openGamepad({ python: config.python, targetExe: config.target, dryRun });
    let previous;
    let actionFrame;
    let correct = 0;
    const total = replay ? replay.length : turns;
    for (let turn = 1; turn <= total; turn++) {
      signal.throwIfAborted();
      const started = performance.now();
      const entry = replay ? replay[turn - 1] : undefined;
      const { frame, signature } = entry ? { frame: await readFile(entry.file) }
        : fixture ? { frame: fixture } : await camera.frame();
      const captured = performance.now();
      const frameChange = frameChangePercent(actionFrame, signature);
      const prompt = presets ? presets.prompt(config.goal, previous) : buildPrompt(config.goal, previous ?? [], schema);
      const feedback = actionFeedback(frameChange);
      const output = await decide(feedback ? prompt + '\n' + feedback : prompt, frame);
      const { action, steps } = presets ? presets.parse(output) : { steps: parseAction(output) };
      signal.throwIfAborted();
      const decided = performance.now();
      const stale = decided - started > maxAge;
      if (steps.length && !stale) {
        await camera?.checkFocus();
        signal.throwIfAborted();
        await pad.play(steps);
      }
      actionFrame = !dryRun && steps.length && !stale ? signature : undefined;
      const matched = entry ? action === entry.expected && !stale : undefined;
      correct += Number(matched === true);
      console.log(JSON.stringify({
        turn, action, expected: entry?.expected, matched, steps, stale, dryRun,
        frameChangePercent: frameChange, captureMs: Math.round(captured - started),
        decisionMs: Math.round(decided - captured), controllerMs: Math.round(performance.now() - decided),
      }));
      previous = stale || replay || (camera && dryRun) ? undefined : action ?? steps;
    }
    if (replay) {
      console.log(JSON.stringify({ replay: replayFile, correct, total }));
      if (correct !== total) process.exitCode = 1;
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
