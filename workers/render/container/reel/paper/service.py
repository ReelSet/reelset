import base64
import logging
import re
import time
from typing import Callable, Optional

from . import eprint, latexml, net, pdf

log = logging.getLogger("reel.paper")

PARSER_VERSION = 1
ID_RE = re.compile(r"^(?:\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})(?:v\d+)?$")
HTML_MAX_BYTES = 12 * 1024 * 1024
PDF_MAX_BYTES = 40 * 1024 * 1024
EPRINT_MAX_BYTES = 60 * 1024 * 1024
MAX_FIGURE_PAYLOAD = 12 * 1024 * 1024
EPRINT_MIN_SECONDS = 25
FIGURES_KEPT = 8

Fetch = Callable[..., net.Fetched]


def valid_id(arxiv_id: str) -> bool:
    return bool(ID_RE.match(arxiv_id))


def base_id(arxiv_id: str) -> str:
    return re.sub(r"v\d+$", "", arxiv_id)


def apply_hires(figures: list, hires: dict) -> int:
    count = 0
    for idx, found in hires.items():
        if idx >= len(figures):
            continue
        fig = figures[idx]
        fig.update(
            data=found["data"], ext=found["ext"], width=found["width"], height=found["height"],
            hires=found["width"] >= eprint.MIN_HIRES_WIDTH, origin="eprint",
        )
        if not fig.get("caption"):
            fig["caption"] = found.get("caption", "")
        count += 1
    return count


def trim_figures(figures: list) -> list:
    """Keep hi-res ones first, in paper order, within a total byte budget."""
    ranked = sorted(range(len(figures)), key=lambda i: (not figures[i].get("data"), i))
    keep, total = set(), 0
    for i in ranked:
        size = len(figures[i].get("data") or b"")
        if len(keep) >= FIGURES_KEPT or total + size > MAX_FIGURE_PAYLOAD:
            continue
        keep.add(i)
        total += size
    return [figures[i] for i in sorted(keep)]


def compact_markdown(paper: dict, limit: int = 24000) -> str:
    parts = [f"# {paper.get('title', '')}".strip()]
    if paper.get("abstract"):
        parts.append(f"## Abstract\n{paper['abstract']}")
    for s in paper.get("sections", []):
        if s["kind"] in ("appendix", "abstract") or not s["markdown"]:
            continue
        parts.append(f"{'#' * min(s['level'] + 1, 4)} {s['heading']}\n{s['markdown']}")
    for t in paper.get("tables", [])[:6]:
        head = " | ".join(t["headers"])
        body = "\n".join("| " + " | ".join(r) + " |" for r in t["rows"][:25])
        parts.append(f"**{t.get('label') or 'Table'}**: {t.get('caption', '')}\n| {head} |\n|{'---|' * len(t['headers'])}\n{body}")
    return "\n\n".join(parts)[:limit]


def to_response(paper: dict, arxiv_id: str, source: str, stats: dict) -> dict:
    figures = trim_figures(paper["figures"])
    out_figs = []
    for f in figures:
        item = {k: v for k, v in f.items() if k != "data"}
        if f.get("data"):
            item["data"] = base64.b64encode(f["data"]).decode()
        out_figs.append(item)
    paper = {**paper, "figures": out_figs}
    paper.update(arxivId=arxiv_id, source=source, version=PARSER_VERSION)
    paper["markdown"] = compact_markdown(paper)
    stats.update(
        sections=len(paper["sections"]), tables=len(paper["tables"]), figures=len(out_figs),
        hires=sum(1 for f in out_figs if f.get("hires")), equations=len(paper["equations"]),
    )
    return {"status": "ok", "paper": paper, "stats": stats}


def parse_paper(arxiv_id: str, budget_seconds: float = 85.0, fetch: Optional[Fetch] = None) -> dict:
    """HTML structure + e-print hi-res figures; PDF only when no HTML; {'status': 'failed'} otherwise."""
    fetch = fetch or net.fetch
    started = time.monotonic()
    deadline = started + budget_seconds
    ident = base_id(arxiv_id)
    stats: dict = {"id": ident, "steps": []}

    def left() -> float:
        return deadline - time.monotonic()

    paper, source = None, "html"
    try:
        res = fetch(f"https://arxiv.org/html/{ident}", max_bytes=HTML_MAX_BYTES, timeout=30, accept="text/html")
        stats["steps"].append(f"html:{res.status}")
        if res.status == 200:
            paper = latexml.parse_arxiv_html(res.content.decode("utf-8", errors="replace"), res.url)
            if paper and not paper["sections"]:
                paper = None
    except Exception as err:
        stats["steps"].append(f"html:error:{type(err).__name__}")
        log.warning("html fetch/parse failed for %s: %s", ident, err)

    archive_bytes: Optional[bytes] = None
    if paper and paper["figures"] and left() > EPRINT_MIN_SECONDS:
        archive_bytes = _fetch_eprint(ident, fetch, stats, left)
        if archive_bytes:
            try:
                hires = eprint.hires_figures(archive_bytes, paper["figures"])
                stats["hires_found"] = apply_hires(paper["figures"], hires)
            except Exception as err:
                stats["steps"].append(f"eprint:parse_error:{type(err).__name__}")
                log.warning("eprint figure conversion failed for %s: %s", ident, err, exc_info=True)

    if paper is None and left() > 8:
        source = "pdf"
        try:
            res = fetch(f"https://arxiv.org/pdf/{ident}", max_bytes=PDF_MAX_BYTES, timeout=45, accept="application/pdf")
            stats["steps"].append(f"pdf:{res.status}")
            if res.status == 200 and res.content[:5] == b"%PDF-":
                paper = pdf.parse_pdf(res.content)
        except Exception as err:
            stats["steps"].append(f"pdf:error:{type(err).__name__}")
            log.warning("pdf fetch/parse failed for %s: %s", ident, err)
        if paper and left() > EPRINT_MIN_SECONDS:
            archive_bytes = _fetch_eprint(ident, fetch, stats, left)
            if archive_bytes:
                try:
                    found = eprint.hires_figures(archive_bytes, None)
                    figs = [
                        {"id": None, "label": f"Figure {i + 1}", "caption": v.get("caption", ""),
                         "data": v["data"], "ext": v["ext"], "width": v["width"], "height": v["height"],
                         "hires": v["width"] >= eprint.MIN_HIRES_WIDTH, "origin": "eprint"}
                        for i, v in sorted(found.items())
                    ]
                    if figs:
                        paper["figures"] = figs
                except Exception as err:
                    log.warning("eprint figures for pdf paper failed: %s", err)

    stats["ms"] = round((time.monotonic() - started) * 1000)
    if paper is None:
        log.warning("paper %s not parsed: %s", ident, stats)
        return {"status": "failed", "stats": stats}
    result = to_response(paper, ident, source, stats)
    log.info("paper parsed %s", result["stats"])
    return result


def _fetch_eprint(ident: str, fetch: Fetch, stats: dict, left: Callable[[], float]) -> Optional[bytes]:
    try:
        res = fetch(
            f"https://arxiv.org/e-print/{ident}", max_bytes=EPRINT_MAX_BYTES,
            timeout=max(10.0, min(60.0, left() - 5)), accept="*/*",
        )
        stats["steps"].append(f"eprint:{res.status}")
        return res.content if res.status == 200 else None
    except net.TooLarge:
        stats["steps"].append("eprint:too_large")
    except Exception as err:
        stats["steps"].append(f"eprint:error:{type(err).__name__}")
        log.warning("eprint fetch failed for %s: %s", ident, err)
    return None
