import json
import os
import tempfile
import unittest

from reel import media, pipeline, props, validation
from reel.errors import RenderError
from tests.test_logic import good_payload


class ValidateMediaTests(unittest.TestCase):
    def req(self, **extra):
        return validation.validate_render_request({**good_payload(), **extra})

    def test_broll_and_demo_are_validated(self):
        r = self.req(
            broll=[{"url": "https://videos.pexels.com/a.mp4", "beat": 1, "seconds": 4, "creator": "Ann", "pageUrl": "https://www.pexels.com/video/1/"}],
            demo={"url": "https://github.com/user-attachments/assets/x", "kind": "mp4", "repo": "acme/widget"},
        )
        self.assertEqual(r.broll[0]["beat"], 1)
        self.assertEqual(r.demo["repo"], "acme/widget")

    def test_rejects_bad_media(self):
        for extra in (
            {"broll": [{"url": "http://videos.pexels.com/a.mp4"}]},
            {"broll": [{"url": "https://videos.pexels.com/a.mp4"}] * 9},
            {"demo": {"url": "https://x.com/a.gif", "kind": "avi", "repo": "a/b"}},
            {"demo": {"url": "https://x.com/a.gif", "kind": "gif", "repo": "not a repo"}},
        ):
            with self.assertRaises(RenderError):
                self.req(**extra)

    def test_image_caption_and_focus_pass_through_and_bad_focus_is_dropped(self):
        r = self.req(images=[
            {"url": "https://i.example/a.png", "kind": "figure", "caption": "Fig", "focus": {"x": 0.2, "y": 0.8}},
            {"url": "https://i.example/b.png", "kind": "og", "focus": {"x": 2, "y": 0}},
        ])
        self.assertEqual(r.images[0]["focus"], {"x": 0.2, "y": 0.8})
        self.assertNotIn("focus", r.images[1])

    def test_repodemo_is_a_known_screen(self):
        self.assertIn("RepoDemo", validation.SCREEN_NAMES)


class CollectBrollTests(unittest.TestCase):
    def test_pexels_host_only(self):
        self.assertTrue(media.is_pexels_video_url("https://videos.pexels.com/x.mp4"))
        self.assertFalse(media.is_pexels_video_url("https://evil.example/x.mp4"))
        self.assertFalse(media.is_pexels_video_url("http://videos.pexels.com/x.mp4"))

    def test_clips_are_trimmed_muted_and_skipped_on_failure(self):
        ran = []

        def download(url, dest):
            if "bad" in url:
                return False
            open(dest, "wb").write(b"x")
            return True

        def run(cmd):
            ran.append(cmd)
            open(cmd[-1], "wb").write(b"y")

        clips = [
            {"url": "https://videos.pexels.com/ok.mp4", "beat": 2, "seconds": 99, "creator": "Ann", "pageUrl": "https://p/1"},
            {"url": "https://videos.pexels.com/bad.mp4"},
        ]
        with tempfile.TemporaryDirectory() as d:
            out = media.collect_broll(clips, d, download, run)
            self.assertEqual(len(out), 1)
            self.assertEqual(out[0]["file"], "broll0.mp4")
            self.assertEqual(out[0]["seconds"], media.MAX_CLIP_SECONDS)
            self.assertEqual(out[0]["beat"], 2)
            self.assertNotIn("broll0.src", os.listdir(d))
        self.assertIn("-an", ran[0])
        self.assertEqual(ran[0][ran[0].index("-t") + 1], "6.00")

    def test_a_crashing_ffmpeg_never_raises(self):
        def run(cmd):
            raise RenderError("ffmpeg_failed", "boom")

        with tempfile.TemporaryDirectory() as d:
            out = media.collect_broll(
                [{"url": "https://videos.pexels.com/ok.mp4"}], d, lambda u, p: open(p, "wb").write(b"x") or True, run
            )
        self.assertEqual(out, [])


class CollectDemoTests(unittest.TestCase):
    def test_gif_converts_to_mp4_and_reports_size(self):
        cmds = []

        def run(cmd):
            cmds.append(cmd)
            open(cmd[-1], "wb").write(b"mp4")

        with tempfile.TemporaryDirectory() as d:
            out = media.collect_demo(
                {"url": "https://github.com/a/b/raw/main/demo.gif", "kind": "gif", "repo": "a/b"}, d,
                lambda u, p: open(p, "wb").write(b"gif") or True, run,
                lambda p: {"seconds": 4.0, "width": 1280, "height": 720},
            )
            self.assertEqual(out, {"file": "demo.mp4", "repo": "a/b", "seconds": 4.0, "width": 1280, "height": 720})
        self.assertIn("libx264", cmds[0])

    def test_failures_and_stills_return_none(self):
        with tempfile.TemporaryDirectory() as d:
            self.assertIsNone(media.collect_demo(None, d))
            self.assertIsNone(media.collect_demo({"url": "https://x/a.gif", "kind": "gif", "repo": "a/b"}, d, lambda u, p: False))
            self.assertIsNone(
                media.collect_demo(
                    {"url": "https://x/a.gif", "kind": "gif", "repo": "a/b"}, d,
                    lambda u, p: open(p, "wb").write(b"g") or True,
                    lambda cmd: open(cmd[-1], "wb").write(b"m"),
                    lambda p: {"seconds": 0.2, "width": 10, "height": 10},
                )
            )


class CreditsTests(unittest.TestCase):
    def test_only_used_clips_are_credited(self):
        broll = [
            {"creator": "Ann", "creatorUrl": "https://pexels.com/@ann", "pageUrl": "https://pexels.com/video/1"},
            {"creator": "Bob", "pageUrl": "https://pexels.com/video/2"},
        ]
        out = media.credits_for(broll, [1, 1, 5], None, False)
        self.assertEqual([c["creator"] for c in out], ["Bob"])
        self.assertEqual(out[0]["provider"], "pexels")

    def test_demo_credit_only_when_shown(self):
        demo = {"repo": "a/b"}
        self.assertEqual(media.credits_for([], [], demo, False), [])
        self.assertEqual(media.credits_for([], [], demo, True)[0]["url"], "https://github.com/a/b")

    def test_pipeline_reads_used_media_from_the_timeline(self):
        with tempfile.TemporaryDirectory() as d:
            json.dump({"usedBroll": [0], "usedDemo": False}, open(os.path.join(d, "timeline.json"), "w"))
            out = pipeline._credits(d, {"broll": [{"creator": "Ann", "pageUrl": "https://p/1"}]})
            self.assertEqual(out[0]["creator"], "Ann")
            self.assertEqual(pipeline._credits(os.path.join(d, "none"), {}), [])


class PropsMediaTests(unittest.TestCase):
    def test_props_carry_broll_demo_and_vetted_image_fields(self):
        req = validation.validate_render_request(good_payload())
        from reel.timing import Word, allocate_segments

        words = [Word(w, i * 0.4, i * 0.4 + 0.3) for i, w in enumerate(req.narration_text().split())]
        spans = allocate_segments(req.narration_segments(), words, words[-1].end + 0.2)
        assets = {
            "audio": "narration.mp3",
            "broll": [{"file": "broll0.mp4", "seconds": 5.0, "width": 720, "height": 1280, "beat": 1, "creator": "Ann"}],
            "demo": {"file": "demo.mp4", "seconds": 4.0, "width": 1280, "height": 720, "repo": "a/b"},
            "images": [{"file": "img0.jpg", "kind": "figure", "caption": "Fig 1", "focus": {"x": 0.3, "y": 0.4}}],
        }
        out = props.build_props(req, words, spans, 12.0, assets)
        self.assertEqual(out["broll"][0]["src"], "job/broll0.mp4")
        self.assertEqual(out["broll"][0]["beat"], 1)
        self.assertEqual(out["demo"]["repo"], "a/b")
        self.assertEqual(out["images"][0]["caption"], "Fig 1")
        self.assertEqual(out["images"][0]["focus"], {"x": 0.3, "y": 0.4})


if __name__ == "__main__":
    unittest.main()
