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
MAX_DEMO_SECONDS = 6.0
BROLL_SIZE = (720, 1280)
BROLL_HOSTS = frozenset({"videos.pexels.com"})
FFMPEG_TIMEOUT = 90
DOWNLOAD_WORKERS = 4
MAX_KEPT_CLIPS = 14

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


MIN_LUMA = 38.0
MIN_SHARPNESS = 1.8
QUALITY_SAMPLE_FPS = 2
QUALITY_SECONDS = 6
QUALITY_SIZE = (360, 640)
_YAVG_ANY = re.compile(r"lavfi\.signalstats\.YAVG=([0-9]+(?:\.[0-9]+)?)")
LAPLACIAN = "0m='0 -1 0 -1 4 -1 0 -1 0':0rdiv=1:0bias=0"


def _quality_chain(extra: str) -> str:
    w, h = QUALITY_SIZE
    return (
        f"fps={QUALITY_SAMPLE_FPS},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h}{extra},"
        "signalstats,metadata=print:key=lavfi.signalstats.YAVG"
    )


def build_luma_cmd(src: str, seconds: float = QUALITY_SECONDS) -> list:
    """Mean luma per sampled frame (2 fps over the part of the clip that is used)."""
    return [
        "ffmpeg", "-hide_banner", "-nostats", "-t", f"{seconds:.2f}", "-i", src, "-an",
        "-vf", _quality_chain(""), "-f", "null", "-",
    ]  # fmt: skip


def build_sharpness_cmd(src: str, seconds: float = QUALITY_SECONDS) -> list:
    """Edge energy per sampled frame: mean of the positive Laplacian response. A sharp frame scores
    ~3-14, an out-of-focus or smooth one under 2."""
    return [
        "ffmpeg", "-hide_banner", "-nostats", "-t", f"{seconds:.2f}", "-i", src, "-an",
        "-vf", _quality_chain(f",format=gray,convolution={LAPLACIAN}"), "-f", "null", "-",
    ]  # fmt: skip


def parse_metric(stderr: str) -> list:
    return [float(m.group(1)) for m in _YAVG_ANY.finditer(stderr)]


def _median(values: list) -> float:
    ordered = sorted(values)
    mid = len(ordered) // 2
    return ordered[mid] if len(ordered) % 2 else (ordered[mid - 1] + ordered[mid]) / 2


def assess_clip(luma: list, sharpness: list) -> str | None:
    """Why a stock clip is unusable as a backdrop (None when it is fine): too dark (median luma under
    38 of 255 vanishes under the scrim) or out of focus / featureless (median edge energy under 1.8).
    No samples means the check could not run, so the clip is kept."""
    if luma and _median(luma) < MIN_LUMA:
        return f"too dark (luma {_median(luma):.1f} < {MIN_LUMA:g})"
    if sharpness and _median(sharpness) < MIN_SHARPNESS:
        return f"too blurry (edge energy {_median(sharpness):.2f} < {MIN_SHARPNESS:g})"
    return None


def _measure(cmd: list) -> list:
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("clip quality scan failed err=%s", err)
        return []
    return parse_metric(proc.stderr)


def clip_problem(src: str, seconds: float = QUALITY_SECONDS) -> str | None:
    return assess_clip(_measure(build_luma_cmd(src, seconds)), _measure(build_sharpness_cmd(src, seconds)))


SIGNATURE_SIZE = (9, 8)
SAME_LOOK_BITS = 12


def dhash(gray: list, width: int = SIGNATURE_SIZE[0], height: int = SIGNATURE_SIZE[1]) -> int:
    """64-bit difference hash of a gray frame (width x height, row-major): one bit per left/right neighbour pair."""
    bits = 0
    for y in range(height):
        for x in range(width - 1):
            bits = (bits << 1) | (1 if gray[y * width + x] > gray[y * width + x + 1] else 0)
    return bits


def look_distance(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def clip_signature(path: str, seconds: float = 3.0) -> int | None:
    """dHash of a frame in the middle of a clip, via one tiny raw gray ffmpeg frame; None when it cannot be read."""
    w, h = SIGNATURE_SIZE
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{max(0.0, seconds / 2):.2f}", "-i", path,
        "-frames:v", "1", "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("clip signature failed err=%s", err)
        return None
    if proc.returncode != 0 or len(proc.stdout) < w * h:
        return None
    return dhash(list(proc.stdout[: w * h]), w, h)


def drop_lookalikes(entries: list, signatures: list, max_bits: int = SAME_LOOK_BITS) -> list:
    """Keeps the first of every group of clips that look alike (stock sets shot on one desk differ by a
    few pixels): a reel never shows what reads as the same footage twice. Unreadable signatures are kept."""
    kept, seen = [], []
    for entry, sig in zip(entries, signatures):
        if sig is not None and any(look_distance(sig, other) <= max_bits for other in seen):
            log.info("broll rejected file=%s reason=looks like an earlier clip", entry.get("file"))
            continue
        if sig is not None:
            seen.append(sig)
        kept.append(entry)
    return kept


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
    """GIF/WebM/MP4 -> mp4 (even dimensions, <= 1440 wide, no audio, trimmed from `start`). Works for animated GIFs."""
    seek = ["-ss", f"{start:.2f}"] if start > 0 else []
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", src, *seek, "-t", f"{seconds:.2f}", "-an",
        "-vf", "scale='min(1440,iw)':-2:flags=lanczos,fps=30,format=yuv420p",
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


MOTION_SAMPLE_FPS = 2
STATIC_MOTION = 0.004
_SCENE_SCORE = re.compile(r"lavfi\.scene_score=([0-9]+(?:\.[0-9]+)?)")


def build_motion_cmd(src: str) -> list:
    """Frame-to-frame change per sample (2 fps, first 60 s): how much actually moves on screen."""
    return [
        "ffmpeg", "-hide_banner", "-nostats", "-t", str(DETAIL_SCAN_SECONDS), "-i", src, "-an",
        "-vf", f"fps={MOTION_SAMPLE_FPS},scale=480:-2,select='gte(scene,0)',metadata=print:key=lavfi.scene_score",
        "-f", "null", "-",
    ]  # fmt: skip


def parse_motion(stderr: str) -> list:
    """[(seconds, scene score)] from `metadata=print` output."""
    out, t = [], None
    for line in stderr.splitlines():
        m = _PTS.search(line)
        if m:
            t = float(m.group(1))
            continue
        v = _SCENE_SCORE.search(line)
        if v and t is not None:
            out.append((t, float(v.group(1))))
            t = None
    return out


def _motion_in(motion: list, start: float, length: float, step: float) -> float:
    """Mean change inside a window; the first sample is the cut into it, so it does not count."""
    inside = [v for t, v in motion if start + step <= t < start + length]
    return sum(inside) / len(inside) if inside else 0.0


def pick_demo_window(samples: list, keep: float = MAX_DEMO_SECONDS, motion: list | None = None):
    """The stretch of a README video worth showing: inside a run of frames with real UI on screen (no
    fade, no blank or title card), from >= 1 s in, at most `keep` s long. With `motion` samples it is the
    stretch where the most moves (a gallery filling in beats a static form); without, the one with the
    most detail. Returns (start, seconds) or None when the samples say nothing (then the scene-cut rule applies)."""
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
        span = min(length, keep)
        if motion:
            # Slide a window of `span` over the run in half-second steps.
            offset = 0.0
            while offset + span <= length + 1e-6:
                s0 = start + offset
                score = _motion_in(motion, s0, span, step)
                if score > best_score:
                    best, best_score = (round(s0, 2), round(span, 2)), score
                offset += 0.5
            continue
        mean = sum(v for _, v in run) / len(run)
        score = mean * span
        if score > best_score:
            best, best_score = (round(start, 2), round(span, 2)), score
    return best


def is_static(motion: list, start: float, seconds: float) -> bool:
    """A demo whose chosen stretch barely changes (a form, a settings page): zoom into its text instead."""
    if not motion:
        return False
    return _motion_in(motion, start, seconds, 1 / MOTION_SAMPLE_FPS) < STATIC_MOTION


def _motion_samples(src: str) -> list:
    try:
        proc = subprocess.run(build_motion_cmd(src), capture_output=True, text=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("demo motion scan failed err=%s", err)
        return []
    return parse_motion(proc.stderr)


def text_region(gray: list, width: int, height: int) -> dict:
    """Where the readable UI sits in a frame, from edge energy. `gray` is row-major luma (0-255).
    Returns {focus: {x, y}, content: {x0, x1}} in 0-1: the densest cell of a 3x3 grid and the
    horizontal extent of everything that carries edges, so a crop can start at a heading, not inside it."""
    energy = [[0.0] * width for _ in range(height)]
    for y in range(1, height - 1):
        row, up, down = gray[y * width:(y + 1) * width], gray[(y - 1) * width:y * width], gray[(y + 1) * width:(y + 2) * width]
        for x in range(1, width - 1):
            energy[y][x] = abs(row[x + 1] - row[x - 1]) + abs(down[x] - up[x])
    cols = [sum(energy[y][x] for y in range(height)) for x in range(width)]
    peak = max(cols) or 1.0
    live = [x for x, c in enumerate(cols) if c > peak * 0.12]
    x0, x1 = (live[0] / width, (live[-1] + 1) / width) if live else (0.0, 1.0)
    best, best_cell = -1.0, (1, 1)
    for gy in range(3):
        for gx in range(3):
            total = sum(
                energy[y][x]
                for y in range(gy * height // 3, (gy + 1) * height // 3)
                for x in range(gx * width // 3, (gx + 1) * width // 3)
            )
            if total > best:
                best, best_cell = total, (gx, gy)
    focus = {"x": round((best_cell[0] + 0.5) / 3, 3), "y": round((best_cell[1] + 0.5) / 3, 3)}
    return {"focus": focus, "content": {"x0": round(x0, 3), "x1": round(x1, 3)}}


def _frame_region(src: str, at: float) -> dict | None:
    """`text_region` of one frame of the demo (via a raw gray ffmpeg frame); None when it cannot be read."""
    w, h = 192, 108
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", src, "-frames:v", "1",
        "-vf", f"scale={w}:{h},format=gray", "-f", "rawvideo", "-",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as err:
        log.warning("demo region scan failed err=%s", err)
        return None
    if proc.returncode != 0 or len(proc.stdout) < w * h:
        return None
    return text_region(list(proc.stdout[: w * h]), w, h)


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
    clips: list, assets_dir: str, download: Download = download_broll, run: Run = _ffmpeg,
    problem: Callable[[str, float], str | None] = clip_problem,
    signature: Callable[[str, float], int | None] = clip_signature,
) -> list:
    """Download, vet and trim stock clips. Returns [{file, seconds, width, height, beat?, creator?, creatorUrl?, pageUrl?}].
    A failed or unusable (too dark, out of focus) clip is skipped and logged with the reason, never fatal."""

    def one(item):
        index, clip = item
        raw = os.path.join(assets_dir, f"broll{index}.src")
        out = f"broll{index}.mp4"
        seconds = clip_seconds(clip.get("seconds"))
        try:
            if not download(clip["url"], raw):
                return None
            why = problem(raw, seconds)
            if why:
                log.info("broll rejected id=%s reason=%s", clip.get("id"), why)
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
        return entry, signature(os.path.join(assets_dir, out), seconds)

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        results = list(pool.map(one, enumerate(clips)))
    made = [r for r in results if r is not None]
    kept = drop_lookalikes([e for e, _ in made], [sig for _, sig in made])[:MAX_KEPT_CLIPS]
    log.info("broll kept=%d of %d", len(kept), len(clips))
    return kept


def collect_demo(
    demo: dict | None, assets_dir: str, download: Download = download_demo, run: Run = _ffmpeg,
    probe: Callable[[str], dict] | None = None, cuts: Callable[[str], list] = _scene_cuts,
    duration: Callable[[str], float] = _duration, detail: Callable[[str], list] = _detail_samples,
    motion: Callable[[str], list] = _motion_samples, region: Callable[[str, float], dict | None] = _frame_region,
) -> dict | None:
    """README demo -> assets/demo.mp4. Returns {file, seconds, width, height, repo, static?, focus?, content?}
    or None; never raises. The stretch shown is the one with the most motion (see `pick_demo_window`);
    a demo that barely moves is flagged `static` and carries the densest text region for a zoom."""
    if not demo:
        return None
    raw = os.path.join(assets_dir, "demo.src")
    out = os.path.join(assets_dir, "demo.mp4")
    try:
        if not download(demo["url"], raw):
            return None
        moves = motion(raw)
        window = pick_demo_window(detail(raw), motion=moves)
        start, seconds = window or (pick_demo_start(cuts(raw), duration(raw)), MAX_DEMO_SECONDS)
        static = is_static(moves, start, seconds)
        log.info(
            "demo start=%.2fs seconds=%.2f by=%s static=%s", start, seconds,
            ("motion" if moves else "detail") if window else "cuts", static,
        )
        run(build_demo_cmd(raw, out, seconds, start))
        info = (probe or _probe)(out)
        found = region(raw, start + seconds / 2)
    except Exception as err:
        log.warning("demo failed err=%s", err)
        return None
    finally:
        if os.path.exists(raw):
            os.remove(raw)
    if info["seconds"] < 1.0:
        os.remove(out)
        return None
    return {"file": "demo.mp4", "repo": demo["repo"], **info, "static": static, **(found or {})}


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
