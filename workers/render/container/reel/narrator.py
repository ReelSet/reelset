import logging

from . import kokoro_tts, tts
from .kokoro_tts import KokoroError

log = logging.getLogger("reel.narrator")

ENGINES = ("kokoro", "edge")
DEFAULT_ENGINE = "edge"


class Narrator:
    """Synthesizes narration with the preferred engine, falling back to edge-tts as the last resort.

    After each call, provider names the engine that produced the audio. Once Kokoro has failed it is
    not retried within the same render, so the pipeline's faster-rate retry goes straight to edge-tts.
    """

    def __init__(self, preferred: str = DEFAULT_ENGINE, kokoro=kokoro_tts.synthesize, edge=tts.synthesize):
        self.provider = "edge"
        self._kokoro = kokoro if preferred == "kokoro" else None
        self._edge = edge

    def __call__(self, text: str, voice: str, rate: str, audio_path: str) -> list:
        if self._kokoro is not None:
            try:
                words = self._kokoro(text, audio_path)
                self.provider = "kokoro"
                return words
            except KokoroError as err:
                log.error("kokoro failed, falling back to edge-tts err=%s", err)
                self._kokoro = None
        self.provider = "edge"
        return self._edge(text, voice, rate, audio_path)


def provider_of(synth) -> str:
    return getattr(synth, "provider", "edge")
