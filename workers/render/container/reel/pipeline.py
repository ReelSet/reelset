import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .version import TEMPLATE_VERSION
from . import images, media, mix, narrator, props, source_images, sources, timing, video, words as words_lib
from .cues import resolve_shots
from .errors import RenderError
from .validation import RenderRequest

log = logging.getLogger("reel.pipeline")

RETRY_DELAY_SECONDS = 1.5

Downloader = Callable[[str, str], bool]


def collect_assets(
    req: RenderRequest,
    assets_dir: str,
    downloader: Downloader = images.download_image,
    public_downloader: Downloader = images.download_public_image,
    page_fetcher: Callable = images.fetch_page,
) -> dict:
    """Fetch the optional source-card cover. Every failure degrades to no cover, never an error."""
    found: dict = {}

    def fetch(url: str, name: str, download: Downloader) -> str | None:
        raw = os.path.join(assets_dir, f"{name}.raw")
        out = f"{name}.jpg"
        try:
            ok = download(url, raw)
            if not ok:
                time.sleep(RETRY_DELAY_SECONDS)  # GitHub's preview CDN rate-limits bursts
                ok = download(url, raw)
            if ok and images.normalize_image(raw, os.path.join(assets_dir, out)):
                return out
        finally:
            if os.path.exists(raw):
                os.remove(raw)
        return None

    for url in req.source_image_urls:
        if name := fetch(url, "cover", downloader):
            found["cover"] = name
            break
    else:
        page = sources.page_url_for_cover(req.source, req.canonical_url)
        html = page_fetcher(page) if page else None
        cover_url = sources.og_image_url(html, page) if html else None
        if cover_url and (name := fetch(cover_url, "cover", public_downloader)):
            found["cover"] = name
    return found


def collect_visuals(
    req: RenderRequest,
    assets_dir: str,
    downloader: Downloader = images.download_image,
    public_downloader: Downloader = images.download_public_image,
    page_fetcher: Callable = images.fetch_page,
    fetch_images: Callable = source_images.collect_item_images,
) -> dict:
    """Source imagery for the composition: `images` (ordered, hero first) and `cover` (= hero).

    Uses the item's captured images; items without any fall back to the direct source preview or
    the page's og:image. Never raises."""
    try:
        found_images = fetch_images(req.images, assets_dir) if req.images else []
    except Exception as err:
        log.warning("source images failed: %s", err)
        found_images = []
    if found_images:
        return {"images": found_images, "cover": found_images[0]["file"]}
    found = collect_assets(req, assets_dir, downloader, public_downloader, page_fetcher)
    if found.get("cover"):
        entry = {"file": found["cover"], "kind": "og"}
        try:
            from PIL import Image

            with Image.open(os.path.join(assets_dir, found["cover"])) as im:
                entry.update(width=im.width, height=im.height)
        except OSError:
            pass
        found["images"] = [entry]
    return found


def _safe(fn: Callable, *args):
    try:
        return fn(*args)
    except Exception as err:
        log.warning("optional media failed: %s", err)
        return None


def run_render(
    req: RenderRequest,
    job_dir: str,
    synth: Callable | None = None,
    downloader: Downloader = images.download_image,
    public_downloader: Downloader = images.download_public_image,
    page_fetcher: Callable = images.fetch_page,
    render: Callable = video.run_remotion,
    fetch_broll: Callable = media.collect_broll,
    fetch_demo: Callable = media.collect_demo,
) -> dict:
    started = time.monotonic()
    log_ctx = f"job={req.job_id}"
    synth = synth or narrator.Narrator(req.tts_engine)
    provider = "supplied"
    assets_dir = os.path.join(job_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    with ThreadPoolExecutor(max_workers=3) as pool:
        covers = pool.submit(
            collect_visuals, req, assets_dir, downloader, public_downloader, page_fetcher
        )
        broll_job = pool.submit(_safe, fetch_broll, req.broll, assets_dir) if req.broll else None
        demo_job = pool.submit(_safe, fetch_demo, req.demo, assets_dir) if req.demo else None

        text = req.narration_text()
        rate = timing.choose_rate(len(text))
        audio_path = os.path.join(assets_dir, "narration.mp3")
        if req.narration_audio is not None:
            with open(audio_path, "wb") as fh:
                fh.write(req.narration_audio)
            words = list(req.narration_words)
            audio_seconds = video.media_seconds(audio_path)
            log.info("%s using supplied narration words=%d %.1fs", log_ctx, len(words), audio_seconds)
            if timing.total_video_seconds(audio_seconds) > timing.MAX_VIDEO_SECONDS:
                raise RenderError("too_large", f"narration is {audio_seconds:.1f}s, over the 60s cap")
        else:
            words = synth(text, req.voice, rate, audio_path)
            audio_seconds = video.media_seconds(audio_path)
            if timing.total_video_seconds(audio_seconds) > timing.MAX_VIDEO_SECONDS:
                faster = timing.refit_rate(rate, audio_seconds)
                if faster is None:
                    raise RenderError(
                        "too_large", f"narration is {audio_seconds:.1f}s, over the 60s cap"
                    )
                log.warning(
                    "%s narration %.1fs at %s, retrying at %s", log_ctx, audio_seconds, rate, faster
                )
                words = synth(text, req.voice, faster, audio_path)
                audio_seconds = video.media_seconds(audio_path)
                if timing.total_video_seconds(audio_seconds) > timing.MAX_VIDEO_SECONDS:
                    raise RenderError(
                        "too_large", f"narration is {audio_seconds:.1f}s at {faster}, over the 60s cap"
                    )
        if req.narration_audio is None:
            provider = narrator.provider_of(synth)
        assets = covers.result()
        if broll_job is not None:
            assets["broll"] = broll_job.result() or []
        if demo_job is not None:
            assets["demo"] = demo_job.result()

    if not words:
        log.warning("%s no word timings from tts, estimating", log_ctx)
        words = timing.estimate_word_timings(text, audio_seconds)
    elif req.narration_audio is None and provider != "kokoro":
        words = words_lib.restore_punctuation(text, words)

    total_seconds = timing.total_video_seconds(audio_seconds)
    spans = timing.allocate_segments(req.narration_segments(), words, audio_seconds)
    spans[-1] = (spans[-1][0], total_seconds)

    assets["audio"] = "narration.mp3"
    shots = resolve_shots(req.beats, words, spans)
    dropped = sum(len(b.shots) for b in req.beats) - len(shots)
    if dropped:
        log.warning("%s dropped %d shots with unresolved cues", log_ctx, dropped)
    sfx = mix.plan_sfx(spans, shots, bool(req.headline))
    composition = props.build_props(req, words, spans, total_seconds, assets, shots, sfx)
    with open(os.path.join(job_dir, "props.json"), "w", encoding="utf-8") as fh:
        json.dump(composition, fh)
    log.info(
        "%s assets cover=%s images=%d", log_ctx, bool(assets.get("cover")), len(assets.get("images", []))
    )

    render(job_dir)
    raw_path = os.path.join(job_dir, "raw.mp4")
    out_path = os.path.join(job_dir, "video.mp4")
    mixed = None
    try:
        timeline = mix.load_timeline_shots(job_dir)
        cues = mix.plan_sfx(spans, [], bool(req.headline), timeline) if timeline else sfx
        mixed = mix.mix_and_mux(
            job_dir, audio_path, raw_path, out_path, cues, total_seconds, req.job_id
        )
    except (RenderError, OSError, KeyError, ValueError) as err:
        log.warning("%s mix failed, plain remux: %s", log_ctx, err)
        video.run_ffmpeg(video.build_faststart_cmd(raw_path, out_path), job_dir)
    os.remove(raw_path)
    poster_path = os.path.join(job_dir, "poster.jpg")
    video.run_ffmpeg(
        video.build_poster_cmd(out_path, poster_path, props.poster_second(spans)), job_dir
    )
    size = video.check_output_size(out_path)

    credits = _credits(job_dir, assets)
    render_ms = int((time.monotonic() - started) * 1000)
    meta = {
        "jobId": req.job_id,
        "bytes": size,
        "posterBytes": os.path.getsize(poster_path),
        "durationMs": int(video.media_seconds(out_path) * 1000),
        "ttsDurationMs": int(audio_seconds * 1000),
        "ttsChars": len(text),
        "ttsProvider": provider,
        "renderMs": render_ms,
        "cover": bool(assets.get("cover")),
        "templateVersion": TEMPLATE_VERSION,
        "mix": mixed,
        "credits": credits,
    }
    log.info("%s render ok %s", log_ctx, meta)
    return meta


def _credits(job_dir: str, assets: dict) -> list:
    """Attribution for the stock clips and README demo that the composition actually used."""
    path = os.path.join(job_dir, "timeline.json")
    try:
        with open(path, encoding="utf-8") as fh:
            timeline = json.load(fh)
    except (OSError, ValueError):
        return []
    return media.credits_for(
        assets.get("broll") or [], timeline.get("usedBroll") or [], assets.get("demo"), bool(timeline.get("usedDemo"))
    )
