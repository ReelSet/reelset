import html
import re
from html.parser import HTMLParser
from urllib.parse import urljoin

OG_KEYS = ("og:image:secure_url", "og:image", "twitter:image", "twitter:image:src")


class _MetaImages(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = {}

    def handle_starttag(self, tag, attrs):
        if tag != "meta":
            return
        attrs = dict(attrs)
        key = (attrs.get("property") or attrs.get("name") or "").lower()
        content = attrs.get("content")
        if key in OG_KEYS and content and key not in self.found:
            self.found[key] = html.unescape(content.strip())


def og_image_url(page_html: str, base_url: str) -> str | None:
    parser = _MetaImages()
    try:
        parser.feed(page_html[:400_000])
    except Exception:
        pass
    for key in OG_KEYS:
        value = parser.found.get(key)
        if value:
            absolute = urljoin(base_url, value)
            return absolute if absolute.startswith("https://") else None
    return None


def page_url_for_cover(source: str, canonical_url: str) -> str | None:
    """Pages worth scraping for og:image. Reddit/HN/GitHub/YouTube pages are handled by direct URLs."""
    if source in ("github", "youtube") or not canonical_url.startswith("https://"):
        return None
    host = re.sub(r"^www\.", "", canonical_url.split("/")[2].lower()) if "//" in canonical_url else ""
    if host in ("reddit.com", "old.reddit.com", "news.ycombinator.com", "youtube.com", "youtu.be"):
        return None
    return canonical_url
