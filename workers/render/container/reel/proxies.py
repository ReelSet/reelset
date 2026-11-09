import logging
import os
import re
import threading
from typing import Callable
from urllib.parse import urlsplit

log = logging.getLogger("reel.proxies")

PROXY_TIMEOUT_SECONDS = 15
_local = threading.local()


def parse_proxy_urls(raw: str | None) -> list:
    """Split a comma/whitespace separated list, keeping only valid http(s) proxy URLs."""
    urls: list = []
    for item in re.split(r"[,\s]+", (raw or "").strip().strip("\"'")):
        if not item:
            continue
        try:
            parts = urlsplit(item)
            valid = parts.scheme in ("http", "https") and bool(parts.hostname) and parts.port
        except ValueError:
            valid = False
        if not valid:
            log.warning("ignoring invalid proxy entry (index=%d)", len(urls))
            continue
        if item not in urls:
            urls.append(item)
    return urls


class ProxyPool:
    """Round-robin start point; each attempt list tries every proxy once, then direct."""

    def __init__(self, urls: list):
        self.urls = list(urls)
        self._next = 0
        self._lock = threading.Lock()

    def attempts(self) -> list:
        """List of (index, url); index and url are None for the final direct attempt."""
        with self._lock:
            start = self._next
            if self.urls:
                self._next = (self._next + 1) % len(self.urls)
        size = len(self.urls)
        order = [((start + n) % size, self.urls[(start + n) % size]) for n in range(size)]
        return order + [(None, None)]


_pool: ProxyPool | None = None


def get_pool() -> ProxyPool:
    global _pool
    if _pool is None:
        _pool = ProxyPool(parse_proxy_urls(os.environ.get("PROXY_URLS")))
        log.info("proxy pool ready size=%d", len(_pool.urls))
    return _pool


def label(index: int | None) -> str:
    return "direct" if index is None else f"proxy#{index}"


def current_proxy() -> str | None:
    return getattr(_local, "url", None)


def run_with_proxies(fn: Callable, pool: ProxyPool, what: str):
    """Call fn(proxy_url_or_None) per attempt; return the first success, else raise the last error."""
    last: Exception | None = None
    for index, url in pool.attempts():
        _local.url = url
        try:
            result = fn(url)
            log.info("%s ok via=%s", what, label(index))
            return result
        except Exception as err:
            last = err
            log.warning("%s failed via=%s err=%s", what, label(index), type(err).__name__)
        finally:
            _local.url = None
    raise last  # type: ignore[misc]


def install_search_proxy_patch() -> None:
    """Make youtube-search-python route sync requests through the thread's current proxy.

    The library reads HTTP(S)_PROXY from the process env, which is shared across threads."""
    from youtubesearchpython.core.requests import RequestCore

    if getattr(RequestCore, "_reel_patched", False):
        return

    def wrap(name: str):
        original = getattr(RequestCore, name)

        def patched(self):
            url = current_proxy()
            if url:
                self.proxy = {"http://": url, "https://": url}
                self.timeout = PROXY_TIMEOUT_SECONDS
            return original(self)

        setattr(RequestCore, name, patched)

    wrap("syncGetRequest")
    wrap("syncPostRequest")
    RequestCore._reel_patched = True
