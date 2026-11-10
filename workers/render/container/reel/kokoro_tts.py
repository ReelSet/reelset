import logging
import os
import subprocess
import threading
import time

from . import kokoro_timing, lexicon

log = logging.getLogger("reel.kokoro")
logging.getLogger("phonemizer").setLevel(logging.ERROR)

VOICE = "af_heart"
LANGUAGE = "en-us"
MODEL_DIR = os.environ.get("KOKORO_MODEL_DIR", "/opt/kokoro")
MODEL_FILE = "kokoro-v1.0.fp16.onnx"
VOICES_FILE = "voices-v1.0.bin"
SAMPLE_RATE = 24_000
INTRA_OP_THREADS = 2
BASE_WPM = 112
TARGET_WPM = 140
PREFERRED_MAX_SPEED = 1.15
FIT_MAX_SPEED = 1.25
MIN_SPEED = 1.0
MAX_AUDIO_SECONDS = 58.0
FIT_HEADROOM_SECONDS = 1.0
MAX_FIT_RENDERS = 3
PAUSE_FRACTION_GUESS = 0.2
MP3_BITRATE = "128k"
LEVEL_FILTER = "loudnorm=I=-15:TP=-1.5:LRA=11"
ENCODE_TIMEOUT_SECONDS = 60


class KokoroError(Exception):
    """Kokoro could not produce usable narration; the caller falls back to another engine."""


class Engine:
    """The loaded model: phonemize script tokens and render timed audio."""

    def __init__(self, model_dir: str = MODEL_DIR):
        import onnxruntime
        from kokoro_onnx import Kokoro

        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = INTRA_OP_THREADS
        options.inter_op_num_threads = 1
        session = onnxruntime.InferenceSession(
            os.path.join(model_dir, MODEL_FILE), sess_options=options, providers=["CPUExecutionProvider"]
        )
        self._kokoro = Kokoro.from_session(session, os.path.join(model_dir, VOICES_FILE))

    def phonemize(self, text: str) -> str:
        return self._kokoro.tokenizer.phonemize(text, LANGUAGE)

    def synthesize(self, phonemes: str, speed: float) -> tuple:
        audio, _, timings = self._kokoro.create_timed(
            phonemes, VOICE, speed=speed, lang=LANGUAGE, is_phonemes=True
        )
        return audio, timings


_engine = None
_engine_lock = threading.Lock()


def shared_engine() -> Engine:
    """Loads the model on first use and keeps it for the life of the process."""
    global _engine
    with _engine_lock:
        if _engine is None:
            started = time.monotonic()
            try:
                _engine = Engine()
            except Exception as err:
                raise KokoroError(f"model load failed: {type(err).__name__}: {err}") from err
            log.info("kokoro model loaded in %.1fs", time.monotonic() - started)
        return _engine


def initial_speed() -> float:
    return min(PREFERRED_MAX_SPEED, max(MIN_SPEED, TARGET_WPM / BASE_WPM))


def refit_speed(measured: list) -> float | None:
    """Speed that brings narration under the cap given (speed, seconds) renders, or None past what stays intelligible.

    Pauses do not shrink with speed, so time is modelled as pause + speech / speed: one render assumes a
    pessimistic pause share, two renders solve it exactly.
    """
    target = MAX_AUDIO_SECONDS - FIT_HEADROOM_SECONDS
    speed, seconds = measured[-1]
    pause = seconds * PAUSE_FRACTION_GUESS
    speech_at_speed = seconds - pause
    if len(measured) >= 2:
        (s1, t1), (s2, t2) = measured[-2], measured[-1]
        slope = (t1 - t2) / (1 / s1 - 1 / s2) if s1 != s2 else 0.0
        if slope > 0:
            pause = max(0.0, t2 - slope / s2)
            speech_at_speed = slope / s2
    room = target - pause
    if room <= 0:
        return None
    needed = max(speed * speech_at_speed / room, speed * 1.02)
    return needed if needed <= FIT_MAX_SPEED else None


def encode_mp3(audio, audio_path: str) -> None:
    import numpy as np

    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    command = [
        "ffmpeg", "-y", "-loglevel", "error", "-f", "s16le", "-ar", str(SAMPLE_RATE), "-ac", "1",
        "-i", "pipe:0", "-af", LEVEL_FILTER, "-ar", str(SAMPLE_RATE), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, audio_path,
    ]
    try:
        subprocess.run(command, input=pcm, check=True, capture_output=True, timeout=ENCODE_TIMEOUT_SECONDS)
    except (subprocess.SubprocessError, OSError) as err:
        raise KokoroError(f"mp3 encode failed: {type(err).__name__}") from err


def _render(engine, phonemes: str, speed: float) -> tuple:
    started = time.monotonic()
    audio, timings = engine.synthesize(phonemes, speed)
    seconds = len(audio) / SAMPLE_RATE
    log.info("kokoro synth speed=%.2f audio=%.1fs wall=%.1fs", speed, seconds, time.monotonic() - started)
    return audio, timings, seconds


def synthesize(text: str, audio_path: str, engine=None) -> list:
    """Write mp3 narration to audio_path and return one timed Word per script token."""
    tokens = text.split()
    if not tokens:
        raise KokoroError("nothing to synthesize")
    engine = engine or shared_engine()
    try:
        per_token = [engine.phonemize(lexicon.spoken_form(token)) for token in tokens]
        phonemes = " ".join(p for p in per_token if p)
        if not phonemes:
            raise KokoroError("no phonemes for narration")
        speed = initial_speed()
        audio, timings, seconds = _render(engine, phonemes, speed)
        measured = [(speed, seconds)]
        while seconds > MAX_AUDIO_SECONDS:
            faster = refit_speed(measured) if len(measured) < MAX_FIT_RENDERS else None
            if faster is None:
                raise KokoroError(f"narration is {seconds:.1f}s at speed {speed:.2f}, over the cap")
            speed = faster
            audio, timings, seconds = _render(engine, phonemes, speed)
            measured.append((speed, seconds))
        if not timings:
            raise KokoroError("model returned no phoneme timings")
    except KokoroError:
        raise
    except Exception as err:
        raise KokoroError(f"synthesis failed: {type(err).__name__}: {err}") from err
    encode_mp3(audio, audio_path)
    words = kokoro_timing.regroup(tokens, per_token, timings)
    log.info("kokoro ok tokens=%d audio=%.1fs speed=%.2f wpm=%.0f", len(tokens), seconds, speed, len(tokens) / seconds * 60)
    return words
