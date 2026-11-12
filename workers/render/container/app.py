import hmac
import json
import logging
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from reel import hoststats, instagram, pipeline, transcript, validation, youtube_search
from reel.activity import Activity
from reel.errors import RenderError
from reel.jobs import JobStore

logging.basicConfig(
    stream=sys.stdout, level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
)
log = logging.getLogger("app")

MAX_BODY_BYTES = 256 * 1024
MAX_RENDER_BODY_BYTES = 8 * 1024 * 1024
PORT = int(os.environ.get("PORT", "8080"))
ASSET_RE = re.compile(r"^/render/([A-Za-z0-9_-]{8,80})/(video|poster)$")
JOB_RE = re.compile(r"^/render/([A-Za-z0-9_-]{8,80})$")
ASSETS = {"video": ("video.mp4", "video/mp4"), "poster": ("poster.jpg", "image/jpeg")}

BOX_TOKEN = os.environ.get("BOX_TOKEN", "")
OPEN_PATHS = ("/health",)


def max_renders_from_env(raw: str | None) -> int:
    return int(raw) if raw and raw.isdigit() and int(raw) > 0 else 1


def is_authorized(token: str, path: str, header: str | None) -> bool:
    if not token or path in OPEN_PATHS:
        return True
    expected = f"Bearer {token}".encode()
    return hmac.compare_digest((header or "").encode(), expected)


activity = Activity()
BOX_NAME = hoststats.box_name()
cpu_sampler = hoststats.CpuSampler()
jobs = JobStore(max_running=max_renders_from_env(os.environ.get("MAX_RENDERS")))


class Handler(BaseHTTPRequestHandler):
    server_version = "reel-container/1"

    def log_message(self, fmt, *args):
        log.info("%s %s", self.address_string(), fmt % args)

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, err: RenderError) -> None:
        self._json(err.status, {"error": err.code, "message": err.message})

    def _read_json(self, limit: int = MAX_BODY_BYTES):
        length = self.headers.get("Content-Length", "")
        if not length.isdigit() or int(length) > limit:
            raise RenderError("invalid_input", "missing or oversized body")
        try:
            return json.loads(self.rfile.read(int(length)))
        except ValueError as err:
            raise RenderError("invalid_input", "body is not valid JSON") from err

    def _authorized(self) -> bool:
        if is_authorized(BOX_TOKEN, self.path, self.headers.get("Authorization")):
            return True
        log.warning("unauthorized %s %s from %s", self.command, self.path, self.address_string())
        self._json(401, {"error": "unauthorized"})
        return False

    def handle_one_request(self):
        self._tracked = False
        try:
            super().handle_one_request()
        finally:
            if self._tracked:
                activity.finish()

    def _track(self) -> None:
        if self.path != "/health" and not self._tracked:
            self._tracked = True
            activity.start()

    def do_GET(self):
        if not self._authorized():
            return
        if self.path == "/health":
            inflight, idle = activity.snapshot()
            return self._json(
                200,
                {
                    "ok": True,
                    "box": BOX_NAME,
                    "running": jobs.running(),
                    "inflight": inflight,
                    "idleSeconds": idle,
                    **hoststats.snapshot(cpu_sampler),
                },
            )
        job = JOB_RE.match(self.path)
        if job:
            # Status probes are not work: they must not reset the idle clock the reclaim guard reads.
            return self._json(200, {"state": jobs.state(job.group(1))})
        self._track()
        match = ASSET_RE.match(self.path)
        if not match:
            return self._json(404, {"error": "not_found"})
        name, content_type = ASSETS[match.group(2)]
        path = jobs.file_path(match.group(1), name)
        if not path:
            return self._json(404, {"error": "not_found"})
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.end_headers()
        with open(path, "rb") as fh:
            while chunk := fh.read(256 * 1024):
                self.wfile.write(chunk)

    def do_DELETE(self):
        if not self._authorized():
            return
        self._track()
        match = JOB_RE.match(self.path)
        if not match:
            return self._json(404, {"error": "not_found"})
        jobs.delete(match.group(1))
        self._json(200, {"deleted": True})

    def do_POST(self):
        if not self._authorized():
            return
        self._track()
        try:
            if self.path == "/transcript":
                video_id = validation.validate_video_id(self._read_json())
                return self._json(200, transcript.fetch_transcript(video_id))
            if self.path == "/youtube/search":
                return self._youtube_search()
            if self.path == "/parse/paper":
                return self._parse_paper()
            if self.path == "/render":
                return self._render()
            if self.path.startswith("/instagram/"):
                return self._instagram(self.path.removeprefix("/instagram/"))
            return self._json(404, {"error": "not_found"})
        except instagram.InstagramError as err:
            log.warning("instagram request rejected code=%s", err.code)
            self._json(err.status, {"error": err.code, "message": err.message})
        except RenderError as err:
            log.warning("request rejected code=%s msg=%s", err.code, err.message)
            self._error(err)
        except Exception:
            log.exception("unhandled error")
            self._json(500, {"error": "ffmpeg_failed", "message": "internal error"})

    def _instagram(self, action: str):
        body = self._read_json()
        if not isinstance(body, dict):
            raise instagram.InstagramError("invalid_input", "body must be an object", 400)
        session = body.get("session") if isinstance(body.get("session"), dict) else None

        def require_str(key: str) -> str:
            value = body.get(key)
            if not isinstance(value, str) or not value:
                raise instagram.InstagramError("invalid_input", f"{key} is required", 400)
            return value

        proxy_index = body.get("proxyIndex") if isinstance(body.get("proxyIndex"), int) else None
        proxy = instagram.resolve_proxy(proxy_index)
        factory = lambda: instagram.new_client(proxy.url)  # noqa: E731
        if action == "status":
            work = lambda: instagram.status(session, factory)  # noqa: E731
        elif action == "login":
            work = lambda: instagram.login(  # noqa: E731
                session,
                require_str("username"),
                require_str("password"),
                body.get("totpSecret") or None,
                body.get("code") or None,
                factory,
            )
        elif action == "post":
            if session is None:
                raise instagram.InstagramError("needs_login", "no saved session", 401)
            raw_poster = body.get("posterUrl")
            poster_url = raw_poster if isinstance(raw_poster, str) and raw_poster else None
            work = lambda: instagram.post_reel(  # noqa: E731
                session, require_str("videoUrl"), poster_url, require_str("caption"), factory
            )
        elif action == "find":
            if session is None:
                raise instagram.InstagramError("needs_login", "no saved session", 401)
            since = body.get("since")
            if not isinstance(since, (int, float)) or isinstance(since, bool) or since <= 0:
                raise instagram.InstagramError("invalid_input", "since must be epoch seconds", 400)
            raw_exclude = body.get("excludeMediaPks")
            exclude = [str(pk) for pk in raw_exclude if isinstance(pk, (str, int))] if isinstance(raw_exclude, list) else []
            work = lambda: instagram.find_reel(  # noqa: E731
                session, require_str("caption"), float(since), exclude, factory
            )
        elif action == "delete":
            if session is None:
                raise instagram.InstagramError("needs_login", "no saved session", 401)
            work = lambda: instagram.delete_media(session, require_str("mediaPk"), factory)  # noqa: E731
        else:
            return self._json(404, {"error": "not_found"})
        result = instagram.run_exclusive(work)
        self._json(200, {**result, "proxy": proxy.public()})

    def _youtube_search(self):
        queries, max_age_days, per_query_limit = youtube_search.validate_search_request(
            self._read_json()
        )
        try:
            result = youtube_search.search_youtube(queries, max_age_days, per_query_limit)
        except youtube_search.SearchFailed as err:
            log.error("youtube search failed: %s", err)
            return self._json(502, {"status": "error", "reason": str(err)})
        self._json(200, result)

    def _parse_paper(self):
        from reel.paper import service as paper_service

        body = self._read_json()
        arxiv_id = body.get("arxivId") if isinstance(body, dict) else None
        if not isinstance(arxiv_id, str) or not paper_service.valid_id(arxiv_id):
            raise RenderError("invalid_input", "arxivId must be an arXiv id")
        self._json(200, paper_service.parse_paper(arxiv_id))

    def _render(self):
        req = validation.validate_render_request(self._read_json(MAX_RENDER_BODY_BYTES))
        state, payload = jobs.begin(req.job_id)
        if state == "done":
            log.info("job=%s already rendered, returning cached metadata", req.job_id)
            return self._json(200, payload)
        try:
            meta = {**pipeline.run_render(req, payload), "box": BOX_NAME}
        except BaseException:
            jobs.fail(req.job_id)
            raise
        jobs.finish(req.job_id, meta)
        self._json(200, meta)


if __name__ == "__main__":
    log.info("listening on %d as box %s", PORT, BOX_NAME)
    cpu_sampler.start()
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
