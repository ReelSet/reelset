"""Poster frame choice: the latest sharp frame of the hook scene, before the first transition blurs it."""

import logging
import subprocess

import numpy as np

from .errors import RenderError

log = logging.getLogger("reel.poster")

SAMPLE_FPS = 12
SAMPLE_WIDTH = 270
SAMPLE_HEIGHT = 480
WINDOW_START_SECOND = 0.5
FALLBACK_WINDOW_END_SECOND = 8.0
# The hook text is still landing before this; a dip here is an entrance animation, not the exit.
MIN_SETTLE_SECONDS = 1.0
# A frame this much softer than the sharpest one so far means the exit transition has begun.
DIP_RATIO = 0.6
# A whole-frame change this large (mean grey levels) is a cut to the next scene.
CUT_DIFF = 40.0
# Among frames before the exit, the latest one at least this sharp wins: all words landed, no blur.
KEEP_RATIO = 0.9
SAMPLE_TIMEOUT_SECONDS = 60


def sharpness(frame: np.ndarray) -> float:
    """Variance of the Laplacian: high for crisp edges and text, low for motion blur."""
    f = frame.astype(np.float32)
    lap = 4 * f[1:-1, 1:-1] - f[:-2, 1:-1] - f[2:, 1:-1] - f[1:-1, :-2] - f[1:-1, 2:]
    return float(lap.var())


def pick_second(times: list, frames: list) -> float | None:
    """The poster time from greyscale samples, or None when there is nothing usable."""
    if not frames:
        return None
    scores = [sharpness(f) for f in frames]
    best = 0.0
    kept = []
    for i, (t, score) in enumerate(zip(times, scores)):
        settled = t - times[0] >= MIN_SETTLE_SECONDS
        if settled and i > 0:
            diff = float(np.abs(frames[i].astype(np.int16) - frames[i - 1].astype(np.int16)).mean())
            if score < best * DIP_RATIO or diff > CUT_DIFF:
                log.debug("poster exit at %.2fs score=%.0f best=%.0f diff=%.1f", t, score, best, diff)
                break
        best = max(best, score)
        kept.append((t, score))
    if not kept or best <= 0:
        return None
    return max(t for t, score in kept if score >= best * KEEP_RATIO)


def build_sample_cmd(video: str, start: float, end: float) -> list:
    return [
        "ffmpeg", "-hide_banner", "-loglevel", "error",
        "-ss", f"{start:.3f}", "-t", f"{max(end - start, 0.1):.3f}", "-i", video,
        "-vf", f"fps={SAMPLE_FPS},scale={SAMPLE_WIDTH}:{SAMPLE_HEIGHT},format=gray",
        "-f", "rawvideo", "-",
    ]  # fmt: skip


def sample_frames(video: str, start: float, end: float) -> tuple:
    try:
        proc = subprocess.run(
            build_sample_cmd(video, start, end), capture_output=True, timeout=SAMPLE_TIMEOUT_SECONDS
        )
    except (subprocess.TimeoutExpired, OSError) as err:
        raise RenderError("ffmpeg_failed", f"poster sampling failed: {err}") from err
    if proc.returncode != 0:
        raise RenderError("ffmpeg_failed", f"poster sampling exited {proc.returncode}")
    size = SAMPLE_WIDTH * SAMPLE_HEIGHT
    count = len(proc.stdout) // size
    raw = np.frombuffer(proc.stdout[: count * size], dtype=np.uint8)
    frames = list(raw.reshape(count, SAMPLE_HEIGHT, SAMPLE_WIDTH))
    times = [start + i / SAMPLE_FPS for i in range(count)]
    return times, frames


def choose_second(video: str, fallback: float, hook_end: float | None = None) -> float:
    """Sharpest settled hook frame; `fallback` (the old fixed guess) when sampling finds nothing."""
    end = hook_end + 0.2 if hook_end else FALLBACK_WINDOW_END_SECOND
    try:
        times, frames = sample_frames(video, WINDOW_START_SECOND, max(end, WINDOW_START_SECOND + 1))
        second = pick_second(times, frames)
    except RenderError as err:
        log.warning("poster sampling failed, using %.2fs: %s", fallback, err)
        return fallback
    if second is None:
        log.warning("poster sampling found no frames, using %.2fs", fallback)
        return fallback
    log.info("poster frame %.2fs (fixed guess was %.2fs, %d samples)", second, fallback, len(frames))
    return second


def main(argv: list) -> int:
    """`python -m reel.poster VIDEO OUT.jpg`: write a sharp poster for an already finished reel."""
    import json
    import os
    import sys

    from . import props, video

    if len(argv) != 2:
        print("usage: python -m reel.poster VIDEO OUT.jpg", file=sys.stderr)
        return 2
    src, out = argv
    fallback = props.fallback_poster_second(video.media_seconds(src))
    second = choose_second(src, fallback)
    video.run_ffmpeg(video.build_poster_cmd(src, out, second), os.path.dirname(os.path.abspath(out)))
    print(json.dumps({"second": round(second, 3), "fallback": second == fallback}))
    return 0


if __name__ == "__main__":
    import sys

    logging.basicConfig(level=logging.WARNING)
    sys.exit(main(sys.argv[1:]))
