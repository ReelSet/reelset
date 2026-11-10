"""Post a photo or reel to Instagram with instagrapi (unofficial private API).

Setup (once):
  python3 -m venv scripts/smoke/.venv
  scripts/smoke/.venv/bin/pip install -r scripts/smoke/requirements-instagram.txt

Env (read from the shell or reelset/.env.local):
  IG_USERNAME, IG_PASSWORD       required
  IG_TOTP_SECRET                 optional, the 2FA seed from an authenticator-app setup
  IG_SESSIONID                   optional, the `sessionid` cookie from a logged-in instagram.com tab
  IG_SESSION_PATH                optional, default ~/.reelset/ig_session.json

Usage:
  scripts/smoke/.venv/bin/python scripts/smoke/instagram_post.py --video out/reel.mp4 --caption 'hi'
  scripts/smoke/.venv/bin/python scripts/smoke/instagram_post.py --image https://.../pic.png --dry-run
  scripts/smoke/.venv/bin/python scripts/smoke/instagram_post.py --delete <media_pk>
"""

import argparse
import logging
import os
import subprocess
import sys
import tempfile
import urllib.request
from pathlib import Path

from instagrapi import Client
from instagrapi.exceptions import ClientNeedsUpgradeError, LoginRequired, TwoFactorRequired
from PIL import Image

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SESSION = Path.home() / ".reelset" / "ig_session.json"

log = logging.getLogger("instagram_post")


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("IG_"):
            os.environ.setdefault(key, value.strip().strip("'\""))


def fetch_local(src: str, workdir: Path) -> Path:
    if not src.startswith(("http://", "https://")):
        path = Path(src).expanduser().resolve()
        if not path.is_file():
            sys.exit(f"file not found: {path}")
        return path
    dest = workdir / Path(src.split("?")[0]).name
    log.info("downloading media url=%s", src.split("?")[0])
    urllib.request.urlretrieve(src, dest)
    log.info("downloaded bytes=%d", dest.stat().st_size)
    return dest


def to_jpeg(path: Path, workdir: Path) -> Path:
    if path.suffix.lower() in (".jpg", ".jpeg"):
        return path
    out = workdir / f"{path.stem}.jpg"
    Image.open(path).convert("RGB").save(out, "JPEG", quality=95)
    log.info("converted image to jpeg src=%s", path.name)
    return out


def make_thumbnail(video: Path, workdir: Path) -> Path:
    # Passing our own thumbnail skips instagrapi's MoviePy dependency.
    thumb = workdir / f"{video.stem}_thumb.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", "1", "-i", str(video), "-frames:v", "1", str(thumb)],
        check=True,
    )
    return thumb


def ask_challenge_code(username: str, choice) -> str:
    return input(f"Instagram sent a security code to your {choice} for @{username}. Code: ").strip()


def reset_keeping_device(cl: Client) -> None:
    # Same device ids on retry, so Instagram sees one phone retrying instead of a new one.
    uuids = cl.get_settings().get("uuids")
    cl.set_settings({})
    if uuids:
        cl.set_uuids(uuids)


def salvage_two_factor_session(cl: Client) -> bool:
    # instagrapi 3.2.9 only reads the session from the Bloks body; Instagram can also return it in
    # real response headers/cookies after verify_code (issue #2881, Nov 4 report).
    resp = cl.last_response
    headers = resp.headers if resp is not None else {}
    applied = cl.bloks_apply_login_response(
        {
            "headers": {k: v for k, v in headers.items() if k.lower().startswith(("ig-set-", "x-ig-set-"))},
            "cookies": {"sessionid": cl.private.cookies.get("sessionid")} if cl.private.cookies.get("sessionid") else {},
        }
    )
    body = resp.text if resp is not None else ""
    log.info(
        "verify_code response status=%s ig_header_names=%s sessionid_cookie=%s body_len=%d markers=%s",
        getattr(resp, "status_code", None),
        sorted(k.lower() for k in headers if k.lower().startswith(("ig-set-", "x-ig-set-"))),
        bool(cl.private.cookies.get("sessionid")),
        len(body),
        [m for m in ("login_response", "two_fac_redirect", "has_been_allowed", "login_success", "error", "Incorrect", "expired") if m in body],
    )
    if not applied:
        return False
    try:
        cl.account_info()
    except Exception as e:
        log.warning("salvaged auth did not work error=%s", type(e).__name__)
        return False
    log.info("salvaged session from verify_code response headers")
    return True


def login(session_path: Path, code: str | None) -> Client:
    username = os.environ.get("IG_USERNAME")
    password = os.environ.get("IG_PASSWORD")
    if not username or not password:
        sys.exit("IG_USERNAME and IG_PASSWORD must be set")
    totp_secret = os.environ.get("IG_TOTP_SECRET")

    cl = Client()
    cl.delay_range = [1, 3]
    cl.challenge_code_handler = ask_challenge_code

    def fresh_login(keep_device: bool = False) -> None:
        if keep_device:
            reset_keeping_device(cl)
        first_code = code or (cl.totp_generate_code(totp_secret) if totp_secret else "")
        try:
            cl.login(username, password, verification_code=first_code)
            return
        except (TwoFactorRequired, ClientNeedsUpgradeError) as e:
            # instagrapi 3.2.x reports a missing 2FA code as needs_upgrade (issues #2807, #2881).
            log.warning("login stopped at two-step verification error=%s", type(e).__name__)
            if first_code and salvage_two_factor_session(cl):
                return
            if first_code or not sys.stdin.isatty():
                raise
        second_code = input("2FA code (authenticator app, or the SMS/WhatsApp Instagram just sent): ")
        reset_keeping_device(cl)
        log.info("retrying login with 2FA code")
        try:
            cl.login(username, password, verification_code=second_code.strip())
        except TwoFactorRequired:
            if not salvage_two_factor_session(cl):
                raise

    sessionid = os.environ.get("IG_SESSIONID")
    if sessionid and not session_path.exists():
        # Skips the password flow, which instagrapi 3.2.x fails on for 2FA accounts (needs_upgrade).
        log.info("logging in with browser sessionid cookie")
        cl.login_by_sessionid(sessionid)
    elif session_path.exists():
        log.info("reusing saved session path=%s", session_path)
        cl.load_settings(session_path)
        try:
            cl.login(username, password)
            cl.get_timeline_feed()
        except LoginRequired:
            log.warning("saved session expired, logging in fresh on the same device id")
            fresh_login(keep_device=True)
    else:
        log.info("no saved session, logging in fresh user=%s", username)
        fresh_login()

    session_path.parent.mkdir(parents=True, exist_ok=True)
    cl.dump_settings(session_path)
    session_path.chmod(0o600)
    log.info("logged in user=%s user_id=%s", username, cl.user_id)
    return cl


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    kind = parser.add_mutually_exclusive_group(required=True)
    kind.add_argument("--image", help="local path or URL of a photo")
    kind.add_argument("--video", help="local path or URL of a vertical MP4, posted as a reel")
    kind.add_argument("--delete", metavar="MEDIA_PK", help="delete one of your posts by media_pk")
    parser.add_argument("--caption", default="reelset test post")
    parser.add_argument("--dry-run", action="store_true", help="log in and prepare media, but do not post")
    parser.add_argument("--code", help="current 2FA code, for the first login only")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    load_env_file(REPO_ROOT / ".env.local")
    session_path = Path(os.environ.get("IG_SESSION_PATH", DEFAULT_SESSION)).expanduser()

    if args.delete:
        cl = login(session_path, args.code)
        info = cl.media_info(args.delete)
        if str(info.user.pk) != str(cl.user_id):
            sys.exit(f"media {args.delete} belongs to @{info.user.username}, not you; refusing to delete")
        log.info("deleting media_pk=%s code=%s taken_at=%s", info.pk, info.code, info.taken_at)
        if args.dry_run:
            log.info("dry run: not deleting")
            return
        log.info("deleted=%s media_pk=%s", cl.media_delete(info.id), info.pk)
        return

    with tempfile.TemporaryDirectory() as tmp:
        workdir = Path(tmp)
        media = fetch_local(args.image or args.video, workdir)
        if args.image:
            media = to_jpeg(media, workdir)
        thumb = make_thumbnail(media, workdir) if args.video else None
        log.info("media ready kind=%s file=%s", "reel" if args.video else "photo", media.name)

        cl = login(session_path, args.code)

        if args.dry_run:
            log.info("dry run: logged in and media prepared, not posting")
            return

        if args.video:
            result = cl.clip_upload(media, args.caption, thumbnail=thumb)
        else:
            result = cl.photo_upload(media, args.caption)
        log.info("published media_pk=%s url=https://www.instagram.com/p/%s/", result.pk, result.code)


if __name__ == "__main__":
    main()
