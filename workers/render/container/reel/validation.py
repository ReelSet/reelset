import base64
import json
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
# Keep in sync with skia/src/planner/lib/types.ts (SCREEN_NAMES, SFX_NAMES).
SCREEN_NAMES = (
    "RepoPage", "Terminal", "CodeBlock", "StatSlam", "BarRace", "HNThread", "RedditPost",
    "YouTubePlayer", "PaperPage", "FigureZoom", "TableScreen", "EquationScreen", "ArticleHeadline", "ImageFull", "KeyPoint",
    "Compare", "EndCard", "RepoDemo",
)  # fmt: skip
MAX_HEADLINE_WORDS = 7
SFX_NAMES = ("whoosh", "pop", "tick", "ding", "hit", "riser", "swoosh")
CUE_RE = re.compile(r"^[^\s#]{1,40}(#[1-9])?$")
MAX_SHOTS_PER_BEAT = 6
MAX_BROLL = 20
DEMO_KINDS = ("gif", "mp4", "webm")


MAX_KEY_POINTS = 2
MAX_KEY_POINT_CHARS = 70


def _validate_key_points(raw) -> list:
    """Optional fallback statements for a beat; invalid entries are dropped, never fatal."""
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        if isinstance(item, str) and 3 <= len(item.strip()) <= MAX_KEY_POINT_CHARS:
            out.append(" ".join(item.split()))
    return out[:MAX_KEY_POINTS]


@dataclass(frozen=True)
class Beat:
    text: str
    visual: dict
    shots: list = field(default_factory=list)
    key_points: list = field(default_factory=list)


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
    tts_engine: str = "edge"
    headline: str = ""
    facts: dict = field(default_factory=dict)
    broll: list = field(default_factory=list)
    demo: dict | None = None
    claims: list = field(default_factory=list)
    director: dict | None = None

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


def _validate_shots(raw) -> list:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_SHOTS_PER_BEAT:
        _bad(f"shots must be a list of at most {MAX_SHOTS_PER_BEAT}")
    shots = []
    for item in raw:
        if not isinstance(item, dict):
            _bad("shot must be an object")
        at = item.get("at")
        if not isinstance(at, str) or not CUE_RE.match(at):
            _bad("shot.at must be a word cue like 'word' or 'word#2'")
        if item.get("show") not in SCREEN_NAMES:
            _bad("shot.show is not supported")
        shot = {"at": at, "show": item["show"]}
        shot_props = item.get("props")
        if shot_props is not None:
            ok = isinstance(shot_props, dict) and len(shot_props) <= 12 and all(
                isinstance(k, str) and len(k) <= 32 and _prop_value_ok(v)
                for k, v in shot_props.items()
            )
            if not ok:
                _bad("shot.props must map short keys to strings, numbers or string lists")
            shot["props"] = shot_props
        sfx = item.get("sfx")
        if sfx is not None:
            if sfx not in SFX_NAMES:
                _bad("shot.sfx is not supported")
            shot["sfx"] = sfx
        shots.append(shot)
    return shots


def _prop_value_ok(v, depth: int = 0) -> bool:
    if isinstance(v, bool) or depth > 2:
        return False
    if isinstance(v, str):
        return len(v) <= 400
    if isinstance(v, (int, float)):
        return True
    if isinstance(v, list):
        return len(v) <= 8 and all(_prop_value_ok(x, depth + 1) for x in v)
    if isinstance(v, dict):
        return len(v) <= 6 and all(
            isinstance(k, str) and len(k) <= 32 and _prop_value_ok(x, depth + 1) for k, x in v.items()
        )
    return False


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


def _clean(value, kind, limit=300):
    if kind == "str":
        return value.strip()[:limit] if isinstance(value, str) and value.strip() else None
    if kind == "int":
        ok = isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value < 1e10
        return int(value) if ok else None
    return None


FACT_FIELDS = {
    "repo": {"owner": "str", "name": "str", "description": "str", "stars": "int", "forks": "int", "language": "str", "latestRelease": "str"},
    "hn": {"points": "int", "comments": "int", "author": "str", "topComment": "str"},
    "reddit": {"subreddit": "str", "upvotes": "int", "comments": "int", "author": "str", "text": "str", "topComment": "str"},
    "youtube": {"channel": "str", "views": "int", "duration": "str"},
    "paper": {"abstract": "str", "upvotes": "int"},
    "article": {"site": "str", "author": "str"},
}  # fmt: skip


def _validate_facts(raw) -> dict:
    """Optional real item metadata for count-ups and headers. Unknown or malformed fields are dropped."""
    if not isinstance(raw, dict):
        return {}
    out: dict = {}
    for group, fields in FACT_FIELDS.items():
        src = raw.get(group)
        if not isinstance(src, dict):
            continue
        clean = {}
        for key, kind in fields.items():
            value = _clean(src.get(key), kind, 600 if key in ("abstract", "topComment", "text") else 300)
            if value is not None:
                clean[key] = value
        if group == "repo":
            langs = src.get("languages")
            if isinstance(langs, list):
                parsed = [
                    {"name": l["name"][:30], "pct": float(l["pct"])}
                    for l in langs[:6]
                    if isinstance(l, dict) and isinstance(l.get("name"), str)
                    and isinstance(l.get("pct"), (int, float)) and 0 <= l["pct"] <= 100
                ]  # fmt: skip
                if parsed:
                    clean["languages"] = parsed
            topics = src.get("topics")
            if isinstance(topics, list):
                kept = [t[:40] for t in topics[:8] if isinstance(t, str) and t.strip()]
                if kept:
                    clean["topics"] = kept
        if group == "paper":
            authors = src.get("authors")
            if isinstance(authors, list):
                kept = [a[:60] for a in authors[:8] if isinstance(a, str) and a.strip()]
                if kept:
                    clean["authors"] = kept
        if clean:
            out[group] = clean
    return out


def validate_render_request(payload) -> RenderRequest:
    if not isinstance(payload, dict):
        _bad("body must be a JSON object")

    job_id = payload.get("jobId")
    if not isinstance(job_id, str) or not JOB_ID_RE.match(job_id):
        _bad("jobId must match [A-Za-z0-9_-]{8,80}")

    voice = payload.get("voice", "en-US-AriaNeural")
    if not isinstance(voice, str) or not VOICE_RE.match(voice):
        _bad("voice is invalid")

    tts_engine = payload.get("ttsEngine", "edge")
    if tts_engine not in ("edge", "kokoro"):
        _bad("ttsEngine must be edge or kokoro")

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
        beats.append(
            Beat(
                text=_text(raw, "text", 220),
                visual=_validate_visual(raw.get("visual")),
                shots=_validate_shots(raw.get("shots")),
                key_points=_validate_key_points(raw.get("keyPoints")),
            )
        )

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
        tts_engine=tts_engine,
        headline=" ".join(_text(script, "headline", 80, required=False).split()[:MAX_HEADLINE_WORDS]),
        facts=_validate_facts(payload.get("facts")),
        broll=_validate_broll(payload.get("broll")),
        demo=_validate_demo(payload.get("demo")),
        claims=_validate_claims(script.get("claims")),
        director=_validate_director(payload.get("director")),
    )


DIRECTOR_EFFORTS = ("low", "medium", "high", "xhigh", "max")
DIRECTOR_MODEL_RE = re.compile(r"^[A-Za-z0-9._:-]{1,100}$")
DIRECTOR_MIN_TOKENS = 1024
DIRECTOR_MAX_TOKENS = 128000
DIRECTOR_MAX_RULES_CHARS = 20000
DIRECTOR_MAX_REVIEW_PROMPT_CHARS = 6000
DIRECTOR_MAX_SKILLS = 24
DIRECTOR_MAX_SKILL_NAME_CHARS = 100
DIRECTOR_MAX_SKILLS_CHARS = 600000
DIRECTOR_MAX_EXAMPLE_CHARS = 200000


def _director_str(raw: dict, key: str, max_len: int) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or len(value) > max_len:
        _bad(f"director.{key} must be a string of at most {max_len} characters")
    return value


def _validate_director_skills(raw) -> list:
    if not isinstance(raw, list) or len(raw) > DIRECTOR_MAX_SKILLS:
        _bad(f"director.skills must be a list of at most {DIRECTOR_MAX_SKILLS}")
    skills = []
    total = 0
    for item in raw:
        if not isinstance(item, dict):
            _bad("director.skills entries must be objects")
        name = item.get("name")
        content = item.get("content")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= DIRECTOR_MAX_SKILL_NAME_CHARS:
            _bad("director.skills[].name must be a short non-empty string")
        if not isinstance(content, str):
            _bad("director.skills[].content must be a string")
        total += len(content)
        skills.append({"name": name.strip(), "content": content})
    if total > DIRECTOR_MAX_SKILLS_CHARS:
        _bad(f"director.skills exceed {DIRECTOR_MAX_SKILLS_CHARS} characters in total")
    return skills


def _validate_director(raw) -> dict | None:
    """Optional model-director config: the box lets the model write the reel's scenes. Absent means the generic renderer."""
    if raw is None:
        return None
    if not isinstance(raw, dict):
        _bad("director must be an object")
    model = raw.get("model")
    if not isinstance(model, str) or not DIRECTOR_MODEL_RE.match(model):
        _bad("director.model is invalid")
    if raw.get("effort") not in DIRECTOR_EFFORTS:
        _bad("director.effort is not supported")
    max_tokens = raw.get("maxTokens")
    if (
        isinstance(max_tokens, bool)
        or not isinstance(max_tokens, int)
        or not DIRECTOR_MIN_TOKENS <= max_tokens <= DIRECTOR_MAX_TOKENS
    ):
        _bad(f"director.maxTokens must be an integer from {DIRECTOR_MIN_TOKENS} to {DIRECTOR_MAX_TOKENS}")
    if not isinstance(raw.get("review"), bool):
        _bad("director.review must be a boolean")
    example = raw.get("example")
    if example is not None:
        example = _director_str(raw, "example", DIRECTOR_MAX_EXAMPLE_CHARS)
    return {
        "model": model,
        "effort": raw["effort"],
        "maxTokens": max_tokens,
        "review": raw["review"],
        "rules": _director_str(raw, "rules", DIRECTOR_MAX_RULES_CHARS),
        "reviewPrompt": _director_str(raw, "reviewPrompt", DIRECTOR_MAX_REVIEW_PROMPT_CHARS),
        "skills": _validate_director_skills(raw.get("skills")),
        "example": example or None,
    }


MAX_CLAIMS = 12


def _validate_claims(raw) -> list:
    """The script's sourced claims, text only: the composition words key points and grounds stat labels with them."""
    if not isinstance(raw, list):
        return []
    out = []
    for claim in raw[:MAX_CLAIMS]:
        text = claim.get("text") if isinstance(claim, dict) else claim
        if isinstance(text, str) and text.strip():
            out.append(" ".join(text.split())[:300])
    return out


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
        caption = raw.get("caption")
        if isinstance(caption, str) and caption.strip():
            entry["caption"] = caption.strip()[:60]
        focus = raw.get("focus")
        if isinstance(focus, dict) and all(
            isinstance(focus.get(k), (int, float)) and not isinstance(focus.get(k), bool) and 0 <= focus[k] <= 1
            for k in ("x", "y")
        ):
            entry["focus"] = {"x": float(focus["x"]), "y": float(focus["y"])}
        out.append(entry)
    return out


def _https_url(value, what: str) -> str:
    if not isinstance(value, str) or len(value) > 2048 or not value.startswith("https://"):
        _bad(f"{what} must be an https url")
    return value


def _validate_broll(value) -> list:
    """Optional stock clips chosen by the worker: [{url, id?, beat?, seconds?, creator?, creatorUrl?, pageUrl?}]."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_BROLL:
        _bad(f"broll must be a list of at most {MAX_BROLL}")
    out = []
    for raw in value:
        if not isinstance(raw, dict):
            _bad("broll entry must be an object")
        entry = {"url": _https_url(raw.get("url"), "broll.url")}
        clip_id = raw.get("id")
        if isinstance(clip_id, int) and not isinstance(clip_id, bool) and clip_id > 0:
            entry["id"] = clip_id
        beat = raw.get("beat")
        if isinstance(beat, int) and not isinstance(beat, bool) and 0 <= beat <= 20:
            entry["beat"] = beat
        seconds = raw.get("seconds")
        if isinstance(seconds, (int, float)) and not isinstance(seconds, bool) and 1 <= seconds <= 30:
            entry["seconds"] = float(seconds)
        for key in ("creator", "creatorUrl", "pageUrl"):
            text = raw.get(key)
            if isinstance(text, str) and text.strip():
                entry[key] = text.strip()[:200 if key == "creator" else 500]
        out.append(entry)
    return out


def _validate_demo(value) -> dict | None:
    """Optional README demo media: {url, kind: gif|mp4|webm, repo}."""
    if value is None:
        return None
    if not isinstance(value, dict):
        _bad("demo must be an object")
    kind = value.get("kind")
    if kind not in DEMO_KINDS:
        _bad("demo.kind is not supported")
    repo = value.get("repo")
    if not isinstance(repo, str) or not re.match(r"^[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}$", repo):
        _bad("demo.repo must be owner/name")
    return {"url": _https_url(value.get("url"), "demo.url"), "kind": kind, "repo": repo}


def validate_video_id(payload) -> str:
    if not isinstance(payload, dict):
        _bad("body must be a JSON object")
    video_id = payload.get("videoId")
    if not isinstance(video_id, str) or not VIDEO_ID_RE.match(video_id):
        _bad("videoId must be 11 characters of [A-Za-z0-9_-]")
    return video_id
