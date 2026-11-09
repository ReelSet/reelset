import logging
from typing import Callable

from . import proxies

log = logging.getLogger("reel.transcript")

LANGUAGES = ("en", "en-US", "en-GB")


def classify_transcript_error(err: Exception) -> str:
    from youtube_transcript_api import (
        AgeRestricted,
        IpBlocked,
        NoTranscriptFound,
        RequestBlocked,
        TranscriptsDisabled,
        VideoUnavailable,
        VideoUnplayable,
    )

    if isinstance(err, (RequestBlocked, IpBlocked)):
        return "blocked"
    if isinstance(
        err, (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, VideoUnplayable, AgeRestricted)
    ):
        return "no_captions"
    return "error"


def fetch_transcript(
    video_id: str, api_factory: Callable | None = None, pool: proxies.ProxyPool | None = None
) -> dict:
    if api_factory is None:
        from youtube_transcript_api import YouTubeTranscriptApi as api_factory
    pool = pool or proxies.get_pool()
    reasons: list = []
    fetched = None
    for index, url in pool.attempts():
        try:
            if url:
                from youtube_transcript_api.proxies import GenericProxyConfig

                api = api_factory(proxy_config=GenericProxyConfig(http_url=url, https_url=url))
            else:
                api = api_factory()
            fetched = api.fetch(video_id, languages=LANGUAGES)
            log.info("transcript fetched video=%s via=%s", video_id, proxies.label(index))
            break
        except Exception as err:
            reason = classify_transcript_error(err)
            log.warning(
                "transcript attempt failed video=%s via=%s reason=%s err=%s",
                video_id, proxies.label(index), reason, type(err).__name__,
            )  # fmt: skip
            if reason == "no_captions":
                return {"status": "unavailable", "reason": reason}
            reasons.append(reason)
    if fetched is None:
        reason = "error" if "error" in reasons else "blocked"
        log.warning("transcript unavailable video=%s reason=%s attempts=%d", video_id, reason, len(reasons))
        return {"status": "unavailable", "reason": reason}
    segments = [
        {"text": s.text, "start": float(s.start), "duration": float(s.duration)} for s in fetched
    ]
    if not segments:
        return {"status": "unavailable", "reason": "no_captions"}
    log.info("transcript ok video=%s segments=%d lang=%s", video_id, len(segments), fetched.language_code)
    return {"status": "ok", "language": fetched.language_code, "segments": segments}
