import os
import tempfile
import unittest

from reel import hoststats


def write(root, name, text):
    with open(os.path.join(root, name), "w") as fh:
        fh.write(text)


class HostStatsTests(unittest.TestCase):
    def test_cpu_pct_over_window(self):
        with tempfile.TemporaryDirectory() as root:
            sampler = hoststats.CpuSampler(root)
            write(root, "stat", "cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1\n")
            sampler.sample()
            self.assertIsNone(sampler.cpu_pct())
            write(root, "stat", "cpu  200 0 200 750 150 0 0 0 0 0\n")
            sampler.sample()
            self.assertEqual(sampler.cpu_pct(), 66.7)

    def test_cpu_unreadable_gives_none(self):
        with tempfile.TemporaryDirectory() as root:
            sampler = hoststats.CpuSampler(root)
            sampler.sample()
            self.assertIsNone(sampler.cpu_pct())

    def test_memory_and_load(self):
        with tempfile.TemporaryDirectory() as root:
            write(
                root,
                "meminfo",
                "MemTotal:        1024000 kB\nMemFree: 1 kB\nMemAvailable:     512000 kB\n"
                "SwapTotal:       2048000 kB\nSwapFree:        1024000 kB\n",
            )
            write(root, "loadavg", "1.25 0.80 0.50 2/100 1234\n")
            self.assertEqual(hoststats.read_memory_mb(root), (500, 1000))
            self.assertEqual(hoststats.read_load1(root), 1.25)
            snap = hoststats.snapshot(hoststats.CpuSampler(root), root)
            self.assertEqual(snap["memUsedMb"], 500)
            self.assertIsNone(snap["cpuPct"])

    def test_missing_proc_files(self):
        with tempfile.TemporaryDirectory() as root:
            self.assertEqual(hoststats.read_memory_mb(root), (None, None))
            self.assertIsNone(hoststats.read_load1(root))

    def test_box_name_env_then_hostname(self):
        old = os.environ.pop("BOX_NAME", None)
        try:
            self.assertTrue(hoststats.box_name())
            os.environ["BOX_NAME"] = "box1"
            self.assertEqual(hoststats.box_name(), "box1")
        finally:
            os.environ.pop("BOX_NAME", None)
            if old:
                os.environ["BOX_NAME"] = old


if __name__ == "__main__":
    unittest.main()
