import unittest
from pathlib import Path
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
        if self.fail:
            raise self.fail
        return SimpleNamespace(pk=777, code="ABC")

    def media_info(self, pk):
        return SimpleNamespace(pk=pk, id=f"{pk}_42", user=SimpleNamespace(pk=self.owner))

    owner = "42"

    def media_delete(self, media_id):
        self.calls.append(("media_delete", media_id))
        return True


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


class PostTests(unittest.TestCase):
    def fakes(self):
        return (lambda url, wd: Path("/tmp/x.mp4")), (lambda v, wd: Path("/tmp/t.jpg"))

    def test_post_returns_media_and_permalink(self):
        client = FakeClient()
        dl, th = self.fakes()
        result = instagram.post_reel({"a": 1}, "https://media.reelset.app/r.mp4", "hi", lambda: client, dl, th)
        self.assertEqual(result["mediaPk"], "777")
        self.assertEqual(result["permalink"], "https://www.instagram.com/p/ABC/")
        self.assertNotIn("login", [c[0] for c in client.calls if isinstance(c, tuple)])

    def test_dead_session_raises_needs_login_without_relogin(self):
        client = FakeClient(fail=LoginRequired("x"))
        dl, th = self.fakes()
        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.post_reel({"a": 1}, "https://media.reelset.app/r.mp4", "hi", lambda: client, dl, th)
        self.assertEqual(ctx.exception.code, "needs_login")
        self.assertEqual(ctx.exception.status, 401)

    def test_other_failure_is_upload_failed(self):
        client = FakeClient(fail=RuntimeError("boom"))
        dl, th = self.fakes()
        with self.assertRaises(instagram.InstagramError) as ctx:
            instagram.post_reel({"a": 1}, "https://media.reelset.app/r.mp4", "hi", lambda: client, dl, th)
        self.assertEqual(ctx.exception.code, "upload_failed")


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


class UrlTests(unittest.TestCase):
    def test_only_https_media_host(self):
        instagram.validate_video_url("https://media.reelset.app/reels/a.mp4")
        for bad in ("http://media.reelset.app/a.mp4", "https://evil.example/a.mp4", "file:///etc/passwd"):
            with self.assertRaises(instagram.InstagramError):
                instagram.validate_video_url(bad)


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


if __name__ == "__main__":
    unittest.main()


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
