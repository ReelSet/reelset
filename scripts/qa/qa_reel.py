#!/usr/bin/env python3
"""Reel QA gate: plan vs render, from a job's props.json and its rendered mp4.

    python3 scripts/qa/qa_reel.py video.mp4 props.json --out qa/

Writes <out>/timeline.json (the planned cuts: scene starts and resolved shots), runs qa_video.py
against it, then adds the reel gates: average gap between visual changes <= 2.5 s with none
> 4 s (planned and detected), caption pages changing at least every 1 s, no frozen stretch over
3 s, no flat frames, loudness -14 LUFS +/-1 with true peak <= -1 dBTP. Exit 1 on any FAIL."""

import argparse
import json
import subprocess
import sys
from pathlib import Path

AVG_GAP_MAX = 2.5
GAP_MAX = 4.0
CAPTION_PAGE_MAX = 1.0
CAPTION_WORDS_PER_PAGE = 3
FREEZE_FAIL = 3.0
CUT_CLUSTER = 0.3
LUFS_TOL = 1.0
TP_MAX = -1.0


def planned_changes(props: dict, extra_shots: list) -> list:
    times = [float(s["start"]) for s in props["scenes"][1:]]
    for scene in props["scenes"]:
        times += [float(x["t"]) for x in scene.get("shots", []) if "t" in x]
    times += [float(x["t"]) for x in extra_shots if isinstance(x.get("t"), (int, float))]
    return sorted({round(t, 3) for t in times})


def cluster(times: list, gap: float = CUT_CLUSTER) -> list:
    out: list = []
    for t in sorted(times):
        if not out or t - out[-1] > gap:
            out.append(t)
    return out


def gaps(changes: list, duration: float) -> list:
    edges = [0.0, *changes, duration]
    return [round(b - a, 3) for a, b in zip(edges, edges[1:])]


def caption_pages(words: list) -> list:
    """Approximate page durations: pages of up to 3 words, broken early on sentence ends."""
    pages, current = [], []
    for w in words:
        current.append(w)
        if len(current) >= CAPTION_WORDS_PER_PAGE or w["text"].rstrip().endswith((".", "?", "!")):
            pages.append(current)
            current = []
    if current:
        pages.append(current)
    return [round(p[-1]["end"] - p[0]["start"], 3) for p in pages]


def check(level: str, name: str, detail: str) -> dict:
    return {"level": level, "check": name, "detail": detail}


def cadence_checks(label: str, changes: list, duration: float) -> list:
    g = gaps(changes, duration)
    avg = sum(g) / len(g)
    longest = max(g)
    out = [
        check(
            "PASS" if avg <= AVG_GAP_MAX else "FAIL",
            f"{label} cadence",
            f"{len(changes)} changes, average shot {avg:.2f}s (<= {AVG_GAP_MAX})",
        ),
        check(
            "PASS" if longest <= GAP_MAX else "FAIL",
            f"{label} longest hold",
            f"{longest:.2f}s (<= {GAP_MAX})",
        ),
    ]
    return out


def reel_checks(report: dict, props: dict, planned: list) -> list:
    duration = float(props["durationSeconds"])
    out = cadence_checks("planned", planned, duration)
    detected = cluster(report["picture"]["cuts"])
    out += cadence_checks("detected", detected, duration)
    pages = caption_pages(props["words"])
    slow = [p for p in pages if p > CAPTION_PAGE_MAX]
    out.append(
        check(
            "PASS" if len(slow) <= max(1, len(pages) // 10) else "WARN",
            "caption pages",
            f"{len(pages)} pages, {len(slow)} longer than {CAPTION_PAGE_MAX}s",
        )
    )
    long_freeze = [f for f in report["picture"]["frozen"] if f["secs"] > FREEZE_FAIL]
    out.append(
        check(
            "FAIL" if long_freeze else "PASS",
            "frozen stretches",
            f"{[(f['from'], f['to']) for f in long_freeze] or 'none over ' + str(FREEZE_FAIL) + 's'}",
        )
    )
    flat = report["picture"]["flat"]
    out.append(check("FAIL" if flat else "PASS", "flat frames", str(flat or "none")))
    audio = report["audio"]
    if audio.get("lufs") is None:
        out.append(check("FAIL", "audio", "no audio stream"))
    else:
        ok = abs(audio["lufs"] - (-14.0)) <= LUFS_TOL and audio["true_peak"] <= TP_MAX
        out.append(
            check(
                "PASS" if ok else "FAIL",
                "mastering",
                f"{audio['lufs']} LUFS (-14 +/-{LUFS_TOL}), true peak {audio['true_peak']} dBTP "
                f"(<= {TP_MAX})",
            )
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video")
    ap.add_argument("props")
    ap.add_argument("--out", default="qa")
    args = ap.parse_args()
    props = json.loads(Path(args.props).read_text(encoding="utf-8"))
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    sibling = Path(args.props).with_name("timeline.json")
    extra = []
    if sibling.exists():
        extra = json.loads(sibling.read_text(encoding="utf-8")).get("shots", [])
    planned = planned_changes(props, extra)
    if extra:
        planned = sorted({round(float(x["t"]), 3) for x in extra if float(x.get("t", 0)) > 0.05})
    timeline = {
        "scenes": [{"id": f"s{i}", "start": s["start"]} for i, s in enumerate(props["scenes"])],
        "cuts": planned,
        "meta": {"clock": "voice", "dur": props["durationSeconds"]},
    }
    (out / "timeline.json").write_text(json.dumps(timeline), encoding="utf-8")
    base = Path(__file__).with_name("qa_video.py")
    proc = subprocess.run(
        [sys.executable, str(base), args.video, "--out", str(out), "--beats", str(out / "timeline.json")],
        capture_output=True,
        text=True,
    )
    if proc.returncode == 2 or not (out / "report.json").exists():
        print(proc.stdout, proc.stderr, file=sys.stderr)
        return 2
    report = json.loads((out / "report.json").read_text(encoding="utf-8"))
    checks = reel_checks(report, props, planned)
    lines = ["# Reel QA", "", "| level | check | detail |", "|---|---|---|"]
    lines += [f"| {c['level']} | {c['check']} | {c['detail']} |" for c in checks]
    other = [c for c in report["checks"] if c["check"] in ("frame 0", "cuts vs plan", "hook")]
    lines += ["", "qa_video:", *[f"- {c['level']} {c['check']}: {c['detail']}" for c in other]]
    lines += ["", f"Sheets in {out}: beats_sheet.jpg, phone_sheet.jpg, hook_sheet.jpg (look at them)."]
    (out / "reel_report.md").write_text("\n".join(lines), encoding="utf-8")
    (out / "reel_report.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
    print("\n".join(lines))
    return 1 if any(c["level"] == "FAIL" for c in checks) else 0


if __name__ == "__main__":
    sys.exit(main())
