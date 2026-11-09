import unittest

from reel import proxies, transcript

A = "http://u:p@10.0.0.1:8000"
B = "http://u:p@10.0.0.2:8000"
C = "http://u:p@10.0.0.3:8000"


class ParseTests(unittest.TestCase):
    def test_separators_and_dedupe(self):
        self.assertEqual(proxies.parse_proxy_urls(f"{A}, {B}\n{C} {A}"), [A, B, C])

    def test_invalid_entries_dropped(self):
        self.assertEqual(proxies.parse_proxy_urls(f"nonsense,ftp://x:1,http://nohost,{A}"), [A])

    def test_empty(self):
        self.assertEqual(proxies.parse_proxy_urls(None), [])
        self.assertEqual(proxies.parse_proxy_urls("  "), [])


class PoolTests(unittest.TestCase):
    def test_rotation_and_direct_last(self):
        pool = proxies.ProxyPool([A, B, C])
        self.assertEqual([i for i, _ in pool.attempts()], [0, 1, 2, None])
        self.assertEqual([i for i, _ in pool.attempts()], [1, 2, 0, None])
        self.assertEqual([i for i, _ in pool.attempts()], [2, 0, 1, None])
        self.assertEqual([i for i, _ in pool.attempts()], [0, 1, 2, None])

    def test_no_proxies_is_direct_only(self):
        self.assertEqual(proxies.ProxyPool([]).attempts(), [(None, None)])

    def test_run_with_proxies_retries_then_succeeds(self):
        seen = []

        def fn(url):
            seen.append(url)
            if url != B:
                raise RuntimeError("blocked")
            return "ok"

        self.assertEqual(proxies.run_with_proxies(fn, proxies.ProxyPool([A, B]), "t"), "ok")
        self.assertEqual(seen, [A, B])

    def test_run_with_proxies_raises_last_error_after_direct(self):
        seen = []

        def fn(url):
            seen.append(url)
            raise ValueError(url)

        with self.assertRaises(ValueError):
            proxies.run_with_proxies(fn, proxies.ProxyPool([A]), "t")
        self.assertEqual(seen, [A, None])


class SearchPatchTests(unittest.TestCase):
    def test_patch_routes_through_thread_proxy_and_sets_timeout(self):
        from youtubesearchpython.core import requests as lib

        seen = {}

        def fake_post(url, **kwargs):
            seen.update(kwargs)
            return "resp"

        original = lib.httpx.post
        lib.httpx.post = fake_post
        try:
            proxies.install_search_proxy_patch()
            core = lib.RequestCore()
            core.url, core.data, core.timeout = "https://x", {}, None
            core.syncPostRequest()
            self.assertEqual(seen["proxies"], {})
            proxies._local.url = A
            core.syncPostRequest()
            self.assertEqual(seen["proxies"], {"http://": A, "https://": A})
            self.assertEqual(seen["timeout"], proxies.PROXY_TIMEOUT_SECONDS)
        finally:
            proxies._local.url = None
            lib.httpx.post = original


class FakeFetched(list):
    language_code = "en"


class Snip:
    text, start, duration = "hi", 0, 1.0


def factory(outcomes, calls):
    def make(proxy_config=None):
        url = proxy_config.http_url if proxy_config else None
        calls.append(url)
        outcome = outcomes[url]

        class Api:
            def fetch(self, video_id, languages):
                if isinstance(outcome, Exception):
                    raise outcome
                return outcome

        return Api()

    return make


class TranscriptProxyTests(unittest.TestCase):
    def setUp(self):
        from youtube_transcript_api import IpBlocked, TranscriptsDisabled

        self.blocked, self.disabled = IpBlocked("v"), TranscriptsDisabled("v")

    def test_blocked_falls_through_to_next_proxy(self):
        calls = []
        api = factory({A: self.blocked, B: FakeFetched([Snip()])}, calls)
        out = transcript.fetch_transcript("dQw4w9WgXcQ", api, proxies.ProxyPool([A, B]))
        self.assertEqual(out["status"], "ok")
        self.assertEqual(calls, [A, B])

    def test_direct_is_last_resort(self):
        calls = []
        api = factory({A: self.blocked, None: FakeFetched([Snip()])}, calls)
        out = transcript.fetch_transcript("dQw4w9WgXcQ", api, proxies.ProxyPool([A]))
        self.assertEqual(out["status"], "ok")
        self.assertEqual(calls, [A, None])

    def test_no_captions_stops_without_retry(self):
        calls = []
        api = factory({A: self.disabled}, calls)
        out = transcript.fetch_transcript("dQw4w9WgXcQ", api, proxies.ProxyPool([A, B]))
        self.assertEqual(out, {"status": "unavailable", "reason": "no_captions"})
        self.assertEqual(calls, [A])

    def test_all_blocked_is_blocked_but_any_error_is_error(self):
        out = transcript.fetch_transcript(
            "dQw4w9WgXcQ", factory({A: self.blocked, None: self.blocked}, []), proxies.ProxyPool([A])
        )
        self.assertEqual(out, {"status": "unavailable", "reason": "blocked"})
        out = transcript.fetch_transcript(
            "dQw4w9WgXcQ", factory({A: RuntimeError("407"), None: self.blocked}, []), proxies.ProxyPool([A])
        )
        self.assertEqual(out, {"status": "unavailable", "reason": "error"})


if __name__ == "__main__":
    unittest.main()
