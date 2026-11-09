import json
import os
import tempfile
import unittest
import unittest.mock

from PIL import Image

from reel import images, pipeline, props, sources, words as words_lib
from reel.timing import Word, allocate_segments
from reel.validation import validate_render_request
from tests.test_logic import good_payload


def make_png(path: str, size=(32, 24)) -> None:
    Image.new("RGB", size, (200, 247, 81)).save(path, "PNG")


class RestorePunctuationTests(unittest.TestCase):
    def test_tokens_regain_punctuation(self):
        text = "Nvidia's CEO wrote it, and it's 12.4k! Done."
        spoken = [Word(t, i * 0.3, i * 0.3 + 0.25) for i, t in enumerate(
            ["Nvidia's", "CEO", "wrote", "it", "and", "it's", "12.4k", "Done"])]
        restored = words_lib.restore_punctuation(text, spoken)
        self.assertEqual([w.text for w in restored], ["Nvidia's", "CEO", "wrote", "it,", "and", "it's", "12.4k!", "Done."])
        self.assertEqual([w.start for w in restored], [w.start for w in spoken])

    def test_split_tokens_keep_trailing_punctuation_on_last_piece(self):
        spoken = [Word(t, i * 0.3, i * 0.3 + 0.25) for i, t in enumerate(["state", "of", "the", "art", "ok"])]
        restored = words_lib.restore_punctuation("state-of-the-art. ok", spoken)
        self.assertEqual([w.text for w in restored], ["state", "of", "the", "art.", "ok"])

    def test_mismatch_degrades_to_tts_words(self):
        spoken = [Word("alpha", 0, 1), Word("beta", 1, 2)]
        self.assertEqual([w.text for w in words_lib.restore_punctuation("gamma delta", spoken)], ["alpha", "beta"])
        self.assertEqual(words_lib.restore_punctuation("", spoken), spoken)


class BuildPropsTests(unittest.TestCase):
    def setUp(self):
        payload = good_payload()
        payload["script"]["beats"][1]["visual"] = {"type": "image", "url": "https://i.ytimg.com/vi/x/hq.jpg"}
        self.req = validate_render_request(payload)
        self.words = [Word(t, i * 0.5, i * 0.5 + 0.4) for i, t in enumerate(self.req.narration_text().split())]
        self.spans = allocate_segments(self.req.narration_segments(), self.words, 4.0)
        self.assets = {"audio": "narration.mp3"}

    def build(self, **assets):
        return props.build_props(self.req, self.words, self.spans, 4.5, {**self.assets, **assets})

    def test_scenes_follow_spoken_spans_in_order(self):
        built = self.build()
        kinds = [s["kind"] for s in built["scenes"]]
        self.assertEqual(kinds, ["hook", "beat", "beat", "outro"])
        starts = [s["start"] for s in built["scenes"]]
        self.assertEqual(starts[0], 0)
        self.assertEqual(starts, sorted(starts))
        for scene, (start, end) in zip(built["scenes"], self.spans):
            self.assertAlmostEqual(scene["start"], start, places=2)
            self.assertAlmostEqual(scene["end"], end, places=2)
        self.assertEqual(built["durationSeconds"], 4.5)
        self.assertEqual(len(built["words"]), len(self.words))
        json.dumps(built)

    def test_image_beat_never_carries_a_file_the_composition_draws_it(self):
        self.assertEqual(self.build()["scenes"][2]["visual"], {"type": "image"})
        self.assertEqual(self.build(cover="cover.jpg")["scenes"][2]["visual"], {"type": "image"})

    def test_cover_is_the_only_optional_asset(self):
        built = self.build()
        self.assertNotIn("cover", built)
        self.assertEqual(self.build(cover="cover.jpg")["cover"], "job/cover.jpg")
        self.assertEqual(built["audio"], "job/narration.mp3")

    def test_domain_label(self):
        self.assertEqual(props.display_domain(self.req), "github.com/acme/widget")
        news = validate_render_request({**good_payload(), "source": "news", "canonicalUrl": "https://www.example.com/a/b?x=1"})
        self.assertEqual(props.display_domain(news), "example.com")
        none = validate_render_request({**good_payload(), "canonicalUrl": ""})
        self.assertEqual(props.display_domain(none), "github")

    def test_poster_is_inside_the_hook(self):
        self.assertGreaterEqual(props.poster_second(self.spans), 0.5)
        self.assertLess(props.poster_second(self.spans), self.spans[0][1])


class SourceCoverTests(unittest.TestCase):
    def test_og_image_prefers_og_over_twitter_and_resolves_relative(self):
        html = '<meta name="twitter:image" content="/t.png"><meta property="og:image" content="/img/og.jpg?a=1&amp;b=2">'
        self.assertEqual(sources.og_image_url(html, "https://example.com/post/1"), "https://example.com/img/og.jpg?a=1&b=2")
        self.assertEqual(sources.og_image_url('<meta name="twitter:image" content="https://c.io/t.png">', "https://e.com"), "https://c.io/t.png")

    def test_og_image_rejects_non_https_and_missing(self):
        self.assertIsNone(sources.og_image_url('<meta property="og:image" content="http://e.com/a.png">', "https://e.com"))
        self.assertIsNone(sources.og_image_url("<html></html>", "https://e.com"))

    def test_page_url_skips_sources_with_direct_images_and_social_hosts(self):
        self.assertIsNone(sources.page_url_for_cover("github", "https://github.com/a/b"))
        self.assertIsNone(sources.page_url_for_cover("hn", "https://news.ycombinator.com/item?id=1"))
        self.assertIsNone(sources.page_url_for_cover("reddit", "https://www.reddit.com/r/x/comments/1"))
        self.assertIsNone(sources.page_url_for_cover("news", "http://insecure.example.com"))
        self.assertEqual(sources.page_url_for_cover("hn", "https://example.com/a"), "https://example.com/a")


class PublicUrlTests(unittest.TestCase):
    def resolver(self, address):
        return lambda host, port, proto=0: [(2, 1, 6, "", (address, 443))]

    def test_public_host_allowed_and_internal_blocked(self):
        self.assertTrue(images.is_public_https_url("https://example.com/a", self.resolver("93.184.216.34")))
        for internal in ("127.0.0.1", "10.0.0.5", "169.254.169.254", "192.168.1.1", "100.64.0.1"):
            self.assertFalse(images.is_public_https_url("https://example.com/a", self.resolver(internal)), internal)

    def test_scheme_credentials_port_and_dns_failure_blocked(self):
        ok = self.resolver("93.184.216.34")
        self.assertFalse(images.is_public_https_url("http://example.com/a", ok))
        self.assertFalse(images.is_public_https_url("https://u:p@example.com/a", ok))
        self.assertFalse(images.is_public_https_url("https://example.com:8443/a", ok))

        def boom(*a, **k):
            raise OSError("nxdomain")

        self.assertFalse(images.is_public_https_url("https://example.com/a", boom))


class NormalizeImageTests(unittest.TestCase):
    def test_reencodes_to_bounded_jpeg(self):
        with tempfile.TemporaryDirectory() as d:
            src, dest = os.path.join(d, "a.png"), os.path.join(d, "a.jpg")
            make_png(src, (2000, 1000))
            self.assertTrue(images.normalize_image(src, dest, max_width=800))
            with Image.open(dest) as im:
                self.assertEqual((im.format, im.size), ("JPEG", (800, 400)))

    def test_garbage_is_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            src = os.path.join(d, "a.bin")
            with open(src, "wb") as fh:
                fh.write(b"not an image")
            self.assertFalse(images.normalize_image(src, os.path.join(d, "o.jpg")))


class CollectAssetsTests(unittest.TestCase):
    def setUp(self):
        patcher = unittest.mock.patch.object(pipeline, "RETRY_DELAY_SECONDS", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def request(self, **overrides):
        return validate_render_request({**good_payload(), **overrides})

    def downloader(self, ok_urls):
        def download(url, dest):
            if url in ok_urls:
                make_png(dest)
                return True
            return False

        return download

    def collect(self, req, **kwargs):
        with tempfile.TemporaryDirectory() as d:
            found = pipeline.collect_assets(req, d, **kwargs)
            files = sorted(os.listdir(d))
        return found, files

    def test_direct_source_image_becomes_cover_and_script_images_are_not_fetched(self):
        req = self.request()
        ok = {"https://opengraph.githubassets.com/x/y", "https://opengraph.githubassets.com/1/acme/widget"}
        found, files = self.collect(req, downloader=self.downloader(ok), page_fetcher=lambda u: self.fail("no scrape"))
        self.assertEqual(found["cover"], "cover.jpg")
        self.assertEqual(files, ["cover.jpg"])

    def test_falls_through_the_candidate_list(self):
        req = self.request(source="youtube", canonicalUrl="https://youtube.com/watch?v=abc", sourceImageUrls=[
            "https://i.ytimg.com/vi/abc/maxresdefault.jpg", "https://i.ytimg.com/vi/abc/hqdefault.jpg"], imageUrls=[])
        found, _ = self.collect(req, downloader=self.downloader({"https://i.ytimg.com/vi/abc/hqdefault.jpg"}))
        self.assertEqual(found["cover"], "cover.jpg")

    def test_og_image_used_when_there_is_no_direct_image(self):
        req = self.request(source="news", canonicalUrl="https://example.com/post", sourceImageUrls=[], imageUrls=[])
        page = '<meta property="og:image" content="https://cdn.example.com/og.png">'
        found, _ = self.collect(
            req,
            downloader=self.downloader(set()),
            public_downloader=self.downloader({"https://cdn.example.com/og.png"}),
            page_fetcher=lambda u: page if u == "https://example.com/post" else None,
        )
        self.assertEqual(found["cover"], "cover.jpg")

    def test_a_rate_limited_download_is_retried_once(self):
        calls = []

        def flaky(url, dest):
            calls.append(url)
            if len(calls) == 1:
                return False
            make_png(dest)
            return True

        found, _ = self.collect(self.request(imageUrls=[], sourceImageUrls=["https://i.ytimg.com/vi/a/hq.jpg"]), downloader=flaky)
        self.assertEqual(found["cover"], "cover.jpg")
        self.assertEqual(len(calls), 2)

    def test_every_failure_degrades_to_no_assets(self):
        req = self.request(source="news", canonicalUrl="https://example.com/post", sourceImageUrls=[])
        found, files = self.collect(
            req,
            downloader=self.downloader(set()),
            public_downloader=self.downloader(set()),
            page_fetcher=lambda u: '<meta property="og:image" content="https://cdn.example.com/og.png">',
        )
        self.assertEqual(found, {})
        self.assertEqual(files, [])

    def test_undecodable_download_is_dropped(self):
        def junk(url, dest):
            with open(dest, "wb") as fh:
                fh.write(b"<html>blocked</html>")
            return True

        found, files = self.collect(self.request(), downloader=junk, page_fetcher=lambda u: None)
        self.assertEqual(found, {})
        self.assertEqual(files, [])


if __name__ == "__main__":
    unittest.main()
