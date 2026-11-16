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

// Positive means turn right on a compass that increases clockwise.
export function headingDelta(from, to) {
  if (![from, to].every(Number.isFinite)) {
    throw new RangeError('Headings must be finite numbers');
  }
  const clockwise = (((to % 360) - (from % 360)) % 360 + 360) % 360;
  return clockwise > 180 ? clockwise - 360 : clockwise;
}

export function easedYaw({ rx, holdMs, rampMs = 100 }) {
  if (!Number.isFinite(rx) || rx === 0 || Math.abs(rx) > 1) {
    throw new RangeError('Yaw stick input must be nonzero and between -1 and 1');
  }
  if (!Number.isInteger(holdMs) || holdMs < 20 || holdMs + 2 * rampMs > 10000) {
    throw new RangeError('Hold duration must be at least 20 ms and the full turn at most 10000 ms');
  }
  const turn = { rx };
  return [
    ...rampSticks({ to: turn, ms: rampMs }),
    { ...turn, ms: holdMs },
    ...rampSticks({ from: turn, ms: rampMs }),
  ];
}
