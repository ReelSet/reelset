import tempfile
import unittest

from app import is_authorized, max_renders_from_env
from reel.errors import RenderError
from reel.jobs import JobStore


class AuthTests(unittest.TestCase):
    def test_no_token_allows_everything(self):
        self.assertTrue(is_authorized("", "/render", None))

    def test_health_is_open(self):
        self.assertTrue(is_authorized("s3cret", "/health", None))

    def test_missing_or_wrong_header_rejected(self):
        for header in (None, "", "s3cret", "Bearer nope", "bearer s3cret", "Bearer s3cret "):
            self.assertFalse(is_authorized("s3cret", "/render", header), header)

    def test_correct_bearer_accepted(self):
        self.assertTrue(is_authorized("s3cret", "/render", "Bearer s3cret"))
        self.assertTrue(is_authorized("s3cret", "/render/abcdefgh/video", "Bearer s3cret"))

    def test_non_ascii_header_does_not_raise(self):
        self.assertFalse(is_authorized("s3cret", "/render", "Bearer sécret"))


class ConcurrencyTests(unittest.TestCase):
    def test_max_renders_parsing(self):
        self.assertEqual(max_renders_from_env(None), 1)
        self.assertEqual(max_renders_from_env("abc"), 1)
        self.assertEqual(max_renders_from_env("0"), 1)
        self.assertEqual(max_renders_from_env("2"), 2)

    def test_second_render_admitted_up_to_limit_then_busy(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root, max_running=2)
            jobs.begin("job-aaaaaa")
            jobs.begin("job-bbbbbb")
            with self.assertRaises(RenderError) as ctx:
                jobs.begin("job-cccccc")
            self.assertEqual(ctx.exception.code, "busy")
            self.assertEqual(ctx.exception.status, 429)
            jobs.finish("job-aaaaaa", {})
            jobs.begin("job-cccccc")


class RunningCountTests(unittest.TestCase):
    def test_running_counts_only_unfinished_jobs(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root, max_running=2)
            self.assertEqual(jobs.running(), 0)
            jobs.begin("job-aaaaaa")
            jobs.begin("job-bbbbbb")
            self.assertEqual(jobs.running(), 2)
            jobs.finish("job-aaaaaa", {})
            self.assertEqual(jobs.running(), 1)


class RepeatedJobTests(unittest.TestCase):
    def test_repeat_of_running_job_is_in_progress_even_with_spare_capacity(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root, max_running=2)
            jobs.begin("job-aaaaaa")
            with self.assertRaises(RenderError) as ctx:
                jobs.begin("job-aaaaaa")
            self.assertEqual(ctx.exception.code, "in_progress")
            self.assertEqual(ctx.exception.status, 409)

    def test_different_job_while_full_stays_busy(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root)
            jobs.begin("job-aaaaaa")
            with self.assertRaises(RenderError) as ctx:
                jobs.begin("job-bbbbbb")
            self.assertEqual(ctx.exception.code, "busy")
            self.assertEqual(ctx.exception.status, 429)

    def test_repeat_after_finish_returns_cached_result(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root)
            jobs.begin("job-aaaaaa")
            jobs.finish("job-aaaaaa", {"ok": 1})
            self.assertEqual(jobs.begin("job-aaaaaa"), ("done", {"ok": 1}))


class JobStateTests(unittest.TestCase):
    def test_state_tracks_absent_running_done_and_failed(self):
        with tempfile.TemporaryDirectory() as root:
            jobs = JobStore(root)
            self.assertEqual(jobs.state("job-aaaaaa"), "absent")
            jobs.begin("job-aaaaaa")
            self.assertEqual(jobs.state("job-aaaaaa"), "running")
            jobs.finish("job-aaaaaa", {})
            self.assertEqual(jobs.state("job-aaaaaa"), "done")
            jobs.begin("job-bbbbbb")
            jobs.fail("job-bbbbbb")
            self.assertEqual(jobs.state("job-bbbbbb"), "absent")
