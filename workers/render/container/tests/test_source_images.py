import os
import random
import tempfile
import unittest

from PIL import Image

from reel import pipeline, props, source_images
from reel.timing import Word, allocate_segments
from reel.validation import validate_render_request
from tests.test_logic import good_payload


def noisy(path: str, size=(640, 360), seed=1, mode="RGB", fmt="PNG") -> None:
    rng = random.Random(seed)
    im = Image.new(mode, size)
    px = im.load()
    for x in range(0, size[0], 4):
        for y in range(0, size[1], 4):
            v = tuple(rng.randrange(256) for _ in range(len(mode)))
            for dx in range(4):
                for dy in range(4):
                    if x + dx < size[0] and y + dy < size[1]:
                        px[x + dx, y + dy] = v
    im.save(path, fmt)


class PrepareImageTests(unittest.TestCase):
    def prep(self, make, **kw):
        with tempfile.TemporaryDirectory() as d:
            src, dest = os.path.join(d, "a.bin"), os.path.join(d, "a.jpg")
            make(src)
            result = source_images.prepare_image(src, dest, **kw)
            size = None
            if result:
                with Image.open(dest) as im:
                    size = (im.format, im.size)
            return result, size

    def test_reencodes_and_bounds_large_images(self):
        result, size = self.prep(lambda p: noisy(p, (2560, 1440)))
        self.assertEqual(size, ("JPEG", (1280, 720)))
        self.assertEqual(result[:2], (1280, 720))

    def test_small_images_are_not_upscaled(self):
        result, size = self.prep(lambda p: noisy(p, (400, 300)))
        self.assertEqual(size, ("JPEG", (400, 300)))

    def test_rejects_tiny_extreme_blank_and_garbage(self):
        self.assertIsNone(self.prep(lambda p: noisy(p, (120, 90)))[0])
        self.assertIsNone(self.prep(lambda p: noisy(p, (3000, 400)))[0])
        self.assertIsNone(self.prep(lambda p: Image.new("RGB", (600, 400), (10, 10, 10)).save(p, "PNG"))[0])
        self.assertIsNone(self.prep(lambda p: open(p, "wb").write(b"nope"))[0])

    def test_transparency_is_flattened_and_webp_converted(self):
        result, size = self.prep(lambda p: noisy(p, (500, 300), mode="RGBA", fmt="WEBP"))
        self.assertEqual(size, ("JPEG", (500, 300)))


class CollectItemImagesTests(unittest.TestCase):
    def downloader(self, files):
        def download(url, dest):
            spec = files.get(url)
            if spec is None:
                return False
            noisy(dest, spec.get("size", (640, 360)), spec.get("seed", 1))
            return True

        return download

    def run_collect(self, candidates, files, **kw):
        with tempfile.TemporaryDirectory() as d:
            found = source_images.collect_item_images(candidates, d, self.downloader(files), **kw)
            return found, sorted(os.listdir(d))

    def test_keeps_order_skips_failures_and_cleans_raw_files(self):
        cands = [
            {"url": "https://a/1", "kind": "og"},
            {"url": "https://a/404", "kind": "figure"},
            {"url": "https://a/2", "kind": "figure", "alt": "Figure 2: loss"},
        ]
        found, files = self.run_collect(cands, {"https://a/1": {"seed": 1}, "https://a/2": {"seed": 2}})
        self.assertEqual([f["kind"] for f in found], ["og", "figure"])
        self.assertEqual(found[1]["alt"], "Figure 2: loss")
        self.assertEqual(found[0]["file"], "img0.jpg")
        self.assertEqual(files, ["img0.jpg", "img2.jpg"])

    def test_near_duplicate_images_are_dropped(self):
        cands = [{"url": "https://a/1", "kind": "og"}, {"url": "https://a/2", "kind": "figure"}]
        found, files = self.run_collect(cands, {"https://a/1": {"seed": 7}, "https://a/2": {"seed": 7}})
        self.assertEqual(len(found), 1)
        self.assertEqual(files, ["img0.jpg"])

    def test_caps_the_count(self):
        cands = [{"url": f"https://a/{i}", "kind": "figure"} for i in range(5)]
        files = {c["url"]: {"seed": i + 10} for i, c in enumerate(cands)}
        found, _ = self.run_collect(cands, files, limit=2)
        self.assertEqual(len(found), 2)

    def test_a_crashing_download_degrades(self):
        def boom(url, dest):
            raise RuntimeError("x")

        with tempfile.TemporaryDirectory() as d:
            self.assertEqual(source_images.collect_item_images([{"url": "https://a/1", "kind": "og"}], d, boom), [])


class CollectVisualsTests(unittest.TestCase):
    def request(self, **overrides):
        return validate_render_request({**good_payload(), **overrides})

    def test_item_images_become_images_and_cover(self):
        req = self.request(images=[{"url": "https://a.com/x.jpg", "kind": "og"}])
        fake = lambda cands, d: [{"file": "img0.jpg", "kind": "og", "width": 800, "height": 400}]
        found = pipeline.collect_visuals(req, "/nonexistent", fetch_images=fake, page_fetcher=lambda u: self.fail("no"))
        self.assertEqual(found["cover"], "img0.jpg")
        self.assertEqual(found["images"][0]["kind"], "og")

    def test_without_item_images_falls_back_to_the_cover_path(self):
        req = self.request()

        def download(url, dest):
            noisy(dest)
            return True

        with tempfile.TemporaryDirectory() as d:
            found = pipeline.collect_visuals(req, d, downloader=download)
        self.assertEqual(found["images"][0]["file"], "cover.jpg")
        self.assertEqual(found["images"][0]["kind"], "og")

    def test_images_validation(self):
        with self.assertRaises(Exception):
            self.request(images=[{"url": "http://a.com/x.jpg", "kind": "og"}])
        with self.assertRaises(Exception):
            self.request(images=[{"url": "https://a.com/x.jpg", "kind": "banner"}])
        self.assertEqual(self.request().images, [])

    def test_props_carry_images_with_job_paths(self):
        req = self.request()
        words = [Word(t, i * 0.5, i * 0.5 + 0.4) for i, t in enumerate(req.narration_text().split())]
        spans = allocate_segments(req.narration_segments(), words, 4.0)
        built = props.build_props(
            req, words, spans, 4.5,
            {"audio": "narration.mp3", "images": [{"file": "img0.jpg", "kind": "figure", "width": 800, "height": 500, "alt": "Figure 1"}]},
        )
        self.assertEqual(built["images"], [{"src": "job/img0.jpg", "kind": "figure", "width": 800, "height": 500, "alt": "Figure 1"}])


if __name__ == "__main__":
    unittest.main()
