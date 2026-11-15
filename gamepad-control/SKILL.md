---
name: gamepad-control
description: Send timed Xbox controller inputs to a Windows game or controller-compatible app when the user asks Codex to operate it through a virtual gamepad. Use for analog movement, stick aim, button holds, and triggers.
---

# Control a Windows app with a virtual gamepad

Use the normal computer-use surface for screenshots and window selection. Start a gamepad session once per target with [session.mjs](scripts/session.mjs) in a persistent Node session. Use the target executable basename from the observed window and the full path to a Python interpreter with `vgamepad` installed. The host also needs ViGEmBus.

```js
const { openGamepad } = await import(sessionModuleFileUrl);
globalThis.gamepad = await openGamepad({
  python: pythonExecutable,
  targetExe: observedExecutableBasename,
});
await gamepad.act(
  [{ ms: 120, ly: 0.75 }, { ms: 100, buttons: ['A'], ly: 0.75 }],
  () => sky.get_window_state({ window: observedWindow }),
);
```

`play` accepts 1–32 full controller states totaling up to 10 seconds. Each state has `ms` (20–10000), optional `buttons` (A, B, X, Y, LB, RB, LS, RS, BACK, START, UP, DOWN, LEFT, RIGHT), sticks `lx`, `ly`, `rx`, `ry` from -1 to 1 (positive is right/up), and triggers `lt`, `rt` from 0 to 1. Omitted inputs return to neutral at the next step. Send consecutive states to avoid releasing a button between steps.

Use `act(steps, observe)` for live play. The callback captures the next frame in the same tool call after the bridge releases all inputs. Inspect that frame before choosing the next action. Use `play(steps)` when a separate observation is unnecessary. If capture fails, refresh the screen before retrying because the input may have already run.

Identify controller bindings from the app. Begin with short stick and button pulses, and calibrate camera motion against the observed heading. Combine movement and aim in one step when both should occur together. Use longer sequences for predictable traversal. Switching to another window releases an active sequence. The `act` result contains `inputMs` and `observationMs` for local timing. These exclude model reasoning and tool dispatch.

When handing control back, ending work, or receiving a user stop signal, call `gamepad.stop()`. After a focus change, recheck the current screen before resuming authorized control. To diagnose command timing without emitting controller inputs, open with `{python: pythonExecutable, dryRun: true}` and inspect the returned trace.
