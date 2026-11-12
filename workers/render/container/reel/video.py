import json
import logging
import os
import subprocess

from .errors import RenderError

log = logging.getLogger("reel.video")

MAX_OUTPUT_BYTES = 25 * 1024 * 1024
FFMPEG_TIMEOUT_SECONDS = 120
DEFAULT_RENDER_TIMEOUT_SECONDS = 7200
DEFAULT_SKIA_DIR = "/app/skia"


def render_timeout_seconds() -> int:
    raw = os.environ.get("RENDER_TIMEOUT_SECONDS") or os.environ.get("REMOTION_TIMEOUT_SECONDS")
    try:
        return int(raw) if raw else DEFAULT_RENDER_TIMEOUT_SECONDS
    except ValueError:
        return DEFAULT_RENDER_TIMEOUT_SECONDS


def skia_dir() -> str:
    return os.environ.get("SKIA_DIR") or DEFAULT_SKIA_DIR


def build_skia_cmd(job_dir: str) -> list:
    return ["node", os.path.join(skia_dir(), "dist", "render.mjs"), job_dir]


def build_faststart_cmd(raw: str, out: str) -> list:
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-i", raw, "-c", "copy", "-movflags", "+faststart", out,
    ]  # fmt: skip


def build_poster_cmd(video: str, out: str, second: float) -> list:
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{second:.3f}", "-i", video, "-frames:v", "1", "-q:v", "3", out,
    ]  # fmt: skip


def run_ffmpeg(cmd: list, cwd: str) -> None:
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT_SECONDS
        )
    except subprocess.TimeoutExpired as err:
        raise RenderError("ffmpeg_failed", "ffmpeg timed out") from err
    except OSError as err:
        raise RenderError("ffmpeg_failed", f"ffmpeg could not start: {err}") from err
    if proc.returncode != 0:
        log.error("ffmpeg failed code=%d stderr=%s", proc.returncode, proc.stderr[-800:])
        raise RenderError("ffmpeg_failed", f"ffmpeg exited {proc.returncode}")


def probe(path: str) -> dict:
    try:
        proc = subprocess.run(
            [
                "ffprobe", "-v", "error", "-print_format", "json",
                "-show_format", "-show_streams", path,
            ],
            capture_output=True, text=True, timeout=30,
        )  # fmt: skip
        if proc.returncode != 0:
            raise RenderError("ffmpeg_failed", "ffprobe failed")
        return json.loads(proc.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as err:
        raise RenderError("ffmpeg_failed", f"ffprobe failed: {err}") from err


def media_seconds(path: str) -> float:
    return float(probe(path)["format"]["duration"])


def check_output_size(path: str) -> int:
    size = os.path.getsize(path)
    if size > MAX_OUTPUT_BYTES:
        raise RenderError("too_large", f"output is {size} bytes, over {MAX_OUTPUT_BYTES}")
    return size


def run_skia(job_dir: str, timeout: int | None = None) -> None:
    """Render <job_dir>/props.json to <job_dir>/raw.mp4 with the Skia renderer (the orchestrator scrubs the env for its drawing child)."""
    timeout = timeout or render_timeout_seconds()
    try:
        proc = subprocess.run(
            build_skia_cmd(job_dir),
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=skia_dir() if os.path.isdir(skia_dir()) else None,
        )
    except subprocess.TimeoutExpired as err:
        raise RenderError("ffmpeg_failed", "skia render timed out") from err
    except OSError as err:
        raise RenderError("ffmpeg_failed", f"node could not start: {err}") from err
    for line in proc.stdout.splitlines()[-12:]:
        log.info("skia: %s", line)
    if proc.returncode != 0:
        log.error("skia failed code=%d stderr=%s", proc.returncode, proc.stderr[-1500:])
        raise RenderError("ffmpeg_failed", f"skia exited {proc.returncode}")
