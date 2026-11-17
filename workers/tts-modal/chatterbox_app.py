"""Chatterbox-Nano narration on Modal: POST script segments, get mp3 narration with word timings.

Deploy: modal deploy workers/tts-modal/chatterbox_app.py
The render worker calls the web endpoint with a bearer token (Modal secret `reelset-tts`, key TTS_TOKEN).
Chatterbox gives no word timings, so each segment is force-aligned to its own text with wav2vec2.
Every voices/<name>.wav is cloned once at startup; a request picks one with "voice" (the admin
setting tts_chatterbox_voice), defaulting to DEFAULT_VOICE. See voices/README.md.
"""

import base64
import hmac
import logging
import os
import pathlib
import re
import subprocess
import time

import modal

CHATTERBOX_COMMIT = "ab55923c27757c90cfcc407baa57dc25a7d25217"
DEFAULT_VOICE = "genz"
VOICES_LOCAL = pathlib.Path(__file__).parent / "voices"
VOICES_DIR = "/voices"
GAP_SECONDS = 0.22
MAX_SEGMENTS = 24
MAX_SEGMENT_CHARS = 600
MAX_TOTAL_CHARS = 4000
MP3_BITRATE = "128k"
LEVEL_FILTER = "loudnorm=I=-15:TP=-1.5:LRA=11"
CPU_CORES = 4

log = logging.getLogger("chatterbox")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def _download_models() -> None:
    import torchaudio
    from chatterbox.tts_turbo import ChatterboxTurboTTS

    ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
    torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.get_model()


image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install("torch==2.6.0", "torchaudio==2.6.0", index_url="https://download.pytorch.org/whl/cpu")
    .pip_install(
        f"chatterbox-tts @ git+https://github.com/resemble-ai/chatterbox.git@{CHATTERBOX_COMMIT}",
        "num2words==0.5.14",
        "fastapi[standard]",
    )
    .run_function(_download_models)
    .add_local_dir(VOICES_LOCAL, VOICES_DIR, ignore=["*.md"])
)

app = modal.App("reelset-chatterbox", image=image)


def spoken_form(token: str) -> str:
    """Letters the aligner can match: digits spelled out, symbols dropped."""
    from num2words import num2words

    def number(match: re.Match) -> str:
        raw = match.group()
        try:
            return " " + num2words(float(raw) if "." in raw else int(raw)) + " "
        except (ValueError, OverflowError):
            return " "

    text = token.replace("%", " percent ").replace("$", " dollars ")
    text = re.sub(r"\d+(?:\.\d+)?", number, text)
    text = re.sub(r"[^A-Za-z' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip().upper()


def align_segment(wav, sample_rate: int, text: str, aligner, bundle, index: dict) -> list:
    """One {text, start, end} per whitespace token, in seconds from the start of this segment."""
    import torch
    import torchaudio

    duration = wav.shape[1] / sample_rate
    tokens = text.split()
    spoken = [spoken_form(token) for token in tokens]
    transcript = "|".join(s.replace(" ", "|") for s in spoken if s)
    chars = [c for c in transcript if c in index]
    if not chars:
        return spread(tokens, 0.0, duration)
    with torch.inference_mode():
        emission, _ = aligner(torchaudio.functional.resample(wav, sample_rate, bundle.sample_rate))
        logp = torch.log_softmax(emission, dim=-1)
    if logp.shape[1] < len(chars):
        return spread(tokens, 0.0, duration)
    aligned, _ = torchaudio.functional.forced_align(logp, torch.tensor([[index[c] for c in chars]]), blank=0)
    frames = aligned[0].tolist()
    frame = duration / len(frames)

    spans = []
    previous = 0
    for position, token_id in enumerate(frames):
        if token_id != 0 and token_id != previous:
            spans.append([position, position + 1])
        elif token_id != 0 and spans:
            spans[-1][1] = position + 1
        previous = token_id

    cursor = 0
    words = []
    for token, form in zip(tokens, spoken):
        count = len([c for c in form.replace(" ", "|") if c in index])
        if count == 0 or cursor + count > len(spans):
            words.append({"text": token, "start": None, "end": None})
            continue
        words.append({"text": token, "start": spans[cursor][0] * frame, "end": spans[cursor + count - 1][1] * frame})
        cursor += count
        if cursor < len(chars) and chars[cursor] == "|":
            cursor += 1
    for i, word in enumerate(words):
        if word["start"] is None:
            before = next((w["end"] for w in reversed(words[:i]) if w["end"] is not None), 0.0)
            after = next((w["start"] for w in words[i + 1 :] if w["start"] is not None), duration)
            word["start"], word["end"] = before, max(before + 0.05, after)
    return words


def spread(tokens: list, start: float, end: float) -> list:
    weights = [len(token) + 1 for token in tokens]
    total = sum(weights) or 1
    cursor = start
    out = []
    for token, weight in zip(tokens, weights):
        nxt = cursor + (end - start) * weight / total
        out.append({"text": token, "start": cursor, "end": nxt})
        cursor = nxt
    return out


def encode_mp3(audio, sample_rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(audio.squeeze(0).numpy(), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    command = [
        "ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-af", LEVEL_FILTER, "-ar", str(sample_rate), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-f", "mp3", "pipe:1",
    ]
    return subprocess.run(command, input=pcm, check=True, capture_output=True, timeout=120).stdout


@app.cls(
    cpu=CPU_CORES,
    memory=4096,
    timeout=900,
    scaledown_window=20,
    max_containers=2,
    secrets=[modal.Secret.from_name("reelset-tts")],
)
@modal.concurrent(max_inputs=1)
class Chatterbox:
    @modal.enter()
    def load(self) -> None:
        import torch
        import torchaudio
        from chatterbox.tts_turbo import ChatterboxTurboTTS

        started = time.monotonic()
        torch.set_num_threads(CPU_CORES * 2)
        self.tts = ChatterboxTurboTTS.from_pretrained(device="cpu", nano=True)
        self.voices = {}
        for clip in sorted(pathlib.Path(VOICES_DIR).glob("*.wav")):
            self.tts.prepare_conditionals(str(clip))
            self.voices[clip.stem] = self.tts.conds
        if DEFAULT_VOICE not in self.voices:
            raise RuntimeError(f"default voice {DEFAULT_VOICE} missing from {VOICES_DIR}")
        log.info("narrator voices cloned: %s (default %s)", ",".join(self.voices), DEFAULT_VOICE)
        self.bundle = torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H
        self.aligner = self.bundle.get_model()
        self.index = {c: i for i, c in enumerate(self.bundle.get_labels())}
        log.info("models loaded in %.1fs sr=%d", time.monotonic() - started, self.tts.sr)

    def narrate(self, segments: list, voice: str) -> dict:
        import torch

        self.tts.conds = self.voices[voice]
        sample_rate = self.tts.sr
        pieces = []
        words = []
        clock = 0.0
        synth_seconds = 0.0
        for n, text in enumerate(segments):
            started = time.monotonic()
            wav = self.tts.generate(text).detach().cpu()
            took = time.monotonic() - started
            synth_seconds += took
            if wav.dim() == 1:
                wav = wav.unsqueeze(0)
            duration = wav.shape[1] / sample_rate
            if duration <= 0 or not torch.isfinite(wav).all():
                raise RuntimeError(f"segment {n} produced unusable audio")
            log.info("segment %d synth=%.1fs audio=%.1fs words=%d", n, took, duration, len(text.split()))
            for word in align_segment(wav, sample_rate, text, self.aligner, self.bundle, self.index):
                words.append(
                    {"text": word["text"], "start": round(clock + word["start"], 3), "end": round(clock + word["end"], 3)}
                )
            pieces.append(wav)
            clock += duration
            if n < len(segments) - 1:
                pieces.append(torch.zeros(1, int(GAP_SECONDS * sample_rate)))
                clock += GAP_SECONDS
        audio = torch.cat(pieces, dim=1)
        audio_seconds = audio.shape[1] / sample_rate
        mp3 = encode_mp3(audio, sample_rate)
        log.info(
            "narration ready voice=%s segments=%d audio=%.1fs synth=%.1fs words=%d bytes=%d",
            voice, len(segments), audio_seconds, synth_seconds, len(words), len(mp3),
        )
        return {
            "audioBase64": base64.b64encode(mp3).decode(),
            "words": words,
            "audioSeconds": round(audio_seconds, 3),
            "synthSeconds": round(synth_seconds, 1),
            "voice": voice,
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
            return self.narrate([s.strip() for s in segments], voice)
        except Exception as err:
            log.exception("narration failed")
            raise http_error(status_code=500, detail=f"narration failed: {type(err).__name__}") from err
