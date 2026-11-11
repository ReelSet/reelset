import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import app
from reel.activity import Activity


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


class ActivityTests(unittest.TestCase):
    def test_idle_grows_only_when_nothing_is_in_flight(self):
        clock = FakeClock()
        activity = Activity(clock)
        clock.now += 30
        self.assertEqual(activity.snapshot(), (0, 30))
        activity.start()
        clock.now += 500
        self.assertEqual(activity.snapshot(), (1, 0))
        activity.finish()
        clock.now += 12
        self.assertEqual(activity.snapshot(), (0, 12))

    def test_concurrent_requests_are_counted(self):
        activity = Activity(FakeClock())
        activity.start()
        activity.start()
        activity.finish()
        self.assertEqual(activity.snapshot()[0], 1)

    def test_finish_never_goes_negative(self):
        activity = Activity(FakeClock())
        activity.finish()
        self.assertEqual(activity.snapshot()[0], 0)


class HealthEndpointTests(unittest.TestCase):
    def setUp(self):
        self.clock = FakeClock()
        patches = [
            mock.patch.object(app, "activity", Activity(self.clock)),
            mock.patch.object(app, "BOX_TOKEN", "s3cret"),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def get(self, path, token=None):
        req = urllib.request.Request(self.base + path)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        return urllib.request.urlopen(req, timeout=5)

    def test_health_reports_idle_and_is_not_counted_as_activity(self):
        self.clock.now += 700
        body = json.load(self.get("/health"))
        self.assertEqual(body, {"ok": True, "running": 0, "inflight": 0, "idleSeconds": 700})
        self.assertEqual(json.load(self.get("/health"))["idleSeconds"], 700)

    def test_finished_request_resets_idle(self):
        self.clock.now += 700
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/render/missing-job-1/video", "s3cret")
        self.assertEqual(ctx.exception.code, 404)
        self.clock.now += 5
        self.assertEqual(json.load(self.get("/health"))["idleSeconds"], 5)

    def test_unauthorized_request_does_not_reset_idle(self):
        self.clock.now += 700
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/render/missing-job-1/video")
        self.assertEqual(ctx.exception.code, 401)
        self.assertEqual(json.load(self.get("/health"))["idleSeconds"], 700)
