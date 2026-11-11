import os
import platform
import sys
import tempfile

from . import kokoro_tts

SENTENCE = "Kokoro is speaking on this machine."
MIN_MP3_BYTES = 4_000


def main() -> int:
    path = os.path.join(tempfile.mkdtemp(), "smoke.mp3")
    words = kokoro_tts.synthesize(SENTENCE, path)
    size = os.path.getsize(path)
    if len(words) != len(SENTENCE.split()) or size < MIN_MP3_BYTES:
        print(f"kokoro smoke failed: words={len(words)} mp3_bytes={size}", file=sys.stderr)
        return 1
    print(f"kokoro smoke ok: arch={platform.machine()} model={kokoro_tts.model_file()} words={len(words)} mp3_bytes={size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
