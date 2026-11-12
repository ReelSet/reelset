import json
import os
import tempfile
import unittest
import unittest.mock

from reel import director, pipeline, video
from reel.errors import RenderError
from reel.validation import validate_render_request
from tests.test_logic import good_payload
from tests.test_smoke import NO_NET, fake_render, make_silence


def good_director(**overrides) -> dict:
    return {
        "model": "claude-haiku-5-5",
        "effort": "medium",
        "maxTokens": 128000,
        "review": True,
        "rules": "be a motion designer",
        "reviewPrompt": "review the frames",
        "skills": [{"name": "motion-design", "content": "ease out"}],
        "example": "return []",
        **overrides,
    }


def validate(**overrides) -> dict | None:
    payload = good_payload()
    payload["director"] = good_director(**overrides)
    return validate_render_request(payload).director


class DirectorValidationTests(unittest.TestCase):
    def test_absent_director_is_none(self):
        self.assertIsNone(validate_render_request(good_payload()).director)

    def test_accepts_the_contract_shape(self):
        self.assertEqual(validate(), good_director())

    def test_example_may_be_null_or_empty(self):
        self.assertIsNone(validate(example=None)["example"])
        self.assertIsNone(validate(example="")["example"])

    def rejects(self, **overrides):
        with self.assertRaises(RenderError) as ctx:
            validate(**overrides)
        self.assertEqual(ctx.exception.code, "invalid_input")

    def test_rejects_bad_shapes(self):
        payload = good_payload()
        payload["director"] = "yes"
        with self.assertRaises(RenderError):
            validate_render_request(payload)
        self.rejects(model="")
        self.rejects(model="bad model!")
        self.rejects(effort="ultra")
        self.rejects(review="true")
        self.rejects(rules=5)
        self.rejects(reviewPrompt=None)
        self.rejects(skills="none")
        self.rejects(skills=[{"name": "", "content": "x"}])
        self.rejects(skills=[{"name": "a"}])
        self.rejects(example=3)

    def test_enforces_token_bounds_and_rejects_bools(self):
        self.assertEqual(validate(maxTokens=1024)["maxTokens"], 1024)
        self.rejects(maxTokens=1023)
        self.rejects(maxTokens=128001)
        self.rejects(maxTokens=True)
        self.rejects(maxTokens="4096")

    def test_enforces_size_limits(self):
        self.assertEqual(len(validate(rules="x" * 20000)["rules"]), 20000)
        self.rejects(rules="x" * 20001)
        self.rejects(reviewPrompt="x" * 6001)
        ok = [{"name": "a", "content": "x" * 300000}, {"name": "b", "content": "y" * 300000}]
        self.assertEqual(len(validate(skills=ok)["skills"]), 2)
        self.rejects(skills=[*ok, {"name": "c", "content": "z"}])


class DirectorMetaTests(unittest.TestCase):
    def test_writes_config_and_reads_result(self):
        with tempfile.TemporaryDirectory() as d:
            config = good_director()
            director.write_config(d, config)
            with open(os.path.join(d, "director.json"), encoding="utf-8") as fh:
                self.assertEqual(json.load(fh), config)
            result = {
                "used": True, "model": "m", "scenes": 8, "sceneErrors": 0, "fallbackReason": None,
                "inputTokens": 1, "outputTokens": 2, "cacheReadTokens": 3, "cacheWriteTokens": 4, "ms": 5,
            }  # fmt: skip
            with open(os.path.join(d, "director-result.json"), "w", encoding="utf-8") as fh:
                json.dump({**result, "extra": "dropped"}, fh)
            self.assertEqual(director.read_result(d, config), result)

    def test_missing_or_malformed_result_is_a_crash(self):
        with tempfile.TemporaryDirectory() as d:
            missing = director.read_result(d, good_director())
            self.assertEqual((missing["used"], missing["fallbackReason"]), (False, "crash"))
            with open(os.path.join(d, "director-result.json"), "w", encoding="utf-8") as fh:
                fh.write('{"used": true}')
            self.assertEqual(director.read_result(d, good_director())["fallbackReason"], "crash")


class DirectorPipelineTests(unittest.TestCase):
    def render(self, payload: dict, render):
        def synth(text, voice, rate, audio_path):
            make_silence(audio_path, 5)
            return []

        req = validate_render_request(payload)
        job_dir = tempfile.mkdtemp()
        self.addCleanup(lambda: __import__("shutil").rmtree(job_dir, ignore_errors=True))
        with unittest.mock.patch.object(pipeline, "RETRY_DELAY_SECONDS", 0):
            meta = pipeline.run_render(req, job_dir, synth=synth, **{**NO_NET, "render": render})
        return job_dir, meta

    def test_without_director_meta_has_no_director_and_no_file(self):
        job_dir, meta = self.render(good_payload(), fake_render(5.5))
        self.assertNotIn("director", meta)
        self.assertFalse(os.path.exists(os.path.join(job_dir, "director.json")))

    def test_director_config_reaches_the_renderer_and_its_result_reaches_meta(self):
        seen = {}
        result = {
            "used": True, "model": "claude-haiku-5-5", "scenes": 7, "sceneErrors": 1,
            "fallbackReason": None, "inputTokens": 10, "outputTokens": 20,
            "cacheReadTokens": 30, "cacheWriteTokens": 40, "ms": 50,
        }  # fmt: skip
        plain = fake_render(5.5)

        def render(job_dir: str) -> None:
            with open(os.path.join(job_dir, "director.json"), encoding="utf-8") as fh:
                seen["config"] = json.load(fh)
            with open(os.path.join(job_dir, "director-result.json"), "w", encoding="utf-8") as fh:
                json.dump(result, fh)
            plain(job_dir)

        payload = good_payload()
        payload["director"] = good_director()
        _, meta = self.render(payload, render)
        self.assertEqual(seen["config"], good_director())
        self.assertEqual(meta["director"], result)


class RunSkiaTests(unittest.TestCase):
    def test_command_uses_skia_dir_and_job_dir(self):
        with unittest.mock.patch.dict(os.environ, {"SKIA_DIR": "/opt/skia"}):
            self.assertEqual(video.build_skia_cmd("/jobs/a"), ["node", "/opt/skia/dist/render.mjs", "/jobs/a"])
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(video.build_skia_cmd("/jobs/a")[1], "/app/skia/dist/render.mjs")

    def test_timeout_prefers_render_then_legacy_then_default(self):
        with unittest.mock.patch.dict(
            os.environ, {"RENDER_TIMEOUT_SECONDS": "100", "REMOTION_TIMEOUT_SECONDS": "200"}, clear=True
        ):
            self.assertEqual(video.render_timeout_seconds(), 100)
        with unittest.mock.patch.dict(os.environ, {"REMOTION_TIMEOUT_SECONDS": "200"}, clear=True):
            self.assertEqual(video.render_timeout_seconds(), 200)
        with unittest.mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(video.render_timeout_seconds(), 7200)
        with unittest.mock.patch.dict(os.environ, {"RENDER_TIMEOUT_SECONDS": "soon"}, clear=True):
            self.assertEqual(video.render_timeout_seconds(), 7200)

    def test_runs_node_with_the_full_environment_and_the_timeout(self):
        done = unittest.mock.Mock(returncode=0, stdout="render done\n", stderr="")
        with unittest.mock.patch.dict(os.environ, {"SKIA_DIR": "/opt/skia"}), unittest.mock.patch.object(
            video.subprocess, "run", return_value=done
        ) as run:
            video.run_skia("/jobs/a", timeout=55)
        self.assertEqual(run.call_args.args[0], ["node", "/opt/skia/dist/render.mjs", "/jobs/a"])
        self.assertEqual(run.call_args.kwargs["timeout"], 55)
        self.assertNotIn("env", run.call_args.kwargs)

    def test_failure_and_timeout_map_to_ffmpeg_failed(self):
        failed = unittest.mock.Mock(returncode=1, stdout="", stderr="boom")
        with unittest.mock.patch.object(video.subprocess, "run", return_value=failed):
            with self.assertRaises(RenderError) as ctx:
                video.run_skia("/jobs/a")
        self.assertEqual(ctx.exception.code, "ffmpeg_failed")
        timeout = video.subprocess.TimeoutExpired("node", 1)
        with unittest.mock.patch.object(video.subprocess, "run", side_effect=timeout):
            with self.assertRaises(RenderError) as ctx:
                video.run_skia("/jobs/a")
        self.assertIn("timed out", ctx.exception.message)


if __name__ == "__main__":
    unittest.main()
