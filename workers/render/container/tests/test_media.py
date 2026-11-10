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


class DemoStartTests(unittest.TestCase):
    def test_parses_scene_change_times(self):
        stderr = "[Parsed_showinfo_1] n:0 pts:15 pts_time:0.5 \n[Parsed_showinfo_1] n:1 pts:96 pts_time:3.2 pos:1"
        self.assertEqual(media.parse_scene_times(stderr), [0.5, 3.2])

    def test_skips_the_title_card(self):
        self.assertEqual(media.pick_demo_start([0.4, 2.6, 5.0], 12.0), 2.6)

    def test_falls_back_to_a_quarter_in_without_a_cut(self):
        self.assertEqual(media.pick_demo_start([], 12.0), 3.0)
        self.assertEqual(media.pick_demo_start([0.3], 8.0), 2.0)

    def test_leaves_enough_clip_and_handles_unknown_length(self):
        self.assertEqual(media.pick_demo_start([9.5], 10.0), 8.0)
        self.assertEqual(media.pick_demo_start([1.5], 2.0), 1.0)
        self.assertEqual(media.pick_demo_start([3.0], 0.0), 0.0)

    def test_demo_is_cut_from_the_first_scene(self):
        cmds = []

        def run(cmd):
            cmds.append(cmd)
            open(cmd[-1], "wb").write(b"mp4")

        with tempfile.TemporaryDirectory() as d:
            media.collect_demo(
                {"url": "https://github.com/a/b/raw/main/demo.mp4", "kind": "mp4", "repo": "a/b"}, d,
                lambda u, p: open(p, "wb").write(b"mp4") or True, run,
                lambda p: {"seconds": 8.0, "width": 1280, "height": 720},
                cuts=lambda p: [0.2, 1.8], duration=lambda p: 20.0, detail=lambda p: [],
            )
        self.assertEqual(cmds[0][cmds[0].index("-ss") + 1], "1.80")


class DemoWindowTests(unittest.TestCase):
    # Detail samples of the fizgig README video (2 fps): a title card, then slides joined by fades to blank.
    FIZGIG = [(t / 2, v) for t, v in enumerate(
        [0.9, 3.4, 3.5, 3.9, 4.0, 4.0, 4.1, 4.2, 4.3, 4.5, 4.7, 4.7, 4.6, 4.6, 4.6, 4.6, 4.6, 4.5, 2.0, 0.0,
         2.1, 2.6, 3.4, 4.0, 4.5, 4.5, 4.5, 4.5, 4.3, 4.3, 4.1, 3.9, 3.8, 3.8, 3.8, 4.0, 4.2, 4.4, 4.6, 4.6,
         4.6, 4.6, 3.4, 0.0, 0.6, 2.9, 3.4, 4.3, 4.8, 4.9, 4.9, 5.6, 5.8, 5.8, 5.8, 5.8, 5.5, 2.1, 0.0, 3.3,
         6.4, 6.5, 6.5, 6.7, 6.9, 6.9, 7.0, 7.0, 7.0, 7.0, 7.1, 7.1, 6.3, 1.8, 0.0, 4.5, 9.7, 9.8, 10.0, 10.2,
         10.5, 10.8, 10.5, 10.2, 9.8, 9.8, 9.6, 6.1, 0.0, 0.9, 6.1, 6.5, 6.6, 7.7, 7.7, 7.8, 7.9, 8.7, 9.5,
         9.7, 9.8, 10.1, 10.5, 10.6, 8.5, 2.2, 0.0, 3.7])]

    def test_parses_detail_samples(self):
        stderr = "frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=0.9\nframe:1    pts:15  pts_time:0.5\nlavfi.signalstats.YAVG=3.4\n"
        self.assertEqual(media.parse_detail(stderr), [(0.0, 0.9), (0.5, 3.4)])

    def test_picks_a_full_slide_not_the_title_card_or_a_fade(self):
        start, seconds = media.pick_demo_window(self.FIZGIG)
        blanks = [t for t, v in self.FIZGIG if v < 1.0]
        self.assertGreaterEqual(start, 30.0)
        self.assertGreaterEqual(seconds, 3.0)
        self.assertLessEqual(seconds, media.MAX_DEMO_SECONDS)
        self.assertFalse(any(start <= t <= start + seconds for t in blanks))

    def test_no_signal_means_the_scene_rule_decides(self):
        self.assertIsNone(media.pick_demo_window([]))
        self.assertIsNone(media.pick_demo_window([(0, 0.0), (0.5, 0.0), (1, 0.0), (1.5, 0.0)]))

    def test_collect_demo_cuts_the_picked_window(self):
        cmds = []

        def run(cmd):
            cmds.append(cmd)
            open(cmd[-1], "wb").write(b"mp4")

        with tempfile.TemporaryDirectory() as d:
            media.collect_demo(
                {"url": "https://github.com/a/b/raw/main/demo.mp4", "kind": "mp4", "repo": "a/b"}, d,
                lambda u, p: open(p, "wb").write(b"mp4") or True, run,
                lambda p: {"seconds": 6.0, "width": 1280, "height": 720},
                cuts=lambda p: [], duration=lambda p: 81.0, detail=lambda p: self.FIZGIG,
            )
        start = float(cmds[0][cmds[0].index("-ss") + 1])
        seconds = float(cmds[0][cmds[0].index("-t") + 1])
        self.assertGreaterEqual(start, 30.0)
        self.assertLessEqual(seconds, media.MAX_DEMO_SECONDS)


class _Resp:
    def __init__(self, body: bytes, fail: Exception | None = None):
        self.body, self.fail = body, fail
        self.headers = {"Content-Type": "video/mp4", "Content-Length": str(len(body))}

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def read(self, n):
        if self.fail:
            raise self.fail
        return self.body


class _Opener:
    def __init__(self, plan):
        self.plan, self.calls = list(plan), 0

    def open(self, request, timeout=None):
        self.calls += 1
        step = self.plan.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


class DownloadRetryTests(unittest.TestCase):
    URL = "https://videos.pexels.com/x.mp4"

    def fetch(self, plan):
        import http.client

        opener = _Opener(plan)
        sleeps = []
        with tempfile.TemporaryDirectory() as d:
            dest = os.path.join(d, "x")
            ok = media._download(self.URL, dest, lambda u: True, 1000, opener=opener, sleep=sleeps.append)
        return ok, opener.calls, sleeps, http.client

    def test_retries_incomplete_reads_and_timeouts_then_succeeds(self):
        import http.client

        ok, calls, sleeps, _ = self.fetch([
            _Resp(b"", http.client.IncompleteRead(b"x", 10)), TimeoutError("slow"), _Resp(b"video"),
        ])
        self.assertTrue(ok)
        self.assertEqual(calls, 3)
        self.assertEqual(sleeps, [1.0, 2.0])

    def test_gives_up_after_three_tries(self):
        ok, calls, _, _ = self.fetch([TimeoutError("a"), TimeoutError("b"), TimeoutError("c")])
        self.assertFalse(ok)
        self.assertEqual(calls, 3)

    def test_does_not_retry_a_404(self):
        import urllib.error

        ok, calls, _, _ = self.fetch([urllib.error.HTTPError(self.URL, 404, "nf", {}, None)])
        self.assertFalse(ok)
        self.assertEqual(calls, 1)


class ClaimsAndFactsTests(unittest.TestCase):
    def test_claims_and_reddit_text_reach_the_props(self):
        payload = good_payload()
        payload["script"] = {**payload["script"], "claims": [{"text": " A  claim. ", "chunkIds": []}, 3, {"text": ""}]}
        payload["facts"] = {"reddit": {"text": "Post body", "upvotes": 4, "bogus": 1}}
        r = validation.validate_render_request(payload)
        self.assertEqual(r.claims, ["A claim."])
        self.assertEqual(r.facts["reddit"], {"text": "Post body", "upvotes": 4})
