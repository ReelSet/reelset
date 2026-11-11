"""Instagram posting through instagrapi (unofficial private API).

Stateless: the worker passes the saved session in each call and stores the returned one.
Nothing here logs in unless `login` is called, and `login` never retries."""

import json
import logging
import os
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from . import props, video
from .errors import RenderError
from .proxies import parse_proxy_urls

log = logging.getLogger("reel.instagram")

MAX_VIDEO_BYTES = 100 * 1024 * 1024
MAX_POSTER_BYTES = 10 * 1024 * 1024
COVER_ASPECT_TOLERANCE = 0.01
DOWNLOAD_TIMEOUT_SECONDS = 120
POSTER_DOWNLOAD_TIMEOUT_SECONDS = 20
DOWNLOAD_USER_AGENT = "reelset-render/2"
CLIP_DELAY_RANGE = [1, 3]
ERROR_MESSAGE_MAX = 200
FIND_RECENT_MEDIA = 12
FIND_CLOCK_SKEW_SECONDS = 120
# Uploads take 30-60s and runs never overlap, so a reel published this soon after a lost upload
# started is that upload even when Instagram dropped or changed its caption.
FIND_WINDOW_SECONDS = 30 * 60

_lock = threading.Lock()


class InstagramError(Exception):
    def __init__(self, code: str, message: str, status: int = 502):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def new_client(proxy_url: str | None = None):
    from instagrapi import Client

    client = Client()
    client.delay_range = CLIP_DELAY_RANGE
    if proxy_url:
        client.set_proxy(proxy_url)
    return client


class ProxyInfo:
    """The one proxy all Instagram traffic uses; `url` never leaves the container."""

    def __init__(self, index: int, url: str, country: str | None, switched: bool):
        self.index = index
        self.url = url
        self.country = country
        self.switched = switched

    def public(self) -> dict:
        return {"index": self.index, "country": self.country, "switched": self.switched, "down": False}


EXIT_PROBES = ("https://api.country.is/", "https://ipinfo.io/json")
PROBE_TIMEOUT_SECONDS = 10


def probe_exit_country(proxy_url: str) -> str | None:
    """Harmless request through the proxy; returns the exit country code, or raises when it is dead."""
    handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
    opener = urllib.request.build_opener(handler)
    last: Exception | None = None
    for url in EXIT_PROBES:
        try:
            with opener.open(url, timeout=PROBE_TIMEOUT_SECONDS) as res:
                data = json.loads(res.read(4096))
            country = data.get("country")
            return str(country)[:2] if country else None
        except Exception as err:  # noqa: BLE001 - any failure means this probe path is unusable
            last = err
    raise last  # type: ignore[misc]


def resolve_proxy(
    preferred: int | None,
    urls: list | None = None,
    probe: Callable = probe_exit_country,
) -> ProxyInfo:
    """Pinned proxy first; another one only when the pinned one is dead. Never direct."""
    candidates = urls if urls is not None else parse_proxy_urls(os.environ.get("PROXY_URLS"))
    if not candidates:
        raise InstagramError("proxy_down", "No proxy is configured, so Instagram is blocked.", 503)
    start = preferred if isinstance(preferred, int) and 0 <= preferred < len(candidates) else 0
    order = [start] + [i for i in range(len(candidates)) if i != start]
    for index in order:
        try:
            country = probe(candidates[index])
        except Exception as err:  # noqa: BLE001
            log.warning("proxy probe failed index=%d err=%s", index, type(err).__name__)
            continue
        return ProxyInfo(index, candidates[index], country, switched=(preferred is not None and index != start))
    raise InstagramError(
        "proxy_down", "The Instagram proxy is not responding. Nothing was sent to Instagram.", 503
    )


def _allowed_hosts() -> set:
    raw = os.environ.get("IG_MEDIA_HOSTS", "media.reelset.app")
    return {h.strip().lower() for h in raw.split(",") if h.strip()}


def validate_media_url(url: str, label: str = "video") -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in _allowed_hosts():
        raise InstagramError("invalid_input", f"{label} url must be https on the media host", 400)
    return url


def short_message(err: Exception) -> str:
    return f"{type(err).__name__}: {str(err)[:ERROR_MESSAGE_MAX]}".strip()


def classify(err: Exception) -> tuple:
    """Maps an instagrapi exception to (account state, user-facing message)."""
    name = type(err).__name__
    if name in ("LoginRequired", "ReloginAttemptExceeded", "SessionExpired"):
        return "needs_login", "Instagram session expired. Connect the account again."
    if name.startswith("Challenge") or name in ("CheckpointRequired", "ConsentRequired"):
        return "challenge", "Instagram wants approval. Open the Instagram app, tap 'This was me', then Connect once."
    if name in ("TwoFactorRequired", "ClientNeedsUpgradeError"):
        return "needs_code", "Instagram asks for a 2FA code."
    if name in ("BadPassword", "InvalidUser", "UserNotFound"):
        return "needs_login", "Instagram rejected the username or password."
    return "unknown", short_message(err)


def _session_of(client) -> dict:
    return client.get_settings()


def _verify(client) -> str:
    info = client.account_info()
    return str(info.username)


def status(session: dict | None, factory: Callable = new_client) -> dict:
    """One read-only call with the saved session. No password, no login."""
    if not session:
        return {"state": "needs_login", "username": None, "message": "No saved session.", "session": None}
    client = factory()
    client.set_settings(session)
    try:
        username = _verify(client)
    except Exception as err:
        state, message = classify(err)
        log.warning("status check failed state=%s err=%s", state, type(err).__name__)
        return {"state": state, "username": None, "message": message, "session": None}
    return {"state": "connected", "username": username, "message": None, "session": _session_of(client)}


def _keep_device(client, session: dict | None) -> None:
    uuids = (session or {}).get("uuids")
    client.set_settings({})
    if uuids:
        client.set_uuids(uuids)


def salvage_two_factor_session(client) -> bool:
    """instagrapi 3.2.9 only reads the session from the Bloks body; Instagram can also return it in
    response headers after verify_code (upstream issue #2881)."""
    resp = client.last_response
    headers = resp.headers if resp is not None else {}
    ig_headers = {k: v for k, v in headers.items() if k.lower().startswith(("ig-set-", "x-ig-set-"))}
    cookie = client.private.cookies.get("sessionid")
    applied = client.bloks_apply_login_response(
        {"headers": ig_headers, "cookies": {"sessionid": cookie} if cookie else {}}
    )
    if not applied:
        return False
    try:
        client.account_info()
    except Exception as err:
        log.warning("salvaged auth did not work err=%s", type(err).__name__)
        return False
    log.info("salvaged session from verify_code response headers")
    return True


def login(
    session: dict | None,
    username: str,
    password: str,
    totp_secret: str | None,
    code: str | None,
    factory: Callable = new_client,
) -> dict:
    """One fresh login attempt, on the saved device ids. Never retried here."""
    if not username or not password:
        raise InstagramError("invalid_input", "username and password are required", 400)
    client = factory()
    _keep_device(client, session)
    first_code = (code or "").strip() or (client.totp_generate_code(totp_secret) if totp_secret else "")
    try:
        client.login(username, password, verification_code=first_code)
    except Exception as err:
        ok = False
        if type(err).__name__ in ("TwoFactorRequired", "ClientNeedsUpgradeError") and first_code:
            ok = salvage_two_factor_session(client)
        if not ok:
            state, message = classify(err)
            log.warning("login did not complete state=%s err=%s", state, type(err).__name__)
            return {"state": state, "username": None, "message": message, "session": None}
    try:
        verified = _verify(client)
    except Exception as err:
        state, message = classify(err)
        return {"state": state, "username": None, "message": message, "session": None}
    log.info("login ok")
    return {"state": "connected", "username": verified, "message": None, "session": _session_of(client)}


def _download(url: str, dest: Path, max_bytes: int, timeout: int, label: str) -> Path:
    validate_media_url(url, label)
    # media.reelset.app sits behind Cloudflare, which answers 403 to the default Python-urllib agent.
    request = urllib.request.Request(url, headers={"User-Agent": DOWNLOAD_USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as res, open(dest, "wb") as out:
            size = 0
            while chunk := res.read(256 * 1024):
                size += len(chunk)
                if size > max_bytes:
                    raise InstagramError("too_large", f"{label} is larger than {max_bytes // (1024 * 1024)} MB", 422)
                out.write(chunk)
    except InstagramError:
        raise
    except Exception as err:
        log.error("%s download failed err=%s", label, type(err).__name__)
        raise InstagramError("download_failed", f"could not download the reel {label} ({short_message(err)})", 502) from err
    log.info("downloaded %s bytes=%d", label, size)
    return dest


def download_video(url: str, workdir: Path) -> Path:
    return _download(url, workdir / "reel.mp4", MAX_VIDEO_BYTES, DOWNLOAD_TIMEOUT_SECONDS, "video")


def download_poster(url: str, workdir: Path) -> Path:
    return _download(url, workdir / "poster.jpg", MAX_POSTER_BYTES, POSTER_DOWNLOAD_TIMEOUT_SECONDS, "poster")


def probe_video(path: Path) -> tuple | None:
    """(width, height, seconds) of the first video stream, or None when ffprobe cannot read it."""
    try:
        info = video.probe(str(path))
        stream = next(s for s in info.get("streams", []) if s.get("codec_type") == "video")
        width, height = int(stream["width"]), int(stream["height"])
        seconds = float(info["format"]["duration"])
    except (RenderError, StopIteration, KeyError, TypeError, ValueError):
        return None
    return (width, height, seconds) if width > 0 and height > 0 else None


def check_poster_fits(poster: Path, shape: tuple | None) -> None:
    """instagrapi center-crops a cover narrower than 9:16, so the poster must have the video's own aspect."""
    from PIL import Image, UnidentifiedImageError

    try:
        with Image.open(poster) as im:
            width, height = im.size
    except (OSError, UnidentifiedImageError) as err:
        raise InstagramError("bad_poster", "poster is not a readable image", 422) from err
    if shape is None:
        return
    if abs(width / height - shape[0] / shape[1]) > COVER_ASPECT_TOLERANCE:
        raise InstagramError("bad_poster", f"poster is {width}x{height}, video is {shape[0]}x{shape[1]}", 422)


def extract_cover_frame(path: Path, workdir: Path, shape: tuple | None) -> Path:
    """Frame near where the render takes its poster, for reels whose poster is missing or unusable."""
    cover = workdir / "frame.jpg"
    second = props.fallback_poster_second(shape[2] if shape else None)
    try:
        video.run_ffmpeg(video.build_poster_cmd(str(path), str(cover), second), str(workdir))
    except RenderError as err:
        raise InstagramError("cover_failed", f"could not extract a cover frame ({err.message})", 502) from err
    if not cover.exists():
        raise InstagramError("cover_failed", f"no video frame at {second:.2f}s for the cover", 502)
    log.info("cover frame extracted second=%.2f", second)
    return cover


def choose_cover(
    path: Path,
    poster_url: str | None,
    workdir: Path,
    fetch_poster: Callable = download_poster,
    extract_frame: Callable = extract_cover_frame,
    probe: Callable = probe_video,
) -> Path:
    """The render's poster, the exact image the app shows; a video frame only when it is unusable."""
    shape = probe(path)
    if not poster_url:
        log.warning("cover source=frame reason=no_poster_url")
        return extract_frame(path, workdir, shape)
    try:
        poster = fetch_poster(poster_url, workdir)
        check_poster_fits(poster, shape)
    except InstagramError as err:
        log.warning("cover source=frame reason=%s detail=%s", err.code, err.message)
        return extract_frame(path, workdir, shape)
    log.info("cover source=poster")
    return poster


def post_reel(
    session: dict,
    video_url: str,
    poster_url: str | None,
    caption: str,
    factory: Callable = new_client,
    download: Callable = download_video,
    cover: Callable = choose_cover,
) -> dict:
    """Uploads one reel with the saved session; a dead session is reported, never re-logged in."""
    client = factory()
    client.set_settings(session)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        reel = download(video_url, workdir)
        thumb = cover(reel, poster_url, workdir)
        try:
            media = client.clip_upload(reel, caption, thumbnail=thumb)
        except Exception as err:
            state, message = classify(err)
            if state in ("needs_login", "challenge", "needs_code"):
                raise InstagramError(state, message, 401) from err
            log.error("clip_upload failed err=%s", type(err).__name__)
            raise InstagramError("upload_failed", short_message(err)) from err
        ensure_caption(client, media, caption)
    permalink = f"https://www.instagram.com/p/{media.code}/"
    log.info("published media_pk=%s", media.pk)
    return {"mediaPk": str(media.pk), "code": str(media.code), "permalink": permalink, "session": _session_of(client)}


def _caption_key(text: str | None) -> str:
    return " ".join((text or "").split())


def _epoch(value) -> float | None:
    try:
        return float(value.timestamp())
    except (AttributeError, TypeError, ValueError, OverflowError):
        return None


def ensure_caption(client, media, caption: str) -> bool:
    """Instagram sometimes publishes a reel without the caption sent at configure (seen on a
    caption with a long link). Puts it back once; never fails the post. True when it edited."""
    if _caption_key(getattr(media, "caption_text", None)) == _caption_key(caption):
        return False
    try:
        client.media_edit(str(media.pk), caption)
    except Exception as err:
        log.warning("caption missing after upload, restore failed media_pk=%s err=%s", media.pk, type(err).__name__)
        return False
    log.warning("caption missing after upload, restored media_pk=%s", media.pk)
    return True


def _match_lost_reel(medias: list, caption: str, since: float, exclude: set):
    """Same caption after `since`; else the reel published closest after `since` within the window."""
    wanted = _caption_key(caption)
    fresh = []
    for media in medias:
        if str(getattr(media, "pk", "")) in exclude:
            continue
        taken = _epoch(getattr(media, "taken_at", None))
        if taken is None or taken < since - FIND_CLOCK_SKEW_SECONDS:
            continue
        if _caption_key(getattr(media, "caption_text", None)) == wanted:
            return media, "caption"
        if taken <= since + FIND_WINDOW_SECONDS and getattr(media, "media_type", 2) == 2:
            fresh.append((taken, media))
    if fresh:
        return min(fresh, key=lambda t: t[0])[1], "time"
    return None, None


def find_reel(
    session: dict,
    caption: str,
    since: float,
    exclude_pks: list | None = None,
    factory: Callable = new_client,
) -> dict:
    """Looks for the reel of an upload whose result was lost, published after `since`.

    Matches the caption first, then (Instagram may have dropped the caption) the one video
    published soonest after `since`, skipping media already recorded for other posts. A reel found
    without its caption gets it back. One private-API page of the account's own recent media."""
    client = factory()
    client.set_settings(session)
    try:
        medias = client.user_medias_v1(client.user_id, FIND_RECENT_MEDIA)
    except Exception as err:
        state, message = classify(err)
        if state in ("needs_login", "challenge", "needs_code"):
            raise InstagramError(state, message, 401) from err
        raise InstagramError("lookup_failed", short_message(err)) from err
    media, how = _match_lost_reel(medias, caption, since, {str(pk) for pk in exclude_pks or []})
    if media is None:
        log.info("lost reel not found among recent=%d", len(medias))
        return {"found": False, "session": _session_of(client)}
    restored = ensure_caption(client, media, caption)
    log.info("lost reel found media_pk=%s match=%s caption_restored=%s", media.pk, how, restored)
    return {
        "found": True,
        "mediaPk": str(media.pk),
        "code": str(media.code),
        "permalink": f"https://www.instagram.com/p/{media.code}/",
        "match": how,
        "captionRestored": restored,
        "session": _session_of(client),
    }


def delete_media(session: dict, media_pk: str, factory: Callable = new_client) -> dict:
    """Deletes one of the account's own posts."""
    client = factory()
    client.set_settings(session)
    try:
        info = client.media_info(media_pk)
        if str(info.user.pk) != str(client.user_id):
            raise InstagramError("invalid_input", "media belongs to another account", 400)
        deleted = bool(client.media_delete(info.id))
    except InstagramError:
        raise
    except Exception as err:
        state, message = classify(err)
        if state in ("needs_login", "challenge", "needs_code"):
            raise InstagramError(state, message, 401) from err
        raise InstagramError("delete_failed", short_message(err)) from err
    log.info("deleted=%s media_pk=%s", deleted, media_pk)
    return {"deleted": deleted, "session": _session_of(client)}


def run_exclusive(fn: Callable):
    """One Instagram operation at a time per container; a second caller gets 409."""
    if not _lock.acquire(blocking=False):
        raise InstagramError("busy", "another Instagram operation is running", 409)
    try:
        return fn()
    finally:
        _lock.release()
