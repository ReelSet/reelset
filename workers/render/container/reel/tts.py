import asyncio
import logging
from typing import Callable

from .errors import RenderError
from .timing import Word

log = logging.getLogger("reel.tts")

TICKS_PER_SECOND = 10_000_000
TTS_TIMEOUT_SECONDS = 90


async def _collect(communicate, audio_path: str) -> list:
    words = []
    with open(audio_path, "wb") as audio:
        async for chunk in communicate.stream():
            kind = chunk["type"]
            if kind == "audio":
                audio.write(chunk["data"])
            elif kind == "WordBoundary":
                start = chunk["offset"] / TICKS_PER_SECOND
                words.append(Word(chunk["text"], start, start + chunk["duration"] / TICKS_PER_SECOND))
    return words


def synthesize(
    text: str,
    voice: str,
    rate: str,
    audio_path: str,
    communicate_factory: Callable | None = None,
) -> list:
    """Write mp3 narration to audio_path and return word timings (may be empty).

    communicate_factory is injectable so tests never touch the network.
    """
    if communicate_factory is None:
        import edge_tts

        def communicate_factory(t, v, r):
            return edge_tts.Communicate(t, v, rate=r, boundary="WordBoundary")

    async def run():
        return await asyncio.wait_for(
            _collect(communicate_factory(text, voice, rate), audio_path), TTS_TIMEOUT_SECONDS
        )

    try:
        words = asyncio.run(run())
    except Exception as err:
        log.error("tts failed voice=%s err=%s: %s", voice, type(err).__name__, err)
        raise RenderError("tts_unavailable", f"tts failed: {type(err).__name__}") from err
    log.info("tts ok voice=%s rate=%s words=%d", voice, rate, len(words))
    return words
