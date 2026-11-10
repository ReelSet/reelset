import http.client
import ipaddress
import logging
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

log = logging.getLogger("reel.images")

ALLOWED_IMAGE_HOSTS = frozenset(
    {
        "opengraph.githubassets.com",
        "avatars.githubusercontent.com",
        "raw.githubusercontent.com",
        "i.ytimg.com",
    }
)
MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_PAGE_BYTES = 768 * 1024
FETCH_TIMEOUT_SECONDS = 10
MAX_REDIRECTS = 3
IMAGE_MAX_WIDTH = 1280


def _https_parts(url: str):
    try:
        parsed = urlparse(url)
        port = parsed.port
    except ValueError:
        return None
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or port not in (None, 443)
    ):
        return None
    return parsed


def is_allowed_image_url(url: str) -> bool:
    parsed = _https_parts(url)
    return parsed is not None and parsed.hostname in ALLOWED_IMAGE_HOSTS


def is_public_https_url(url: str, resolve=socket.getaddrinfo) -> bool:
    """https to a host whose every address is globally routable (no internal/metadata targets)."""
    parsed = _https_parts(url)
    if parsed is None:
        return False
    try:
        addresses = {info[4][0] for info in resolve(parsed.hostname, 443, proto=socket.IPPROTO_TCP)}
    except OSError:
        return False
    return bool(addresses) and all(ipaddress.ip_address(a).is_global for a in addresses)


def _redirect_handler(check):
    class Handler(urllib.request.HTTPRedirectHandler):
        max_redirections = MAX_REDIRECTS

        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if not check(newurl):
                raise urllib.error.URLError(
                    f"redirect to disallowed url blocked: {urlparse(newurl).hostname}"
                )
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    return Handler()


def default_opener(check=is_allowed_image_url):
    return urllib.request.build_opener(_redirect_handler(check))


RETRY_BACKOFF_SECONDS = (1.0, 2.0)


def _transient(err: BaseException) -> bool:
    """Worth another try: truncated bodies, timeouts, dropped connections, 429 and 5xx."""
    if isinstance(err, urllib.error.HTTPError):
        return err.code == 429 or err.code >= 500
    if isinstance(err, urllib.error.URLError):
        return isinstance(err.reason, (TimeoutError, socket.timeout, ConnectionError))
    transient = (http.client.IncompleteRead, http.client.RemoteDisconnected, TimeoutError, socket.timeout, ConnectionError)
    return isinstance(err, transient)


def _fetch(url: str, check, opener, accept_prefix: str, limit: int, attempts: int = 1, sleep=time.sleep):
    if not check(url):
        log.warning("url rejected host=%s", urlparse(url).hostname)
        return None
    opener = opener or default_opener(check)
    host = urlparse(url).hostname
    for attempt in range(1, attempts + 1):
        request = urllib.request.Request(url, headers={"User-Agent": "reelset-render/2"})
        try:
            with opener.open(request, timeout=FETCH_TIMEOUT_SECONDS) as response:
                content_type = (response.headers.get("Content-Type") or "").lower()
                if not content_type.startswith(accept_prefix):
                    log.warning("fetch rejected content_type=%s", content_type)
                    return None
                declared = response.headers.get("Content-Length")
                if declared and declared.isdigit() and int(declared) > limit:
                    log.warning("fetch rejected declared_bytes=%s", declared)
                    return None
                data = response.read(limit + 1)
        except (urllib.error.URLError, http.client.HTTPException, TimeoutError, OSError) as err:
            if attempt < attempts and _transient(err):
                wait = RETRY_BACKOFF_SECONDS[min(attempt - 1, len(RETRY_BACKOFF_SECONDS) - 1)]
                log.warning("fetch retry host=%s attempt=%d err=%s", host, attempt, type(err).__name__)
                sleep(wait)
                continue
            log.warning("fetch failed host=%s attempts=%d err=%s", host, attempt, err)
            return None
        if len(data) > limit:
            log.warning("fetch rejected: over %d bytes", limit)
            return None
        return data
    return None


def download_image(
    url: str, dest_path: str, opener=None, check=is_allowed_image_url, limit: int = MAX_IMAGE_BYTES
) -> bool:
    """Download an image to dest_path. Returns False (never raises) on any problem."""
    data = _fetch(url, check, opener, "image/", limit)
    if data is None:
        return False
    with open(dest_path, "wb") as fh:
        fh.write(data)
    return True


def download_public_image(
    url: str, dest_path: str, opener=None, limit: int = MAX_IMAGE_BYTES
) -> bool:
    return download_image(url, dest_path, opener, check=is_public_https_url, limit=limit)


def fetch_page(url: str, opener=None) -> str | None:
    data = _fetch(url, is_public_https_url, opener, "text/html", MAX_PAGE_BYTES)
    return data.decode("utf-8", errors="replace") if data is not None else None


def normalize_image(src_path: str, dest_path: str, max_width: int = IMAGE_MAX_WIDTH) -> bool:
    """Re-encode to a bounded RGB JPEG so the compositor never decodes odd formats or huge files."""
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(src_path) as im:
            im = im.convert("RGB")
            if im.width > max_width:
                im = im.resize((max_width, round(im.height * max_width / im.width)))
            im.save(dest_path, "JPEG", quality=86)
    except (UnidentifiedImageError, OSError, ValueError) as err:
        log.warning("image not usable: %s", err)
        return False
    return True
