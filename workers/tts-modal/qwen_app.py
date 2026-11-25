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
    align_segment,
    buffer_has_words,
    emissions,
    encode_mp3,
    fade,
    group_parts,
    heard_letters,
    level_bounds,
    parse_stitch,
    pause_before,
    quietest_point,
    quiet_pauses,
    speech_check,
    spoken_sentence,
    tighten_silence,
    with_tail_buffer,
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
# About 125 s of speech at 12 codec frames per second; a whole script is never that long, a loop is.
MAX_NEW_TOKENS = 1500
MAX_SEGMENTS = 24
# A pause the voice takes at a written "..." or "?" is kept as it is: never shortened, never padded,
# since forcing silence where the voice did not slow down sounds like the audio cutting out.
WRITTEN_PAUSE_MARKS = ("...", "\u2026", "?")
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


# genz_clean.wav is genz.wav through highpass=f=60,afftdn=nr=18:nf=-50:tn=1 (ffmpeg): same words and
# timing, less hiss for the clone to copy into every pause.
CLEAN_VOICE = "genz-clean"


def genz_reference(file: str = DEFAULT_VOICE):
    import numpy as np
    import soundfile as sf

    audio, rate = sf.read(f"{VOICES_DIR}/{file}.wav", dtype="float32")
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
            DEFAULT_VOICE: self.model.create_voice_clone_prompt(ref_audio=reference, ref_text=GENZ_TRANSCRIPT),
            CLEAN_VOICE: self.model.create_voice_clone_prompt(
                ref_audio=genz_reference("genz_clean"), ref_text=GENZ_TRANSCRIPT
            ),
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
            # The clone default streams the text in faster than it is spoken, so the pace climbs as the
            # take goes on (QwenLM/Qwen3-TTS#239, +21% measured here); the whole text up front keeps it flat.
            non_streaming_mode=True,
        )
        return [torch.from_numpy(w.astype("float32")).reshape(1, -1) for w in wavs], rate

    def judge(self, wav, rate: int, text: str) -> tuple:
        import torch

        seconds = wav.shape[1] / rate
        if seconds <= 0 or not torch.isfinite(wav).all():
            return {"ok": False, "ratio": 0.0, "gap": 999, "tooLong": False, "tooShort": True}, None
        logp = emissions(wav, rate, self.aligner, self.bundle)
        return speech_check(text, heard_letters(logp, self.labels), seconds), logp

    def narrate(self, segments: list, voice: str, chunks: int, natural: bool = False, stitch: dict | None = None) -> dict:
        import torch

        stitch = stitch or parse_stitch(None)
        buffer = stitch["tailBuffer"]
        spoken_buffer = spoken_sentence(buffer) if buffer_has_words(buffer) else buffer
        groups = group_parts(segments, chunks)
        texts = [" ".join(segments[i] for i in g) for g in groups]
        # What each take actually says: its text plus the tail buffer, which is cut off afterwards.
        said = [with_tail_buffer(t, buffer) for t in texts]
        spoken = [with_tail_buffer(" ".join(spoken_sentence(segments[i]) for i in g), spoken_buffer) for g in groups]
        started = time.monotonic()
        wavs, rate = self.generate(spoken, voice, SEED)
        checks = [self.judge(wav, rate, said[n]) for n, wav in enumerate(wavs)]
        retried = 0
        for round_number in range(1, MAX_RETRY_ROUNDS + 1):
            failed = [n for n, (check, _) in enumerate(checks) if not check["ok"]]
            if not failed:
                break
            log.warning("round %d regenerating takes %s: %s", round_number, failed, [checks[n][0] for n in failed])
            retried += len(failed)
            fresh, _ = self.generate([spoken[n] for n in failed], voice, SEED + RETRY_SEED_STEP * round_number)
            for n, wav in zip(failed, fresh):
                check, logp = self.judge(wav, rate, said[n])
                old = checks[n][0]
                if check["ok"] or (check["gap"], -check["ratio"]) < (old["gap"], -old["ratio"]):
                    wavs[n], checks[n] = wav, (check, logp)
        synth_seconds = time.monotonic() - started
        bad = [n for n, (check, _) in enumerate(checks) if not check["ok"]]
        if bad:
            log.warning("takes %s still off after retries, keeping the closest ones", bad)

        takes, trimmed, shortened, padded = [], 0.0, 0, 0
        for n, raw in enumerate(wavs):
            parts = [segments[i] for i in groups[n]]
            tokens = texts[n].split()
            if natural:
                # Pauses are the voice's own, from the script's punctuation: only the take's edges are trimmed.
                words = align_segment(raw, rate, said[n], self.aligner, self.bundle, self.index, checks[n][1])
                takes.append(self.cut_take(raw, rate, words, tokens, stitch))
                continue
            first = align_segment(raw, rate, said[n], self.aligner, self.bundle, self.index, checks[n][1])
            wav, stats = tighten_silence(raw, rate, self.written_pauses(first))
            trimmed += stats["trimmedSeconds"]
            shortened += stats["shortenedPauses"]
            words = align_segment(wav, rate, said[n], self.aligner, self.bundle, self.index)
            wav, words = self.cut_take(wav, rate, words, tokens, stitch)
            wav, words, added = self.pad_breaks(wav, rate, words, parts, stitch["pause"])
            wav = quiet_pauses(wav, rate, words)
            padded += added
            takes.append((wav, words))

        pieces, words, clock = [], [], 0.0
        for n, (wav, take_words) in enumerate(takes):
            if n > 0:
                trailing = clock - words[-1]["end"]
                wanted = pause_before(n, groups, len(segments), stitch)
                gap = max(0.0, wanted - trailing - take_words[0]["start"])
                pieces.append(torch.zeros(1, int(gap * rate)))
                clock += gap
            for word in take_words:
                words.append({"text": word["text"], "start": round(clock + word["start"], 3), "end": round(clock + word["end"], 3)})
            pieces.append(wav)
            clock += wav.shape[1] / rate
        audio = torch.cat(pieces, dim=1)
        audio_seconds = audio.shape[1] / rate
        mp3 = encode_mp3(audio, rate)
        log.info(
            "narration ready voice=%s parts=%d takes=%d audio=%.1fs synth=%.1fs retried=%d unresolved=%d words=%d"
            " bytes=%d trimmed=%.1fs shortened_pauses=%d padded_breaks=%d",
            voice, len(segments), len(groups), audio_seconds, synth_seconds, retried, len(bad), len(words),
            len(mp3), trimmed, shortened, padded,
        )
        return {
            "audioBase64": base64.b64encode(mp3).decode(),
            "words": words,
            "audioSeconds": round(audio_seconds, 3),
            "synthSeconds": round(synth_seconds, 1),
            "voice": voice,
            "takes": len(groups),
            "natural": natural,
            "retriedSegments": retried,
            "unresolvedSegments": len(bad),
            "trimmedSeconds": round(trimmed, 2),
            "shortenedPauses": shortened,
            "paddedBreaks": padded,
            "stitch": stitch,
        }

    @staticmethod
    def cut_take(wav, rate: int, words: list, tokens: list, stitch: dict) -> tuple:
        """Cuts a take to its real words and fades the edges: an in-breath before the first word, and
        the tail or tail buffer after the last, are dropped. trim "words" cuts at the aligned words,
        "level" where the audio drops below trimDb, "off" only cuts the buffer away."""
        duration = wav.shape[1] / rate
        real, extra = words[: len(tokens)], words[len(tokens) :]
        if not real:
            return fade(wav, rate, stitch["fadeInMs"], stitch["fadeOutMs"]), real
        limit = quietest_point(wav, rate, real[-1]["end"], extra[0]["start"]) / rate if extra else duration
        if stitch["trim"] == "words":
            start, end = real[0]["start"] - stitch["leadKeep"], real[-1]["end"] + stitch["tailKeep"]
        elif stitch["trim"] == "level":
            start, end = level_bounds(
                wav[:, : int(limit * rate)], rate, stitch["trimDb"], stitch["leadKeep"], stitch["tailKeep"]
            )
        else:
            start, end = 0.0, duration
        start, end = max(0.0, start), min(end, limit)
        if end - start < 0.05:
            start, end = 0.0, limit
        cut = fade(wav[:, int(start * rate) : int(end * rate)], rate, stitch["fadeInMs"], stitch["fadeOutMs"])
        length = cut.shape[1] / rate
        return cut, [
            {"text": token, "start": min(max(0.0, w["start"] - start), length), "end": min(max(0.0, w["end"] - start), length)}
            for token, w in zip(tokens, real)
        ]

    @staticmethod
    def written_pauses(words: list) -> tuple:
        """The (start, end) of each pause after a word written with "..." or "?"."""
        return tuple(
            (words[j - 1]["end"], words[j]["start"])
            for j in range(1, len(words))
            if words[j - 1]["text"].endswith(WRITTEN_PAUSE_MARKS)
        )

    @staticmethod
    def pad_breaks(wav, rate: int, words: list, parts: list, pause: float) -> tuple:
        """Where one part ends and the next begins inside a take, makes the pause at least
        `pause` seconds, splicing silence in at the quietest point (quiet_pauses fades around it)."""
        import torch

        breaks, count = [], 0
        for part in parts[:-1]:
            count += len(part.split())
            breaks.append(count)
        out, added = wav, 0
        for j in reversed(breaks):
            if j <= 0 or j >= len(words):
                continue
            extra = pause - (words[j]["start"] - words[j - 1]["end"])
            if extra <= 0.02:
                continue
            at = quietest_point(out, rate, words[j - 1]["end"], words[j]["start"])
            out = torch.cat([out[:, :at], torch.zeros(1, int(extra * rate)), out[:, at:]], dim=1)
            words = words[:j] + [{**w, "start": w["start"] + extra, "end": w["end"] + extra} for w in words[j:]]
            added += 1
        return out, words, added

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
        chunks = body.get("chunks", len(segments))
        if not isinstance(chunks, int) or isinstance(chunks, bool) or not 1 <= chunks <= len(segments):
            raise http_error(status_code=400, detail="chunks must be a whole number from 1 to the number of segments")
        try:
            stitch = parse_stitch(body.get("stitch"))
        except ValueError as err:
            raise http_error(status_code=400, detail=str(err)) from err
        try:
            natural = body.get("natural") is True
            result = self.narrate([s.strip() for s in segments], voice, chunks, natural, stitch)
        except Exception as err:
            log.exception("narration failed")
            raise http_error(status_code=500, detail=f"narration failed: {type(err).__name__}") from err
        gpu_seconds = time.monotonic() - started
        result["gpu"] = self.gpu
        result["gpuSeconds"] = round(gpu_seconds, 1)
        result["gpuUsd"] = round(gpu_seconds * GPU_USD_PER_SECOND[self.gpu], 6)
        return result
