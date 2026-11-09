import os
import tempfile
import unittest

from reel import cues as cues_lib
from reel import mix, validation
from reel.errors import RenderError
from reel.timing import Word
from tests.test_logic import good_payload


def words(text, step=0.4):
    return [Word(t, i * step, i * step + step * 0.9) for i, t in enumerate(text.split())]


class CueTests(unittest.TestCase):
    def test_resolves_nth_occurrence_inside_window(self):
        w = words("so it is a big win a big deal")
        self.assertEqual(cues_lib.resolve_cue("big", w, 0, 10), w[4].start)
        self.assertEqual(cues_lib.resolve_cue("big#2", w, 0, 10), w[7].start)
        self.assertIsNone(cues_lib.resolve_cue("big#3", w, 0, 10))
        self.assertIsNone(cues_lib.resolve_cue("win", w, 3.0, 10))

    def test_punctuation_and_case_ignored(self):
        w = [Word("Stars,", 1.0, 1.3)]
        self.assertEqual(cues_lib.resolve_cue("stars", w, 0, 5), 1.0)

    def test_resolve_shots_drops_missing_and_crowded(self):
        payload = good_payload()
        payload["script"]["beats"][0]["shots"] = [
            {"at": "First", "show": "ImageFull"},
            {"at": "nope", "show": "KeyPoint"},
            {"at": "beat", "show": "StatSlam", "sfx": "ding"},
        ]
        req = validation.validate_render_request(payload)
        w = words("This changes everything. First beat. Second beat. Thanks for watching.")
        spans = [(0, 1.2), (1.2, 2.4), (2.4, 3.6), (3.6, 5.0)]
        shots = cues_lib.resolve_shots(req.beats, w, spans)
        self.assertEqual([s["show"] for s in shots], ["ImageFull", "StatSlam"])
        self.assertTrue(all(1.2 <= s["t"] < 2.4 for s in shots))


class PlanTests(unittest.TestCase):
    def test_whoosh_on_cuts_pop_on_headline_riser_before_ding(self):
        spans = [(0, 3), (3, 8), (8, 14), (14, 18)]
        shots = [{"t": 5.0, "sfx": "ding"}, {"t": 9.0}]
        cues = mix.plan_sfx(spans, shots, True)
        names = [(c["t"], c["name"]) for c in cues]
        self.assertIn((0.15, "pop"), names)
        self.assertIn((3, "whoosh"), names)
        self.assertIn((5.0, "ding"), names)
        self.assertIn((5.0 - mix.RISER_SECONDS, "riser"), [(round(t, 3), n) for t, n in names])
        self.assertIn((9.0, "whoosh"), names)
        self.assertEqual(names, sorted(names))

    def test_collapses_close_duplicates_and_caps(self):
        spans = [(0, 3), (3, 8), (8, 14), (14, 18)]
        cues = mix.plan_sfx(spans, [{"t": 3.05}], False)
        self.assertEqual([c for c in cues if c["name"] == "whoosh" and c["t"] < 4], [{"t": 3, "name": "whoosh"}])
        many = [{"t": 1 + i * 0.5} for i in range(100)]
        self.assertLessEqual(len(mix.plan_sfx(spans, many, True)), mix.MAX_CUES)

    def test_bed_variant_is_stable(self):
        self.assertEqual(mix.bed_variant("abc"), mix.bed_variant("abc"))
        self.assertIn(mix.bed_variant("xyz"), range(mix.BED_VARIANTS))


class PickBedTests(unittest.TestCase):
    def test_returns_the_seed_variant_when_the_file_exists(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "music"))
            for v in range(mix.BED_VARIANTS):
                open(os.path.join(d, "music", f"bed{v}.m4a"), "wb").close()
            self.assertEqual(mix.pick_bed("abc", d), mix.bed_variant("abc"))

    def test_walks_to_an_existing_variant_and_fails_loudly_when_none(self):
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "music"))
            first = mix.bed_variant("abc")
            other = (first + 1) % mix.BED_VARIANTS
            open(os.path.join(d, "music", f"bed{other}.m4a"), "wb").close()
            self.assertEqual(mix.pick_bed("abc", d), other)
        with tempfile.TemporaryDirectory() as d:
            os.makedirs(os.path.join(d, "music"))
            with self.assertRaises(RenderError):
                mix.pick_bed("abc", d)


class CommandTests(unittest.TestCase):
    def test_filter_ducks_bed_and_delays_sfx(self):
        cues = [{"t": 1.5, "name": "whoosh"}, {"t": 4.0, "name": "ding"}]
        graph = mix.build_filter(cues, 20.0)
        self.assertIn("sidechaincompress", graph)
        self.assertIn("adelay=1500|1500", graph)
        self.assertIn("amix=inputs=4:normalize=0", graph)
        cmd = mix.build_mix_cmd("n.mp3", "bed.m4a", cues, 20.0, "o.wav", "/a")
        self.assertEqual(cmd.count("-i"), 4)
        self.assertIn("/a/sfx/ding.wav", cmd)

    def test_master_targets_loudness(self):
        measured = dict(input_i=-20.0, input_tp=-5.0, input_lra=4.0, input_thresh=-30.0, target_offset=0.1)
        af = mix.build_master_cmd("a.wav", measured, "o.m4a")[8]
        self.assertIn("I=-14.0", af)
        self.assertIn("TP=-1.5", af)
        self.assertIn("linear=true", af)

    def test_parse_loudnorm_json(self):
        text = 'noise\n{"input_i":"-20.1","input_tp":"-3.0","input_lra":"5.0","input_thresh":"-30.5","target_offset":"0.2","x":"1"}\n'
        self.assertEqual(mix.parse_loudnorm_json(text)["input_i"], -20.1)
        with self.assertRaises(RenderError):
            mix.parse_loudnorm_json("nothing")

    def test_timeline_shots_missing_file(self):
        self.assertEqual(mix.load_timeline_shots("/nonexistent"), [])


class ShotValidationTests(unittest.TestCase):
    def test_rejects_bad_shots(self):
        for bad in (
            [{"at": "two words", "show": "ImageFull"}],
            [{"at": "ok", "show": "nope"}],
            [{"at": "ok", "show": "ImageFull", "sfx": "boom"}],
            [{"at": "ok", "show": "ImageFull", "props": {"a": {"b": {"c": {"d": 1}}}}}],
        ):
            payload = good_payload()
            payload["script"]["beats"][0]["shots"] = bad
            with self.assertRaises(RenderError):
                validation.validate_render_request(payload)

    def test_headline_and_shots_accepted(self):
        payload = good_payload()
        payload["script"]["headline"] = "Stop shipping AI slop"
        payload["script"]["beats"][0]["shots"] = [
            {"at": "First", "show": "StatSlam", "props": {"value": 10, "label": "stars"}, "sfx": "tick"}
        ]
        req = validation.validate_render_request(payload)
        self.assertEqual(req.headline, "Stop shipping AI slop")
        self.assertEqual(req.beats[0].shots[0]["props"]["value"], 10)


if __name__ == "__main__":
    unittest.main()
