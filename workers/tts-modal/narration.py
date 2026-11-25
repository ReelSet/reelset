"""Helpers shared by the Modal narrators: spoken wording, forced word alignment, a speech check
and mp3 encoding. Torch, torchaudio and num2words are imported inside functions so the module
loads on the local machine that runs `modal deploy`."""

import difflib
import re
import subprocess

GAP_SECONDS = 0.22
MP3_BITRATE = "128k"
LEVEL_FILTER = "loudnorm=I=-15:TP=-1.5:LRA=11"

# A run of this many extra or missing letters means a word was invented or dropped, not misheard.
MAX_LETTER_GAP = 12
MIN_LETTER_MATCH = 0.6
MAX_SECONDS_PER_LETTER = 0.16
MIN_SECONDS_PER_LETTER = 0.025
LOOP_GRACE_SECONDS = 1.5

_NUMBER = re.compile(r"(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?:st|nd|rd|th|[kKMBx])?")
_SCALE = {"k": "thousand", "K": "thousand", "M": "million", "B": "billion", "x": "times"}
_MONEY_SCALE = {
    "k": "thousand", "K": "thousand",
    "m": "million", "M": "million", "mn": "million",
    "b": "billion", "B": "billion", "bn": "billion",
    "t": "trillion", "T": "trillion", "tn": "trillion",
}
_SCALE_WORDS = {"thousand", "million", "billion", "trillion"}
# symbol: (one, many)
_CURRENCY = {"$": ("dollar", "dollars"), "€": ("euro", "euros"), "£": ("pound", "pounds"), "₹": ("rupee", "rupees")}
_MONEY = re.compile(
    r"^(?:US|C|A|NZ|HK|S)?([$€£₹])((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)(?:-?(bn|mn|tn|[kKmMbBtT])(?![A-Za-z]))?"
)
_MONTHS = {
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
}
_DAY = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?$")
_EDGE = re.compile(r"^([\"'“‘(\[]*)(.*?)([\"'”’)\].,!?;:]*)$", re.S)


def _us_words(value, to: str = "cardinal") -> str:
    from num2words import num2words

    return num2words(value, lang="en", to=to).replace(" and ", " ").replace(",", "")


def _number_words(raw: str) -> str:
    suffix = ""
    if raw[-2:] in ("st", "nd", "rd", "th"):
        digits, suffix = raw[:-2], "ordinal"
    elif raw[-1] in _SCALE:
        digits, suffix = raw[:-1], _SCALE[raw[-1]]
    else:
        digits = raw
    digits = digits.replace(",", "")
    try:
        if suffix == "ordinal":
            return _us_words(int(digits), to="ordinal")
        if "." in digits:
            words = _us_words(float(digits))
        elif len(digits) == 4 and 1100 <= int(digits) <= 2099 and not suffix and "," not in raw:
            words = _us_words(int(digits), to="year")
        else:
            words = _us_words(int(digits))
    except (ValueError, OverflowError):
        return raw
    return f"{words} {suffix}" if suffix else words


def _split_edges(token: str) -> tuple:
    lead, core, trail = _EDGE.match(token).groups()
    return lead, core, trail


def _plain_words(text: str) -> str:
    text = text.replace("%", " percent")
    text = _NUMBER.sub(lambda m: " " + _number_words(m.group()) + " ", text)
    return re.sub(r"\s+", " ", text).strip()


def _money_words(digits: str, scale: str, unit: tuple, next_scale: bool) -> str:
    """`$12.5` + `million` is said "twelve point five million dollars": the currency moves after the
    scale, which may be glued on (`$1M`, `$3.4bn`) or the next word (`next_scale`)."""
    value = digits.replace(",", "")
    if scale or next_scale:
        words = _us_words(float(value)) if "." in value else _us_words(int(value))
        return f"{words} {scale} {unit[1]}".strip() if scale else words
    if "." in value:
        whole, cents = value.split(".", 1)
        if len(cents) == 2:
            said = f"{_us_words(int(whole))} {unit[0] if int(whole) == 1 else unit[1]}"
            return said if int(cents) == 0 else f"{said} {_us_words(int(cents))} cents"
        return f"{_us_words(float(value))} {unit[1]}"
    return f"{_us_words(int(value))} {unit[0] if int(value) == 1 else unit[1]}"


def speech_tokens(tokens: list) -> list:
    """How each script token is said aloud, one string per token so word timings stay one to one:
    digits, percent, money and dates in words, edge punctuation kept."""
    parts = [_split_edges(t) for t in tokens]
    out = []
    pending_unit = None
    for i, (lead, core, trail) in enumerate(parts):
        nxt = parts[i + 1][1].lower() if i + 1 < len(parts) and not parts[i + 1][0] else ""
        prev = parts[i - 1][1].lower().rstrip(".") if i > 0 else ""
        if pending_unit and core.lower() in _SCALE_WORDS:
            out.append(f"{lead}{core} {pending_unit}{trail}")
            pending_unit = None
            continue
        pending_unit = None
        money = _MONEY.match(core)
        if money:
            symbol, digits, scale = money.groups()
            unit = _CURRENCY[symbol]
            # A scale word after the amount is only joined when nothing sits between them.
            next_scale = not scale and not trail and nxt in _SCALE_WORDS
            said = _money_words(digits, _MONEY_SCALE.get(scale or "", ""), unit, next_scale)
            if next_scale:
                pending_unit = unit[1]
            rest = core[money.end():]
            text = f"{said} {_plain_words(rest.replace('-', ' '))}".strip() if rest else said
            out.append(f"{lead}{text}{trail}")
            continue
        day = _DAY.match(core)
        if day and 1 <= int(day.group(1)) <= 31 and (prev in _MONTHS or (not trail and nxt.rstrip(".,") in _MONTHS)):
            out.append(f"{lead}{_us_words(int(day.group(1)), to='ordinal')}{trail}")
            continue
        out.append(f"{lead}{_plain_words(core)}{trail}")
    return out


def speech_text(token: str) -> str:
    """How one script token is said aloud, without its neighbours."""
    return speech_tokens([token])[0]


def _letters(said: str) -> str:
    text = re.sub(r"[^A-Za-z' ]+", " ", said.replace("-", " "))
    return re.sub(r"\s+", " ", text).strip().upper()


def spoken_forms(tokens: list) -> list:
    """Letters the aligner can match for each token, upper case, words split by spaces."""
    return [_letters(said) for said in speech_tokens(tokens)]


def spoken_form(token: str) -> str:
    return spoken_forms([token])[0]


def spoken_sentence(text: str) -> str:
    return " ".join(speech_tokens(text.split()))


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


def emissions(wav, sample_rate: int, aligner, bundle):
    import torch
    import torchaudio

    with torch.inference_mode():
        audio = torchaudio.functional.resample(wav, sample_rate, bundle.sample_rate)
        emission, _ = aligner(audio.to(next(aligner.parameters()).device))
        return torch.log_softmax(emission, dim=-1).cpu()


def align_segment(wav, sample_rate: int, text: str, aligner, bundle, index: dict, logp=None) -> list:
    """One {text, start, end} per whitespace token, in seconds from the start of this segment."""
    import torch
    import torchaudio

    duration = wav.shape[1] / sample_rate
    tokens = text.split()
    spoken = spoken_forms(tokens)
    transcript = "|".join(s.replace(" ", "|") for s in spoken if s)
    chars = [c for c in transcript if c in index]
    if not chars:
        return spread(tokens, 0.0, duration)
    if logp is None:
        logp = emissions(wav, sample_rate, aligner, bundle)
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


def heard_letters(logp, labels: list) -> str:
    """Greedy CTC read of the emissions: what the speech recognizer heard, letters only."""
    best = logp[0].argmax(dim=-1).tolist()
    out, previous = [], None
    for token_id in best:
        if token_id != previous and token_id != 0:
            out.append(labels[token_id])
        previous = token_id
    return "".join(c for c in out if c.isalpha())


def speech_check(text: str, heard: str, seconds: float) -> dict:
    """Compares what was said with the script: a long run of extra or missing letters means the voice
    invented or dropped words; a duration far off the script length means a loop or a cut-off."""
    expected = "".join(c for c in "".join(spoken_forms(text.split())) if c.isalpha())
    matcher = difflib.SequenceMatcher(None, expected, heard, autojunk=False)
    gap = 0
    for op, a1, a2, b1, b2 in matcher.get_opcodes():
        if op != "equal":
            gap = max(gap, abs((a2 - a1) - (b2 - b1)) if op == "replace" else max(a2 - a1, b2 - b1))
    ratio = matcher.ratio()
    letters = max(len(expected), 1)
    too_long = seconds > letters * MAX_SECONDS_PER_LETTER + LOOP_GRACE_SECONDS
    too_short = seconds < letters * MIN_SECONDS_PER_LETTER
    ok = gap < MAX_LETTER_GAP and ratio >= MIN_LETTER_MATCH and not too_long and not too_short
    return {"ok": ok, "ratio": round(ratio, 3), "gap": gap, "tooLong": too_long, "tooShort": too_short}


# Speech models pad each take with silence and hold long breaths at full stops; joined back to back
# that sounds like the voice stalling. Quieter than SILENCE_DB below the loudest frame is silence.
SILENCE_DB = -38.0
FRAME_SECONDS = 0.01
LEAD_PAD_SECONDS = 0.03
TAIL_PAD_SECONDS = 0.07
MAX_INNER_PAUSE_SECONDS = 0.38
INNER_PAUSE_SECONDS = 0.3
EDGE_FADE_SECONDS = 0.008


def tighten_silence(wav, sample_rate: int, protect: tuple = ()):
    """Trims a take's leading and trailing silence and shortens long pauses inside it, except pauses
    overlapping a `protect` (start, end) range in seconds; returns (wav, stats)."""
    import numpy as np
    import torch

    audio = wav.squeeze(0).numpy()
    frame = max(1, int(FRAME_SECONDS * sample_rate))
    count = len(audio) // frame
    if count < 3:
        return wav, {"trimmedSeconds": 0.0, "shortenedPauses": 0}
    rms = np.sqrt(np.mean(audio[: count * frame].reshape(count, frame) ** 2, axis=1) + 1e-12)
    voiced = 20 * np.log10(rms / rms.max()) > SILENCE_DB
    if not voiced.any():
        return wav, {"trimmedSeconds": 0.0, "shortenedPauses": 0}
    first, last = int(np.argmax(voiced)), count - 1 - int(np.argmax(voiced[::-1]))
    start = max(0, first * frame - int(LEAD_PAD_SECONDS * sample_rate))
    end = min(len(audio), (last + 1) * frame + int(TAIL_PAD_SECONDS * sample_rate))
    keep, cursor, shortened = [], start, 0
    run_start = None
    half = int(INNER_PAUSE_SECONDS * sample_rate / 2)
    for i in range(first, last + 1):
        if not voiced[i] and run_start is None:
            run_start = i
        elif voiced[i] and run_start is not None:
            protected = any(a < i * FRAME_SECONDS and b > run_start * FRAME_SECONDS for a, b in protect)
            if (i - run_start) * FRAME_SECONDS > MAX_INNER_PAUSE_SECONDS and not protected:
                keep.append(audio[cursor : run_start * frame + half])
                cursor = i * frame - half
                shortened += 1
            run_start = None
    keep.append(audio[cursor:end])
    out = np.concatenate(keep)
    fade = min(int(EDGE_FADE_SECONDS * sample_rate), len(out) // 2)
    if fade > 0:
        ramp = np.linspace(0.0, 1.0, fade, dtype=out.dtype)
        out[:fade] *= ramp
        out[-fade:] *= ramp[::-1]
    trimmed = (len(audio) - len(out)) / sample_rate
    return torch.from_numpy(np.ascontiguousarray(out)).reshape(1, -1), {
        "trimmedSeconds": round(trimmed, 2),
        "shortenedPauses": shortened,
    }


def group_parts(parts: list, chunks: int) -> list:
    """Splits consecutive parts into `chunks` runs of about equal length; returns lists of indices."""
    chunks = max(1, min(chunks, len(parts)))
    total = sum(len(p) for p in parts)
    groups, current, done = [], [], 0
    for i, part in enumerate(parts):
        current.append(i)
        done += len(part)
        left_parts, left_groups = len(parts) - i - 1, chunks - len(groups) - 1
        target = total * (len(groups) + 1) / chunks
        closest = left_parts > 0 and done + len(parts[i + 1]) / 2 >= target
        if left_groups > 0 and (closest or left_parts == left_groups):
            groups.append(current)
            current = []
    if current:
        groups.append(current)
    return groups


def fade_edges(wav, sample_rate: int):
    fade = min(int(EDGE_FADE_SECONDS * sample_rate), wav.shape[1] // 2)
    if fade <= 0:
        return wav
    import torch

    out = wav.clone()
    ramp = torch.linspace(0.0, 1.0, fade)
    out[0, :fade] *= ramp
    out[0, -fade:] *= ramp.flip(0)
    return out


def quietest_point(wav, sample_rate: int, start: float, end: float) -> int:
    """Sample index of the quietest 10 ms between two times, where silence can be spliced in."""
    import numpy as np

    a, b = int(start * sample_rate), int(end * sample_rate)
    frame = max(1, int(FRAME_SECONDS * sample_rate))
    if b - a < 2 * frame:
        return (a + b) // 2
    audio = wav.squeeze(0).numpy()[a:b]
    count = len(audio) // frame
    energy = (audio[: count * frame].reshape(count, frame) ** 2).mean(axis=1)
    return a + int(np.argmin(energy)) * frame + frame // 2


# Cloned voices carry the reference clip's hiss and breaths into every pause, and loudness leveling
# raises them; between words (from the alignment) the audio is faded down to true silence.
GATE_AFTER_WORD_SECONDS = 0.07
GATE_BEFORE_WORD_SECONDS = 0.04
GATE_FADE_SECONDS = 0.03


def quiet_pauses(wav, sample_rate: int, words: list):
    """Silences the audio between words, and before the first and after the last, with short fades."""
    import torch

    if not words:
        return wav
    length = wav.shape[1]
    fade = int(GATE_FADE_SECONDS * sample_rate)
    gain = torch.ones(length)
    edges = [(0.0, words[0]["start"])] + [(p["end"], q["start"]) for p, q in zip(words, words[1:])]
    edges.append((words[-1]["end"], length / sample_rate))
    for n, (end, start) in enumerate(edges):
        a = int((end + (GATE_AFTER_WORD_SECONDS if n > 0 else 0.0)) * sample_rate)
        b = int((start - (GATE_BEFORE_WORD_SECONDS if n < len(edges) - 1 else 0.0)) * sample_rate)
        a, b = max(0, a), min(length, b)
        if b - a < 2 * fade:
            continue
        gain[a + fade : b - fade] = 0.0
        if n > 0:
            gain[a : a + fade] = torch.minimum(gain[a : a + fade], torch.linspace(1.0, 0.0, fade))
        else:
            gain[a : a + fade] = 0.0
        if n < len(edges) - 1:
            gain[b - fade : b] = torch.minimum(gain[b - fade : b], torch.linspace(0.0, 1.0, fade))
        else:
            gain[b - fade : b] = 0.0
    return wav * gain.reshape(1, -1)


def encode_mp3(audio, sample_rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(audio.squeeze(0).numpy(), -1.0, 1.0) * 32767).astype("<i2").tobytes()
    command = [
        "ffmpeg", "-loglevel", "error", "-f", "s16le", "-ar", str(sample_rate), "-ac", "1", "-i", "pipe:0",
        "-af", LEVEL_FILTER, "-ar", str(sample_rate), "-c:a", "libmp3lame", "-b:a", MP3_BITRATE, "-f", "mp3", "pipe:1",
    ]
    return subprocess.run(command, input=pcm, check=True, capture_output=True, timeout=120).stdout


# How takes are trimmed and joined. The defaults are what the service did before these were options.
STITCH_DEFAULTS = {
    "pause": 0.45,
    "edgePause": None,
    "trim": "words",
    "trimDb": -45.0,
    "leadKeep": 0.06,
    "tailKeep": 0.12,
    "fadeInMs": 8.0,
    "fadeOutMs": 8.0,
    "tailBuffer": "",
}
STITCH_RANGES = {
    "pause": (0.0, 2.0),
    "edgePause": (0.0, 2.0),
    "trimDb": (-80.0, -20.0),
    "leadKeep": (0.0, 0.5),
    "tailKeep": (0.0, 0.5),
    "fadeInMs": (0.0, 100.0),
    "fadeOutMs": (0.0, 100.0),
}
TRIM_MODES = ("words", "level", "off")
MAX_TAIL_BUFFER_CHARS = 40


def parse_stitch(raw) -> dict:
    """Request stitch options over the defaults; raises ValueError naming the bad field."""
    if raw is None:
        return dict(STITCH_DEFAULTS)
    if not isinstance(raw, dict):
        raise ValueError("stitch must be an object")
    unknown = set(raw) - set(STITCH_DEFAULTS)
    if unknown:
        raise ValueError(f"stitch has unknown fields: {sorted(unknown)}")
    out = dict(STITCH_DEFAULTS)
    for key, value in raw.items():
        if value is None:
            continue
        if key in STITCH_RANGES:
            low, high = STITCH_RANGES[key]
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not low <= value <= high:
                raise ValueError(f"stitch.{key} must be a number from {low} to {high}")
            out[key] = float(value)
        elif key == "trim":
            if value not in TRIM_MODES:
                raise ValueError(f"stitch.trim must be one of {TRIM_MODES}")
            out[key] = value
        elif key == "tailBuffer":
            if not isinstance(value, str) or len(value) > MAX_TAIL_BUFFER_CHARS:
                raise ValueError(f"stitch.tailBuffer must be text of at most {MAX_TAIL_BUFFER_CHARS} characters")
            out[key] = value.strip()
    return out


def buffer_has_words(buffer: str) -> bool:
    return any(c.isalpha() for c in buffer)


def with_tail_buffer(text: str, buffer: str) -> str:
    """Text plus the runway the model reads past the last real word: words after a space, bare
    punctuation glued on."""
    if not buffer:
        return text
    return f"{text} {buffer}" if buffer_has_words(buffer) else f"{text}{buffer}"


def level_bounds(wav, sample_rate: int, threshold_db: float, lead: float, tail: float) -> tuple:
    """(start, end) in seconds of the audio above threshold_db, widened by lead and tail."""
    import numpy as np

    audio = np.abs(wav.squeeze(0).numpy())
    loud = np.nonzero(audio > 10 ** (threshold_db / 20))[0]
    duration = len(audio) / sample_rate
    if len(loud) == 0:
        return 0.0, duration
    return max(0.0, loud[0] / sample_rate - lead), min(duration, loud[-1] / sample_rate + tail)


def fade(wav, sample_rate: int, in_ms: float, out_ms: float):
    """Linear fade in and out at a clip's edges, so a cut never clicks."""
    import torch

    out = wav.clone()
    size = out.shape[1]
    fade_in = min(int(in_ms / 1000 * sample_rate), size // 2)
    fade_out = min(int(out_ms / 1000 * sample_rate), size // 2)
    if fade_in > 0:
        out[0, :fade_in] *= torch.linspace(0.0, 1.0, fade_in)
    if fade_out > 0:
        out[0, -fade_out:] *= torch.linspace(1.0, 0.0, fade_out)
    return out


def pause_before(take: int, groups: list, part_count: int, stitch: dict) -> float:
    """Silence wanted between the last word of take-1 and the first word of take: edgePause right
    after the hook and right before the outro, pause everywhere else."""
    edge = stitch["edgePause"] if stitch["edgePause"] is not None else stitch["pause"]
    at_edge = groups[take - 1][-1] == 0 or groups[take][0] == part_count - 1
    return edge if at_edge else stitch["pause"]
