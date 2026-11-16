import assert from 'node:assert/strict';
import { openGamepad } from './gamepad-control/scripts/session.mjs';
import { easedYaw, headingDelta, rampSticks } from './gamepad-control/scripts/motion.mjs';

const python = process.argv[2];
if (!python) throw new Error('Usage: node smoke-test.mjs <python executable>');
const pad = await openGamepad({ python, dryRun: true });
try {
  const steps = [{ ms: 90, ly: 0.75 }, { ms: 65, buttons: ['A'], rx: -0.25, rt: 0.8 }];
  const sequence = pad.play(steps);
  await assert.rejects(() => pad.play([{ ms: 20 }]), /current sequence/);
  const { trace } = await sequence;
  assert.equal(trace.length, 3);
  assert.equal(trace[0].state.ly, 0.75);
  assert.equal(trace[1].state.ly, 0);
  assert.equal(trace[1].state.rx, -0.25);
  assert.equal(trace[1].state.rt, 0.8);
  assert.deepEqual(trace[1].state.buttons, ['A']);
  assert.equal(trace[2].state, null);
  assert.ok(trace[1].at_ms - trace[0].at_ms >= 89);
  assert.ok(trace[2].at_ms - trace[1].at_ms >= 64);

  await assert.rejects(() => pad.play([{ ms: 20 }, { ms: 20, lx: 2 }]), /lx must be/);
  const next = await pad.act([{ ms: 20 }], async () => {
    await assert.rejects(() => pad.play([{ ms: 20 }]), /observation to finish/);
    return 'frame';
  });
  assert.equal(next.result.trace.length, 2);
  assert.equal(next.result.trace[1].state, null);
  assert.equal(next.observation, 'frame');
  assert.ok(next.inputMs >= 19);
  const stride = { ly: 0.8, rx: -0.5 };
  const accelerate = rampSticks({ to: stride, ms: 127, buttons: ['LB'] });
  const brake = rampSticks({ from: stride, ms: 101, buttons: ['LB'] });
  const { trace: motion } = await pad.play([...accelerate, ...brake]);
  assert.equal(accelerate.reduce((total, report) => total + report.ms, 0), 127);
  assert.equal(brake.reduce((total, report) => total + report.ms, 0), 101);
  assert.ok(accelerate[0].ly > 0 && accelerate[0].ly < accelerate[1].ly);
  assert.equal(motion[accelerate.length - 1].state.rx, -0.5);
  assert.equal(motion.at(-2).state.ly, 0);
  assert.ok(motion.slice(0, -1).every(entry => entry.state.buttons.includes('LB')));
  assert.equal(motion.at(-1).state, null);

  assert.equal(headingDelta(350, 10), 20);
  assert.equal(headingDelta(10, 350), -20);
  assert.equal(headingDelta(248, 323), 75);
  assert.equal(headingDelta(323, 261), -62);
  assert.equal(headingDelta(360, 0), 0);
  assert.throws(() => headingDelta(0, NaN), /finite/);
  assert.throws(() => easedYaw({ rx: 0.85, holdMs: 9990 }), /full turn/);
  const yaw = easedYaw({ rx: -0.85, holdMs: 340 });
  const { trace: turnTrace } = await pad.play(yaw);
  assert.equal(yaw.reduce((total, report) => total + report.ms, 0), 540);
  assert.deepEqual(yaw[5], { rx: -0.85, ms: 340 });
  assert.ok(turnTrace.slice(0, -1).every(({ state }) => state.lx === 0 && state.ly === 0 && state.ry === 0 && state.rx <= 0));
  assert.equal(turnTrace.at(-2).state.rx, 0);
  assert.equal(turnTrace.at(-1).state, null);
  const interrupted = pad.play([{ ms: 10000, lt: 1 }]);
  pad.stop();
  await assert.rejects(interrupted, /session stopped/);
  await assert.rejects(() => pad.play([{ ms: 20 }]), /session is closed/);
  console.log('Timed reports, validation, neutral release, and stop passed');
} finally {
  pad.stop();
}
