import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const bridge = fileURLToPath(new URL('./gamepad.py', import.meta.url));

export async function openGamepad({ python, targetExe, dryRun = false }) {
  if (!python || (!dryRun && !targetExe)) {
    throw new Error('Provide a Python executable and, for live mode, a target executable basename');
  }
  const options = dryRun ? ['--dry-run'] : ['--target-exe', targetExe];
  const child = spawn(python, ['-u', bridge, ...options], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  let stderr = '';
  let pending;
  let stopped = false;
  let observing = false;

  function finish(error, result) {
    const request = pending;
    if (!request) return;
    pending = undefined;
    clearTimeout(request.timer);
    if (error) request.reject(error);
    else request.resolve(result);
  }

  function stop(error = new Error('Gamepad session stopped')) {
    stopped = true;
    finish(error);
    child.kill();
  }

  function readReply(timeoutMs) {
    if (stopped) throw new Error('Gamepad session is closed');
    if (pending) throw new Error('Wait for the current sequence before sending another');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => stop(new Error('Gamepad reply timed out')), timeoutMs);
      pending = { resolve, reject, timer };
    });
  }

  child.stderr.setEncoding('utf8').on('data', chunk => {
    stderr = (stderr + chunk).slice(-4096);
  });
  child.on('error', error => stop(error));
  child.stdin.on('error', error => stop(error));
  child.on('close', code => {
    stopped = true;
    finish(new Error(stderr.trim() || `Gamepad bridge exited (${code})`));
  });
  lines.on('line', line => {
    try {
      finish(null, JSON.parse(line));
    } catch {
      stop(new Error('Gamepad sent an invalid reply'));
    }
  });

  const hello = await readReply(8000);
  if (hello.ready !== true) {
    stop();
    throw new Error('Gamepad did not announce readiness');
  }
  async function play(steps) {
    const line = JSON.stringify({ steps }) + '\n';
    if (Buffer.byteLength(line) > 16384) throw new Error('Command exceeds the line limit');
    const response = readReply(13000);
    child.stdin.write(line);
    const result = await response;
    if (!result.ok) throw new Error(result.error);
    return result;
  }

  return {
    async play(steps) {
      if (observing) throw new Error('Wait for the action and its observation to finish');
      return play(steps);
    },
    async act(steps, observe) {
      if (typeof observe !== 'function') throw new TypeError('Provide an observation callback');
      if (observing) throw new Error('Wait for the action and its observation to finish');
      observing = true;
      try {
        const started = performance.now();
        const result = await play(steps);
        const released = performance.now();
        const observation = await observe();
        return {
          result,
          observation,
          inputMs: released - started,
          observationMs: performance.now() - released,
        };
      } finally {
        observing = false;
      }
    },
    stop,
  };
}
