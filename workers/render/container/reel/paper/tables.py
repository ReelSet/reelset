import re
from typing import Optional

from bs4 import NavigableString, Tag

from .text import BOLD_MATH, latex_to_plain, plain

NUM_RE = re.compile(
    r"^[<>~≈≤≥+\-−–]?\s*\$?\d[\d,]*(?:\.\d+)?\s*(?:%|×|x|k|K|M|B|ms|s|GB|MB|h)?"
    r"(?:\s*(?:±|\+/-|\(|/)\s*[\d.,]+\)?%?)*\s*[*†‡]*$"
)
LOWER_IS_BETTER = re.compile(
    r"loss|error|err\b|ppl|perplexity|latency|time|cost|rmse|mae|fid|wer|cer|lpips|chamfer|"
    r"memory|params|flops|\bmse\b|\bnll\b|bpc|bpb",
    re.I,
)
MAX_COLS = 14
MAX_ROWS = 60


def _classes(el: Tag) -> list:
    return el.get("class") or []


def _span(el: Tag, axis: str) -> int:
    raw = el.get(f"{axis}span")
    if raw and str(raw).isdigit():
        return max(1, int(raw))
    for c in _classes(el):
        m = re.fullmatch(rf"ltx_{axis}span_(\d+)", c)
        if m:
            return max(1, int(m.group(1)))
    return 1


def _is_tabular(el) -> bool:
    return isinstance(el, Tag) and "ltx_tabular" in _classes(el)


def _closest_tabular(el: Tag) -> Optional[Tag]:
    p = el.parent
    while p is not None and not _is_tabular(p):
        p = p.parent
    return p


def _own(scope: Tag, kind: str, tabular: Optional[Tag] = None) -> list:
    tabular = tabular or scope
    out = []
    for el in scope.find_all(True):
        cls = _classes(el)
        hit = (
            (kind == "row" and (el.name == "tr" or "ltx_tr" in cls))
            or (kind == "cell" and (el.name in ("td", "th") or "ltx_td" in cls or "ltx_th" in cls))
        )
        if hit and _closest_tabular(el) is tabular:
            out.append(el)
    return out


def _cell_parts(cell: Tag) -> tuple:
    """(text, bold, underline) of a cell, math flattened to plain symbols."""
    bold_len = 0
    total = 0
    underline = False

    def walk(node, in_bold: bool) -> str:
        nonlocal bold_len, total, underline
        if isinstance(node, NavigableString):
            s = str(node)
            n = len(s.strip())
            total += n
            if in_bold:
                bold_len += n
            return s
        if not isinstance(node, Tag):
            return ""
        cls = _classes(node)
        if node.name == "math":
            alt = node.get("alttext", "")
            s = latex_to_plain(alt)
            n = len(s.replace(" ", ""))
            total += n
            if in_bold or BOLD_MATH.search(alt):
                bold_len += n
            return s
        if node.name in ("annotation", "script", "style"):
            return ""
        if "ltx_cite" in cls or "ltx_note" in cls or node.name == "cite":
            return ""
        if node.name == "br":
            return " "
        if any("underline" in c or "uline" in c for c in cls):
            underline = True
        is_bold = in_bold or "ltx_font_bold" in cls or node.name in ("b", "strong")
        if _is_tabular(node):
            lines = []
            for row in _own(node, "row"):
                lines.append(" ".join(walk(c, is_bold) for c in _own(row, "cell", node)))
            return " / ".join(l for l in (plain(x) for x in lines) if l)
        return "".join(walk(ch, is_bold) for ch in node.children)

    text = plain(walk(cell, False))
    bold = total > 0 and bold_len / total >= 0.8
    return text, bold, underline


def _grid(tabular: Tag) -> list:
    rows = _own(tabular, "row")[:MAX_ROWS]
    grid: list = []
    pending: dict = {}
    for r_idx, row in enumerate(rows):
        line: list = []
        col = 0
        cells = _own(row, "cell", tabular)
        queue = list(cells)
        while queue or col in pending:
            if col in pending:
                remaining, value = pending[col]
                line.append({**value, "carry": True})
                if remaining <= 1:
                    del pending[col]
                else:
                    pending[col] = (remaining - 1, value)
                col += 1
                continue
            cell = queue.pop(0)
            text, bold, underline = _cell_parts(cell)
            header = "ltx_th_column" in _classes(cell) or cell.name == "th"
            value = {"text": text, "bold": bold, "underline": underline, "header": header}
            cs, rs = _span(cell, "col"), _span(cell, "row")
            for k in range(cs):
                line.append({**value, "carry": k > 0})
                if rs > 1:
                    pending[col] = (rs - 1, {**value})
                col += 1
        grid.append(line[:MAX_COLS])
    width = max((len(r) for r in grid), default=0)
    for r in grid:
        r.extend({"text": "", "bold": False, "underline": False, "header": False, "carry": False} for _ in range(width - len(r)))
    return grid


def _is_numeric(text: str) -> bool:
    return bool(NUM_RE.match(text.strip())) if text.strip() else False


def _header_rows(grid: list) -> int:
    n = 0
    for row in grid:
        body = [c["text"] for c in row[1:] if c["text"]]
        if not body:
            n += 1
            continue
        numeric = sum(_is_numeric(t) for t in body)
        if numeric * 2 >= len(body):
            break
        n += 1
    return min(n, max(1, len(grid) - 1)) if len(grid) > 1 else len(grid)


def _is_title_row(row: list) -> bool:
    texts = {c["text"] for c in row if c["text"]}
    return len(texts) == 1 and len(row) > 2 and sum(1 for c in row if c["text"]) >= len(row) - 1


def _flatten_headers(grid: list, count: int) -> list:
    width = len(grid[0]) if grid else 0
    out = []
    for c in range(width):
        parts: list = []
        for r in range(count):
            if _is_title_row(grid[r]):
                continue
            t = grid[r][c]["text"]
            if t and t not in parts:
                parts.append(t)
        out.append(" ".join(parts))
    return out


def _computed_best(headers: list, rows: list) -> list:
    best = []
    for c, head in enumerate(headers):
        if c == 0:
            continue
        up, down = "↑" in head, "↓" in head
        if not (up or down):
            continue
        vals = []
        for r, row in enumerate(rows):
            m = re.match(r"\s*[-−]?\d[\d,]*(?:\.\d+)?", row[c] if c < len(row) else "")
            if m:
                vals.append((float(m.group(0).replace(",", "").replace("−", "-")), r))
        if len(vals) < 2:
            continue
        target = min(vals)[0] if down and not up else max(vals)[0]
        best.extend([r, c] for v, r in vals if v == target)
    return best


def parse_tabular(tabular: Tag) -> Optional[dict]:
    grid = _grid(tabular)
    if len(grid) < 2 or not grid[0] or len(grid[0]) < 2:
        return None
    hcount = _header_rows(grid)
    headers = _flatten_headers(grid, hcount)
    body = grid[hcount:]
    if not body:
        return None
    rows, best, second = [], [], []
    for row in body:
        texts = [c["text"] for c in row]
        non_empty = [t for t in texts if t]
        if len(non_empty) == 0:
            continue
        is_group = len(set(non_empty)) == 1 and len(non_empty) > 1 and all(c["carry"] for c in row[1:] if c["text"])
        if is_group:
            rows.append([non_empty[0]] + [""] * (len(texts) - 1))
            continue
        r = len(rows)
        for c, cell in enumerate(row):
            if cell["carry"] or c == 0 or not cell["text"]:
                continue
            if cell["bold"] and _is_numeric(cell["text"]):
                best.append([r, c])
            elif cell["underline"] and _is_numeric(cell["text"]):
                second.append([r, c])
        rows.append(texts)
    if not rows:
        return None
    best_by = "bold" if best else "none"
    if not best:
        best = _computed_best(headers, rows)
        best_by = "computed" if best else "none"
    return {"headers": headers, "rows": rows, "best": best, "second": second, "bestBy": best_by}


def parse_table_figure(fig: Tag) -> Optional[dict]:
    tabulars = [t for t in fig.find_all(True) if _is_tabular(t) and _closest_tabular(t) is None]
    parsed = [p for p in (parse_tabular(t) for t in tabulars) if p]
    if not parsed:
        return None
    table = max(parsed, key=lambda p: len(p["rows"]) * len(p["headers"]))
    table["subtables"] = len(parsed)
    return table
