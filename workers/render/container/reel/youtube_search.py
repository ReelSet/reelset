import json
import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone
from typing import Callable

from . import proxies
from .errors import RenderError
from .validation import VIDEO_ID_RE

log = logging.getLogger("reel.youtube_search")

MAX_QUERIES = 30
MAX_PER_QUERY_LIMIT = 20
MAX_AGE_DAYS = 30
SEARCH_WORKERS = 4
INFO_WORKERS = 8
TIME_BUDGET_SECONDS = 100.0

UNIT_SECONDS = {
    "second": 1,
    "minute": 60,
    "hour": 3600,
    "day": 86400,
    "week": 7 * 86400,
    "month": 30 * 86400,
    "year": 365 * 86400,
}
RELATIVE_RE = re.compile(r"(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago", re.IGNORECASE)


class SearchFailed(Exception):
    """Every query failed, which means the library is broken or blocked."""


def min_age_seconds(text) -> int | None:
    """Lower bound of a video's age from search text like 'Streamed 3 days ago'.

    None means unknown, so the caller must ask getInfo instead of dropping the video."""
    if not isinstance(text, str):
        return None
    match = RELATIVE_RE.search(text)
    if match:
        return int(match.group(1)) * UNIT_SECONDS[match.group(2).lower()]
    if "just now" in text.lower():
        return 0
    return None


def parse_view_count(text) -> int:
    if isinstance(text, int):
        return text
    if not isinstance(text, str):
        return 0
    digits = re.sub(r"[^0-9]", "", text)
    return int(digits) if digits else 0


def parse_clock_duration(text) -> int | None:
    if not isinstance(text, str) or not re.fullmatch(r"\d{1,2}(:\d{2}){1,2}", text):
        return None
    seconds = 0
    for part in text.split(":"):
        seconds = seconds * 60 + int(part)
    return seconds or None


def parse_published_at(value) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def validate_search_request(payload) -> tuple[list, int, int]:
    def bad(message: str):
        raise RenderError("invalid_input", message)

    if not isinstance(payload, dict):
        bad("body must be a JSON object")
    queries = payload.get("queries")
    if not isinstance(queries, list) or not 1 <= len(queries) <= MAX_QUERIES:
        bad(f"queries must be a list of 1 to {MAX_QUERIES} strings")
    cleaned = []
    for query in queries:
        if not isinstance(query, str) or not 2 <= len(query.strip()) <= 100:
            bad("each query must be a string of 2 to 100 characters")
        cleaned.append(query.strip())
    max_age = payload.get("maxAgeDays")
    if isinstance(max_age, bool) or not isinstance(max_age, int) or not 1 <= max_age <= MAX_AGE_DAYS:
        bad(f"maxAgeDays must be an integer from 1 to {MAX_AGE_DAYS}")
    per_query = payload.get("perQueryLimit")
    if (
        isinstance(per_query, bool)
        or not isinstance(per_query, int)
        or not 1 <= per_query <= MAX_PER_QUERY_LIMIT
    ):
        bad(f"perQueryLimit must be an integer from 1 to {MAX_PER_QUERY_LIMIT}")
    return cleaned, max_age, per_query


def library_search(query: str, limit: int) -> list:
    from youtubesearchpython import VideosSearch

    proxies.install_search_proxy_patch()
    return proxies.run_with_proxies(
        lambda _url: VideosSearch(query, limit=limit).result()["result"],
        proxies.get_pool(),
        "youtube search",
    )


def library_info(video_id: str) -> dict:
    from youtubesearchpython import ResultMode, Video

    proxies.install_search_proxy_patch()

    def get(_url):
        info = Video.getInfo(video_id, mode=ResultMode.json)
        return json.loads(info) if isinstance(info, str) else info

    return proxies.run_with_proxies(get, proxies.get_pool(), "youtube getInfo")


def _build_video(hit: dict, info: dict) -> dict | None:
    published = parse_published_at(info.get("publishDate") or info.get("uploadDate"))
    if published is None:
        return None
    channel = hit.get("channel") or {}
    info_channel = info.get("channel") or {}
    duration = info.get("duration") or {}
    seconds = duration.get("secondsText")
    duration_sec = int(seconds) if isinstance(seconds, str) and seconds.isdigit() else None
    if not duration_sec:
        duration_sec = parse_clock_duration(hit.get("duration"))
    video_id = hit["id"]
    views = (info.get("viewCount") or {}).get("text")
    if views is None:
        views = (hit.get("viewCount") or {}).get("text")
    return {
        "videoId": video_id,
        "title": hit.get("title") or info.get("title") or "",
        "channelName": channel.get("name") or info_channel.get("name") or "",
        "channelId": channel.get("id") or info_channel.get("id") or "",
        "url": f"https://www.youtube.com/watch?v={video_id}",
        "publishedAt": published.isoformat().replace("+00:00", "Z"),
        "viewCount": parse_view_count(views),
        "durationSec": duration_sec,
        "description": info.get("description") or "",
        "thumbnailUrl": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
    }


def search_youtube(
    queries: list,
    max_age_days: int,
    per_query_limit: int,
    *,
    search_fn: Callable = library_search,
    info_fn: Callable = library_info,
    now: datetime | None = None,
    budget_seconds: float = TIME_BUDGET_SECONDS,
) -> dict:
    now = now or datetime.now(timezone.utc)
    cutoff = now - timedelta(days=max_age_days)
    deadline = time.monotonic() + budget_seconds
    unique_queries = list(dict.fromkeys(queries))

    def run_query(query: str):
        started = time.monotonic()
        try:
            hits = search_fn(query, per_query_limit)
        except Exception as err:
            log.warning(
                "youtube query failed query=%r ms=%d err=%s",
                query, (time.monotonic() - started) * 1000, type(err).__name__,
            )  # fmt: skip
            return query, None, (time.monotonic() - started)
        return query, hits, (time.monotonic() - started)

    failed: list = []
    candidates: dict = {}
    max_age_seconds = max_age_days * 86400
    pool = ThreadPoolExecutor(max_workers=SEARCH_WORKERS)
    try:
        futures = [pool.submit(run_query, q) for q in unique_queries]
        done, not_done = wait(futures, timeout=max(0.0, deadline - time.monotonic()))
        for future in not_done:
            future.cancel()
        results = {}
        for future in done:
            query, hits, elapsed = future.result()
            results[query] = (hits, elapsed)
        for query in unique_queries:
            if query not in results or results[query][0] is None:
                failed.append(query)
                continue
            hits, elapsed = results[query]
            fresh = 0
            for hit in hits:
                if not isinstance(hit, dict) or hit.get("type", "video") != "video":
                    continue
                video_id = hit.get("id")
                if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
                    continue
                if video_id in candidates:
                    continue
                age = min_age_seconds(hit.get("publishedTime"))
                if age is not None and age > max_age_seconds:
                    continue
                candidates[video_id] = (query, hit)
                fresh += 1
            log.info(
                "youtube query ok query=%r results=%d candidates=%d ms=%d",
                query, len(hits), fresh, elapsed * 1000,
            )  # fmt: skip
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    if len(failed) == len(unique_queries):
        raise SearchFailed(f"all {len(unique_queries)} queries failed")

    videos = []
    kept_per_query: dict = {}
    info_pool = ThreadPoolExecutor(max_workers=INFO_WORKERS)
    try:
        info_futures = {}
        for video_id in candidates:

            def fetch(video_id=video_id):
                try:
                    return info_fn(video_id)
                except Exception as err:
                    log.warning("youtube getInfo failed video=%s err=%s", video_id, type(err).__name__)
                    return None

            info_futures[info_pool.submit(fetch)] = video_id
        done, not_done = wait(info_futures, timeout=max(0.0, deadline - time.monotonic()))
        for future in not_done:
            future.cancel()
            log.warning("youtube getInfo skipped (time budget) video=%s", info_futures[future])
        infos = {info_futures[f]: f.result() for f in done}
    finally:
        info_pool.shutdown(wait=False, cancel_futures=True)

    for video_id, (query, hit) in candidates.items():
        info = infos.get(video_id)
        if not info:
            continue
        video = _build_video(hit, info)
        if video is None:
            log.warning("youtube video has no publish date video=%s", video_id)
            continue
        if parse_published_at(video["publishedAt"]) < cutoff:
            continue
        videos.append(video)
        kept_per_query[query] = kept_per_query.get(query, 0) + 1

    for query in unique_queries:
        if query not in failed:
            log.info("youtube query kept query=%r kept=%d", query, kept_per_query.get(query, 0))
    log.info(
        "youtube search done queries=%d failed=%d candidates=%d videos=%d",
        len(unique_queries), len(failed), len(candidates), len(videos),
    )  # fmt: skip
    return {"status": "ok", "videos": videos, "failedQueries": failed}
