import json
import logging
import os
import subprocess
import zlib

from .cues import resolve_shots
from .errors import RenderError
from .video import run_ffmpeg

log = logging.getLogger("reel.mix")

AUDIO_DIR = os.environ.get("REEL_AUDIO_DIR", os.path.join(os.path.dirname(__file__), "..", "audio"))
SAMPLE_RATE = 48000
VOICE_LUFS = -16.0
BED_TRIM_DB = 2.0
TARGET_LUFS = -14.0
TARGET_TP = -1.5
MAX_CUES = 40
MIN_SAME_GAP = 0.2
RISER_SECONDS = 1.3
HEADLINE_POP_AT = 0.15
BED_VARIANTS = 4
SFX_GAIN_DB = {
    "whoosh": -7.0, "pop": -6.0, "tick": -9.0, "ding": -8.0, "hit": -4.0, "riser": -10.0,
    "swoosh": -9.0,
}  # fmt: skip
DUCK = "sidechaincompress=threshold=0.04:ratio=3.5:attack=20:release=400:makeup=1"


def bed_variant(seed: str) -> int:
    return zlib.crc32(seed.encode()) % BED_VARIANTS


def pick_bed(seed: str, audio_dir: str = AUDIO_DIR) -> int:
    """Stable variant for the seed; walks to the next variant on disk if that file is missing."""
    first = bed_variant(seed)
    for k in range(BED_VARIANTS):
        variant = (first + k) % BED_VARIANTS
        if os.path.exists(os.path.join(audio_dir, "music", f"bed{variant}.m4a")):
            return variant
    raise RenderError("ffmpeg_failed", "no music bed files found")


def plan_sfx(spans: list, shots: list, has_headline: bool, timeline_shots: list | None = None) -> list:
    """SFX cues [{t, name}] sorted by time. A whoosh lands on every cut (beat starts and shots,
    unless the shot names its own sfx), a pop on the headline card, and a riser leads into a ding
    reveal. Same-name cues closer than 0.2 s collapse, and the total is capped."""
    cues = []
    if has_headline:
        cues.append({"t": HEADLINE_POP_AT, "name": "pop"})
    for start, _ in spans[1:-1]:
        cues.append({"t": start, "name": "whoosh"})
    for shot in [*shots, *(timeline_shots or [])]:
        t = shot.get("t")
        if not isinstance(t, (int, float)) or t < 0:
            continue
        name = shot.get("sfx") or "whoosh"
        if name == "ding" and t >= RISER_SECONDS + 0.2:
            cues.append({"t": t - RISER_SECONDS, "name": "riser"})
        cues.append({"t": float(t), "name": name})
    cues.sort(key=lambda c: (c["t"], c["name"]))
    kept: list = []
    for cue in cues:
        clash = any(
            k["name"] == cue["name"] and cue["t"] - k["t"] < MIN_SAME_GAP for k in kept[-6:]
        )
        near_whoosh = cue["name"] == "whoosh" and any(
            k["name"] != "riser" and abs(k["t"] - cue["t"]) < 0.12 for k in kept[-4:]
        )
        if clash or near_whoosh:
            continue
        kept.append({"t": round(cue["t"], 3), "name": cue["name"]})
    return kept[:MAX_CUES]


def load_timeline_shots(job_dir: str) -> list:
    """Optional <job>/timeline.json written by the composition: {"shots": [{"t", "sfx"?}]}."""
    path = os.path.join(job_dir, "timeline.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        return [s for s in data.get("shots", []) if isinstance(s, dict)]
    except (OSError, ValueError, AttributeError):
        return []


def build_filter(cues: list, duration: float) -> str:
    parts = [
        f"[0:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,"
        f"loudnorm=I={VOICE_LUFS}:TP=-2:LRA=11,asplit=2[vo][sc]",
        f"[1:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,"
        f"volume={BED_TRIM_DB}dB,atrim=0:{duration:.3f}[bedraw]",
        f"[bedraw][sc]{DUCK}[bed]",
    ]
    labels = ["[vo]", "[bed]"]
    for i, cue in enumerate(cues):
        ms = max(0, int(cue["t"] * 1000))
        gain = SFX_GAIN_DB[cue["name"]]
        parts.append(
            f"[{i + 2}:a]aresample={SAMPLE_RATE},aformat=channel_layouts=stereo,"
            f"volume={gain}dB,adelay={ms}|{ms}[s{i}]"
        )
        labels.append(f"[s{i}]")
    parts.append(
        f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=longest,"
        f"atrim=0:{duration:.3f},asetpts=PTS-STARTPTS[mix]"
    )
    return ";".join(parts)


def build_mix_cmd(
    narration: str, bed: str, cues: list, duration: float, out_wav: str, audio_dir: str = AUDIO_DIR
) -> list:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", narration]
    cmd += ["-stream_loop", "-1", "-t", f"{duration:.3f}", "-i", bed]
    for cue in cues:
        cmd += ["-i", os.path.join(audio_dir, "sfx", f"{cue['name']}.wav")]
    cmd += ["-filter_complex", build_filter(cues, duration), "-map", "[mix]", "-ar", str(SAMPLE_RATE)]
    cmd += ["-c:a", "pcm_s16le", out_wav]
    return cmd


def parse_loudnorm_json(stderr: str) -> dict:
    start = stderr.rfind("{")
    end = stderr.rfind("}")
    if start < 0 or end < start:
        raise RenderError("ffmpeg_failed", "loudnorm measurement missing")
    data = json.loads(stderr[start : end + 1])
    return {k: float(data[k]) for k in ("input_i", "input_tp", "input_lra", "input_thresh", "target_offset")}


def build_master_cmd(mix_wav: str, measured: dict, out_m4a: str) -> list:
    af = (
        f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=11:measured_I={measured['input_i']}:"
        f"measured_TP={measured['input_tp']}:measured_LRA={measured['input_lra']}:"
        f"measured_thresh={measured['input_thresh']}:offset={measured['target_offset']}:"
        f"linear=true,alimiter=limit=0.85:level=disabled"
    )
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", mix_wav,
        "-af", af, "-ar", str(SAMPLE_RATE), "-c:a", "aac", "-b:a", "128k", out_m4a,
    ]  # fmt: skip


def build_mux_cmd(video_in: str, audio_in: str, out: str) -> list:
    return [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video_in, "-i", audio_in,
        "-map", "0:v:0", "-map", "1:a:0", "-c", "copy", "-shortest", "-movflags", "+faststart", out,
    ]  # fmt: skip


def measure_loudnorm(mix_wav: str) -> dict:
    cmd = [
        "ffmpeg", "-hide_banner", "-nostats", "-i", mix_wav,
        "-af", f"loudnorm=I={TARGET_LUFS}:TP={TARGET_TP}:LRA=11:print_format=json", "-f", "null", "-",
    ]  # fmt: skip
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.SubprocessError) as err:
        raise RenderError("ffmpeg_failed", f"loudnorm measure failed: {err}") from err
    if proc.returncode != 0:
        raise RenderError("ffmpeg_failed", "loudnorm measure failed")
    return parse_loudnorm_json(proc.stderr)


def mix_and_mux(
    job_dir: str,
    narration: str,
    video_in: str,
    video_out: str,
    cues: list,
    duration: float,
    seed: str,
) -> dict:
    """Narration + ducked music bed + SFX cues, mastered to -14 LUFS / -1 dBTP, muxed over the
    silent-or-voice-only render. Raises RenderError so callers may fall back to the plain remux."""
    variant = pick_bed(seed)
    bed = os.path.join(AUDIO_DIR, "music", f"bed{variant}.m4a")
    mix_wav = os.path.join(job_dir, "mix.wav")
    master = os.path.join(job_dir, "master.m4a")
    try:
        run_ffmpeg(build_mix_cmd(narration, bed, cues, duration, mix_wav), job_dir)
        measured = measure_loudnorm(mix_wav)
        run_ffmpeg(build_master_cmd(mix_wav, measured, master), job_dir)
        run_ffmpeg(build_mux_cmd(video_in, master, video_out), job_dir)
    finally:
        for path in (mix_wav, master):
            if os.path.exists(path):
                os.remove(path)
    log.info("mix ok cues=%d bed=bed%d input_lufs=%.1f", len(cues), variant, measured["input_i"])
    return {
        "cues": len(cues),
        "bed": os.path.basename(bed),
        "bedVariant": variant,
        "mixLufs": measured["input_i"],
    }


__all__ = ["pick_bed", "plan_sfx", "resolve_shots", "mix_and_mux", "load_timeline_shots", "bed_variant"]
