const STICKS = ['lx', 'ly', 'rx', 'ry'];

function stickVector(state) {
  return STICKS.map(axis => {
    const value = state[axis] ?? 0;
    if (!Number.isFinite(value) || Math.abs(value) > 1) {
      throw new RangeError(`${axis} must be between -1 and 1`);
    }
    return value;
  });
}

// Returns ordinary bridge steps. Reuse the end vector as the next ramp's start.
export function rampSticks({ from = {}, to = {}, ms = 120, buttons, lt, rt } = {}) {
  if (!Number.isInteger(ms) || ms < 40 || ms > 10000) {
    throw new RangeError('Ramp duration must be an integer from 40 to 10000 ms');
  }
  const start = stickVector(from);
  const end = stickVector(to);
  const count = Math.min(12, Math.floor(ms / 20));
  return Array.from({ length: count }, (_, index) => {
    const fraction = (index + 1) / count;
    const eased = fraction * fraction * (3 - 2 * fraction);
    const report = {
      ms: Math.floor(ms * (index + 1) / count) - Math.floor(ms * index / count),
      buttons,
      lt,
      rt,
    };
    for (const [i, axis] of STICKS.entries()) {
      report[axis] = index === count - 1 ? end[i] : start[i] + (end[i] - start[i]) * eased;
    }
    return report;
  });
}
