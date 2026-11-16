"""Capture the visible game client area on demand over stdin."""

import base64
import ctypes
from io import BytesIO
import json
from pathlib import Path
import sys

from PIL import Image, ImageGrab

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "gamepad-control" / "scripts"))
from gamepad import Foreground


def capture(game, width):
    target = game.identity()
    focused = game.for_sequence()
    if not target or not focused() or game.identity() != target:
        raise ValueError("Bring the target game to the foreground")
    image = ImageGrab.grab(window=target[0])
    if not focused():
        raise ValueError("Game lost focus during capture")
    image.thumbnail((width, width))
    if not image.getbbox():
        raise ValueError("The game window returned a blank frame. Try windowed or borderless mode")
    # A small RGB sample makes it possible to compare consecutive frames without decoding JPEGs in Node.
    signature = image.resize((32, 18), Image.Resampling.BOX).tobytes()
    output = BytesIO()
    image.convert("RGB").save(output, format="JPEG", quality=83)
    return {
        "frame": base64.b64encode(output.getvalue()).decode("ascii"),
        "signature": base64.b64encode(signature).decode("ascii"),
    }, focused


def main():
    ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    game = Foreground(sys.argv[1])
    width = int(sys.argv[2])
    focused = None
    for command in sys.stdin:
        try:
            if command.strip() == "check":
                if not focused or not focused():
                    raise ValueError("Game window changed after capture")
                reply = {"focused": True}
            else:
                reply, focused = capture(game, width)
        except (ValueError, OSError) as error:
            reply = {"error": str(error)}
        print(json.dumps(reply), flush=True)


if __name__ == "__main__":
    main()
