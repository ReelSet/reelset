import io
import os
import re
import tarfile
import unittest

from reel.paper import eprint, latexml, net, pdf, service, tables

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "paper")


def read(name: str) -> str:
    with open(os.path.join(FIX, name), encoding="utf8") as fh:
        return fh.read()


def parsed(arxiv_id: str) -> dict:
    return latexml.parse_arxiv_html(read(f"{arxiv_id}.html"), f"https://arxiv.org/html/{arxiv_id}v1")


def eprint_bytes() -> bytes:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(os.path.join(FIX, "eprint-2611.08264"), arcname=".")
    return buf.getvalue()


class TableParsingTests(unittest.TestCase):
    def setUp(self):
        self.multirow = {t["label"]: t for t in parsed("2611.08264")["tables"]}
        self.pm = {t["label"]: t for t in parsed("2611.03953")["tables"]}

    def test_multicol_group_headers_flatten_onto_leaf_columns(self):
        t = self.multirow["Table 1"]
        self.assertEqual(t["headers"][:4], ["Input", "Method", "ScanNet DISTS↓", "ScanNet LPIPS↓"])
        self.assertEqual(len(t["headers"]), len(t["rows"][0]))

    def test_multirow_labels_repeat_down_their_span(self):
        rows = self.multirow["Table 1"]["rows"]
        self.assertEqual([r[0] for r in rows[:6]], ["w/o Pose"] * 6)
        self.assertIn(["w/o Pose", "Ours"], [r[:2] for r in rows])

    def test_title_rows_do_not_pollute_headers(self):
        self.assertTrue(all("Qwen3-4B Qwen3-4B" not in h for h in self.pm["Table 1"]["headers"]))

    def test_bold_cells_are_the_best_results(self):
        t = self.multirow["Table 3"]
        self.assertEqual(t["bestBy"], "bold")
        for r, c in t["best"]:
            self.assertTrue(re.match(r"\d", t["rows"][r][c]))

    def test_best_is_computed_only_from_header_arrows_when_nothing_is_bold(self):
        t = self.multirow["Table 1"]
        self.assertEqual(t["bestBy"], "computed")
        best_rows = {r for r, c in t["best"] if c == 2}
        self.assertEqual({t["rows"][r][1] for r in best_rows}, {"Ours"})

    def test_plus_minus_and_percent_survive(self):
        cells = [c for row in self.pm["Table 2"]["rows"] for c in row]
        self.assertIn("+29.0±8.3", cells)

    def test_numeric_detection(self):
        for ok in ["0.278", "+29.0±8.3", "96.20 ± 0.86", "50.99%", "1,089", "1.00×", "−3.2"]:
            self.assertTrue(tables._is_numeric(ok), ok)
        for bad in ["Ours", "w/o Pose", "", "MedQA"]:
            self.assertFalse(tables._is_numeric(bad), bad)

    def test_captions_and_labels(self):
        t = self.multirow["Table 1"]
        self.assertTrue(t["caption"].startswith("Quantitative comparison across seven benchmark"))
        self.assertEqual(t["id"], "S4.T1")


class SectionAndFrontMatterTests(unittest.TestCase):
    def test_front_matter(self):
        p = parsed("2611.03953")
        self.assertTrue(p["title"].startswith("P2-MOPD"))
        self.assertGreaterEqual(len(p["authors"]), 5)
        self.assertGreater(len(p["abstract"]), 300)
        self.assertIn({"kind": "code", "url": "https://github.com/SinuoWang/P2-MOPD"}, p["links"])

    def test_sections_cover_method_experiments_conclusion(self):
        kinds = {s["kind"] for s in parsed("2611.08264")["sections"]}
        self.assertTrue({"intro", "method", "experiments", "conclusion"} <= kinds)

    def test_math_stays_latex_and_citations_are_gone(self):
        text = "\n".join(s["markdown"] for s in parsed("2611.08264")["sections"])
        self.assertRegex(text, r"\$[^$]*\\[a-zA-Z]+[^$]*\$")
        self.assertNotRegex(text, r"\[\d+(?:,\s*\d+)*\]")
        self.assertNotIn("( )", text)
        self.assertNotIn("Refer to caption", text)

    def test_sections_flat_with_levels_and_no_bibliography(self):
        secs = parsed("2611.08264")["sections"]
        self.assertTrue(all(s["level"] in (2, 3, 4) for s in secs))
        self.assertFalse(any(re.search(r"reference|bibliograph", s["heading"], re.I) for s in secs))

    def test_key_equations_keep_latex_and_label(self):
        eqs = parsed("2611.08264")["equations"]
        self.assertTrue(eqs)
        self.assertTrue(all("=" in e["latex"] for e in eqs))
        self.assertIn("(1)", [e["label"] for e in eqs])


class FigureTests(unittest.TestCase):
    def test_figure_urls_resolve_against_the_page_and_captions_skip_alt_text(self):
        figs = parsed("2611.08264")["figures"]
        self.assertTrue(figs[0]["url"].startswith("https://arxiv.org/html/2611.08264v1/"))
        self.assertNotIn("2611.08264v1/2611.08264v1", figs[0]["url"])
        self.assertEqual(figs[0]["label"], "Figure 1")
        self.assertNotIn("Refer to caption", figs[0]["caption"])
        self.assertTrue(all(f["origin"] == "latexml" and not f["hires"] for f in figs))

    def test_tables_are_not_figures(self):
        self.assertFalse(any((f["label"] or "").startswith("Table") for f in parsed("2611.08264")["figures"]))


class EprintTests(unittest.TestCase):
    def test_main_tex_expands_inputs(self):
        tex = eprint.Archive(eprint_bytes()).main_tex()
        self.assertIn("\\begin{figure", tex)
        self.assertNotIn("\\input{sec/", tex)

    def test_figure_environments_give_caption_label_and_graphic(self):
        tex = eprint.Archive(eprint_bytes()).main_tex()
        figs = {f.label: f for f in eprint.figures_from_tex(tex)}
        self.assertEqual(figs["fig:teaser"].graphics, ["figures/teaser/teaser.pdf"])
        self.assertTrue(figs["fig:architecture"].caption.startswith("Architecture of SplatAnything"))
        self.assertNotIn("\\", figs["fig:teaser"].caption)

    def test_captions_map_to_the_matching_html_figures(self):
        tex = eprint.Archive(eprint_bytes()).main_tex()
        tex_figs = eprint.figures_from_tex(tex)
        mapping = eprint.match_figures(parsed("2611.08264")["figures"], tex_figs)
        self.assertEqual([tex_figs[mapping[i]].label for i in (0, 1, 2)], ["fig:teaser", "fig:gsnorm", "fig:architecture"])

    def test_pdf_figure_is_rendered_wide_and_cropped(self):
        data = open(os.path.join(FIX, "eprint-2611.08264", "figures", "method", "point_spacing.pdf"), "rb").read()
        out = eprint.convert_graphic("point_spacing.pdf", data)
        self.assertGreaterEqual(out["width"], eprint.MIN_HIRES_WIDTH)
        self.assertIn(out["ext"], ("png", "jpg"))

    def test_raster_figure_is_kept_not_upscaled(self):
        data = open(os.path.join(FIX, "eprint-2611.08264", "figures", "method", "pipeline_2.jpg"), "rb").read()
        out = eprint.convert_graphic("pipeline_2.jpg", data)
        from PIL import Image

        with Image.open(io.BytesIO(data)) as im:
            self.assertEqual(out["width"], min(im.width, eprint.MAX_WIDTH))

    def test_unsafe_member_names_are_dropped(self):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for name in ("../evil.tex", "/abs.tex", "ok.tex"):
                info = tarfile.TarInfo(name)
                data = b"\\documentclass{x}\\begin{document}\\end{document}"
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        archive = eprint.Archive(buf.getvalue())
        self.assertEqual(list(archive.tex), ["ok.tex"])

    def test_eps_is_skipped_without_ghostscript(self):
        import shutil

        if shutil.which("gs"):
            self.skipTest("ghostscript present")
        self.assertIsNone(eprint.convert_graphic("a.eps", b"%!PS-Adobe-3.0 EPSF-3.0"))

    def test_hires_figures_by_html_index(self):
        found = eprint.hires_figures(eprint_bytes(), parsed("2611.08264")["figures"])
        self.assertTrue(found)
        self.assertTrue(all(v["width"] >= 300 for v in found.values()))


class PdfTests(unittest.TestCase):
    def test_pdf_only_paper_gets_sections_and_abstract(self):
        data = open(os.path.join(FIX, "hep-th-9711200.pdf"), "rb").read()
        p = pdf.parse_pdf(data)
        self.assertIn("Large", p["title"])
        self.assertIn("supergravity", p["abstract"])
        self.assertGreater(len(p["sections"]), 5)

    def test_markdown_pipe_tables_become_tables_with_captions(self):
        md = "Table 2. Accuracy by model\n\n| Model | Acc |\n|---|---|\n| A | 71.2 |\n| B | 80.1 |\n"
        t = pdf.md_tables(md)
        self.assertEqual(len(t), 1)
        self.assertEqual((t[0]["label"], t[0]["caption"]), ("Table 2", "Accuracy by model"))
        self.assertEqual(t[0]["rows"], [["A", "71.2"], ["B", "80.1"]])

    def test_unreadable_pdf_returns_none(self):
        self.assertIsNone(pdf.parse_pdf(b"%PDF-1.4 not really"))


def res(status, content=b"", url="https://arxiv.org/x"):
    return net.Fetched(status, url, content, "")


class FallbackChainTests(unittest.TestCase):
    def fetcher(self, routes):
        calls = []

        def fetch(url, **kw):
            calls.append(url)
            for key, value in routes.items():
                if key in url:
                    if isinstance(value, Exception):
                        raise value
                    return value
            return res(404)

        fetch.calls = calls
        return fetch

    def test_html_then_eprint_gives_hires_figures(self):
        fetch = self.fetcher(
            {"/html/": res(200, read("2611.08264.html").encode(), "https://arxiv.org/html/2611.08264v1"),
             "/e-print/": res(200, eprint_bytes())}
        )
        out = service.parse_paper("2611.08264", fetch=fetch)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["paper"]["source"], "html")
        self.assertGreater(out["stats"]["hires"], 0)
        self.assertTrue(out["paper"]["markdown"].startswith("# "))
        self.assertTrue(any(f.get("data") for f in out["paper"]["figures"]))

    def test_eprint_failure_keeps_latexml_figures(self):
        fetch = self.fetcher(
            {"/html/": res(200, read("2611.08264.html").encode(), "https://arxiv.org/html/2611.08264v1"),
             "/e-print/": net.TooLarge("big")}
        )
        out = service.parse_paper("2611.08264", fetch=fetch)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["stats"]["hires"], 0)
        self.assertTrue(all(f["origin"] == "latexml" for f in out["paper"]["figures"]))

    def test_no_html_falls_back_to_pdf(self):
        fetch = self.fetcher({"/html/": res(404), "/pdf/": res(200, open(os.path.join(FIX, "hep-th-9711200.pdf"), "rb").read())})
        out = service.parse_paper("hep-th/9711200", fetch=fetch)
        self.assertEqual(out["status"], "ok")
        self.assertEqual(out["paper"]["source"], "pdf")

    def test_everything_failing_reports_failed(self):
        out = service.parse_paper("2611.00001", fetch=self.fetcher({"/html/": res(404), "/pdf/": res(500)}))
        self.assertEqual(out["status"], "failed")

    def test_network_errors_never_raise(self):
        out = service.parse_paper("2611.00001", fetch=self.fetcher({"/html/": OSError("down"), "/pdf/": OSError("down")}))
        self.assertEqual(out["status"], "failed")

    def test_tiny_budget_skips_eprint(self):
        fetch = self.fetcher(
            {"/html/": res(200, read("2611.08264.html").encode(), "https://arxiv.org/html/2611.08264v1")}
        )
        out = service.parse_paper("2611.08264", budget_seconds=5, fetch=fetch)
        self.assertEqual(out["status"], "ok")
        self.assertFalse(any("/e-print/" in c for c in fetch.calls))

    def test_id_validation(self):
        for ok in ["2611.08264", "2611.08264v2", "hep-th/9711200", "1706.03762"]:
            self.assertTrue(service.valid_id(ok), ok)
        for bad in ["../etc/passwd", "2611.08264;rm", "abc", "http://x"]:
            self.assertFalse(service.valid_id(bad), bad)

    def test_figure_payload_is_capped(self):
        figs = [{"data": b"x" * 5_000_000, "label": str(i)} for i in range(6)]
        kept = service.trim_figures(figs)
        self.assertLessEqual(sum(len(f["data"]) for f in kept), service.MAX_FIGURE_PAYLOAD)


if __name__ == "__main__":
    unittest.main()
