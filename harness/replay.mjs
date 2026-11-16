import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export async function loadReplay(path, actions) {
  const source = await readFile(path, 'utf8');
  const entries = JSON.parse(source.replace(/^\uFEFF/, ''));
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('A replay must be a nonempty array of frame and expected-action entries');
  }
  return entries.map((entry, index) => {
    if (typeof entry?.frame !== 'string' || !entry.frame.trim() || !actions.includes(entry.expected)) {
      throw new Error(`Replay entry ${index + 1} needs a frame path and a supported expected action`);
    }
    return { ...entry, file: resolve(dirname(path), entry.frame) };
  });
}
