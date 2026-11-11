import unittest
from pathlib import Path
from datetime import datetime, timezone
from types import SimpleNamespace

from reel import instagram


class LoginRequired(Exception):
    pass


class ChallengeRequired(Exception):
    pass


class TwoFactorRequired(Exception):
    pass


class FakeClient:
    def __init__(self, fail=None, username="reelset"):
        self.fail = fail
        self.username = username
        self.calls = []
        self.settings = {}
        self.user_id = "42"
        self.last_response = None

    def set_settings(self, s):
        self.settings = dict(s)

    def get_settings(self):
        return {"uuids": {"phone": "p"}, "authorization_data": "x", **self.settings}

    def set_uuids(self, u):
        self.settings["uuids"] = u

    def totp_generate_code(self, secret):
        return "123456"

    def login(self, username, password, verification_code=""):
        self.calls.append(("login", verification_code))
        if self.fail:
            raise self.fail

    def account_info(self):
        self.calls.append("account_info")
        if self.fail:
            raise self.fail
        return SimpleNamespace(username=self.username)

    def clip_upload(self, path, caption, thumbnail=None):
        self.calls.append(("clip_upload", caption))
        self.thumbnail = thumbnail
        if self.fail:
            raise self.fail
        return SimpleNamespace(pk=777, code="ABC")

    def media_info(self, pk):
        return SimpleNamespace(pk=pk, id=f"{pk}_42", user=SimpleNamespace(pk=self.owner))

    owner = "42"

    def media_delete(self, media_id):
        self.calls.append(("media_delete", media_id))
        return True

    medias = []

    def user_medias_v1(self, user_id, amount=0):
        self.calls.append(("user_medias_v1", user_id, amount))
        if self.fail:
            raise self.fail
        return self.medias


class StatusTests(unittest.TestCase):
    def test_no_session_never_calls_instagram(self):
        client = FakeClient()
        result = instagram.status(None, lambda: client)
        self.assertEqual(result["state"], "needs_login")
        self.assertEqual(client.calls, [])

    def test_valid_session_is_connected_without_login(self):
        client = FakeClient()
        result = instagram.status({"uuids": {}}, lambda: client)
        self.assertEqual(result["state"], "connected")
        self.assertEqual(result["username"], "reelset")
        self.assertEqual(client.calls, ["account_info"])

    def test_expired_session_reports_needs_login_and_does_not_relogin(self):
        client = FakeClient(fail=LoginRequired("nope"))
        result = instagram.status({"uuids": {}}, lambda: client)
        self.assertEqual(result["state"], "needs_login")
        self.assertNotIn(("login", ""), client.calls)


class LoginTests(unittest.TestCase):
    def test_success_returns_session(self):
        client = FakeClient()
        result = instagram.login({"uuids": {"phone": "p"}}, "u", "p", None, "654321", lambda: client)
        self.assertEqual(result["state"], "connected")
        self.assertIn(("login", "654321"), client.calls)
        self.assertEqual(client.settings["uuids"], {"phone": "p"})
        self.assertEqual(sum(1 for c in client.calls if isinstance(c, tuple) and c[0] == "login"), 1)

    def test_totp_secret_used_when_no_code(self):
        client = FakeClient()
        instagram.login(None, "u", "p", "SECRET", None, lambda: client)
        self.assertIn(("login", "123456"), client.calls)

    def test_missing_2fa_code_asks_for_code(self):
        client = FakeClient(fail=TwoFactorRequired("2fa"))
        result = instagram.login(None, "u", "p", None, None, lambda: client)
        self.assertEqual(result["state"], "needs_code")
        self.assertIsNone(result["session"])

    def test_challenge_is_reported_with_guidance(self):
        client = FakeClient(fail=ChallengeRequired("c"))
        result = instagram.login(None, "u", "p", None, "1", lambda: client)
        self.assertEqual(result["state"], "challenge")
        self.assertIn("Instagram app", result["message"])

    def test_requires_credentials(self):
        with self.assertRaises(instagram.InstagramError):
            instagram.login(None, "", "", None, None, FakeClient)


VIDEO_URL = "https://media.reelset.app/reels/i/k.mp4"
POSTER_URL = "https://media.reelset.app/reels/i/k.jpg"


class PostTests(unittest.TestCase):
    def post(self, client, cover=None, poster_url=POSTER_URL):
        dl = lambda url, wd: Path("/tmp/x.mp4")  # noqa: E731
        cover = cover or (lambda v, url, wd: Path("/tmp/t.jpg"))
        return instagram.post_reel({"a": 1}, VIDEO_URL, poster_url, "hi", lambda: client, dl, cover)

    def test_post_returns_media_and_permalink(self):
        client = FakeClient()
        result = self.post(client)
        self.assertEqual(result["mediaPk"], "777")
        self.assertEqual(result["permalink"], "https://www.instagram.com/p/ABC/")
        self.assertNotIn("login", [c[0] for c in client.calls if isinstance(c, tuple)])

    def test_uploads_the_chosen_cover_as_the_thumbnail(self):
        client = FakeClient()
        seen = {}

        def cover(video, url, wd):
            seen["args"] = (video, url)
            return Path("/tmp/poster.jpg")

        self.post(client, cover)
        self.assertEqual(seen["args"], (Path("/tmp/x.mp4"), POSTER_URL))
        self.assertEqual(client.thumbnail, Path("/tmp/poster.jpg"))

    def test_dead_session_raises_needs_login_without_relogin(self):
        with self.assertRaises(instagram.InstagramError) as ctx:
            self.post(FakeClient(fail=LoginRequired("x")))
        self.assertEqual(ctx.exception.code, "needs_login")
        self.assertEqual(ctx.exception.status, 401)

    def test_other_failure_is_upload_failed(self):
        with self.assertRaises(instagram.InstagramError) as ctx:
            self.post(FakeClient(fail=RuntimeError("boom")))
        self.assertEqual(ctx.exception.code, "upload_failed")


def write_image(path: Path, size: tuple) -> Path:
    from PIL import Image

    Image.new("RGB", size, (10, 20, 30)).save(path, "JPEG")
    return path


class CoverTests(unittest.TestCase):
    SHAPE = (1080, 1920, 30.0)

    def setUp(self):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.workdir = Path(self._tmp.name)
        self.frames = []

    def tearDown(self):
        self._tmp.cleanup()

    def frame(self, video, wd, shape):
        self.frames.append(shape)
        return wd / "frame.jpg"

    def choose(self, poster_url, fetch):
        return instagram.choose_cover(
            Path("/tmp/x.mp4"), poster_url, self.workdir, fetch, self.frame, lambda v: self.SHAPE
        )

    def test_uses_the_render_poster_when_it_matches_the_video(self):
        poster = write_image(self.workdir / "poster.jpg", (1080, 1920))
        with self.assertLogs("reel.instagram", "INFO") as logs:
            self.assertEqual(self.choose(POSTER_URL, lambda url, wd: poster), poster)
        self.assertEqual(self.frames, [])
        self.assertIn("cover source=poster", logs.output[-1])

    def test_falls_back_to_a_frame_without_a_poster_url(self):
        with self.assertLogs("reel.instagram", "WARNING") as logs:
            self.assertEqual(self.choose(None, None), self.workdir / "frame.jpg")
        self.assertEqual(self.frames, [self.SHAPE])
        self.assertIn("reason=no_poster_url", logs.output[0])

    def test_falls_back_to_a_frame_when_the_poster_download_fails(self):
        def fetch(url, wd):
            raise instagram.InstagramError("download_failed", "404")

        with self.assertLogs("reel.instagram", "WARNING") as logs:
            self.assertEqual(self.choose(POSTER_URL, fetch), self.workdir / "frame.jpg")
        self.assertIn("reason=download_failed", logs.output[0])

    def test_falls_back_when_the_poster_aspect_differs_from_the_video(self):
        poster = write_image(self.workdir / "poster.jpg", (1080, 1080))
        with self.assertLogs("reel.instagram", "WARNING") as logs:
            self.choose(POSTER_URL, lambda url, wd: poster)
        self.assertEqual(len(self.frames), 1)
        self.assertIn("reason=bad_poster", logs.output[0])

    def test_falls_back_when_the_poster_is_not_an_image(self):
        poster = self.workdir / "poster.jpg"
        poster.write_bytes(b"<html>not found</html>")
        with self.assertLogs("reel.instagram", "WARNING"):
            self.choose(POSTER_URL, lambda url, wd: poster)
        self.assertEqual(len(self.frames), 1)

    def test_poster_on_a_foreign_host_is_never_fetched(self):
        from unittest import mock

        with mock.patch("urllib.request.urlopen") as urlopen, self.assertLogs("reel.instagram", "WARNING"):
            self.choose("https://evil.example/p.jpg", instagram.download_poster)
        urlopen.assert_not_called()
        self.assertEqual(len(self.frames), 1)


class FallbackFrameTests(unittest.TestCase):
    def test_frame_time_uses_the_render_poster_bounds(self):
        from reel import props

        self.assertEqual(props.fallback_poster_second(None), props.POSTER_UNKNOWN_HOOK_SECOND)
        self.assertEqual(props.fallback_poster_second(30.0), props.POSTER_UNKNOWN_HOOK_SECOND)
        self.assertEqual(props.fallback_poster_second(2.0), 1.0)
        self.assertEqual(props.fallback_poster_second(0.4), props.POSTER_MIN_SECOND)
        self.assertNotEqual(props.fallback_poster_second(30.0), 1.0)

    def test_extracts_a_frame_with_the_render_poster_command(self):
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(instagram.video, "run_ffmpeg") as run:
            workdir = Path(tmp)
            run.side_effect = lambda cmd, cwd: (workdir / "frame.jpg").write_bytes(b"jpg")
            cover = instagram.extract_cover_frame(Path("v.mp4"), workdir, (1080, 1920, 20.0))
        self.assertEqual(cover, workdir / "frame.jpg")
        cmd = run.call_args[0][0]
        self.assertEqual(cmd, instagram.video.build_poster_cmd("v.mp4", str(workdir / "frame.jpg"), 3.0))

    def test_missing_frame_is_a_cover_error(self):
        import tempfile
        from unittest import mock

        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(instagram.video, "run_ffmpeg"):
            with self.assertRaises(instagram.InstagramError) as ctx:
                instagram.extract_cover_frame(Path("v.mp4"), Path(tmp), None)
        self.assertEqual(ctx.exception.code, "cover_failed")


class DeleteTests(unittest.TestCase):
    def test_deletes_own_media(self):
        client = FakeClient()
        self.assertTrue(instagram.delete_media({"a": 1}, "9", lambda: client)["deleted"])

    def test_refuses_foreign_media(self):
        client = FakeClient()
        client.owner = "99"
        with self.assertRaises(instagram.InstagramError):
            instagram.delete_media({"a": 1}, "9", lambda: client)
        self.assertNotIn(("media_delete", "9_42"), client.calls)


class FindTests(unittest.TestCase):
    def media(self, pk, caption, taken):
        return SimpleNamespace(
            pk=pk, code=f"C{pk}", caption_text=caption, taken_at=datetime.fromtimestamp(taken, timezone.utc)
        )

    def test_finds_the_reel_by_caption_after_the_start_time(self):
        client = FakeClient()
        client.medias = [
            self.media(1, "Other post", 2_000),
            self.media(2, "OpenAI raises $11B\n\n#ai   #openai", 1_950),
        ]
        out = instagram.find_reel({"s": 1}, "OpenAI raises $11B\n#ai #openai", 2_000, lambda: client)
        self.assertEqual(out["found"], True)
        self.assertEqual(out["mediaPk"], "2")
        self.assertEqual(out["permalink"], "https://www.instagram.com/p/C2/")
        self.assertIn(("user_medias_v1", "42", instagram.FIND_RECENT_MEDIA), client.calls)

    def test_ignores_an_older_post_with_the_same_caption(self):
        client = FakeClient()
        client.medias = [self.media(3, "Same caption", 1_000)]
        out = instagram.find_reel({"s": 1}, "Same caption", 5_000, lambda: client)
        self.assertEqual(out["found"], False)
        self.assertNotIn("mediaPk", out)

    def test_dead_session_is_needs_login(self):
        client = FakeClient(fail=LoginRequired("x"))
        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.find_reel({"s": 1}, "c", 1, lambda: client)
        self.assertEqual(ctx.exception.code, "needs_login")

    def test_other_failure_is_lookup_failed(self):
        client = FakeClient(fail=RuntimeError("boom"))
        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.find_reel({"s": 1}, "c", 1, lambda: client)
        self.assertEqual(ctx.exception.code, "lookup_failed")


class UrlTests(unittest.TestCase):
    def test_only_https_media_host(self):
        instagram.validate_media_url("https://media.reelset.app/reels/a.mp4")
        for bad in ("http://media.reelset.app/a.mp4", "https://evil.example/a.mp4", "file:///etc/passwd"):
            with self.assertRaises(instagram.InstagramError):
                instagram.validate_media_url(bad)


class ProxyTests(unittest.TestCase):
    URLS = ["http://u:p@10.0.0.1:1", "http://u:p@10.0.0.2:2"]

    def test_uses_the_pinned_proxy_and_reports_country(self):
        probed = []

        def probe(url):
            probed.append(url)
            return "US"

        info = instagram.resolve_proxy(1, self.URLS, probe)
        self.assertEqual((info.index, info.country, info.switched), (1, "US", False))
        self.assertEqual(probed, [self.URLS[1]])

    def test_public_view_has_no_url(self):
        info = instagram.resolve_proxy(0, self.URLS, lambda u: "DE")
        self.assertEqual(set(info.public()), {"index", "country", "switched", "down"})
        self.assertNotIn("10.0.0", str(info.public()))

    def test_switches_only_when_pinned_is_dead(self):
        def probe(url):
            if url == self.URLS[0]:
                raise OSError("dead")
            return "NL"

        info = instagram.resolve_proxy(0, self.URLS, probe)
        self.assertEqual((info.index, info.switched), (1, True))

    def test_all_dead_blocks_instead_of_going_direct(self):
        def probe(url):
            raise OSError("dead")

        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.resolve_proxy(0, self.URLS, probe)
        self.assertEqual((ctx.exception.code, ctx.exception.status), ("proxy_down", 503))

    def test_no_proxy_configured_blocks(self):
        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.resolve_proxy(None, [], lambda u: "US")
        self.assertEqual(ctx.exception.code, "proxy_down")

    def test_out_of_range_pin_uses_the_first_proxy(self):
        info = instagram.resolve_proxy(9, self.URLS, lambda u: "US")
        self.assertEqual((info.index, info.switched), (0, False))


class ExclusiveTests(unittest.TestCase):
    def test_second_caller_gets_busy(self):
        def inner():
            with self.assertRaises(instagram.InstagramError) as ctx:
                instagram.run_exclusive(lambda: None)
            self.assertEqual(ctx.exception.code, "busy")

        instagram.run_exclusive(inner)



class DownloadTests(unittest.TestCase):
    def test_sends_a_user_agent_and_reports_http_errors(self):
        import tempfile
        import urllib.error
        from unittest import mock

        seen = {}

        def fake_urlopen(request, timeout):
            seen["agent"] = request.get_header("User-agent")
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)

        with tempfile.TemporaryDirectory() as tmp, mock.patch("urllib.request.urlopen", fake_urlopen):
            with self.assertRaises(instagram.InstagramError) as ctx:
                instagram.download_video("https://media.reelset.app/reels/a/b.mp4", Path(tmp))
        self.assertEqual(seen["agent"], instagram.DOWNLOAD_USER_AGENT)
        self.assertEqual(ctx.exception.code, "download_failed")
        self.assertIn("403", ctx.exception.message)

    def test_poster_download_is_capped(self):
        import io
        import tempfile
        from unittest import mock

        class Body(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        big = Body(b"x" * (instagram.MAX_POSTER_BYTES + 1))
        with tempfile.TemporaryDirectory() as tmp, mock.patch("urllib.request.urlopen", lambda r, timeout: big):
            with self.assertRaises(instagram.InstagramError) as ctx:
                instagram.download_poster(POSTER_URL, Path(tmp))
        self.assertEqual(ctx.exception.code, "too_large")


if __name__ == "__main__":
    unittest.main()
