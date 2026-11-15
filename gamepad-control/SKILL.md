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
await gamepad.play([{ ms: 350, ly: 0.75 }, { ms: 110, buttons: ['A'], ly: 0.75 }]);
```

`play` accepts 1–32 full controller states totaling up to 10 seconds. Each state has `ms` (20–10000), optional `buttons` (A, B, X, Y, LB, RB, LS, RS, BACK, START, UP, DOWN, LEFT, RIGHT), sticks `lx`, `ly`, `rx`, `ry` from -1 to 1 (positive is right/up), and triggers `lt`, `rt` from 0 to 1. Omitted inputs return to neutral at the next step. Send consecutive states to avoid releasing a button between steps.

Start with one short action and check the result visually. Identify controller bindings from the app and calibrate camera movement with short pulses. Batch consecutive inputs only when the intervening state is predictable. Keep sessions foregrounded. Switching away neutralizes an active sequence, and the bridge neutralizes all inputs after each sequence.

When handing control back, ending work, or receiving a user stop signal, call `gamepad.stop()`. After a focus change, recheck the current screen before resuming authorized control. To diagnose command timing without emitting controller inputs, open with `{python: pythonExecutable, dryRun: true}` and inspect the returned trace.
