import os
import tempfile
import unittest
import urllib.error

from reel import images, proxies, timing, transcript, validation
from reel.errors import RenderError
from reel.timing import Word


def good_payload():
    return {
        "jobId": "job12345",
        "title": "Some repo",
        "sourceLabel": "GitHub",
        "voice": "en-US-AriaNeural",
        "imageUrls": ["https://opengraph.githubassets.com/x/y"],
        "source": "github",
        "canonicalUrl": "https://github.com/acme/widget",
        "sourceImageUrls": ["https://opengraph.githubassets.com/1/acme/widget"],
        "script": {
            "hook": "This changes everything.",
            "beats": [
                {"text": "First beat.", "visual": {"type": "title", "title": "Hello"}},
                {"text": "Second beat.", "visual": {"type": "stat", "label": "stars", "value": "10k"}},
            ],
            "outro": "Thanks for watching.",
        },
    }


class ValidationTests(unittest.TestCase):
    def test_accepts_valid_payload(self):
        req = validation.validate_render_request(good_payload())
        self.assertEqual(req.job_id, "job12345")
        self.assertEqual(req.narration_text(), "This changes everything. First beat. Second beat. Thanks for watching.")

    def assert_invalid(self, mutate):
        payload = good_payload()
        mutate(payload)
        with self.assertRaises(RenderError) as ctx:
            validation.validate_render_request(payload)
        self.assertEqual(ctx.exception.code, "invalid_input")

    def test_rejects_bad_input(self):
        self.assert_invalid(lambda p: p.update(jobId="../etc"))
        self.assert_invalid(lambda p: p.update(voice="en US; rm"))
        self.assert_invalid(lambda p: p["script"].update(beats=[]))
        self.assert_invalid(lambda p: p["script"]["beats"][0].update(visual={"type": "video"}))
        self.assert_invalid(lambda p: p["script"].update(hook="x" * 121))
        self.assert_invalid(lambda p: p.update(imageUrls=["https://i.ytimg.com/a"] * 11))
        self.assert_invalid(lambda p: p.update(imageUrls=[5]))
        self.assert_invalid(lambda p: p.pop("title"))

    def test_source_fields_are_optional_and_validated(self):
        payload = good_payload()
        for key in ("source", "canonicalUrl", "sourceImageUrls"):
            payload.pop(key)
        req = validation.validate_render_request(payload)
        self.assertEqual((req.source, req.canonical_url, req.source_image_urls), ("news", "", []))
        self.assert_invalid(lambda p: p.update(source="myspace"))
        self.assert_invalid(lambda p: p.update(sourceImageUrls=["https://i.ytimg.com/a"] * 5))
        self.assert_invalid(lambda p: p.update(sourceImageUrls=[1]))

    def test_rejects_non_object(self):
        with self.assertRaises(RenderError):
            validation.validate_render_request([])

    def test_video_id(self):
        self.assertEqual(validation.validate_video_id({"videoId": "dQw4w9WgXcQ"}), "dQw4w9WgXcQ")
        for bad in ({"videoId": "short"}, {"videoId": "dQw4w9WgXcQ&x"}, {}, "x"):
            with self.assertRaises(RenderError):
                validation.validate_video_id(bad)


class TimingTests(unittest.TestCase):
    def words(self, text, per_word=0.5):
        out, t = [], 0.0
        for token in text.split():
            out.append(Word(token, t, t + per_word))
            t += per_word
        return out

    def test_allocation_follows_word_boundaries(self):
        segments = ["one two", "three four five", "six"]
        words = self.words(" ".join(segments))
        spans = timing.allocate_segments(segments, words, 3.0)
        self.assertEqual(len(spans), 3)
        self.assertAlmostEqual(spans[0][0], 0.0)
        self.assertAlmostEqual(spans[0][1], 1.0)
        self.assertAlmostEqual(spans[1][1], 2.5)
        self.assertAlmostEqual(spans[2][1], 3.0)
        for (_, end), (start, _) in zip(spans, spans[1:]):
            self.assertAlmostEqual(end, start)

    def test_allocation_tolerates_different_tokenization(self):
        segments = ["well-known tool", "next"]
        words = [Word("well", 0, 0.3), Word("-", 0.3, 0.4), Word("known", 0.4, 0.8),
                 Word("tool", 0.8, 1.2), Word("next", 1.2, 1.6)]  # fmt: skip
        spans = timing.allocate_segments(segments, words, 1.6)
        self.assertAlmostEqual(spans[0][1], 1.2)

    def test_allocation_without_words_uses_estimate(self):
        spans = timing.allocate_segments(["aaaa bbbb", "cccc dddd"], [], 4.0)
        self.assertAlmostEqual(spans[0][1], 2.0, places=1)
        self.assertAlmostEqual(spans[-1][1], 4.0)

    def test_estimate_covers_total(self):
        words = timing.estimate_word_timings("a bb ccc", 6.0)
        self.assertAlmostEqual(words[-1].end, 6.0)
        self.assertEqual(timing.estimate_word_timings("", 3.0), [])

    def test_choose_rate(self):
        self.assertEqual(timing.choose_rate(400), "+0%")
        self.assertEqual(timing.choose_rate(1000), "+26%")
        self.assertEqual(timing.choose_rate(5000), "+50%")

    def test_refit_rate_brings_measured_audio_under_cap(self):
        self.assertEqual(timing.refit_rate("+0%", 66.0), "+13%")
        self.assertEqual(timing.refit_rate("+10%", 66.0), "+25%")
        self.assertIsNone(timing.refit_rate("+0%", 120.0))


class ImageAllowlistTests(unittest.TestCase):
    def test_allowed(self):
        for url in (
            "https://opengraph.githubassets.com/abc/org/repo",
            "https://avatars.githubusercontent.com/u/1",
            "https://raw.githubusercontent.com/o/r/main/a.png",
            "https://i.ytimg.com/vi/x/hq.jpg",
            "https://i.ytimg.com:443/vi/x/hq.jpg",
        ):
            self.assertTrue(images.is_allowed_image_url(url), url)

    def test_blocked(self):
        for url in (
            "http://i.ytimg.com/a.jpg",
            "https://evil.com/a.jpg",
            "https://i.ytimg.com.evil.com/a.jpg",
            "https://user:pw@i.ytimg.com/a.jpg",
            "https://i.ytimg.com:8443/a.jpg",
            "https://169.254.169.254/latest",
            "file:///etc/passwd",
            "https://i.ytimg.com:abc/a.jpg",
            "not a url",
        ):
            self.assertFalse(images.is_allowed_image_url(url), url)

    def test_download_enforces_cap_and_type(self):
        class Resp:
            def __init__(self, data, ctype="image/png", length=None):
                self.data, self.headers = data, {"Content-Type": ctype}
                if length is not None:
                    self.headers["Content-Length"] = str(length)

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def read(self, n):
                return self.data[:n]

        class Opener:
            def __init__(self, resp):
                self.resp = resp

            def open(self, req, timeout):
                assert timeout == images.FETCH_TIMEOUT_SECONDS
                if isinstance(self.resp, Exception):
                    raise self.resp
                return self.resp

        url = "https://i.ytimg.com/a.png"
        with tempfile.TemporaryDirectory() as d:
            dest = os.path.join(d, "img")
            self.assertTrue(images.download_image(url, dest, Opener(Resp(b"x" * 10))))
            self.assertEqual(os.path.getsize(dest), 10)
            self.assertFalse(images.download_image(url, dest, Opener(Resp(b"x", "text/html"))))
            self.assertFalse(images.download_image(url, dest, Opener(Resp(b"x", length=images.MAX_IMAGE_BYTES + 1))))
            big = b"x" * (images.MAX_IMAGE_BYTES + 5)
            self.assertFalse(images.download_image(url, dest, Opener(Resp(big))))
            self.assertFalse(images.download_image(url, dest, Opener(urllib.error.URLError("boom"))))
            self.assertFalse(images.download_image("https://evil.com/a.png", dest, Opener(Resp(b"x"))))


class TranscriptTests(unittest.TestCase):
    def api(self, result=None, error=None):
        class Api:
            def fetch(self, video_id, languages):
                if error:
                    raise error
                return result

        return Api

    def test_ok(self):
        class Snip:
            def __init__(self, text, start, duration):
                self.text, self.start, self.duration = text, start, duration

        class Fetched(list):
            language_code = "en"

        out = transcript.fetch_transcript("dQw4w9WgXcQ", self.api(Fetched([Snip("hi", 0, 2.1)])), proxies.ProxyPool([]))
        self.assertEqual(out, {"status": "ok", "language": "en", "segments": [{"text": "hi", "start": 0.0, "duration": 2.1}]})

    def test_error_mapping(self):
        from youtube_transcript_api import IpBlocked, NoTranscriptFound, TranscriptsDisabled, VideoUnavailable

        cases = [
            (IpBlocked("v"), "blocked"),
            (TranscriptsDisabled("v"), "no_captions"),
            (VideoUnavailable("v"), "no_captions"),
            (NoTranscriptFound("v", ["en"], None), "no_captions"),
            (RuntimeError("boom"), "error"),
        ]
        for err, reason in cases:
            out = transcript.fetch_transcript("dQw4w9WgXcQ", self.api(error=err), proxies.ProxyPool([]))
            self.assertEqual(out, {"status": "unavailable", "reason": reason}, type(err).__name__)


class TtsTests(unittest.TestCase):
    def test_collects_word_boundaries_and_audio(self):
        from reel import tts

        class Fake:
            async def stream(self):
                yield {"type": "audio", "data": b"abc"}
                yield {"type": "WordBoundary", "offset": 5_000_000, "duration": 2_500_000, "text": "hi"}
                yield {"type": "audio", "data": b"def"}

        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "a.mp3")
            words = tts.synthesize("hi", "v", "+0%", path, lambda t, v, r: Fake())
            with open(path, "rb") as fh:
                self.assertEqual(fh.read(), b"abcdef")
        self.assertEqual(len(words), 1)
        self.assertAlmostEqual(words[0].start, 0.5)
        self.assertAlmostEqual(words[0].end, 0.75)

    def test_failure_maps_to_tts_unavailable(self):
        from reel import tts

        class Broken:
            async def stream(self):
                raise ConnectionError("down")
                yield

        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RenderError) as ctx:
                tts.synthesize("hi", "v", "+0%", os.path.join(d, "a.mp3"), lambda t, v, r: Broken())
        self.assertEqual(ctx.exception.code, "tts_unavailable")


if __name__ == "__main__":
    unittest.main()
