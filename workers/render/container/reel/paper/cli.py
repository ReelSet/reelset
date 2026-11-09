"""Parse one paper locally: python -m reel.paper.cli <arxivId> <outDir> (used by the backfill script)."""

import base64
import json
import logging
import os
import sys

from . import service


def main(argv: list) -> int:
    if len(argv) != 3 or not service.valid_id(argv[1]):
        print("usage: python -m reel.paper.cli <arxivId> <outDir>", file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    result = service.parse_paper(argv[1])
    os.makedirs(argv[2], exist_ok=True)
    if result["status"] == "ok":
        for i, fig in enumerate(result["paper"]["figures"]):
            data = fig.pop("data", None)
            if data:
                name = f"fig-{i + 1}.{fig['ext']}"
                with open(os.path.join(argv[2], name), "wb") as fh:
                    fh.write(base64.b64decode(data))
                fig["file"] = name
    with open(os.path.join(argv[2], "result.json"), "w", encoding="utf8") as fh:
        json.dump(result, fh, ensure_ascii=False)
    return 0 if result["status"] == "ok" else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
