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
