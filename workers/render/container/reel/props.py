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
) -> dict:
    """Composition props. `assets` maps role -> file name inside the job's assets dir:
    illustration, cover, audio, and images {script url: file name}."""
    scenes = [{"kind": "hook", "start": spans[0][0], "end": spans[0][1], "text": req.hook}]
    for beat, (start, end) in zip(req.beats, spans[1:-1]):
        visual = dict(beat.visual)
        if visual["type"] == "image":
            visual = {"type": "image"}
            file = assets.get("images", {}).get(beat.visual["url"])
            if file:
                visual["file"] = file
        scenes.append(
            {"kind": "beat", "start": start, "end": end, "text": beat.text, "visual": visual}
        )
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
    for role in ("illustration", "cover"):
        if assets.get(role):
            props[role] = f"job/{assets[role]}"
    for scene in props["scenes"]:
        file = scene.get("visual", {}).get("file")
        if file:
            scene["visual"]["file"] = f"job/{file}"
    return props


def _round_scene(scene: dict) -> dict:
    return {**scene, "start": round(scene["start"], 3), "end": round(scene["end"], 3)}


def _word(w: Word) -> dict:
    return {"text": w.text, "start": round(w.start, 3), "end": round(w.end, 3)}


def poster_second(spans: list) -> float:
    """Frame for the poster: late enough that the hook text has landed, inside the hook scene."""
    return max(0.5, min(8.0, spans[0][1] - 0.15))
