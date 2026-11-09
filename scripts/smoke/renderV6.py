"""Render a v6 sample through the production pipeline (real images, Remotion, ffmpeg) with silent
stand-in narration. Usage: renderV6.py <payload.json> <out_dir>"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "workers", "render", "container"))
from reel import pipeline, timing  # noqa: E402
from reel.validation import validate_render_request  # noqa: E402


def synth(text, voice, rate, audio_path):
    words = text.split()
    seconds = len(words) / 4.0
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
         "anullsrc=r=24000:cl=mono", "-t", f"{seconds:.2f}", "-c:a", "libmp3lame", audio_path],
        check=True,
    )
    return timing.estimate_word_timings(text, seconds)


payload = json.load(open(sys.argv[1]))
job_dir = sys.argv[2]
os.makedirs(job_dir, exist_ok=True)
req = validate_render_request(payload)
print(json.dumps(pipeline.run_render(req, job_dir, synth=synth)))
