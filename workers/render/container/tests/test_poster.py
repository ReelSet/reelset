import unittest
from unittest import mock

import numpy as np

from reel import poster
from reel.errors import RenderError

H, W = 48, 27


def text_frame(lines: int, seed: int = 0) -> np.ndarray:
    """Dark frame with `lines` rows of crisp white 'text' blocks; more lines means more edges."""
    rng = np.random.default_rng(seed)
    f = np.full((H, W), 20, dtype=np.uint8)
    for row in range(lines):
        y = 4 + row * 6
        mask = rng.random(W - 4) > 0.4
        f[y : y + 3, 2 : W - 2][:, mask] = 230
    return f


def blurred(frame: np.ndarray, width: int = 7) -> np.ndarray:
    """Horizontal motion blur, the smear a whip transition leaves."""
    kernel = np.ones(width) / width
    out = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode="same"), 1, frame.astype(float))
    return out.astype(np.uint8)


def timeline(frames: list) -> tuple:
    return [0.5 + i / poster.SAMPLE_FPS for i in range(len(frames))], frames


class SharpnessTest(unittest.TestCase):
    def test_motion_blur_scores_far_lower_than_the_crisp_frame(self):
        crisp = text_frame(6)
        self.assertLess(poster.sharpness(blurred(crisp)), poster.sharpness(crisp) * poster.DIP_RATIO)

    def test_flat_frame_scores_zero(self):
        self.assertEqual(poster.sharpness(np.full((H, W), 90, dtype=np.uint8)), 0.0)


class PickSecondTest(unittest.TestCase):
    def test_takes_the_last_settled_frame_before_the_exit_blur(self):
        building = [text_frame(n) for n in (2, 3, 4, 5, 6)]
        settled = [text_frame(6)] * 15
        exit_blur = [blurred(text_frame(6))] * 3
        next_scene = [text_frame(7, seed=9)] * 6
        times, frames = timeline(building + settled + exit_blur + next_scene)
        self.assertAlmostEqual(poster.pick_second(times, frames), times[19])

    def test_a_hard_cut_to_the_next_scene_also_ends_the_hook(self):
        hook = [text_frame(5)] * 18
        inverted = [255 - text_frame(7, seed=3)] * 6
        times, frames = timeline(hook + inverted)
        self.assertAlmostEqual(poster.pick_second(times, frames), times[17])

    def test_ignores_an_entrance_blur_before_the_hook_settles(self):
        entrance = [blurred(text_frame(3)), text_frame(3), blurred(text_frame(4))]
        settled = [text_frame(4)] * 20
        times, frames = timeline(entrance + settled)
        self.assertAlmostEqual(poster.pick_second(times, frames), times[-1])

    def test_nothing_to_pick_from(self):
        self.assertIsNone(poster.pick_second([], []))
        flat = [np.full((H, W), 20, dtype=np.uint8)] * 4
        self.assertIsNone(poster.pick_second(*timeline(flat)))


class ChooseSecondTest(unittest.TestCase):
    def test_samples_only_up_to_just_past_the_hook(self):
        with mock.patch.object(poster, "sample_frames", return_value=timeline([text_frame(4)] * 5)) as s:
            poster.choose_second("v.mp4", 3.0, hook_end=4.5)
        self.assertEqual(s.call_args[0], ("v.mp4", poster.WINDOW_START_SECOND, 4.7))

    def test_without_hook_timing_scans_the_opening_seconds(self):
        with mock.patch.object(poster, "sample_frames", return_value=timeline([text_frame(4)] * 5)) as s:
            poster.choose_second("v.mp4", 3.0)
        self.assertEqual(s.call_args[0][2], poster.FALLBACK_WINDOW_END_SECOND)

    def test_falls_back_to_the_fixed_guess_when_sampling_fails(self):
        with mock.patch.object(poster, "sample_frames", side_effect=RenderError("ffmpeg_failed", "x")):
            self.assertEqual(poster.choose_second("v.mp4", 3.0, hook_end=4.5), 3.0)
        with mock.patch.object(poster, "sample_frames", return_value=([], [])):
            self.assertEqual(poster.choose_second("v.mp4", 2.0), 2.0)

    def test_sample_command_reads_small_grey_frames_from_the_window(self):
        cmd = poster.build_sample_cmd("v.mp4", 0.5, 4.7)
        self.assertLess(cmd.index("-ss"), cmd.index("-i"))
        self.assertEqual(cmd[cmd.index("-t") + 1], "4.200")
        self.assertIn("format=gray", cmd[cmd.index("-vf") + 1])
        self.assertEqual(cmd[-3:], ["-f", "rawvideo", "-"])


if __name__ == "__main__":
    unittest.main()
