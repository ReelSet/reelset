"""Instagram posting through instagrapi (unofficial private API).

Stateless: the worker passes the saved session in each call and stores the returned one.
Nothing here logs in unless `login` is called, and `login` never retries."""

import json
import logging
import os
import subprocess
import tempfile
import threading
import urllib.request
from pathlib import Path
from typing import Callable
from urllib.parse import urlsplit

from .proxies import parse_proxy_urls

log = logging.getLogger("reel.instagram")

MAX_VIDEO_BYTES = 100 * 1024 * 1024
DOWNLOAD_TIMEOUT_SECONDS = 120
CLIP_DELAY_RANGE = [1, 3]
ERROR_MESSAGE_MAX = 200

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


def validate_video_url(url: str) -> str:
    parts = urlsplit(url)
    if parts.scheme != "https" or (parts.hostname or "").lower() not in _allowed_hosts():
        raise InstagramError("invalid_input", "video url must be https on the media host", 400)
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


def download_video(url: str, workdir: Path) -> Path:
    validate_video_url(url)
    dest = workdir / "reel.mp4"
    with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT_SECONDS) as res, open(dest, "wb") as out:
        size = 0
        while chunk := res.read(256 * 1024):
            size += len(chunk)
            if size > MAX_VIDEO_BYTES:
                raise InstagramError("too_large", "video is larger than 100 MB", 422)
            out.write(chunk)
    log.info("downloaded video bytes=%d", size)
    return dest


def make_thumbnail(video: Path, workdir: Path) -> Path:
    thumb = workdir / "thumb.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", str(video), "-frames:v", "1", str(thumb)],
        check=True,
    )
    return thumb


def post_reel(
    session: dict,
    video_url: str,
    caption: str,
    factory: Callable = new_client,
    download: Callable = download_video,
    thumbnail: Callable = make_thumbnail,
) -> dict:
    """Uploads one reel with the saved session; a dead session is reported, never re-logged in."""
    client = factory()
    client.set_settings(session)
    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        video = download(video_url, workdir)
        thumb = thumbnail(video, workdir)
        try:
            media = client.clip_upload(video, caption, thumbnail=thumb)
        except Exception as err:
            state, message = classify(err)
            if state in ("needs_login", "challenge", "needs_code"):
                raise InstagramError(state, message, 401) from err
            log.error("clip_upload failed err=%s", type(err).__name__)
            raise InstagramError("upload_failed", short_message(err)) from err
    permalink = f"https://www.instagram.com/p/{media.code}/"
    log.info("published media_pk=%s", media.pk)
    return {"mediaPk": str(media.pk), "code": str(media.code), "permalink": permalink, "session": _session_of(client)}


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
