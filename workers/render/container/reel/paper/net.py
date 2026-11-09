import logging
import threading
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

log = logging.getLogger("reel.paper.net")

USER_AGENT = "reelset-paper-parser/1.0"
ALLOWED_HOSTS = frozenset({"arxiv.org", "export.arxiv.org"})
MIN_INTERVAL_SECONDS = 3.0
MAX_REDIRECTS = 4

_lock = threading.Lock()
_last_finished = 0.0


@dataclass
class Fetched:
    status: int
    url: str
    content: bytes
    content_type: str


class TooLarge(Exception):
    pass


def fetch(url: str, *, max_bytes: int, timeout: float, accept: str = "*/*") -> Fetched:
    """One arXiv request at a time with a minimum gap, a generic user agent and a size cap."""
    global _last_finished
    with _lock:
        wait = MIN_INTERVAL_SECONDS - (time.monotonic() - _last_finished)
        if wait > 0:
            time.sleep(wait)
        try:
            return _get(url, max_bytes, timeout, accept)
        finally:
            _last_finished = time.monotonic()


def _get(url: str, max_bytes: int, timeout: float, accept: str) -> Fetched:
    for _ in range(MAX_REDIRECTS + 1):
        host = urlparse(url).hostname
        if urlparse(url).scheme != "https" or host not in ALLOWED_HOSTS:
            raise ValueError(f"host not allowed: {host}")
        headers = {"user-agent": USER_AGENT, "accept": accept}
        with httpx.stream("GET", url, headers=headers, timeout=timeout) as res:
            if res.status_code in (301, 302, 303, 307, 308) and res.headers.get("location"):
                url = str(res.url.join(res.headers["location"]))
                continue
            declared = int(res.headers.get("content-length", "0") or 0)
            if declared > max_bytes:
                raise TooLarge(f"{declared} bytes over cap {max_bytes}")
            chunks, total = [], 0
            for chunk in res.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise TooLarge(f"body over cap {max_bytes}")
                chunks.append(chunk)
            log.info("arxiv fetch %s -> %d (%d bytes)", url, res.status_code, total)
            return Fetched(
                res.status_code, url, b"".join(chunks), res.headers.get("content-type", "")
            )
    raise ValueError("too many redirects")
