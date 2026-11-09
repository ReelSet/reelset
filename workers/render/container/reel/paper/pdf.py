import io
import logging
import re
from typing import Optional

from .text import tidy

log = logging.getLogger("reel.paper.pdf")

MAX_PAGES = 40
MIN_IMAGE_W = 420
MIN_IMAGE_H = 240
MAX_IMAGES = 8
MAX_SECTION_CHARS = 14000
HEADING_RE = re.compile(r"^(#{1,4})\s+(.*\S)\s*$")
TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")
CAPTION_RE = re.compile(r"^\W*(?:\*\*)?(Table|Fig(?:ure|\.)?)\s*(\d+)[.:]?\**\s*(.*)$", re.I)
KINDS = (
    ("abstract", r"^abstract"),
    ("intro", r"^introduction"),
    ("related", r"related work|background|preliminar"),
    ("experiments", r"experiment|result|evaluation|ablation|analysis"),
    ("conclusion", r"conclusion|discussion|summary|limitations"),
    ("method", r"method|approach|model|architecture|framework"),
)


def _kind(heading: str) -> str:
    h = heading.lower()
    for kind, pattern in KINDS:
        if re.search(pattern, h):
            return kind
    return "other"


def _cells(line: str) -> list:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def md_tables(markdown: str) -> list:
    """Pipe tables in pymupdf4llm output, each with the nearest 'Table N' caption line."""
    lines = markdown.split("\n")
    out = []
    i = 0
    while i < len(lines) - 1:
        if "|" in lines[i] and TABLE_SEP_RE.match(lines[i + 1]) and "|" in lines[i + 1]:
            headers = [re.sub(r"<br>|\*\*", " ", c).strip() for c in _cells(lines[i])]
            j = i + 2
            rows = []
            while j < len(lines) and "|" in lines[j]:
                rows.append([re.sub(r"<br>|\*\*", " ", c).strip() for c in _cells(lines[j])])
                j += 1
            caption, label = "", None
            for k in list(range(i - 1, max(i - 4, -1), -1)) + list(range(j, min(j + 3, len(lines)))):
                m = CAPTION_RE.match(lines[k].strip())
                if m and m.group(1).lower().startswith("t"):
                    label, caption = f"Table {m.group(2)}", m.group(3).strip()
                    break
            width = len(headers)
            rows = [(r + [""] * width)[:width] for r in rows]
            if len(rows) >= 1 and width >= 2:
                out.append(
                    {
                        "id": None,
                        "label": label,
                        "caption": caption,
                        "headers": headers,
                        "rows": rows,
                        "best": [],
                        "second": [],
                        "bestBy": "none",
                        "notes": None,
                    }
                )
            i = j
        else:
            i += 1
    return out


def md_sections(markdown: str) -> list:
    sections, current = [], None
    for line in markdown.split("\n"):
        m = HEADING_RE.match(line)
        plain_heading = re.sub(r"\*\*|__", "", m.group(2)).strip() if m else ""
        if m and len(plain_heading) < 90 and not plain_heading.lower().startswith(("table", "fig")):
            if current:
                sections.append(current)
            level = min(4, max(2, len(m.group(1)) + 1))
            heading = re.sub(r"^(?:\d+(?:\.\d+)*|[A-Z]|[IVX]+)[.\s]\s*", "", plain_heading)
            current = {"heading": heading, "level": level, "kind": _kind(heading), "lines": []}
        elif current is not None:
            current["lines"].append(line)
        elif line.strip():
            current = {"heading": "Front matter", "level": 2, "kind": "other", "lines": [line]}
    if current:
        sections.append(current)
    out = []
    for s in sections:
        body = [l for l in s["lines"] if "|" not in l or not TABLE_SEP_RE.match(l)]
        text = tidy("\n".join(body))
        text = re.sub(r"\n{3,}", "\n\n", text)
        if len(text) > MAX_SECTION_CHARS:
            text = text[:MAX_SECTION_CHARS].rsplit(" ", 1)[0] + " ..."
        if text or s["level"] == 2:
            out.append({"heading": s["heading"], "level": s["level"], "kind": s["kind"], "markdown": text})
    return out


def pdf_images(doc, max_images: int = MAX_IMAGES) -> list:
    import pymupdf as fitz
    from PIL import Image

    seen, out = set(), []
    for page_no in range(min(doc.page_count, MAX_PAGES)):
        for info in doc[page_no].get_images(full=True):
            xref = info[0]
            if xref in seen:
                continue
            seen.add(xref)
            width, height = info[2], info[3]
            if width < MIN_IMAGE_W or height < MIN_IMAGE_H:
                continue
            if width > height * 5 or height > width * 5:
                continue
            try:
                pix = fitz.Pixmap(doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples) if pix.alpha == 0 else None
                if im is None:
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                    im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            except Exception as err:
                log.info("pdf image %s skipped: %s", xref, err)
                continue
            if im.width > 2400:
                im = im.resize((2400, round(im.height * 2400 / im.width)))
            buf = io.BytesIO()
            im.save(buf, "PNG", optimize=True)
            data, ext = buf.getvalue(), "png"
            if len(data) > 1_800_000:
                jpg = io.BytesIO()
                im.save(jpg, "JPEG", quality=88)
                data, ext = jpg.getvalue(), "jpg"
            out.append({"data": data, "ext": ext, "width": im.width, "height": im.height, "page": page_no + 1})
            if len(out) >= max_images:
                return out
    return out


def figure_captions(markdown: str) -> list:
    caps = []
    for line in markdown.split("\n"):
        m = CAPTION_RE.match(line.strip())
        if m and m.group(1).lower().startswith("f") and len(m.group(3)) > 15:
            caps.append((f"Figure {m.group(2)}", m.group(3).strip()))
    return caps


def _pdf_title(page) -> str:
    """The largest-font text near the top of page one, skipping the arXiv stamp."""
    best, size = "", 0.0
    for block in page.get_text("dict")["blocks"][:12]:
        for line in block.get("lines", []):
            text = " ".join(s["text"] for s in line["spans"]).strip()
            if not text or text.lower().startswith("arxiv") or len(text) < 6:
                continue
            top = max(s["size"] for s in line["spans"])
            if top > size + 0.5:
                best, size = text, top
            elif abs(top - size) <= 0.5 and best and len(best) < 150:
                best = f"{best} {text}"
    return re.sub(r"\s+", " ", best)[:200]


def parse_pdf(data: bytes) -> Optional[dict]:
    import pymupdf as fitz

    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception as err:
        log.warning("pdf not readable: %s", err)
        return None
    with doc:
        if doc.page_count < 1:
            return None
        try:
            import pymupdf4llm

            markdown = pymupdf4llm.to_markdown(
                doc, pages=list(range(min(doc.page_count, MAX_PAGES))), write_images=False,
                use_ocr=False,
                show_progress=False,
            )
        except Exception as err:
            log.warning("pymupdf4llm failed, using plain text: %s", err)
            markdown = "\n\n".join(doc[i].get_text() for i in range(min(doc.page_count, MAX_PAGES)))
        images = pdf_images(doc)
        title = _pdf_title(doc[0])
    sections = md_sections(markdown)
    abstract = next((s["markdown"] for s in sections if s["kind"] == "abstract"), "")
    if not abstract:
        m = re.search(r"abstract[\s:.\-—]*\n*(.{200,2500}?)(?:\n\s*\n|\n#|$)", markdown, re.I | re.S)
        abstract = tidy(m.group(1)) if m else ""
    caps = figure_captions(markdown)
    figures = []
    for idx, img in enumerate(images):
        label, caption = caps[idx] if idx < len(caps) else (None, "")
        figures.append({**img, "id": None, "label": label, "caption": caption})
    return {
        "title": title,
        "authors": [],
        "affiliations": [],
        "abstract": abstract,
        "sections": [s for s in sections if s["heading"] != "Front matter" or s["markdown"]],
        "tables": md_tables(markdown),
        "figures": figures,
        "equations": [],
        "links": [],
    }
