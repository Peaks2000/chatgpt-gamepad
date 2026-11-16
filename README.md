# ChatGPT Gamepad

A local Windows bridge and Codex skill for controlling a game through a virtual Xbox 360 controller. One Python process owns the controller for the session. The Node client can send a timed controller sequence and capture the next frame in a single Codex tool call. Short actions keep screen feedback frequent, and longer sequences let predictable movement run at local speed.

## Setup

Use Windows with an x64 Python 3.10+ installation. Install [ViGEmBus 1.22.0](https://github.com/nefarius/ViGEmBus/releases/tag/v1.22.0) from the upstream release if it is missing. ViGEmBus is an archived driver. Keep game and platform rules in mind when deciding where to use automation.

In PowerShell from this repository, create an environment for the bridge. The environment variable tells the Python package to skip its bundled, older driver installer. The live bridge itself needs no administrator permissions once the driver is available.

```powershell
python -m venv .venv
$env:VGAMEPAD_SKIP_VIGEMBUS_INSTALL = 'true'
.\.venv\Scripts\python.exe -m pip install vgamepad==0.2.0
```

Copy the entire [gamepad-control](gamepad-control) folder into your Codex skills directory, normally `~/.codex/skills`. In a Codex chat on the Windows host, invoke `$gamepad-control` and give it the path to the environment's Python executable and the game you want to control. The skill needs a persistent Node session that can start a local subprocess, such as Codex's Node REPL. Open the target game and bring it to the foreground.

## Try it

Run the test with Node.js and a Python executable. Dry run needs only Python's standard library.

```powershell
node smoke-test.mjs .\.venv\Scripts\python.exe
```

For an actual device check, start the bridge, keep it open, and confirm that Windows lists a controller in Game Controllers (`joy.cpl`). Then bring your target game to the foreground and send a short action through the skill. In a local controller test app, you can target that app's executable and use the same check.

```powershell
.\.venv\Scripts\python.exe -u gamepad-control/scripts/gamepad.py --target-exe MyGame.exe
```

The program reads one JSON object per line from stdin. It prints a readiness message first, then one reply per command. For example, this moves forward for 400 ms and jumps while moving for another 120 ms. The bridge releases all controls after the command.

```json
{"steps":[{"ms":400,"ly":0.75},{"ms":120,"ly":0.75,"buttons":["A"]}]}
```

Use an app's observed controller bindings. Commands are rejected when the target executable is outside the foreground. Alt+Tab away from the game to release the current input, or call `gamepad.stop()` to stop the Node session and disconnect the controller. In the standalone terminal, Ctrl+C stops the bridge. Passing `--dry-run` prints the actual report timing and bypasses the driver and foreground check.

## Play with a model

The standalone Windows harness captures the foreground game window by handle, sends one frame to a model, validates its next controller plan, and runs it through the same Xbox bridge. It checks the window again before executing a plan and logs capture, model, and controller time for every turn. Use windowed or borderless mode for reliable capture. Inside the Codex harness, the [Gamepad Control skill](gamepad-control/SKILL.md) uses Computer Use's native screenshot display.

Install the capture dependency in the same Python environment you used for the controller. The harness also requires Node.js 22 or later.

```powershell
.\.venv\Scripts\python.exe -m pip install "Pillow>=11.2.1"
```

**Ollama.** Start the local Ollama server, pull a vision model per the [Ollama vision guide](https://docs.ollama.com/capabilities/vision), and pass its installed tag as `--model`. Frames are sent to the local Ollama server on port 11434.

```powershell
ollama pull qwen3-vl:2b-instruct
node harness/play.mjs --provider ollama --model qwen3-vl:2b-instruct --python .\.venv\Scripts\python.exe --target MyGame.exe --goal "Follow the trail and stay behind cover"
```

**ChatGPT subscription.** Install the [Codex CLI](https://developers.openai.com/codex/cli), run `codex login`, and choose ChatGPT sign-in. The harness checks the CLI login mode and sends screenshots to OpenAI through Codex. It uses the signed-in account's Codex usage allowance. Pass `--model` to select an available Codex model, or let the CLI choose its default. If Codex is outside your PATH, use `--codex` with the full executable path. See [Codex authentication](https://learn.chatgpt.com/docs/auth).

```powershell
node harness/play.mjs --provider codex --python .\.venv\Scripts\python.exe --target MyGame.exe --goal "Move toward the next checkpoint using cover"
```

For live capture, Ollama loads the model before the first game frame. Switch to the target window during the five-second countdown. The harness takes up to ten decisions by default. Set `--turns` for a longer session. The controller releases input after every sequence. Alt+Tab away to stop gameplay commands, or use Ctrl+C to stop the harness.

Model inference is usually the dominant delay. The Codex path starts a CLI turn for each frame and is suited to slower, deliberate actions. With a fast local model, tune `--frame-width` and set `--max-frame-age-ms` to skip decisions that arrive too late for the game. Judge model performance from the logged times and play results.

After a live controller action, the next turn reports how much of the image changed. The model can use that signal with the current frame to spot actions that need a correction, such as trying to walk through a wall. Animation and other players also affect the reading.

Add `--controls presets` to let the model choose a named action each turn. The harness applies the matching fixed controller sequence, including small aim corrections, eased turns, movement, and button taps. Start with presets when tuning a local model. Use the default direct controls when a game needs custom button combinations or hold durations. The game’s controller settings determine how far a stick action moves or turns.

Use `--preset-file controls.json` to replace the built-in presets with actions calibrated for your game. Give each action a descriptive name and up to six controller states totaling at most 2.5 seconds. The harness always includes an `observe` action that sends no input. A short action list lets you test just the decisions a scenario needs.

```json
{
  "aim_right_small": [{ "ms": 150, "rx": 0.55 }],
  "aim_left_small": [{ "ms": 150, "rx": -0.55 }],
  "move_forward": [{ "ms": 650, "ly": 0.85 }]
}
```

To check a model against a saved PNG or JPEG without sending controller inputs to a game, replace `--target MyGame.exe` with `--dry-run --frame sample.png --turns 1`. The selected model still receives the image.

To inspect decisions while you play, combine `--dry-run` with `--target MyGame.exe`. The harness captures the foreground game and logs the model's proposed inputs through the dry-run bridge. You keep the controller. With Codex as the provider, the selected game frames are sent to OpenAI.

To compare models, use `--replay aim-replay.json` with the same goal and presets for each provider. Paths are relative to the manifest. Replay evaluates each frame independently, keeps expected actions out of model prompts, and runs selected actions through the dry-run controller. The command prints a score and exits with status 1 if any action mismatches or exceeds `--max-frame-age-ms` when that limit is set.

```json
[
  { "frame": "target-left.png", "expected": "aim_left_small" },
  { "frame": "target-right.png", "expected": "aim_right_small" }
]
```
