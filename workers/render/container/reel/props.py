from urllib.parse import urlparse

from .timing import Word
from .validation import RenderRequest

SOURCE_DOMAIN_LIMIT = 48


def display_domain(req: RenderRequest) -> str:
    """Short host/path label for the outro, e.g. github.com/owner/repo or example.com."""
    parsed = urlparse(req.canonical_url)
    host = (parsed.hostname or "").removeprefix("www.")
    if not host:
        return req.source_label.lower()
    if req.source == "github":
        label = host + parsed.path.rstrip("/")
    else:
        label = host
    return label if len(label) <= SOURCE_DOMAIN_LIMIT else label[: SOURCE_DOMAIN_LIMIT - 1] + "…"


def build_props(
    req: RenderRequest,
    words: list,
    spans: list,
    total_seconds: float,
    assets: dict,
    shots: list | None = None,
    sfx: list | None = None,
) -> dict:
    """Composition props. `assets` maps role -> file name inside the job's assets dir: cover
    (optional source card) and audio. All visuals are drawn by the composition."""
    scenes = [{"kind": "hook", "start": spans[0][0], "end": spans[0][1], "text": req.hook}]
    for beat, (start, end) in zip(req.beats, spans[1:-1]):
        visual = {"type": "image"} if beat.visual["type"] == "image" else dict(beat.visual)
        scene = {"kind": "beat", "start": start, "end": end, "text": beat.text, "visual": visual}
        in_beat = [s for s in shots or [] if start - 1e-6 <= s["t"] < end]
        if in_beat:
            scene["shots"] = in_beat
        scenes.append(scene)
    scenes.append({"kind": "outro", "start": spans[-1][0], "end": spans[-1][1], "text": req.outro})

    props = {
        "durationSeconds": total_seconds,
        "title": req.title,
        "source": req.source,
        "sourceLabel": req.source_label,
        "domain": display_domain(req),
        "scenes": [_round_scene(s) for s in scenes],
        "words": [_word(w) for w in words],
        "audio": f"job/{assets['audio']}",
    }
    if req.headline:
        props["headline"] = req.headline
    if sfx:
        props["sfx"] = sfx
    if req.facts:
        props["facts"] = req.facts
    if assets.get("cover"):
        props["cover"] = f"job/{assets['cover']}"
    if assets.get("images"):
        props["images"] = [_image(i) for i in assets["images"]]
    if assets.get("broll"):
        props["broll"] = [_clip(c) for c in assets["broll"]]
    if assets.get("demo"):
        d = assets["demo"]
        props["demo"] = {
            "src": f"job/{d['file']}", "seconds": round(d["seconds"], 2),
            "width": d["width"], "height": d["height"], "repo": d["repo"],
        }  # fmt: skip
    return props


def _clip(entry: dict) -> dict:
    out = {"src": f"job/{entry['file']}", "seconds": entry["seconds"],
           "width": entry["width"], "height": entry["height"]}  # fmt: skip
    for key in ("beat", "creator", "creatorUrl", "pageUrl"):
        if entry.get(key) is not None:
            out[key] = entry[key]
    return out


def _round_scene(scene: dict) -> dict:
    return {**scene, "start": round(scene["start"], 3), "end": round(scene["end"], 3)}


def _image(entry: dict) -> dict:
    out = {"src": f"job/{entry['file']}", "kind": entry["kind"]}
    for key in ("width", "height", "alt", "caption", "focus"):
        if entry.get(key):
            out[key] = entry[key]
    return out


def _word(w: Word) -> dict:
    return {"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3)}


def poster_second(spans: list) -> float:
    """Frame for the poster: late enough that the hook text has landed, inside the hook scene."""
    return max(0.5, min(8.0, spans[0][1] - 0.15))
