"""Qwen3-TTS 1.7B narration on Modal (L4 GPU): POST script segments, get mp3 narration with word timings.

Deploy: modal deploy workers/tts-modal/qwen_app.py
Same contract and bearer token as chatterbox_app.py (Modal secret `reelset-tts`, key TTS_TOKEN); the
render worker reaches it at QWEN_TTS_URL and falls back to Chatterbox when it fails.

The narrator is always the same voice: the genz clip is cloned once per container from a fixed
excerpt and transcript, and every request samples with fixed seeds, so the same script always
sounds the same. All segments are generated in one batch. Each one is then checked with a speech
recognizer and generated again (new seed) when words were invented or dropped.
"""

import base64
import hmac
import logging
import os
import pathlib
import time

import modal

from narration import (
    GAP_SECONDS,
    align_segment,
    emissions,
    encode_mp3,
    heard_letters,
    speech_check,
    spoken_sentence,
)

MODEL_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
MODEL_REVISION = "fd4b254389122332181a7c3db7f27e918eec64e3"
DEFAULT_VOICE = "genz"
VOICES_LOCAL = pathlib.Path(__file__).parent / "voices"
VOICES_DIR = "/voices"
# Two clean stretches of genz.wav (seconds) and exactly what is said in them.
GENZ_EXCERPTS = ((0.0, 6.95), (17.15, 26.65))
GENZ_TRANSCRIPT = (
    "Hey besties, oh my god you are not prepared. I was literally just trying to get my pumpkin spice latte. "
    "Like, sir, please, your confidence is running on store credit. Anyway, I had to tell someone before I "
    "internally exploded."
)
# Any of these when L4s are short; list prices per second from modal.com/pricing (Nov 2026).
GPUS = ["L4", "A10", "L40S"]
GPU_USD_PER_SECOND = {"L4": 0.000222, "A10": 0.000306, "L40S": 0.000542}
SEED = 1234
RETRY_SEED_STEP = 1000
MAX_RETRY_ROUNDS = 2
# About 100 s of speech at 12 codec frames per second; a segment is never that long, a loop is.
MAX_NEW_TOKENS = 1200
MAX_SEGMENTS = 24
MAX_SEGMENT_CHARS = 600
MAX_TOTAL_CHARS = 4000

log = logging.getLogger("qwen-tts")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _download_models() -> None:
    import torchaudio
    from huggingface_hub import snapshot_download

    snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION)
    torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.get_model()


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "sox", "libsndfile1")
    .pip_install("torch==2.6.0", "torchaudio==2.6.0")
    .pip_install("qwen-tts==0.1.1", "num2words==0.5.14", "soundfile==0.12.1", "fastapi[standard]")
    .add_local_python_source("narration", copy=True)
    .run_function(_download_models)
    .add_local_dir(VOICES_LOCAL, VOICES_DIR, ignore=["*.md"])
)

app = modal.App("reelset-qwen-tts", image=image)


def genz_reference():
    import numpy as np
    import soundfile as sf

    audio, rate = sf.read(f"{VOICES_DIR}/{DEFAULT_VOICE}.wav", dtype="float32")
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    pieces = [audio[int(start * rate) : int(end * rate)] for start, end in GENZ_EXCERPTS]
    return np.concatenate(pieces), rate


@app.cls(
    gpu=GPUS,
    timeout=900,
    scaledown_window=60,
    max_containers=2,
    secrets=[modal.Secret.from_name("reelset-tts")],
)
@modal.concurrent(max_inputs=1)
class QwenNarrator:
    @modal.enter()
    def load(self) -> None:
        import torch
        import torchaudio
        from qwen_tts import Qwen3TTSModel

        from huggingface_hub import snapshot_download

        started = time.monotonic()
        self.model = Qwen3TTSModel.from_pretrained(
            snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION),
            device_map="cuda:0",
            dtype=torch.bfloat16,
            attn_implementation="sdpa",
        )
        reference = genz_reference()
        self.voices = {
            DEFAULT_VOICE: self.model.create_voice_clone_prompt(ref_audio=reference, ref_text=GENZ_TRANSCRIPT)
        }
        self.bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        self.aligner = self.bundle.get_model().to("cuda:0").eval()
        self.labels = list(self.bundle.get_labels())
        self.index = {c: i for i, c in enumerate(self.labels)}
        device = torch.cuda.get_device_name(0)
        self.gpu = next((g for g in GPU_USD_PER_SECOND if g in device.replace("A10G", "A10")), "L40S")
        log.info(
            "models loaded in %.1fs gpu=%s (%s) voice=%s reference=%.1fs",
            time.monotonic() - started, self.gpu, device, DEFAULT_VOICE, len(reference[0]) / reference[1],
        )

    def generate(self, texts: list, voice: str, seed: int) -> tuple:
        import torch

        torch.manual_seed(seed)
        wavs, rate = self.model.generate_voice_clone(
            text=texts,
            language=["English"] * len(texts),
            voice_clone_prompt=self.voices[voice],
            max_new_tokens=MAX_NEW_TOKENS,
        )
        return [torch.from_numpy(w.astype("float32")).reshape(1, -1) for w in wavs], rate

    def judge(self, wav, rate: int, text: str) -> tuple:
        import torch

        seconds = wav.shape[1] / rate
        if seconds <= 0 or not torch.isfinite(wav).all():
            return {"ok": False, "ratio": 0.0, "gap": 999, "tooLong": False, "tooShort": True}, None
        logp = emissions(wav, rate, self.aligner, self.bundle)
        return speech_check(text, heard_letters(logp, self.labels), seconds), logp

    def narrate(self, segments: list, voice: str) -> dict:
        import torch

        spoken = [spoken_sentence(s) for s in segments]
        started = time.monotonic()
        wavs, rate = self.generate(spoken, voice, SEED)
        checks = []
        for n, wav in enumerate(wavs):
            checks.append(self.judge(wav, rate, segments[n]))
        retried = 0
        for round_number in range(1, MAX_RETRY_ROUNDS + 1):
            failed = [n for n, (check, _) in enumerate(checks) if not check["ok"]]
            if not failed:
                break
            log.warning("round %d regenerating segments %s: %s", round_number, failed, [checks[n][0] for n in failed])
            retried += len(failed)
            fresh, _ = self.generate([spoken[n] for n in failed], voice, SEED + RETRY_SEED_STEP * round_number)
            for n, wav in zip(failed, fresh):
                check, logp = self.judge(wav, rate, segments[n])
                old = checks[n][0]
                if check["ok"] or (check["gap"], -check["ratio"]) < (old["gap"], -old["ratio"]):
                    wavs[n], checks[n] = wav, (check, logp)
        synth_seconds = time.monotonic() - started
        bad = [n for n, (check, _) in enumerate(checks) if not check["ok"]]
        if bad:
            log.warning("segments %s still off after retries, keeping the closest takes", bad)

        pieces, words, clock = [], [], 0.0
        for n, (wav, text) in enumerate(zip(wavs, segments)):
            duration = wav.shape[1] / rate
            for word in align_segment(wav, rate, text, self.aligner, self.bundle, self.index, checks[n][1]):
                words.append(
                    {"text": word["text"], "start": round(clock + word["start"], 3), "end": round(clock + word["end"], 3)}
                )
            pieces.append(wav)
            clock += duration
            if n < len(segments) - 1:
                pieces.append(torch.zeros(1, int(GAP_SECONDS * rate)))
                clock += GAP_SECONDS
        audio = torch.cat(pieces, dim=1)
        audio_seconds = audio.shape[1] / rate
        mp3 = encode_mp3(audio, rate)
        log.info(
            "narration ready voice=%s segments=%d audio=%.1fs synth=%.1fs retried=%d unresolved=%d words=%d bytes=%d",
            voice, len(segments), audio_seconds, synth_seconds, retried, len(bad), len(words), len(mp3),
        )
        return {
            "audioBase64": base64.b64encode(mp3).decode(),
            "words": words,
            "audioSeconds": round(audio_seconds, 3),
            "synthSeconds": round(synth_seconds, 1),
            "voice": voice,
            "retriedSegments": retried,
            "unresolvedSegments": len(bad),
        }

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, Header, HTTPException

        api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

        @api.post("/synthesize")
        def synthesize(body: dict, authorization: str | None = Header(default=None)):
            return self._handle(body, authorization, HTTPException)

        return api

    def _handle(self, body: dict, authorization, http_error):
        started = time.monotonic()
        expected = os.environ.get("TTS_TOKEN", "")
        supplied = (authorization or "").removeprefix("Bearer ").strip()
        if not expected or not hmac.compare_digest(supplied, expected):
            log.warning("rejected request: bad token")
            raise http_error(status_code=401, detail="unauthorized")
        segments = body.get("segments") if isinstance(body, dict) else None
        if (
            not isinstance(segments, list)
            or not 1 <= len(segments) <= MAX_SEGMENTS
            or not all(isinstance(s, str) and s.strip() and len(s) <= MAX_SEGMENT_CHARS for s in segments)
            or sum(len(s) for s in segments) > MAX_TOTAL_CHARS
        ):
            raise http_error(status_code=400, detail="segments must be 1 to 24 short non-empty strings")
        voice = body.get("voice") or DEFAULT_VOICE
        if not isinstance(voice, str) or voice not in self.voices:
            log.warning("rejected request: unknown voice %r", voice)
            raise http_error(status_code=400, detail=f"voice must be one of {sorted(self.voices)}")
        try:
            result = self.narrate([s.strip() for s in segments], voice)
        except Exception as err:
            log.exception("narration failed")
            raise http_error(status_code=500, detail=f"narration failed: {type(err).__name__}") from err
        gpu_seconds = time.monotonic() - started
        result["gpu"] = self.gpu
        result["gpuSeconds"] = round(gpu_seconds, 1)
        result["gpuUsd"] = round(gpu_seconds * GPU_USD_PER_SECOND[self.gpu], 6)
        return result
