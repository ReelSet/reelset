import logging
import os
import re
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


DOWNLOAD_ATTEMPTS = 3


def _download(url: str, dest: str, check, limit: int, accept: str = "video/", opener=None, sleep=None) -> bool:
    """Media files are large and CDNs drop connections: 3 tries with backoff, then skip (returns False)."""
    extra = {"sleep": sleep} if sleep else {}
    data = images._fetch(url, check, opener, accept, limit, attempts=DOWNLOAD_ATTEMPTS, **extra)
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


def build_demo_cmd(src: str, dest: str, seconds: float, start: float = 0.0) -> list:
    """GIF/WebM/MP4 -> mp4 (even dimensions, <= 1080 wide, no audio, trimmed from `start`). Works for animated GIFs."""
    seek = ["-ss", f"{start:.2f}"] if start > 0 else []
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, *seek, "-t", f"{seconds:.2f}", "-an",
        "-vf", "scale='min(1080,iw)':-2:flags=lanczos,fps=30,format=yuv420p",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-movflags", "+faststart", dest,
    ]  # fmt: skip


SCENE_THRESHOLD = 0.25
SCENE_SAMPLE_FPS = 4
SCENE_SCAN_SECONDS = 30
MIN_INTRO_SECONDS = 1.0
FALLBACK_START_SHARE = 0.25
_PTS = re.compile(r"pts_time:([0-9]+(?:\.[0-9]+)?)")


def build_scene_cmd(src: str) -> list:
    """Scene changes in the first 30 s, sampled at 4 fps so a slow fade off a title card still registers."""
    return [
        "ffmpeg", "-hide_banner", "-nostats", "-t", str(SCENE_SCAN_SECONDS), "-i", src, "-an",
        "-vf", f"fps={SCENE_SAMPLE_FPS},select='gt(scene,{SCENE_THRESHOLD})',showinfo", "-f", "null", "-",
    ]  # fmt: skip


def parse_scene_times(stderr: str) -> list:
    return [float(m.group(1)) for m in _PTS.finditer(stderr)]


def pick_demo_start(cuts: list, duration: float, keep: float = MAX_DEMO_SECONDS) -> float:
    """Skip a README video's title card: the first scene change at >= 1 s, else 25% in. Never so late
    that less than 2 s (or the whole clip, if shorter) is left."""
    if duration <= 0:
        return 0.0
    start = next((t for t in sorted(cuts) if t >= MIN_INTRO_SECONDS), duration * FALLBACK_START_SHARE)
    room = min(2.0, duration / 2)
    return round(max(0.0, min(start, duration - room)), 2)


DETAIL_SAMPLE_FPS = 2
DETAIL_SCAN_SECONDS = 60
EMPTY_SHARE = 0.5
MIN_SEGMENT_SECONDS = 3.0
FADE_TRIM_SECONDS = 0.25
_YAVG = re.compile(r"lavfi\.signalstats\.YAVG=([0-9]+(?:\.[0-9]+)?)")


def build_detail_cmd(src: str) -> list:
    """Edge density per sample (2 fps, first 60 s): a README slideshow's fades and blank cards score ~0."""
    return [
        "ffmpeg", "-hide_banner", "-nostats", "-t", str(DETAIL_SCAN_SECONDS), "-i", src, "-an",
        "-vf", f"fps={DETAIL_SAMPLE_FPS},scale=480:-2,edgedetect=low=0.08:high=0.2,signalstats,"
        "metadata=print:key=lavfi.signalstats.YAVG", "-f", "null", "-",
    ]  # fmt: skip


def parse_detail(stderr: str) -> list:
    """[(seconds, detail)] from `metadata=print` output (a pts_time line, then its YAVG line)."""
    out, t = [], None
    for line in stderr.splitlines():
        m = _PTS.search(line)
        if m:
            t = float(m.group(1))
            continue
        v = _YAVG.search(line)
        if v and t is not None:
            out.append((t, float(v.group(1))))
            t = None
    return out


def pick_demo_window(samples: list, keep: float = MAX_DEMO_SECONDS):
    """The stretch of a README video worth showing: the run of frames with real UI on screen (no fade,
    no blank or title card) that has the most detail, from >= 1 s in, at most `keep` s long.
    Returns (start, seconds) or None when the samples say nothing (then the scene-cut rule applies)."""
    if len(samples) < 4:
        return None
    values = sorted(v for _, v in samples)
    floor = values[len(values) // 2] * EMPTY_SHARE
    if floor <= 0:
        return None
    step = samples[1][0] - samples[0][0] if len(samples) > 1 else 1 / DETAIL_SAMPLE_FPS
    runs, cur = [], []
    for t, v in samples:
        if v >= floor and t >= MIN_INTRO_SECONDS:
            cur.append((t, v))
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    best, best_score = None, -1.0
    for run in runs:
        start = run[0][0] + FADE_TRIM_SECONDS
        length = run[-1][0] + step - FADE_TRIM_SECONDS - start
        if length < MIN_SEGMENT_SECONDS:
            continue
        mean = sum(v for _, v in run) / len(run)
        score = mean * min(length, keep)
        if score > best_score:
            best, best_score = (round(start, 2), round(min(length, keep), 2)), score
    return best


def _detail_samples(src: str) -> list:
    try:
        proc = subprocess.run(build_detail_cmd(src), capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("demo detail scan failed err=%s", err)
        return []
    return parse_detail(proc.stderr)


def _scene_cuts(src: str) -> list:
    try:
        proc = subprocess.run(build_scene_cmd(src), capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("scene detect failed err=%s", err)
        return []
    return parse_scene_times(proc.stderr)


def _duration(path: str) -> float:
    from . import video

    try:
        return float(video.probe(path)["format"].get("duration") or 0)
    except (RenderError, KeyError, ValueError, TypeError):
        return 0.0


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
    probe: Callable[[str], dict] | None = None, cuts: Callable[[str], list] = _scene_cuts,
    duration: Callable[[str], float] = _duration, detail: Callable[[str], list] = _detail_samples,
) -> dict | None:
    """README demo -> assets/demo.mp4. Returns {file, seconds, width, height, repo} or None; never raises."""
    if not demo:
        return None
    raw = os.path.join(assets_dir, "demo.src")
    out = os.path.join(assets_dir, "demo.mp4")
    try:
        if not download(demo["url"], raw):
            return None
        window = pick_demo_window(detail(raw))
        start, seconds = window or (pick_demo_start(cuts(raw), duration(raw)), MAX_DEMO_SECONDS)
        log.info("demo start=%.2fs seconds=%.2f by=%s", start, seconds, "detail" if window else "cuts")
        run(build_demo_cmd(raw, out, seconds, start))
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
