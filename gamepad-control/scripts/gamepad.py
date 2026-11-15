"""Local JSON-lines bridge for a virtual Xbox 360 controller."""

import argparse
import ctypes
from ctypes import wintypes
import json
from pathlib import PureWindowsPath
import sys
import time


BUTTONS = {
    "UP": 0x0001, "DOWN": 0x0002, "LEFT": 0x0004, "RIGHT": 0x0008,
    "START": 0x0010, "BACK": 0x0020, "LS": 0x0040, "RS": 0x0080,
    "LB": 0x0100, "RB": 0x0200,
    "A": 0x1000, "B": 0x2000, "X": 0x4000, "Y": 0x8000,
}
AXES = {"lx", "ly", "rx", "ry", "lt", "rt"}
MAX_LINE = 16384


def normalize(steps):
    if not isinstance(steps, list) or not 1 <= len(steps) <= 32:
        raise ValueError("Provide 1 to 32 steps")
    reports = []
    for step in steps:
        if not isinstance(step, dict) or step.keys() - (AXES | {"ms", "buttons"}):
            raise ValueError("Each step must contain only ms, buttons, and controller axes")
        duration = step.get("ms")
        if type(duration) is not int or not 20 <= duration <= 10000:
            raise ValueError("ms must be an integer from 20 to 10000")
        names = step.get("buttons", [])
        if not isinstance(names, list) or any(
            not isinstance(name, str) or name not in BUTTONS for name in names
        ):
            raise ValueError("buttons must be a list of supported button names")
        report = {"ms": duration, "buttons": sorted(set(names))}
        for axis in sorted(AXES):
            value = step.get(axis, 0)
            minimum = 0 if axis in ("lt", "rt") else -1
            if type(value) not in (int, float) or not minimum <= value <= 1:
                raise ValueError(f"{axis} must be between {minimum} and 1")
            report[axis] = value
        reports.append(report)
    if sum(report["ms"] for report in reports) > 10000:
        raise ValueError("A sequence may last at most 10000 ms")
    return reports


class Foreground:
    def __init__(self, exe):
        self.exe = exe.casefold()
        self.user = ctypes.WinDLL("user32", use_last_error=True)
        self.kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        self.user.GetForegroundWindow.restype = wintypes.HWND
        self.user.GetWindowThreadProcessId.argtypes = (
            wintypes.HWND, ctypes.POINTER(wintypes.DWORD),
        )
        self.kernel.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        self.kernel.OpenProcess.restype = wintypes.HANDLE
        self.kernel.QueryFullProcessImageNameW.argtypes = (
            wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD),
        )
        self.kernel.CloseHandle.argtypes = (wintypes.HANDLE,)

    def identity(self):
        window = self.user.GetForegroundWindow()
        if not window:
            return None
        process_id = wintypes.DWORD()
        if not self.user.GetWindowThreadProcessId(window, ctypes.byref(process_id)):
            return None
        return window, process_id.value

    def for_sequence(self):
        target = self.identity()
        if target is None:
            return lambda: False
        process = self.kernel.OpenProcess(0x1000, False, target[1])
        if not process:
            return lambda: False
        try:
            path = ctypes.create_unicode_buffer(32768)
            length = wintypes.DWORD(len(path))
            if not self.kernel.QueryFullProcessImageNameW(process, 0, path, ctypes.byref(length)):
                return lambda: False
            if PureWindowsPath(path.value).name.casefold() != self.exe:
                return lambda: False
        finally:
            self.kernel.CloseHandle(process)
        return lambda: self.identity() == target


class XboxPad:
    def __init__(self):
        import vgamepad
        self.pad = vgamepad.VX360Gamepad()

    def send(self, state):
        self.pad.reset()
        if state:
            for button in state["buttons"]:
                self.pad.press_button(BUTTONS[button])
            self.pad.left_joystick_float(state["lx"], state["ly"])
            self.pad.right_joystick_float(state["rx"], state["ry"])
            self.pad.left_trigger_float(state["lt"])
            self.pad.right_trigger_float(state["rt"])
        self.pad.update()


class TracePad:
    def __init__(self):
        self.entries = []

    def send(self, state):
        self.entries.append({"at_ms": round(time.perf_counter() * 1000, 2), "state": state})


def play(pad, steps, focused):
    try:
        for step in steps:
            if not focused():
                raise ValueError("Target game is not in the foreground")
            pad.send(step)
            deadline = time.perf_counter() + step["ms"] / 1000
            while (remaining := deadline - time.perf_counter()) > 0:
                time.sleep(min(remaining, 0.015))
                if not focused():
                    raise ValueError("Target game lost focus. Sequence canceled")
    finally:
        pad.send(None)


def reply(message):
    print(json.dumps(message), flush=True)


def serve(pad, focus_for_sequence):
    reply({"ready": True})
    try:
        while raw := sys.stdin.buffer.readline(MAX_LINE + 1):
            if len(raw) > MAX_LINE:
                reply({"ok": False, "error": "Command exceeded the line limit. Session closed"})
                return
            try:
                command = json.loads(raw)
                if not isinstance(command, dict) or set(command) != {"steps"}:
                    raise ValueError("Expected an object with a steps field")
                steps = normalize(command["steps"])
                if isinstance(pad, TracePad):
                    pad.entries.clear()
                started = time.perf_counter()
                play(pad, steps, focus_for_sequence())
                result = {
                    "ok": True,
                    "steps": len(steps),
                    "playback_ms": round((time.perf_counter() - started) * 1000, 2),
                }
                if isinstance(pad, TracePad):
                    result["trace"] = pad.entries
                reply(result)
            except ValueError as error:
                reply({"ok": False, "error": str(error)})
    finally:
        pad.send(None)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="capture timed reports in memory")
    parser.add_argument("--target-exe", help="basename of the game executable")
    args = parser.parse_args()
    if not args.dry_run and (
        not args.target_exe or PureWindowsPath(args.target_exe).name != args.target_exe
        or not args.target_exe.lower().endswith(".exe")
    ):
        parser.error("live mode requires --target-exe with an executable basename")
    try:
        if args.dry_run:
            serve(TracePad(), lambda: lambda: True)
        else:
            focused = Foreground(args.target_exe)
            serve(XboxPad(), focused.for_sequence)
    except KeyboardInterrupt:
        return 130
    except Exception as error:
        print(f"Gamepad bridge failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
