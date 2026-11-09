import logging
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Callable

from . import images

log = logging.getLogger("reel.source_images")

MAX_SOURCE_IMAGES = 6
MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024
MAX_GIF_BYTES = 5 * 1024 * 1024
MIN_WIDTH = 240
MIN_HEIGHT = 140
MAX_ASPECT = 5.0
MAX_SIDE = 1280
DOWNLOAD_WORKERS = 4
HASH_DISTANCE = 5

Download = Callable[[str, str], bool]


def _download(url: str, dest: str) -> bool:
    return images.download_public_image(url, dest, limit=MAX_DOWNLOAD_BYTES)


def _ahash(im) -> int:
    small = im.convert("L").resize((8, 8))
    pixels = list(small.getdata())
    mean = sum(pixels) / 64
    return sum(1 << i for i, p in enumerate(pixels) if p >= mean)


def prepare_image(src_path: str, dest_path: str) -> tuple[int, int, int] | None:
    """Validate and re-encode a downloaded image as a bounded RGB JPEG.

    Returns (width, height, perceptual hash) or None for tiny, extreme, blank, oversized-gif
    or undecodable images. Alpha is flattened onto white; animated formats keep the first frame.
    """
    from PIL import Image, ImageStat, UnidentifiedImageError

    try:
        with Image.open(src_path) as im:
            if im.format == "GIF" and os.path.getsize(src_path) > MAX_GIF_BYTES:
                log.info("image rejected: gif over %d bytes", MAX_GIF_BYTES)
                return None
            im.seek(0)
            width, height = im.size
            if width < MIN_WIDTH or height < MIN_HEIGHT:
                log.info("image rejected: too small %dx%d", width, height)
                return None
            if width > height * MAX_ASPECT or height > width * MAX_ASPECT:
                log.info("image rejected: aspect %dx%d", width, height)
                return None
            if im.mode in ("RGBA", "LA", "P"):
                rgba = im.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (255, 255, 255))
                flat.paste(rgba, mask=rgba.getchannel("A"))
                rgb = flat
            else:
                rgb = im.convert("RGB")
            if max(ImageStat.Stat(rgb.convert("L")).stddev) < 4:
                log.info("image rejected: blank")
                return None
            if max(rgb.size) > MAX_SIDE:
                scale = MAX_SIDE / max(rgb.size)
                rgb = rgb.resize((round(rgb.width * scale), round(rgb.height * scale)), Image.LANCZOS)
            rgb.save(dest_path, "JPEG", quality=88)
            return rgb.width, rgb.height, _ahash(rgb)
    except (UnidentifiedImageError, OSError, ValueError, EOFError) as err:
        log.warning("image not usable: %s", err)
        return None


def _hamming(a: int, b: int) -> int:
    return bin(a ^ b).count("1")


def collect_item_images(
    candidates: list, assets_dir: str, download: Download = _download, limit: int = MAX_SOURCE_IMAGES
) -> list:
    """Download candidates in order (kept order), skipping junk and near-duplicates.

    Each candidate is {url, kind, alt?}; the result entries are {file, kind, width, height, alt?}
    with `file` relative to assets_dir. Never raises.
    """

    def fetch(index_and_candidate):
        index, cand = index_and_candidate
        raw = os.path.join(assets_dir, f"img{index}.raw")
        out = f"img{index}.jpg"
        try:
            if not download(cand["url"], raw):
                return None
            prepared = prepare_image(raw, os.path.join(assets_dir, out))
        except Exception as err:  # best effort: one bad image never fails a render
            log.warning("image fetch crashed url=%s err=%s", cand["url"][:80], err)
            return None
        finally:
            if os.path.exists(raw):
                os.remove(raw)
        return None if prepared is None else (out, cand, prepared)

    with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as pool:
        results = list(pool.map(fetch, enumerate(candidates)))

    kept: list = []
    hashes: list = []
    for result in results:
        if result is None:
            continue
        out, cand, (width, height, phash) = result
        if any(_hamming(phash, h) <= HASH_DISTANCE for h in hashes) or len(kept) >= limit:
            os.remove(os.path.join(assets_dir, out))
            continue
        hashes.append(phash)
        entry = {"file": out, "kind": cand["kind"], "width": width, "height": height}
        if cand.get("alt"):
            entry["alt"] = cand["alt"]
        kept.append(entry)
    log.info("source images kept=%d of %d", len(kept), len(candidates))
    return kept
