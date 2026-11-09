import unittest

import qa_reel as q

PROPS = {
    "durationSeconds": 12.0,
    "scenes": [
        {"kind": "hook", "start": 0, "end": 3},
        {"kind": "beat", "start": 3, "end": 8, "shots": [{"t": 5.0}, {"t": 6.5}]},
        {"kind": "outro", "start": 8, "end": 12},
    ],
    "words": [{"text": w, "start": i * 0.3, "end": i * 0.3 + 0.25} for i, w in enumerate("a b c d e f g h".split())],
}


class QaReelTests(unittest.TestCase):
    def test_planned_changes_merge_scene_and_shot_times(self):
        self.assertEqual(q.planned_changes(PROPS, [{"t": 10.0}]), [3.0, 5.0, 6.5, 8.0, 10.0])

    def test_gaps_and_cadence_verdicts(self):
        ok = q.cadence_checks("planned", [3.0, 5.0, 6.5, 8.0, 10.0], 12.0)
        self.assertEqual([c["level"] for c in ok], ["PASS", "PASS"])
        held = q.cadence_checks("planned", [8.0], 12.0)
        self.assertEqual([c["level"] for c in held], ["FAIL", "FAIL"])

    def test_cluster_merges_frame_runs(self):
        self.assertEqual(q.cluster([0.133, 0.167, 0.2, 8.467, 8.5]), [0.133, 8.467])

    def test_caption_pages_break_at_three_words(self):
        self.assertEqual(len(q.caption_pages(PROPS["words"])), 3)

    def test_mastering_gate(self):
        report = {
            "picture": {"cuts": [3.0, 5.0, 6.5, 8.0, 10.0], "frozen": [], "flat": []},
            "audio": {"lufs": -14.2, "true_peak": -1.4},
        }
        checks = q.reel_checks(report, PROPS, [3.0, 5.0, 6.5, 8.0, 10.0])
        self.assertTrue(all(c["level"] != "FAIL" for c in checks))
        report["audio"] = {"lufs": -19.0, "true_peak": -0.2}
        self.assertEqual(q.reel_checks(report, PROPS, [3.0])[-1]["level"], "FAIL")


if __name__ == "__main__":
    unittest.main()
