"""The box side of the render director: hands the config to the Skia orchestrator and reads its result back."""
import json
import logging
import os

log = logging.getLogger("reel.director")

CONFIG_FILE = "director.json"
RESULT_FILE = "director-result.json"
RESULT_FIELDS = (
    "used", "model", "scenes", "sceneErrors", "fallbackReason",
    "inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens", "ms",
)  # fmt: skip


def write_config(job_dir: str, config: dict) -> None:
    with open(os.path.join(job_dir, CONFIG_FILE), "w", encoding="utf-8") as fh:
        json.dump(config, fh)


def read_result(job_dir: str, config: dict) -> dict:
    """The director metadata for the render response; a missing or unreadable result counts as a render error."""
    path = os.path.join(job_dir, RESULT_FILE)
    try:
        with open(path, encoding="utf-8") as fh:
            raw = json.load(fh)
        if isinstance(raw, dict) and all(k in raw for k in RESULT_FIELDS):
            return {k: raw[k] for k in RESULT_FIELDS}
        log.warning("director result is malformed: %s", path)
    except (OSError, ValueError):
        log.warning("director result is missing: %s", path)
    return {
        "used": False, "model": config["model"], "scenes": 0, "sceneErrors": 0,
        "fallbackReason": "crash", "inputTokens": 0, "outputTokens": 0,
        "cacheReadTokens": 0, "cacheWriteTokens": 0, "ms": 0,
    }  # fmt: skip
