import base64
import re
from dataclasses import dataclass, field

from .errors import RenderError
from .timing import Word

JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")
VOICE_RE = re.compile(r"^[A-Za-z0-9-]{5,60}$")
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
VISUAL_TYPES = ("title", "code", "stat", "quote", "image")
SOURCES = ("hn", "github", "news", "reddit", "youtube", "papers")
MAX_IMAGE_URLS = 10
MAX_SOURCE_IMAGES = 8
IMAGE_KINDS = ("og", "thumbnail", "figure", "screenshot", "avatar")


@dataclass(frozen=True)
class Beat:
    text: str
    visual: dict


@dataclass(frozen=True)
class RenderRequest:
    job_id: str
    hook: str
    beats: list
    outro: str
    title: str
    source_label: str
    image_urls: list = field(default_factory=list)
    voice: str = "en-US-AriaNeural"
    source: str = "news"
    canonical_url: str = ""
    source_image_urls: list = field(default_factory=list)
    images: list = field(default_factory=list)
    narration_audio: bytes | None = None
    narration_words: list = field(default_factory=list)

    def narration_segments(self) -> list:
        return [self.hook, *[b.text for b in self.beats], self.outro]

    def narration_text(self) -> str:
        return " ".join(self.narration_segments())


def _bad(message: str):
    raise RenderError("invalid_input", message)


def _text(obj: dict, key: str, max_len: int, *, required: bool = True) -> str:
    value = obj.get(key)
    if value is None and not required:
        return ""
    if not isinstance(value, str) or not value.strip():
        _bad(f"{key} must be a non-empty string")
    if len(value) > max_len:
        _bad(f"{key} exceeds {max_len} characters")
    return value


def _validate_visual(visual) -> dict:
    if not isinstance(visual, dict):
        _bad("visual must be an object")
    kind = visual.get("type")
    if kind not in VISUAL_TYPES:
        _bad("visual.type is not supported")
    if kind == "title":
        return {
            "type": kind,
            "title": _text(visual, "title", 90),
            "subtitle": _text(visual, "subtitle", 120, required=False),
        }
    if kind == "code":
        return {
            "type": kind,
            "language": _text(visual, "language", 24),
            "code": _text(visual, "code", 600),
        }
    if kind == "stat":
        return {"type": kind, "label": _text(visual, "label", 60), "value": _text(visual, "value", 24)}
    if kind == "quote":
        return {
            "type": kind,
            "text": _text(visual, "text", 220),
            "attribution": _text(visual, "attribution", 80),
        }
    return {"type": kind, "url": _text(visual, "url", 2048)}


def validate_render_request(payload) -> RenderRequest:
    if not isinstance(payload, dict):
        _bad("body must be a JSON object")

    job_id = payload.get("jobId")
    if not isinstance(job_id, str) or not JOB_ID_RE.match(job_id):
        _bad("jobId must match [A-Za-z0-9_-]{8,80}")

    voice = payload.get("voice", "en-US-AriaNeural")
    if not isinstance(voice, str) or not VOICE_RE.match(voice):
        _bad("voice is invalid")

    script = payload.get("script")
    if not isinstance(script, dict):
        _bad("script must be an object")
    beats_raw = script.get("beats")
    if not isinstance(beats_raw, list) or not 2 <= len(beats_raw) <= 6:
        _bad("script.beats must have 2 to 6 entries")
    beats = []
    for raw in beats_raw:
        if not isinstance(raw, dict):
            _bad("beat must be an object")
        beats.append(Beat(text=_text(raw, "text", 220), visual=_validate_visual(raw.get("visual"))))

    image_urls = payload.get("imageUrls", [])
    if not isinstance(image_urls, list) or len(image_urls) > MAX_IMAGE_URLS:
        _bad(f"imageUrls must be a list of at most {MAX_IMAGE_URLS}")
    if not all(isinstance(u, str) and len(u) <= 2048 for u in image_urls):
        _bad("imageUrls must contain strings")

    source = payload.get("source", "news")
    if source not in SOURCES:
        _bad("source is not supported")
    canonical_url = payload.get("canonicalUrl") or ""
    if not isinstance(canonical_url, str) or len(canonical_url) > 2048:
        _bad("canonicalUrl must be a string of at most 2048 characters")
    source_image_urls = payload.get("sourceImageUrls", [])
    if not isinstance(source_image_urls, list) or len(source_image_urls) > 4:
        _bad("sourceImageUrls must be a list of at most 4")
    if not all(isinstance(u, str) and len(u) <= 2048 for u in source_image_urls):
        _bad("sourceImageUrls must contain strings")

    narration_audio, narration_words = _validate_narration(payload.get("narration"))

    return RenderRequest(
        job_id=job_id,
        hook=_text(script, "hook", 120),
        beats=beats,
        outro=_text(script, "outro", 120),
        title=_text(payload, "title", 200),
        source_label=_text(payload, "sourceLabel", 40),
        image_urls=list(image_urls),
        voice=voice,
        source=source,
        canonical_url=canonical_url,
        source_image_urls=list(source_image_urls),
        images=_validate_images(payload.get("images")),
        narration_audio=narration_audio,
        narration_words=narration_words,
    )


def _validate_narration(raw) -> tuple:
    """Optional pre-synthesized narration: base64 mp3 plus word timings, so edge-tts is skipped."""
    if raw is None:
        return None, []
    if not isinstance(raw, dict):
        _bad("narration must be an object")
    try:
        audio = base64.b64decode(raw.get("audioBase64", ""), validate=True)
    except (ValueError, TypeError):
        _bad("narration.audioBase64 is not valid base64")
    if not audio:
        _bad("narration.audioBase64 is empty")
    raw_words = raw.get("words")
    if not isinstance(raw_words, list) or not raw_words or len(raw_words) > 1000:
        _bad("narration.words must be a list of 1 to 1000 words")
    words = []
    for w in raw_words:
        ok = (
            isinstance(w, dict)
            and isinstance(w.get("text"), str)
            and all(isinstance(w.get(k), (int, float)) and not isinstance(w.get(k), bool) for k in ("start", "end"))
            and 0 <= w["start"] <= w["end"] <= 600
        )
        if not ok:
            _bad("narration.words entries need text, start and end seconds")
        words.append(Word(w["text"], float(w["start"]), float(w["end"])))
    return audio, words


def _validate_images(value) -> list:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_SOURCE_IMAGES:
        _bad(f"images must be a list of at most {MAX_SOURCE_IMAGES}")
    out = []
    for raw in value:
        if not isinstance(raw, dict):
            _bad("image must be an object")
        url = raw.get("url")
        if not isinstance(url, str) or len(url) > 2048 or not url.startswith("https://"):
            _bad("image.url must be an https url")
        kind = raw.get("kind")
        if kind not in IMAGE_KINDS:
            _bad("image.kind is not supported")
        entry = {"url": url, "kind": kind}
        alt = raw.get("alt")
        if isinstance(alt, str) and alt.strip():
            entry["alt"] = alt.strip()[:300]
        out.append(entry)
    return out


def validate_video_id(payload) -> str:
    if not isinstance(payload, dict):
        _bad("body must be a JSON object")
    video_id = payload.get("videoId")
    if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
        _bad("videoId must be 11 characters of [A-Za-z0-9_-]")
    return video_id
