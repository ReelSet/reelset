import re
from typing import Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup, NavigableString, Tag

from .tables import parse_table_figure
from .text import plain, tidy

MAX_SECTION_CHARS = 14000
MAX_FIGURES = 24
MAX_TABLES = 16
MAX_EQUATIONS = 6

KINDS = (
    ("abstract", r"^abstract"),
    ("intro", r"^(?:introduction|background and introduction|overview)\b"),
    ("related", r"related work|prior work|background|preliminar"),
    ("experiments", r"experiment|result|evaluation|benchmark|ablation|analysis|empirical|findings"),
    ("conclusion", r"conclusion|concluding|discussion|summary|limitations|future work"),
    ("method", r"method|approach|model|architecture|framework|algorithm|system|design|our "),
)
CODE_HOSTS = ("github.com", "gitlab.com", "huggingface.co", "bitbucket.org")
SKIP_SECTION = re.compile(r"acknowledg|references|bibliograph|ethic|broader impact|reproducib")
HEADING = re.compile(r"^h[1-6]$")


def classes(el) -> list:
    return (el.get("class") or []) if isinstance(el, Tag) else []


def has(el, name: str) -> bool:
    return name in classes(el)


def section_kind(heading: str, appendix: bool) -> str:
    if appendix:
        return "appendix"
    h = heading.lower()
    for kind, pattern in KINDS:
        if re.search(pattern, h):
            return kind
    return "other"


def inline_md(node, math: bool = True) -> str:
    if isinstance(node, NavigableString):
        return str(node)
    if not isinstance(node, Tag):
        return ""
    cls = classes(node)
    name = node.name
    if name == "math":
        alt = (node.get("alttext") or "").strip()
        if not alt or not math:
            return alt
        return f"$${alt}$$" if node.get("display") == "block" else f"${alt}$"
    if name in ("annotation", "script", "style", "cite", "img"):
        return ""
    if any(c in cls for c in ("ltx_cite", "ltx_note", "ltx_tag", "ltx_bibref", "ltx_note_mark")):
        return ""
    if name == "br":
        return " "
    inner = "".join(inline_md(c, math) for c in node.children)
    if not inner.strip():
        return inner
    if "ltx_font_bold" in cls or name in ("b", "strong"):
        return f"**{inner.strip()}**"
    if "ltx_font_italic" in cls or name in ("em", "i"):
        return f"*{inner.strip()}*"
    if "ltx_font_typewriter" in cls or name == "code":
        return f"`{inner.strip()}`"
    return inner


def para_text(el: Tag) -> str:
    return tidy(inline_md(el))


def block_md(el: Tag, out: list, equations: list, section_id: str) -> None:
    """Appends the markdown blocks of el's direct content; nested sections and floats are skipped."""
    for child in el.children:
        if not isinstance(child, Tag):
            continue
        cls = classes(child)
        name = child.name
        if name in ("section", "figure") or any(c.startswith("ltx_float") for c in cls):
            continue
        if HEADING.match(name) and "ltx_title" in cls:
            continue
        if name == "table" and ("ltx_equation" in cls or "ltx_equationgroup" in cls):
            tag = child.find(class_=re.compile(r"ltx_tag_equation"))
            label = plain(tag.get_text()) if tag else None
            for eq in child.find_all("math"):
                alt = (eq.get("alttext") or "").strip()
                if alt:
                    equations.append({"latex": alt, "label": label, "section": section_id})
                    out.append(f"$${alt}$$")
            continue
        if name in ("ul", "ol") or "ltx_itemize" in cls or "ltx_enumerate" in cls:
            for i, li in enumerate(child.find_all("li", recursive=False), 1):
                text = para_text(li)
                if text:
                    out.append(f"{i}. {text}" if name == "ol" else f"- {text}")
            continue
        if name == "p" or (name == "span" and "ltx_p" in cls):
            text = para_text(child)
            if text:
                out.append(text)
            continue
        if "ltx_listing" in cls or "ltx_bibliography" in cls:
            continue
        block_md(child, out, equations, section_id)


def parse_sections(root: Tag) -> tuple:
    sections: list = []
    equations: list = []
    for sec in root.find_all("section"):
        cls = classes(sec)
        level = (
            4
            if "ltx_subsubsection" in cls
            else 3
            if "ltx_subsection" in cls
            else 2
            if ("ltx_section" in cls or "ltx_appendix" in cls)
            else 0
        )
        if level == 0 or has(sec, "ltx_bibliography"):
            continue
        head = next(
            (h for h in sec.find_all(HEADING, recursive=False) if has(h, "ltx_title")), None
        ) or sec.find(HEADING, class_="ltx_title")
        heading = tidy(inline_md(head, math=False)) if head else ""
        heading = re.sub(r"^(?:Appendix\s+)?(?:[A-Z]|\d+|[IVX]+)(?:\.\d+)*[.:\s]+\s*", "", heading)
        if SKIP_SECTION.search(heading.lower()):
            continue
        appendix = has(sec, "ltx_appendix") or any(
            has(p, "ltx_appendix") for p in sec.parents if isinstance(p, Tag)
        )
        out: list = []
        block_md(sec, out, equations, sec.get("id", ""))
        md = "\n\n".join(out)
        if len(md) > MAX_SECTION_CHARS:
            md = md[:MAX_SECTION_CHARS].rsplit(" ", 1)[0] + " ..."
        if not md and level > 2:
            continue
        sections.append(
            {
                "heading": heading,
                "level": level,
                "kind": section_kind(heading, appendix),
                "markdown": md,
            }
        )
    return sections, equations


def pick_equations(equations: list) -> list:
    scored = []
    for idx, eq in enumerate(equations):
        latex = eq["latex"]
        if not (8 <= len(latex) <= 220) or "=" not in latex:
            continue
        score = 2 if eq.get("label") else 0
        score += 1 if re.search(r"\\(?:sum|frac|mathcal|exp|log|min|max|prod|int)", latex) else 0
        score += 1 if len(latex) > 20 else 0
        score -= 2 if re.search(r"\\q?quad", latex) else 0
        scored.append((-score, idx))
    scored.sort()
    keep = sorted(idx for _, idx in scored[:MAX_EQUATIONS])
    return [{"latex": equations[i]["latex"], "label": equations[i].get("label")} for i in keep]


def figure_caption(fig: Tag) -> tuple:
    cap = fig.find("figcaption")
    if cap is None:
        return None, ""
    tag = cap.find(class_=re.compile(r"ltx_tag"))
    label = re.sub(r"[:.\s]+$", "", plain(tag.get_text())) if tag else None
    return label, tidy(inline_md(cap))


def _dim(v) -> Optional[int]:
    return int(v) if v and str(v).isdigit() else None


def parse_figures(root: Tag, base: str) -> list:
    out = []
    for fig in root.find_all("figure"):
        cls = classes(fig)
        if "ltx_table" in cls or any(c.startswith("ltx_float_") for c in cls):
            continue
        imgs = [i for i in fig.find_all("img") if i.get("src")]
        if not imgs:
            continue
        label, caption = figure_caption(fig)
        first = imgs[0]
        out.append(
            {
                "id": fig.get("id"),
                "label": label,
                "caption": caption,
                "url": urljoin(base, first["src"]),
                "width": _dim(first.get("width")),
                "height": _dim(first.get("height")),
                "hires": False,
                "origin": "latexml",
            }
        )
        if len(out) >= MAX_FIGURES:
            break
    return out


def parse_tables(root: Tag) -> list:
    out = []
    for fig in root.find_all("figure", class_="ltx_table"):
        parsed = parse_table_figure(fig)
        if not parsed:
            continue
        label, caption = figure_caption(fig)
        notes = [
            tidy(inline_md(p))
            for p in fig.find_all("p", recursive=False)
            if not p.find(class_="ltx_tabular")
        ]
        out.append(
            {
                "id": fig.get("id"),
                "label": label,
                "caption": caption,
                **parsed,
                "notes": " ".join(n for n in notes if n) or None,
            }
        )
        if len(out) >= MAX_TABLES:
            break
    return out


def parse_front(root: Tag) -> dict:
    title_el = root.find(class_="ltx_title_document")
    title = tidy(inline_md(title_el, math=False)) if title_el else ""
    title = re.sub(r"^\s*Title\s*:\s*", "", title)
    authors, affiliations = [], []
    block = root.find(class_="ltx_authors")
    if block:
        for creator in block.find_all(class_="ltx_creator"):
            for name in creator.find_all(class_="ltx_personname"):
                for sup in name.find_all("sup"):
                    sup.decompose()
                text = plain(name.get_text(" "))
                parts = [p.strip() for p in re.split(r",|\band\b|&", text) if p.strip()]
                authors.extend(p for p in parts if len(p) < 60 and not re.search(r"\d|@", p))
            for aff in creator.find_all(class_="ltx_role_affiliation"):
                for sup in aff.find_all("sup"):
                    sup.decompose()
                t = plain(aff.get_text(" "))
                if t:
                    affiliations.append(t)
    abstract_el = root.find(class_="ltx_abstract")
    abstract = ""
    if abstract_el:
        abstract = tidy(" ".join(para_text(p) for p in abstract_el.find_all("p", class_="ltx_p")))
    return {
        "title": title,
        "authors": list(dict.fromkeys(authors)),
        "affiliations": list(dict.fromkeys(affiliations)),
        "abstract": abstract,
    }


def parse_links(root: Tag) -> list:
    seen, out = set(), []
    for a in root.find_all("a", href=True):
        href = a["href"].strip()
        p = urlparse(href)
        if p.scheme not in ("http", "https") or not p.hostname:
            continue
        host = p.hostname.lower()
        if host.endswith("arxiv.org") or host.endswith("doi.org"):
            continue
        kind = None
        if host in CODE_HOSTS or host.endswith(".huggingface.co"):
            kind = "code"
        elif host.endswith(".github.io"):
            kind = "project"
        if not kind or any(has(par, "ltx_bibliography") for par in a.parents):
            continue
        if host == "github.com":
            parts = [x for x in p.path.split("/") if x]
            if len(parts) < 2:
                continue
            href = f"https://github.com/{parts[0]}/{parts[1]}"
        if href.lower() in seen:
            continue
        seen.add(href.lower())
        out.append({"kind": kind, "url": href})
    return out[:6]


def looks_like_latexml(html: str) -> bool:
    return "ltx_page_main" in html or "ltx_document" in html


def parse_arxiv_html(html: str, page_url: str) -> Optional[dict]:
    if not looks_like_latexml(html):
        return None
    soup = BeautifulSoup(html, "lxml")
    base = page_url.rstrip("/")
    root = soup.find("article") or soup.find(class_="ltx_page_content") or soup.body or soup
    sections, equations = parse_sections(root)
    return {
        **parse_front(root),
        "sections": sections,
        "tables": parse_tables(root),
        "figures": parse_figures(root, base),
        "equations": pick_equations(equations),
        "links": parse_links(root),
    }
