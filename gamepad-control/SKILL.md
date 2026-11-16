---
name: gamepad-control
description: Operate Windows games and controller-compatible apps through a virtual Xbox gamepad. Use for smooth analog movement, calibrated stick aim, button holds, triggers, and live Fortnite play.
---

# Control a Windows app with a virtual gamepad

Start a gamepad session once per target with [session.mjs](scripts/session.mjs) in a persistent Node session. Use the target executable basename from the observed window and the full path to a Python interpreter with `vgamepad` installed. The host also needs ViGEmBus.

In the Codex harness, use the normal Computer Use screenshot path for fast gameplay feedback. Select the game window once with `cua.getApp` in `cua_repl`. For live frames, call `gameWindow.getScreenshot()` with its default display behavior. The tool displays the image directly. Reuse the window handle and capture the frame in the same call as the controller action when both are available in that session.

```js
const { openGamepad } = await import(sessionModuleFileUrl);
const observeGame = () => gameWindow.getScreenshot();
globalThis.gamepad = await openGamepad({
  python: pythonExecutable,
  targetExe: observedExecutableBasename,
});
await gamepad.act(
  [{ ms: 120, ly: 0.75 }, { ms: 100, buttons: ['A'], ly: 0.75 }],
  observeGame,
);
```

`play` accepts 1–32 full controller states totaling up to 10 seconds. Each state has `ms` (20–10000), optional `buttons` (A, B, X, Y, LB, RB, LS, RS, BACK, START, UP, DOWN, LEFT, RIGHT), sticks `lx`, `ly`, `rx`, `ry` from -1 to 1 (positive is right/up), and triggers `lt`, `rt` from 0 to 1. Omitted inputs return to neutral at the next step. Send consecutive states to avoid releasing a button between steps.

Use `act(steps, observe)` for live play. The callback captures the next frame in the same tool call after the bridge releases all inputs. Inspect that frame before choosing the next action. Use `play(steps)` when a separate observation is unnecessary. If capture fails, refresh the screen before retrying because the input may have already run.

Identify controller bindings from the app. Begin with short stick and button pulses, and calibrate camera motion against the observed heading. Combine movement and aim in one step when both should occur together. Use longer sequences for predictable traversal. Switching to another window releases an active sequence. The `act` result contains `inputMs` and `observationMs` for local timing. These exclude model reasoning and tool dispatch.

Use `rampSticks` from [motion.mjs](scripts/motion.mjs) to ease the sticks into or out of a planned move. It returns normal bridge steps with the given duration. Pass the previous step's stick values as `from` to join a ramp smoothly. Put reactions that must be immediate in direct `play` or `act` steps.

```js
const { rampSticks } = await import(motionModuleFileUrl);
const stride = { ly: 0.85, rx: 0.4 };
await gamepad.act([
  ...rampSticks({ to: stride, ms: 120 }),
  { ...stride, ms: 360 },
  ...rampSticks({ from: stride, ms: 100 }),
], observeGame);
```

Read the [Fortnite playbook](references/fortnite.md) when playing Fortnite. Calibrate stationary turns in both directions before combining turning and movement. Use `headingDelta` and `easedYaw` from [motion.mjs](scripts/motion.mjs) to measure a turn and replay its stick profile. Reuse the settings that produced a measured turn, then check the new heading before correcting.

When handing control back, ending work, or receiving a user stop signal, call `gamepad.stop()`. After a focus change, recheck the current screen before resuming authorized control. To diagnose command timing without emitting controller inputs, open with `{python: pythonExecutable, dryRun: true}` and inspect the returned trace.
