import difflib
import io
import logging
import os
import posixpath
import re
import shutil
import subprocess
import tarfile
import tempfile
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger("reel.paper.eprint")

MAX_TEX_BYTES = 2 * 1024 * 1024
MAX_TEX_FILES = 80
MAX_GRAPHIC_BYTES = 30 * 1024 * 1024
MAX_MEMBERS = 3000
TARGET_WIDTH = 1600
MIN_HIRES_WIDTH = 1400
MAX_WIDTH = 2400
MAX_PIXELS = 24_000_000
MIN_FIGURE_WIDTH = 300
MIN_FIGURE_HEIGHT = 120
GRAPHIC_EXTS = (".pdf", ".png", ".jpg", ".jpeg", ".eps")
INPUT_RE = re.compile(r"\\(?:input|include)\s*\{([^}]+)\}")
GRAPHICSPATH_RE = re.compile(r"\\graphicspath\s*\{((?:\{[^}]*\}\s*)+)\}")
FIG_ENV_RE = re.compile(r"\\begin\{(figure\*?|wrapfigure|SCfigure)\}(.*?)\\end\{\1\}", re.S)
INCLUDE_RE = re.compile(r"\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}")


@dataclass
class TexFigure:
    caption: str
    label: Optional[str]
    graphics: list


def strip_comments(tex: str) -> str:
    return "\n".join(re.sub(r"(?<!\\)%.*$", "", line) for line in tex.split("\n"))


def _balanced(s: str, start: int) -> tuple:
    """Content of the {...} group whose opening brace is at s[start]."""
    depth = 0
    for i in range(start, len(s)):
        c = s[i]
        if c == "\\":
            continue
        if c == "{" and s[i - 1] != "\\":
            depth += 1
        elif c == "}" and s[i - 1] != "\\":
            depth -= 1
            if depth == 0:
                return s[start + 1 : i], i + 1
    return s[start + 1 :], len(s)


def _command_arg(block: str, command: str) -> Optional[str]:
    m = re.search(rf"\\{command}\s*(?:\[[^\]]*\])?\s*\{{", block)
    if not m:
        return None
    content, _ = _balanced(block, m.end() - 1)
    return content


def latex_to_text(s: str) -> str:
    t = re.sub(r"\\(?:cite[a-z]*|ref|autoref|cref|Cref|eqref|label|vspace|hspace)\*?\s*(?:\[[^\]]*\])?\{[^}]*\}", "", s)
    t = re.sub(r"\\(?:textbf|textit|emph|textsc|texttt|underline|textrm|mathrm|text)\s*\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\(?:textbf|textit|emph|textsc|texttt|underline|textrm|mathrm|text)\s*\{([^{}]*)\}", r"\1", t)
    t = re.sub(r"\\(?:\\|,|;|!|quad|qquad|noindent|centering|small|footnotesize)\b\*?", " ", t)
    t = re.sub(r"\\([%&_#$])", r"\1", t)
    t = re.sub(r"\\[A-Za-z]+\*?", " ", t)
    t = t.replace("{", "").replace("}", "").replace("~", " ")
    return re.sub(r"\s+", " ", t).strip()


def figures_from_tex(tex: str) -> list:
    out = []
    for m in FIG_ENV_RE.finditer(tex):
        body = m.group(2)
        graphics = [g.strip() for g in INCLUDE_RE.findall(body)]
        if not graphics:
            continue
        caption = _command_arg(body, "caption")
        label = _command_arg(body, "label")
        out.append(
            TexFigure(
                caption=latex_to_text(caption or ""),
                label=label.strip() if label else None,
                graphics=graphics,
            )
        )
    return out


def graphics_dirs(tex: str) -> list:
    dirs = [""]
    for m in GRAPHICSPATH_RE.finditer(tex):
        dirs.extend(d.strip().strip("./") for d in re.findall(r"\{([^}]*)\}", m.group(1)))
    return list(dict.fromkeys(dirs))


def _safe_name(name: str) -> Optional[str]:
    norm = posixpath.normpath(name)
    if norm.startswith("/") or norm.startswith("..") or norm == "." or "\x00" in norm:
        return None
    return norm


class Archive:
    """A downloaded e-print: tex sources in memory, graphics extracted on demand."""

    def __init__(self, data: bytes):
        self.data = data
        self.names: dict = {}
        self.tex: dict = {}
        self.single_tex: Optional[str] = None
        self._scan()

    def _scan(self) -> None:
        if not tarfile.is_tarfile(io.BytesIO(self.data)):
            import gzip

            try:
                raw = gzip.decompress(self.data)
            except OSError:
                raw = self.data
            if raw[:5] == b"%PDF-":
                return
            self.single_tex = raw[:MAX_TEX_BYTES].decode("utf-8", errors="replace")
            return
        with tarfile.open(fileobj=io.BytesIO(self.data), mode="r:*") as tar:
            for i, member in enumerate(tar):
                if i > MAX_MEMBERS:
                    break
                if not member.isfile():
                    continue
                name = _safe_name(member.name)
                if name is None:
                    continue
                self.names[name.lower()] = name
                if name.lower().endswith(".tex") and len(self.tex) < MAX_TEX_FILES:
                    if member.size <= MAX_TEX_BYTES:
                        fh = tar.extractfile(member)
                        if fh:
                            self.tex[name] = fh.read().decode("utf-8", errors="replace")

    def main_tex(self) -> Optional[str]:
        """The root document with \\input/\\include expanded."""
        if self.single_tex is not None:
            return strip_comments(self.single_tex)
        roots = [n for n, t in self.tex.items() if "\\documentclass" in t and "\\begin{document}" in t]
        if not roots:
            return None
        root = max(roots, key=lambda n: len(self.tex[n]))
        return self._expand(root, 0, set())

    def _expand(self, name: str, depth: int, seen: set) -> str:
        text = strip_comments(self.tex.get(name, ""))
        if depth >= 4:
            return text

        def repl(m):
            target = m.group(1).strip()
            for cand in (target, target + ".tex"):
                safe = _safe_name(cand)
                key = self.names.get(safe.lower()) if safe else None
                if key and key in self.tex and key not in seen:
                    return self._expand(key, depth + 1, seen | {key})
            return ""

        return INPUT_RE.sub(repl, text)

    def resolve(self, graphic: str, dirs: list) -> Optional[str]:
        base = _safe_name(graphic)
        if not base:
            return None
        for d in dirs:
            stem = posixpath.join(d, base) if d else base
            for ext in ("",) + GRAPHIC_EXTS:
                found = self.names.get((stem + ext).lower())
                if found and found.lower().endswith(GRAPHIC_EXTS):
                    return found
        return None

    def read(self, name: str) -> Optional[bytes]:
        with tarfile.open(fileobj=io.BytesIO(self.data), mode="r:*") as tar:
            for member in tar:
                if member.isfile() and _safe_name(member.name) == name:
                    if member.size > MAX_GRAPHIC_BYTES:
                        return None
                    fh = tar.extractfile(member)
                    return fh.read() if fh else None
        return None

    def read_many(self, wanted: set) -> dict:
        out: dict = {}
        with tarfile.open(fileobj=io.BytesIO(self.data), mode="r:*") as tar:
            for member in tar:
                if not member.isfile() or len(out) == len(wanted):
                    continue
                name = _safe_name(member.name)
                if name in wanted and member.size <= MAX_GRAPHIC_BYTES:
                    fh = tar.extractfile(member)
                    if fh:
                        out[name] = fh.read()
        return out


def _autocrop(im, pad: int = 12):
    from PIL import Image, ImageChops

    bg = Image.new(im.mode, im.size, (255, 255, 255))
    box = ImageChops.difference(im, bg).convert("L").point(lambda v: 255 if v > 12 else 0).getbbox()
    if not box:
        return im
    left, top, right, bottom = box
    return im.crop(
        (max(0, left - pad), max(0, top - pad), min(im.width, right + pad), min(im.height, bottom + pad))
    )


def _flatten(im):
    from PIL import Image

    if im.mode in ("RGBA", "LA", "P"):
        rgba = im.convert("RGBA")
        flat = Image.new("RGB", rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel("A"))
        return flat
    return im.convert("RGB")


def _encode(im) -> tuple:
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    data, ext = buf.getvalue(), "png"
    if len(data) > 1_800_000:
        jpg = io.BytesIO()
        im.save(jpg, "JPEG", quality=88, optimize=True)
        data, ext = jpg.getvalue(), "jpg"
    return data, ext


def render_pdf_bytes(data: bytes) -> Optional[tuple]:
    import pymupdf as fitz

    with fitz.open(stream=data, filetype="pdf") as doc:
        if doc.page_count < 1:
            return None
        page = doc[0]
        rect = page.rect
        if rect.width < 10 or rect.height < 10:
            return None
        zoom = max(1.0, min(8.0, TARGET_WIDTH / rect.width))
        while rect.width * rect.height * zoom * zoom > MAX_PIXELS and zoom > 1.0:
            zoom *= 0.8
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        from PIL import Image

        im = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
    return im


def eps_to_image(data: bytes):
    gs = shutil.which("gs")
    if not gs:
        return None
    from PIL import Image

    with tempfile.TemporaryDirectory() as d:
        src, dest = os.path.join(d, "in.eps"), os.path.join(d, "out.png")
        with open(src, "wb") as fh:
            fh.write(data)
        cmd = [gs, "-dSAFER", "-dBATCH", "-dNOPAUSE", "-dQUIET", "-sDEVICE=png16m", "-r220",
               "-dEPSCrop", "-dGraphicsAlphaBits=4", "-dTextAlphaBits=4", f"-sOutputFile={dest}", src]
        try:
            subprocess.run(cmd, check=True, timeout=40, capture_output=True)
        except (subprocess.SubprocessError, OSError) as err:
            log.warning("ghostscript failed: %s", err)
            return None
        with Image.open(dest) as im:
            return im.convert("RGB")


def convert_graphic(name: str, data: bytes) -> Optional[dict]:
    """Original figure file -> PNG/JPEG of at least MIN_HIRES_WIDTH px where the source allows it."""
    from PIL import Image

    lower = name.lower()
    try:
        if lower.endswith(".pdf"):
            im = render_pdf_bytes(data)
        elif lower.endswith(".eps"):
            im = eps_to_image(data)
        else:
            im = Image.open(io.BytesIO(data))
            im.load()
        if im is None:
            return None
        im = _flatten(im)
        if lower.endswith((".pdf", ".eps")):
            im = _autocrop(im)
        if im.width > MAX_WIDTH:
            h = round(im.height * MAX_WIDTH / im.width)
            im = im.resize((MAX_WIDTH, h), Image.LANCZOS)
    except Exception as err:
        log.warning("figure %s not converted: %s", name, err)
        return None
    if im.width < MIN_FIGURE_WIDTH or im.height < MIN_FIGURE_HEIGHT:
        return None
    if im.width > im.height * 6 or im.height > im.width * 6:
        return None
    payload, ext = _encode(im)
    return {"data": payload, "ext": ext, "width": im.width, "height": im.height}


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def match_figures(html_figures: list, tex_figures: list) -> dict:
    """html figure index -> tex figure index, by caption similarity, then by order if counts agree."""
    pairs: dict = {}
    used: set = set()
    for i, hf in enumerate(html_figures):
        a = _norm(hf.get("caption", ""))[:120]
        if len(a) < 12:
            continue
        best, best_j = 0.0, None
        for j, tf in enumerate(tex_figures):
            if j in used:
                continue
            b = _norm(tf.caption)[:120]
            if len(b) < 12:
                continue
            ratio = difflib.SequenceMatcher(None, a, b).ratio()
            if ratio > best:
                best, best_j = ratio, j
        if best_j is not None and best >= 0.6:
            pairs[i] = best_j
            used.add(best_j)
    if not pairs and html_figures and len(html_figures) == len(tex_figures):
        return {i: i for i in range(len(html_figures))}
    return pairs


def hires_figures(data: bytes, html_figures: Optional[list], max_figures: int = 10) -> dict:
    """Converted original figures. With html_figures: {html index: figure}; without: {tex order: figure}."""
    archive = Archive(data)
    tex = archive.main_tex()
    if not tex:
        return {}
    tex_figs = [f for f in figures_from_tex(tex) if f.graphics]
    dirs = graphics_dirs(tex)
    resolved = [archive.resolve(f.graphics[0], dirs) for f in tex_figs]
    mapping = (
        match_figures(html_figures, tex_figs)
        if html_figures is not None
        else {j: j for j in range(len(tex_figs))}
    )
    order = sorted(mapping.items())[:max_figures]
    files = archive.read_many({resolved[j] for _, j in order if resolved[j]})
    out: dict = {}
    for i, j in order:
        name = resolved[j]
        if not name or name not in files:
            continue
        converted = convert_graphic(name, files[name])
        if converted:
            converted.update(caption=tex_figs[j].caption, texLabel=tex_figs[j].label, source=name)
            out[i] = converted
    return out
