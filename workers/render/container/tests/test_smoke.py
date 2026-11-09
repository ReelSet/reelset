import base64
import json
import os
import subprocess
import tempfile
import unittest
import unittest.mock

from reel import pipeline, video
from reel.errors import RenderError
from reel.jobs import JobStore
from reel.validation import validate_render_request
from tests.test_logic import good_payload


def make_silence(path: str, seconds: float) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
         "-t", str(seconds), "-q:a", "9", path],
        check=True,
    )  # fmt: skip


def fake_render(seconds: float):
    """Stands in for the Remotion step: writes <job>/raw.mp4 from the props' audio, like the real one."""

    def render(job_dir: str) -> None:
        assert os.path.exists(os.path.join(job_dir, "props.json"))
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=720x1280:r=30",
             "-i", os.path.join(job_dir, "assets", "narration.mp3"), "-t", str(seconds),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", os.path.join(job_dir, "raw.mp4")],
            check=True,
        )  # fmt: skip

    return render


NO_NET = dict(
    downloader=lambda u, d: False,
    public_downloader=lambda u, d: False,
    page_fetcher=lambda u: None,
)


class JobStoreTests(unittest.TestCase):
    def test_lifecycle(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root)
            state, directory = jobs.begin("job12345")
            self.assertEqual(state, "new")
            with self.assertRaises(RenderError) as ctx:
                jobs.begin("other123")
            self.assertEqual(ctx.exception.code, "busy")
            with open(os.path.join(directory, "video.mp4"), "wb") as fh:
                fh.write(b"x")
            jobs.finish("job12345", {"a": 1})
            self.assertEqual(jobs.begin("job12345"), ("done", {"a": 1}))
            self.assertIsNotNone(jobs.file_path("job12345", "video.mp4"))
            jobs.delete("job12345")
            self.assertIsNone(jobs.file_path("job12345", "video.mp4"))


class PipelineTests(unittest.TestCase):
    def setUp(self):
        patcher = unittest.mock.patch.object(pipeline, "RETRY_DELAY_SECONDS", 0)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_pipeline(self, synth, **overrides):
        req = validate_render_request(good_payload())
        job_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(job_dir, ignore_errors=True))
        kwargs = {**NO_NET, "render": fake_render(6.5), **overrides}
        return req, job_dir, pipeline.run_render(req, job_dir, synth=synth, **kwargs)

    def test_renders_faststart_h264_with_poster_and_props(self):
        def synth(text, voice, rate, audio_path):
            make_silence(audio_path, 6)
            return []

        req, job_dir, meta = self.run_pipeline(synth)
        info = video.probe(os.path.join(job_dir, "video.mp4"))
        v = next(s for s in info["streams"] if s["codec_type"] == "video")
        self.assertEqual((v["width"], v["height"], v["codec_name"]), (720, 1280, "h264"))
        with open(os.path.join(job_dir, "video.mp4"), "rb") as fh:
            head = fh.read(64 * 1024)
        self.assertLess(head.find(b"moov"), head.find(b"mdat") if b"mdat" in head else 10**9)
        with open(os.path.join(job_dir, "poster.jpg"), "rb") as fh:
            self.assertEqual(fh.read(3), b"\xff\xd8\xff")
        self.assertFalse(os.path.exists(os.path.join(job_dir, "raw.mp4")))
        self.assertEqual(meta["ttsChars"], len(req.narration_text()))
        self.assertEqual(meta["cover"], False)
        self.assertEqual(sorted(meta), sorted(["jobId","bytes","posterBytes","durationMs","ttsDurationMs","ttsChars","renderMs","cover","templateVersion","mix"]))
        self.assertLessEqual(meta["bytes"], video.MAX_OUTPUT_BYTES)

    def test_supplied_narration_skips_tts_and_keeps_its_timings(self):
        audio = os.path.join(tempfile.mkdtemp(), "n.mp3")
        make_silence(audio, 5)
        with open(audio, "rb") as fh:
            raw = fh.read()
        tokens = validate_render_request(good_payload()).narration_text().split()
        step = 5 / len(tokens)
        payload = good_payload()
        payload["narration"] = {
            "audioBase64": base64.b64encode(raw).decode(),
            "words": [{"text": t, "start": i * step, "end": (i + 1) * step} for i, t in enumerate(tokens)],
        }
        req = validate_render_request(payload)
        job_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(job_dir, ignore_errors=True))

        def synth(*_):
            raise AssertionError("edge-tts must not run")

        meta = pipeline.run_render(req, job_dir, synth=synth, **{**NO_NET, "render": fake_render(5.5)})
        with open(os.path.join(job_dir, "props.json"), encoding="utf-8") as fh:
            props_words = json.load(fh)["words"]
        self.assertEqual(props_words[0]["text"], tokens[0])
        self.assertAlmostEqual(meta["ttsDurationMs"] / 1000, 5, delta=0.3)

    def test_render_needs_no_external_images(self):
        def synth(text, voice, rate, audio_path):
            make_silence(audio_path, 4)
            return []

        _, job_dir, meta = self.run_pipeline(synth)
        import json

        with open(os.path.join(job_dir, "props.json")) as fh:
            composition = json.load(fh)
        self.assertNotIn("cover", composition)
        self.assertEqual([s["kind"] for s in composition["scenes"]], ["hook", "beat", "beat", "outro"])
        self.assertEqual(meta["jobId"], "job12345")

    def test_overlong_narration_is_retried_faster(self):
        rates = []

        def synth(text, voice, rate, audio_path):
            rates.append(rate)
            make_silence(audio_path, 66 if len(rates) == 1 else 55)
            return []

        _, _, meta = self.run_pipeline(synth, render=fake_render(55.5))
        self.assertEqual(len(rates), 2)
        self.assertNotEqual(rates[0], rates[1])
        self.assertLessEqual(meta["durationMs"], 60_000)

    def test_unfixable_narration_is_too_large(self):
        def synth(text, voice, rate, audio_path):
            make_silence(audio_path, 130)
            return []

        with self.assertRaises(RenderError) as ctx:
            self.run_pipeline(synth)
        self.assertEqual(ctx.exception.code, "too_large")


class FfmpegHelpersTests(unittest.TestCase):
    def test_faststart_remux_is_a_stream_copy(self):
        cmd = video.build_faststart_cmd("raw.mp4", "out.mp4")
        self.assertEqual(cmd[cmd.index("-c") + 1], "copy")
        self.assertEqual(cmd[cmd.index("-movflags") + 1], "+faststart")

    def test_poster_cmd_seeks_before_input_for_speed(self):
        cmd = video.build_poster_cmd("v.mp4", "p.jpg", 2.5)
        self.assertLess(cmd.index("-ss"), cmd.index("-i"))
        self.assertEqual(cmd[cmd.index("-ss") + 1], "2.500")

    def test_oversize_output_rejected(self):
        with tempfile.NamedTemporaryFile() as f:
            f.truncate(video.MAX_OUTPUT_BYTES + 1)
            with self.assertRaises(RenderError) as ctx:
                video.check_output_size(f.name)
        self.assertEqual(ctx.exception.code, "too_large")

    def test_ffmpeg_failure_maps_to_error_code(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(RenderError) as ctx:
                video.run_ffmpeg(["ffmpeg", "-i", "missing.mp4", "out.mp4"], d)
        self.assertEqual(ctx.exception.code, "ffmpeg_failed")

    def test_remotion_failure_maps_to_error_code(self):
        with tempfile.TemporaryDirectory() as d:
            original = video.REMOTION_SCRIPT
            video.REMOTION_SCRIPT = os.path.join(d, "missing.mjs")
            try:
                with self.assertRaises(RenderError) as ctx:
                    video.run_remotion(d)
            finally:
                video.REMOTION_SCRIPT = original
        self.assertEqual(ctx.exception.code, "ffmpeg_failed")


if __name__ == "__main__":
    unittest.main()
