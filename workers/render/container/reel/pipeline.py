import json
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from .version import TEMPLATE_VERSION
from . import illustration, images, props, sources, timing, tts, video, words as words_lib
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
    """Fetch and normalize imagery. Every failure degrades to a missing asset, never an error."""
    found = {"images": {}}

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

    wanted = list(req.image_urls)
    for beat in req.beats:
        url = beat.visual.get("url")
        if url and url not in wanted:
            wanted.append(url)
    for i, url in enumerate(wanted):
        if name := fetch(url, f"img{i}", downloader):
            found["images"][url] = name

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


def make_illustration(req: RenderRequest, assets_dir: str, generate: Callable) -> str | None:
    if not req.illustrate:
        return None
    raw = os.path.join(assets_dir, "illustration.raw")
    try:
        if generate(req.title, req.hook, raw) and images.normalize_image(
            raw, os.path.join(assets_dir, "illustration.jpg")
        ):
            return "illustration.jpg"
    finally:
        if os.path.exists(raw):
            os.remove(raw)
    return None


def run_render(
    req: RenderRequest,
    job_dir: str,
    synth: Callable = tts.synthesize,
    downloader: Downloader = images.download_image,
    public_downloader: Downloader = images.download_public_image,
    page_fetcher: Callable = images.fetch_page,
    generate: Callable = illustration.generate,
    render: Callable = video.run_remotion,
) -> dict:
    started = time.monotonic()
    log_ctx = f"job={req.job_id}"
    assets_dir = os.path.join(job_dir, "assets")
    os.makedirs(assets_dir, exist_ok=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        art = pool.submit(make_illustration, req, assets_dir, generate)
        covers = pool.submit(collect_assets, req, assets_dir, downloader, public_downloader, page_fetcher)

        text = req.narration_text()
        rate = timing.choose_rate(len(text))
        audio_path = os.path.join(assets_dir, "narration.mp3")
        words = synth(text, req.voice, rate, audio_path)
        audio_seconds = video.media_seconds(audio_path)
        if timing.total_video_seconds(audio_seconds) > timing.MAX_VIDEO_SECONDS:
            faster = timing.refit_rate(rate, audio_seconds)
            if faster is None:
                raise RenderError("too_large", f"narration is {audio_seconds:.1f}s, over the 60s cap")
            log.warning("%s narration %.1fs at %s, retrying at %s", log_ctx, audio_seconds, rate, faster)
            words = synth(text, req.voice, faster, audio_path)
            audio_seconds = video.media_seconds(audio_path)
            if timing.total_video_seconds(audio_seconds) > timing.MAX_VIDEO_SECONDS:
                raise RenderError(
                    "too_large", f"narration is {audio_seconds:.1f}s at {faster}, over the 60s cap"
                )
        assets = covers.result()
        illustration_file = art.result()

    if not words:
        log.warning("%s no word timings from tts, estimating", log_ctx)
        words = timing.estimate_word_timings(text, audio_seconds)
    else:
        words = words_lib.restore_punctuation(text, words)

    total_seconds = timing.total_video_seconds(audio_seconds)
    spans = timing.allocate_segments(req.narration_segments(), words, audio_seconds)
    spans[-1] = (spans[-1][0], total_seconds)

    assets["audio"] = "narration.mp3"
    if illustration_file:
        assets["illustration"] = illustration_file
    composition = props.build_props(req, words, spans, total_seconds, assets)
    with open(os.path.join(job_dir, "props.json"), "w", encoding="utf-8") as fh:
        json.dump(composition, fh)
    log.info(
        "%s assets illustration=%s cover=%s images=%d",
        log_ctx, bool(illustration_file), bool(assets.get("cover")), len(assets["images"]),
    )  # fmt: skip

    render(job_dir)
    raw_path = os.path.join(job_dir, "raw.mp4")
    out_path = os.path.join(job_dir, "video.mp4")
    video.run_ffmpeg(video.build_faststart_cmd(raw_path, out_path), job_dir)
    os.remove(raw_path)
    poster_path = os.path.join(job_dir, "poster.jpg")
    video.run_ffmpeg(
        video.build_poster_cmd(out_path, poster_path, props.poster_second(spans)), job_dir
    )
    size = video.check_output_size(out_path)

    render_ms = int((time.monotonic() - started) * 1000)
    meta = {
        "jobId": req.job_id,
        "bytes": size,
        "posterBytes": os.path.getsize(poster_path),
        "durationMs": int(video.media_seconds(out_path) * 1000),
        "ttsDurationMs": int(audio_seconds * 1000),
        "ttsChars": len(text),
        "renderMs": render_ms,
        "illustration": bool(illustration_file),
        "cover": bool(assets.get("cover")),
        "templateVersion": TEMPLATE_VERSION,
    }
    log.info("%s render ok %s", log_ctx, meta)
    return meta
