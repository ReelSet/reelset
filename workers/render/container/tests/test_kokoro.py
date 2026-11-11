import os
import tempfile
import unittest
from unittest import mock

from reel import kokoro_timing, kokoro_tts, lexicon, narrator, validation
from reel.kokoro_tts import KokoroError
from reel.timing import Word


class T:
    def __init__(self, phoneme, start, end):
        self.phoneme, self.start, self.end = phoneme, start, end


def timings_for(phonemes: str, step=0.1, gap_after=()):
    out, t = [], 0.0
    for i, ch in enumerate(phonemes):
        out.append(T(ch, t, t + step))
        t += step + (0.3 if i in gap_after else 0)
    return out


class LexiconTests(unittest.TestCase):
    def test_user_listed_terms(self):
        cases = {
            "MOPD": "M O P D",
            "P^2-MOPD": "P squared M O P D",
            "P²": "P squared",
            "SPF": "S P F",
            "DKIM": "dee kim",
            "example.com": "example dot com",
            "p=none": "p equals none",
            "1.7B": "1.7 billion",
        }
        for token, spoken in cases.items():
            self.assertEqual(lexicon.spoken_form(token), spoken, token)

    def test_keeps_surrounding_punctuation(self):
        self.assertEqual(lexicon.spoken_form("MOPD,"), "M O P D,")
        self.assertEqual(lexicon.spoken_form("(SPF)"), "(S P F)")
        self.assertEqual(lexicon.spoken_form("example.com."), "example dot com.")
        self.assertEqual(lexicon.spoken_form("1.7B-parameter"), "1.7 billion-parameter")

    def test_generic_acronyms_without_vowels_are_spelled(self):
        self.assertEqual(lexicon.spoken_form("TCP"), "T C P")
        self.assertEqual(lexicon.spoken_form("LLMs"), "LLMs")
        self.assertEqual(lexicon.spoken_form("LLM"), "L L M")

    def test_words_the_voice_already_reads_are_left_alone(self):
        for token in ("NASA", "GPU", "API", "Hello", "world", "I", "A", "2025", "94.7%", "GitHub"):
            self.assertEqual(lexicon.spoken_form(token), token)

    def test_domain_suffixes(self):
        self.assertEqual(lexicon.spoken_form("node.js"), "node dot J S")
        self.assertEqual(lexicon.spoken_form("huggingface.co"), "huggingface.co")


class RegroupTests(unittest.TestCase):
    def test_one_word_per_token_monotonic_covering_all(self):
        tokens = ["Hello,", "world."]
        phonemes = ["həlˈoʊ,", "wˈɜːld."]
        timings = timings_for(" ".join(phonemes).replace(" ", ""))
        words = kokoro_timing.regroup(tokens, phonemes, timings)
        self.assertEqual([w.text for w in words], tokens)
        self.assertAlmostEqual(words[0].start, 0.0)
        self.assertLessEqual(words[0].end, words[1].start)
        self.assertAlmostEqual(words[1].end, timings[-2].end)

    def test_trailing_punctuation_stays_out_of_the_word_span(self):
        tokens = ["a,", "b"]
        timings = [T("a", 0, 0.2), T(",", 0.2, 0.9), T("b", 0.9, 1.1)]
        words = kokoro_timing.regroup(tokens, ["a,", "b"], timings)
        self.assertAlmostEqual(words[0].end, 0.2)
        self.assertAlmostEqual(words[1].start, 0.9)

    def test_multi_phoneme_spoken_form_maps_to_original_token(self):
        tokens = ["MOPD", "works"]
        phonemes = ["ɛm oʊ pˈi di", "wˈɜːks"]
        flat = "".join("".join(p.split()) for p in phonemes)
        words = kokoro_timing.regroup(tokens, phonemes, timings_for(flat))
        self.assertEqual(words[0].text, "MOPD")
        self.assertAlmostEqual(words[0].end - words[0].start, 0.1 * len("ɛmoʊpˈidi"))
        self.assertAlmostEqual(words[1].start, words[0].end)

    def test_empty_phonemes_token_is_zero_length_at_previous_end(self):
        words = kokoro_timing.regroup(["a", "—", "b"], ["a", "", "b"], timings_for("ab"))
        self.assertEqual(len(words), 3)
        self.assertEqual(words[1].start, words[1].end)
        self.assertAlmostEqual(words[1].start, words[0].end)

    def test_diverging_timings_stay_monotonic_and_complete(self):
        phonemes = ["abc", "def", "ghi"]
        timings = timings_for("abcdeghi")
        words = kokoro_timing.regroup(["x", "y", "z"], phonemes, timings)
        self.assertEqual(len(words), 3)
        previous = 0.0
        for w in words:
            self.assertGreaterEqual(w.start, previous)
            self.assertGreaterEqual(w.end, w.start)
            previous = w.end

    def test_whitespace_in_timings_is_ignored(self):
        timings = [T("a", 0, 0.1), T(" ", 0.1, 0.2), T("b", 0.2, 0.3)]
        words = kokoro_timing.regroup(["a", "b"], ["a", "b"], timings)
        self.assertAlmostEqual(words[1].start, 0.2)


class FakeEngine:
    def __init__(self, seconds_at_speed_one=40.0, timings=True, fixed_pause_seconds=0.0):
        self.calls = []
        self.seconds_at_speed_one = seconds_at_speed_one
        self.timings = timings
        self.fixed_pause_seconds = fixed_pause_seconds

    def phonemize(self, text):
        return "".join(ch for ch in text if ch.isalpha() or ch in ",.")

    def synthesize(self, phonemes, speed):
        self.calls.append(speed)
        seconds = self.fixed_pause_seconds + (self.seconds_at_speed_one - self.fixed_pause_seconds) / speed
        samples = int(seconds * kokoro_tts.SAMPLE_RATE)
        return tone(samples), timings_for(phonemes) if self.timings else []


def tone(samples: int):
    import numpy as np

    return np.full(samples, 0.1, dtype=np.float32)


class EncodeTests(unittest.TestCase):
    def test_levels_narration_and_keeps_native_rate(self):
        import numpy as np

        with mock.patch.object(kokoro_tts.subprocess, "run") as run:
            kokoro_tts.encode_mp3(np.zeros(240), "/tmp/n.mp3")
        command = run.call_args.args[0]
        self.assertIn(kokoro_tts.LEVEL_FILTER, command)
        self.assertEqual(command[command.index("-ar", command.index("-af")) + 1], "24000")


class ModelFileTests(unittest.TestCase):
    def test_arm64_uses_fp32_and_everything_else_fp16(self):
        self.assertEqual(kokoro_tts.model_file("aarch64"), "kokoro-v1.0.onnx")
        self.assertEqual(kokoro_tts.model_file("arm64"), "kokoro-v1.0.onnx")
        self.assertEqual(kokoro_tts.model_file("x86_64"), "kokoro-v1.0.fp16.onnx")


class AudibleGuardTests(unittest.TestCase):
    def test_accepts_normal_audio(self):
        kokoro_tts.assert_audible(tone(2400))

    def test_rejects_nan_inf_silence_and_empty(self):
        import numpy as np

        bad = {
            "nan": np.full(2400, np.nan, dtype=np.float32),
            "partial nan": np.concatenate([tone(100), np.array([np.nan], dtype=np.float32)]),
            "inf": np.concatenate([tone(100), np.array([np.inf], dtype=np.float32)]),
            "silent": np.zeros(2400, dtype=np.float32),
            "empty": np.zeros(0, dtype=np.float32),
        }
        for name, audio in bad.items():
            with self.subTest(name), self.assertRaises(KokoroError):
                kokoro_tts.assert_audible(audio)

    def test_synthesize_raises_instead_of_encoding_broken_audio(self):
        import numpy as np

        for audio in (np.full(48_000, np.nan, dtype=np.float32), np.zeros(48_000, dtype=np.float32)):
            engine = FakeEngine()
            engine.synthesize = mock.Mock(return_value=(audio, timings_for("hello")))
            with self.subTest(), mock.patch.object(kokoro_tts, "encode_mp3") as encode:
                with self.assertRaises(KokoroError):
                    kokoro_tts.synthesize("Hello", "/tmp/n.mp3", engine=engine)
                encode.assert_not_called()


class KokoroSynthesisTests(unittest.TestCase):
    def synth(self, engine, text="Hello world. MOPD works, really."):
        path = os.path.join(tempfile.mkdtemp(), "n.mp3")
        with mock.patch.object(kokoro_tts, "encode_mp3") as encode:
            words = kokoro_tts.synthesize(text, path, engine=engine)
        return words, encode

    def test_returns_original_tokens_in_order(self):
        engine = FakeEngine()
        words, encode = self.synth(engine)
        self.assertEqual([w.text for w in words], "Hello world. MOPD works, really.".split())
        encode.assert_called_once()
        self.assertAlmostEqual(engine.calls[0], kokoro_tts.initial_speed())

    def test_initial_speed_is_capped_at_the_preferred_maximum(self):
        self.assertLessEqual(kokoro_tts.initial_speed(), kokoro_tts.PREFERRED_MAX_SPEED)
        self.assertGreaterEqual(kokoro_tts.initial_speed(), 1.0)

    def test_over_cap_refits_faster_once(self):
        engine = FakeEngine(seconds_at_speed_one=70)
        self.synth(engine)
        self.assertEqual(len(engine.calls), 2)
        self.assertGreater(engine.calls[1], engine.calls[0])
        self.assertLessEqual(engine.calls[1], kokoro_tts.FIT_MAX_SPEED)

    def test_hopelessly_long_narration_raises(self):
        with self.assertRaises(KokoroError):
            self.synth(FakeEngine(seconds_at_speed_one=120))

    def test_missing_timings_raise(self):
        with self.assertRaises(KokoroError):
            self.synth(FakeEngine(timings=False))

    def test_engine_crash_is_wrapped(self):
        engine = FakeEngine()
        engine.synthesize = mock.Mock(side_effect=RuntimeError("onnx boom"))
        with self.assertRaises(KokoroError):
            self.synth(engine)

    def test_empty_text_raises(self):
        with self.assertRaises(KokoroError):
            self.synth(FakeEngine(), text="   ")

    def test_refit_speed_rejects_what_would_clip_sentence_starts(self):
        self.assertIsNone(kokoro_tts.refit_speed([(1.15, 90)]))
        self.assertIsNotNone(kokoro_tts.refit_speed([(1.15, 60)]))

    def test_single_measurement_assumes_pauses_do_not_shrink(self):
        naive = 1.15 * 58 / (kokoro_tts.MAX_AUDIO_SECONDS - kokoro_tts.FIT_HEADROOM_SECONDS)
        self.assertGreater(kokoro_tts.refit_speed([(1.15, 58)]), naive)

    def test_two_measurements_solve_the_pause_exactly(self):
        pause, speech = 12.0, 54.0
        measured = [(1.0, pause + speech / 1.0), (1.1, pause + speech / 1.1)]
        speed = kokoro_tts.refit_speed(measured)
        self.assertAlmostEqual(pause + speech / speed, kokoro_tts.MAX_AUDIO_SECONDS - kokoro_tts.FIT_HEADROOM_SECONDS, places=1)

    def test_pause_heavy_narration_fits_by_the_third_render(self):
        engine = FakeEngine(seconds_at_speed_one=66, fixed_pause_seconds=20)
        self.synth(engine)
        self.assertLessEqual(len(engine.calls), kokoro_tts.MAX_FIT_RENDERS)
        self.assertLessEqual(engine.calls[-1], kokoro_tts.FIT_MAX_SPEED)

    def test_pauses_that_leave_no_room_raise(self):
        with self.assertRaises(KokoroError):
            self.synth(FakeEngine(seconds_at_speed_one=75, fixed_pause_seconds=60))


class NarratorTests(unittest.TestCase):
    def test_kokoro_first_then_provider_is_kokoro(self):
        edge = mock.Mock()
        n = narrator.Narrator("kokoro", kokoro=lambda t, p: [Word("a", 0, 1)], edge=edge)
        self.assertEqual(n("a", "v", "+0%", "x.mp3"), [Word("a", 0, 1)])
        self.assertEqual(n.provider, "kokoro")
        edge.assert_not_called()

    def test_kokoro_failure_falls_back_to_edge_and_stays_there(self):
        kokoro = mock.Mock(side_effect=KokoroError("boom"))
        edge = mock.Mock(return_value=[Word("a", 0, 1)])
        n = narrator.Narrator("kokoro", kokoro=kokoro, edge=edge)
        n("a", "v", "+0%", "x.mp3")
        n("a", "v", "+20%", "x.mp3")
        self.assertEqual(n.provider, "edge")
        self.assertEqual(kokoro.call_count, 1)
        self.assertEqual(edge.call_count, 2)

    def test_edge_preference_never_touches_kokoro(self):
        kokoro = mock.Mock()
        edge = mock.Mock(return_value=[])
        n = narrator.Narrator("edge", kokoro=kokoro, edge=edge)
        n("a", "v", "+0%", "x.mp3")
        kokoro.assert_not_called()
        self.assertEqual(narrator.provider_of(n), "edge")

    def test_plain_callables_report_edge(self):
        self.assertEqual(narrator.provider_of(lambda *a: []), "edge")

    def test_edge_failure_propagates(self):
        edge = mock.Mock(side_effect=RuntimeError("down"))
        n = narrator.Narrator("kokoro", kokoro=mock.Mock(side_effect=KokoroError("x")), edge=edge)
        with self.assertRaises(RuntimeError):
            n("a", "v", "+0%", "x.mp3")


class RequestEngineTests(unittest.TestCase):
    def payload(self, **extra):
        from tests.test_logic import good_payload

        return {**good_payload(), **extra}

    def test_defaults_to_edge(self):
        self.assertEqual(validation.validate_render_request(self.payload()).tts_engine, "edge")

    def test_accepts_kokoro(self):
        req = validation.validate_render_request(self.payload(ttsEngine="kokoro"))
        self.assertEqual(req.tts_engine, "kokoro")

    def test_rejects_unknown_engine(self):
        from reel.errors import RenderError

        with self.assertRaises(RenderError):
            validation.validate_render_request(self.payload(ttsEngine="aura"))


if __name__ == "__main__":
    unittest.main()
