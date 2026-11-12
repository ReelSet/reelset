"""Render one payload through the real pipeline without HTTP: python tools/render_local.py payload.json out_dir

Needs node + `npm ci && npm run build` in skia/ (or the Docker image). Set CLAUDE_API_KEY and add a "director" block to the payload to try the model director.
"""
import json
import logging
import os
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
os.environ.setdefault("SKIA_DIR", os.path.join(HERE, "skia"))

from reel import pipeline, validation  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

payload_path, out_dir = sys.argv[1], sys.argv[2]
out_dir = os.path.abspath(out_dir)
os.makedirs(out_dir, exist_ok=True)
with open(payload_path) as fh:
    req = validation.validate_render_request(json.load(fh))
print(json.dumps(pipeline.run_render(req, out_dir), indent=1))
