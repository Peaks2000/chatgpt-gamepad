# Fortnite with the virtual controller

Use the current HUD for button bindings and weapon behavior. Controller presets, deadzones, look curves, and ADS sensitivity affect calibration. Build the first calibration in a quiet spot or practice area. Keep each probe short.

## Calibrate camera input

1. Stand still and read the compass from a fresh frame. Start with a direct 150 ms pulse at `rx: 0.55`. Read the compass again after the stick returns to neutral. If the camera barely moves, increase stick strength on the next probe. Record the start and end headings, signed stick strength, and complete timing profile.
2. Calibrate both directions. Keep a small pulse for corrections and an eased pulse for wider turns. Repeat each profile to see how much the result varies. When tuning a profile, keep the ramp and stick strength fixed and change the hold duration. Different stick strengths can yield very different turn rates. Check pitch against a stationary edge and calibrate aiming down sights separately.
3. Compute the shortest signed angle from the current heading to the desired heading. Pick a measured pulse in that direction that turns by roughly the desired amount or slightly less. Use a smaller probe when none fits. Read the fresh heading after each action before making another correction or starting a run.

### Measured starting points

These are individual observations from a live Fortnite session. Verify them on the current settings before relying on them. Each eased pulse used a 100 ms ramp at each end with the left stick and triggers neutral.

| Right stick X | Hold | Total | Compass | Observed turn |
| ---: | ---: | ---: | --- | ---: |
| +0.85 | 410 ms | 610 ms | 248° to 323° | +75° |
| −0.85 | 340 ms | 540 ms | 323° to 261° | −62° |

A separate direct pulse at `rx: 0.55` for 150 ms moved the compass about 3° before a forward movement. Treat it as a small starting probe and remeasure it while stationary.

```js
const { easedYaw, headingDelta } = await import(motionModuleFileUrl);
const error = headingDelta(currentHeading, desiredHeading);
// Use the observed left turn when it fits the remaining angle.
if (error <= -62 && error >= -75) {
  const { observation } = await gamepad.act(easedYaw({ rx: -0.85, holdMs: 340 }), observeGame);
  // Read the new compass heading in observation before planning the next pulse.
}
```

In a fight, use the latest frame and shorten corrections as the reticle closes in. Fire when the reticle is on a clear target. Check the target, impact, or ammo before sending another shot. Hold the trigger when the weapon and visibility support it.

## Move with purpose

- Pick the next piece of cover, opening, or teammate from the frame. Turn in place when lining up a narrow passage or a large change in heading. For a wide opening, carry forward speed with the left stick and add a short right-stick correction, then check the new heading and position.
- Ease in and out when crossing a short gap, tracking a landmark, or rounding a corner. Use a direct stick input for an urgent dodge or a short correction. Strong or long pulses are easier to overshoot when the target is close.
- Approach loot at a walk. Get the pickup prompt into view, release movement, and use the shown input. Verify the inventory slot before switching or firing.
- Check the minimap and storm timer before a long rotation. Move with the squad and preserve cover. Get a usable weapon and shield before taking a fresh fight when the match gives you time. If knocked, crawl to nearby cover or a teammate and watch for the revive.

## Reboot a teammate

- Check the squad HUD for the teammate’s reboot card status. If it needs collecting, use the card marker and timer to decide whether you can reach it. Verify the HUD shows the card recovered before committing to the van.
- Pick a reachable van using the minimap. Travel in segments between visible cover and check the storm before a long detour. Stop within reach and read the interaction prompt.
- Use the button and hold shown on the prompt. When the HUD shows progress, keep that button held across consecutive states in a single sequence. Check the progress after the sequence and verify completion in the squad HUD when the teammate returns.

## Improve from observed results

Track whether a turn landed on the intended heading, the character stopped where expected, and the intended action appeared in the HUD. Change one input at a time after a miss. If the screen changed while an action was being chosen, refresh it before committing to a fight. A scripted input pulse can be precise while the target is already moving elsewhere.
