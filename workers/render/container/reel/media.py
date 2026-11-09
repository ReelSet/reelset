import logging
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from typing import Callable
from urllib.parse import urlparse

from . import images
from .errors import RenderError

log = logging.getLogger("reel.media")

MAX_CLIP_BYTES = 25 * 1024 * 1024
MAX_DEMO_BYTES = 20 * 1024 * 1024
DEFAULT_CLIP_SECONDS = 5.0
MAX_CLIP_SECONDS = 6.0
MAX_DEMO_SECONDS = 8.0
BROLL_SIZE = (720, 1280)
BROLL_HOSTS = frozenset({"videos.pexels.com"})
FFMPEG_TIMEOUT = 90
DOWNLOAD_WORKERS = 3

Download = Callable[[str, str], bool]
Run = Callable[[list], None]


def is_pexels_video_url(url: str) -> bool:
    parsed = images._https_parts(url)
    return parsed is not None and parsed.hostname in BROLL_HOSTS


def _download(url: str, dest: str, check, limit: int, accept: str = "video/") -> bool:
    data = images._fetch(url, check, None, accept, limit)
    if data is None:
        return False
    with open(dest, "wb") as fh:
        fh.write(data)
    return True


def download_broll(url: str, dest: str) -> bool:
    return _download(url, dest, is_pexels_video_url, MAX_CLIP_BYTES)


def download_demo(url: str, dest: str) -> bool:
    # GitHub serves attachments as video/*, image/gif or application/octet-stream; ffmpeg is the validator.
    return _download(url, dest, images.is_public_https_url, MAX_DEMO_BYTES, "")


def _ffmpeg(cmd: list) -> None:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        raise RenderError("ffmpeg_failed", f"ffmpeg: {err}") from err
    if proc.returncode != 0:
        log.warning("ffmpeg failed code=%d stderr=%s", proc.returncode, proc.stderr[-400:])
        raise RenderError("ffmpeg_failed", f"ffmpeg exited {proc.returncode}")


def build_broll_cmd(src: str, dest: str, seconds: float) -> list:
    """Muted, trimmed, 720x1280 cover-cropped 30 fps h264: small, and cheap for the compositor to decode."""
    w, h = BROLL_SIZE
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-t", f"{seconds:.2f}", "-an",
        "-vf", f"scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},fps=30",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", dest,
    ]  # fmt: skip


def build_demo_cmd(src: str, dest: str, seconds: float) -> list:
    """GIF/WebM/MP4 -> mp4 (even dimensions, <= 1080 wide, no audio, trimmed). Works for animated GIFs."""
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, "-t", f"{seconds:.2f}", "-an",
        "-vf", "scale='min(1080,iw)':-2:flags=lanczos,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-movflags", "+faststart", dest,
    ]  # fmt: skip


def clip_seconds(requested) -> float:
    if isinstance(requested, (int, float)) and requested > 0:
        return min(float(requested), MAX_CLIP_SECONDS)
    return DEFAULT_CLIP_SECONDS


def collect_broll(
    clips: list, assets_dir: str, download: Download = download_broll, run: Run = _ffmpeg
) -> list:
    """Download and trim stock clips. Returns [{file, seconds, width, height, beat?, creator?, creatorUrl?, pageUrl?}].
    A failed clip is skipped, never fatal."""

    def one(item):
        index, clip = item
        raw = os.path.join(assets_dir, f"broll{index}.src")
        out = f"broll{index}.mp4"
        seconds = clip_seconds(clip.get("seconds"))
        try:
            if not download(clip["url"], raw):
                return None
            run(build_broll_cmd(raw, os.path.join(assets_dir, out), seconds))
        except Exception as err:
            log.warning("broll failed host=%s err=%s", urlparse(clip["url"]).hostname, err)
            return None
        finally:
            if os.path.exists(raw):
                os.remove(raw)
        entry = {"file": out, "seconds": seconds, "width": BROLL_SIZE[0], "height": BROLL_SIZE[1]}
        for key in ("beat", "creator", "creatorUrl", "pageUrl"):
            if clip.get(key) is not None:
                entry[key] = clip[key]
        return entry

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        results = list(pool.map(one, enumerate(clips)))
    kept = [r for r in results if r is not None]
    log.info("broll kept=%d of %d", len(kept), len(clips))
    return kept


def collect_demo(
    demo: dict | None, assets_dir: str, download: Download = download_demo, run: Run = _ffmpeg,
    probe: Callable[[str], dict] | None = None,
) -> dict | None:
    """README demo -> assets/demo.mp4. Returns {file, seconds, width, height, repo} or None; never raises."""
    if not demo:
        return None
    raw = os.path.join(assets_dir, "demo.src")
    out = os.path.join(assets_dir, "demo.mp4")
    try:
        if not download(demo["url"], raw):
            return None
        run(build_demo_cmd(raw, out, MAX_DEMO_SECONDS))
        info = (probe or _probe)(out)
    except Exception as err:
        log.warning("demo failed err=%s", err)
        return None
    finally:
        if os.path.exists(raw):
            os.remove(raw)
    if info["seconds"] < 1.0:
        os.remove(out)
        return None
    return {"file": "demo.mp4", "repo": demo["repo"], **info}


def _probe(path: str) -> dict:
    from . import video

    data = video.probe(path)
    stream = next(s for s in data["streams"] if s.get("codec_type") == "video")
    return {
        "seconds": float(data["format"]["duration"]),
        "width": int(stream["width"]),
        "height": int(stream["height"]),
    }


def credits_for(broll: list, used: list, demo: dict | None, demo_used: bool) -> list:
    """Attribution for media that actually appears in the video."""
    out = []
    for index in sorted(set(used)):
        if 0 <= index < len(broll):
            clip = broll[index]
            if clip.get("creator") or clip.get("pageUrl"):
                out.append({
                    "kind": "stock", "provider": "pexels", "creator": clip.get("creator"),
                    "creatorUrl": clip.get("creatorUrl"), "url": clip.get("pageUrl"),
                })  # fmt: skip
    if demo and demo_used:
        out.append({"kind": "demo", "repo": demo["repo"], "url": f"https://github.com/{demo['repo']}"})
    return out
