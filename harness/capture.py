"""Capture the visible game client area on demand over stdin."""

import base64
import ctypes
from ctypes import wintypes
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import ImageGrab

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gamepad-control" / "scripts"))
from gamepad import Foreground


def capture(game, width):
    target = game.identity()
    focused = game.for_sequence()
    if not target or not focused() or game.identity() != target:
        raise ValueError("Bring the target game to the foreground")
    window = target[0]
    area = wintypes.RECT()
    origin = wintypes.POINT()
    if not game.user.GetClientRect(window, ctypes.byref(area)):
        raise ValueError("Could not read the game client area")
    if not game.user.ClientToScreen(window, ctypes.byref(origin)):
        raise ValueError("Could not locate the game client area")
    if area.right <= 0 or area.bottom <= 0:
        raise ValueError("The game client area is empty")
    image = ImageGrab.grab(
        bbox=(origin.x, origin.y, origin.x + area.right, origin.y + area.bottom),
        all_screens=True,
    )
    if not focused():
        raise ValueError("Game lost focus during capture")
    image.thumbnail((width, width))
    output = BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=83)
    return base64.b64encode(output.getvalue()).decode("ascii")


def main():
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    game = Foreground(sys.argv[1])
    game.user.GetClientRect.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.RECT))
    game.user.ClientToScreen.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.POINT))
    width = int(sys.argv[2])
    for _ in sys.stdin:
        try:
            reply = {"frame": capture(game, width)}
        except (ValueError, OSError) as error:
            reply = {"error": str(error)}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
