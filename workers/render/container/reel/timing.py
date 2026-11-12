import math
from dataclasses import dataclass

MAX_VIDEO_SECONDS = 100.0
TAIL_SECONDS = 0.5
CHARS_PER_SECOND = 14.5
MAX_RATE_PERCENT = 50
MAX_REFIT_RATE_PERCENT = 80
REFIT_HEADROOM_SECONDS = 1.0
TARGET_NARRATION_SECONDS = 95.0
MIN_SPAN_SECONDS = 0.3


@dataclass(frozen=True)
class Word:
    text: str
    start: float
    end: float


def choose_rate(char_count: int) -> str:
    """edge-tts rate string that keeps estimated narration inside the video cap."""
    estimated = char_count / CHARS_PER_SECOND
    if estimated <= TARGET_NARRATION_SECONDS:
        return "+0%"
    percent = math.ceil((estimated / TARGET_NARRATION_SECONDS - 1) * 100)
    return f"+{min(percent, MAX_RATE_PERCENT)}%"


def refit_rate(rate: str, measured_seconds: float) -> str | None:
    """Faster edge-tts rate that brings a measured narration under the cap, or None if hopeless.

    The character-based estimate in choose_rate is only a guess; real pace varies with numbers,
    identifiers and punctuation, so the pipeline measures and retries once with this.
    """
    target = MAX_VIDEO_SECONDS - TAIL_SECONDS - REFIT_HEADROOM_SECONDS
    speed = (1 + int(rate.rstrip("%")) / 100) * measured_seconds / target
    percent = math.ceil((speed - 1) * 100)
    return f"+{percent}%" if percent <= MAX_REFIT_RATE_PERCENT else None


def estimate_word_timings(text: str, total_seconds: float) -> list:
    """Fallback when the service returned no word events: spread time by character weight."""
    tokens = text.split()
    if not tokens or total_seconds <= 0:
        return []
    weights = [len(t) + 1 for t in tokens]
    total_weight = sum(weights)
    words = []
    cursor = 0.0
    for token, weight in zip(tokens, weights):
        span = total_seconds * weight / total_weight
        words.append(Word(token, cursor, cursor + span))
        cursor += span
    return words


def _nonspace_len(text: str) -> int:
    return sum(1 for ch in text if not ch.isspace())


def allocate_segments(segments: list, words: list, total_seconds: float) -> list:
    """Return one (start, end) span per narration segment, contiguous from 0 to total_seconds.

    Words are matched to segments by cumulative non-space character count, so differences in
    how the TTS service tokenizes (hyphens, numbers, punctuation) do not shift later segments.
    """
    if not segments:
        return []
    if not words:
        words = estimate_word_timings(" ".join(segments), total_seconds)

    word_ends = []
    running = 0
    for w in words:
        running += _nonspace_len(w.text)
        word_ends.append(running)

    boundaries = [0.0]
    segment_cumulative = 0
    word_index = 0
    for segment in segments[:-1]:
        segment_cumulative += _nonspace_len(segment)
        while word_index < len(words) - 1 and word_ends[word_index] < segment_cumulative:
            word_index += 1
        boundaries.append(words[word_index].end)
    boundaries.append(total_seconds)

    spans = []
    previous_end = 0.0
    for i in range(len(segments)):
        start = previous_end
        end = max(boundaries[i + 1], start + MIN_SPAN_SECONDS)
        spans.append((start, end))
        previous_end = end
    last_start, _ = spans[-1]
    spans[-1] = (last_start, max(total_seconds, last_start + MIN_SPAN_SECONDS))
    return spans


def total_video_seconds(audio_seconds: float) -> float:
    return audio_seconds + TAIL_SECONDS
