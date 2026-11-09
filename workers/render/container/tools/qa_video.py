"""QA a rendered reel: probe it, write a contact sheet and flag layout/encode problems.

  python tools/qa_video.py video.mp4 out_dir [t1 t2 ...]   # default: one frame every 4 s

Writes out_dir/sheet.png (phone-size tiles with the app's UI-safe zones outlined), the individual
frames, and prints a report. Exit code 1 when a hard check fails (size, duration, codec).
"""
import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

MAX_SECONDS = 60.5
MAX_BYTES = 25 * 1024 * 1024
TILE_W = 270
COLUMNS = 6


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, check=True).stdout


def probe(path):
    info = json.loads(
        run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path])
    )
    video = next(s for s in info["streams"] if s["codec_type"] == "video")
    audio = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    return info["format"], video, audio


def main():
    path, out = sys.argv[1], Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    fmt, video, audio = probe(path)
    duration = float(fmt["duration"])
    times = [float(t) for t in sys.argv[3:]] or [i * 4.0 for i in range(int(duration // 4) + 1)]
    times = [t for t in times if t < duration - 0.1]

    problems = []
    if (video["width"], video["height"]) != (720, 1280):
        problems.append(f"size {video['width']}x{video['height']}")
    if video["codec_name"] != "h264" or video.get("pix_fmt") != "yuv420p":
        problems.append(f"codec {video['codec_name']}/{video.get('pix_fmt')}")
    if audio is None or audio["codec_name"] != "aac":
        problems.append("no aac audio")
    if duration > MAX_SECONDS:
        problems.append(f"duration {duration:.1f}s")
    if int(fmt["size"]) > MAX_BYTES:
        problems.append(f"bytes {fmt['size']}")

    frames = []
    for t in times:
        png = out / f"f_{t:05.1f}.png"
        run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", path, "-frames:v", "1", str(png)])
        frames.append((t, Image.open(png).convert("RGB")))

    tile_h = TILE_W * 1280 // 720
    rows = (len(frames) + COLUMNS - 1) // COLUMNS
    sheet = Image.new("RGB", (COLUMNS * TILE_W, rows * tile_h), (20, 20, 24))
    for i, (t, frame) in enumerate(frames):
        tile = frame.resize((TILE_W, tile_h))
        d = ImageDraw.Draw(tile)
        d.rectangle([0, tile_h * 0.78, TILE_W, tile_h], outline=(255, 80, 80))  # bottom 22% (app UI)
        d.rectangle([TILE_W * 0.85, 0, TILE_W, tile_h], outline=(255, 80, 80))  # right 15%
        d.text((6, tile_h - 14), f"{t:.1f}s", fill=(255, 255, 0))
        sheet.paste(tile, ((i % COLUMNS) * TILE_W, (i // COLUMNS) * tile_h))
    sheet.save(out / "sheet.png")

    bitrate = int(fmt["bit_rate"]) / 1000
    print(
        f"{path}: {video['width']}x{video['height']} {video['codec_name']} {duration:.1f}s "
        f"{int(fmt['size']) / 1e6:.1f}MB {bitrate:.0f}kbps fps={video['r_frame_rate']}"
    )
    print("PROBLEMS: " + "; ".join(problems) if problems else "ok")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
