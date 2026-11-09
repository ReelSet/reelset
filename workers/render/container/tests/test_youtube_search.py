import unittest
from datetime import datetime, timezone

from reel import youtube_search as ys
from reel.errors import RenderError

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


def hit(video_id, published="2 days ago", views="7,259 views", **extra):
    base = {
        "type": "video",
        "id": video_id,
        "title": f"title {video_id}",
        "publishedTime": published,
        "duration": "13:42",
        "viewCount": {"text": views},
        "channel": {"name": "Chan", "id": "UCabc"},
    }
    base.update(extra)
    return base


def info(published="2026-11-07T16:00:21-08:00", views="37933", seconds="822"):
    return {
        "publishDate": published,
        "viewCount": {"text": views},
        "description": "desc",
        "duration": {"secondsText": seconds},
    }


def run(search_map, info_map, queries=None, **kwargs):
    def search_fn(query, limit):
        value = search_map[query]
        if isinstance(value, Exception):
            raise value
        return value

    def info_fn(video_id):
        value = info_map[video_id]
        if isinstance(value, Exception):
            raise value
        return value

    queries = queries or list(search_map)
    return ys.search_youtube(
        queries, kwargs.pop("max_age", 14), 5, search_fn=search_fn, info_fn=info_fn, now=NOW, **kwargs
    )


class RelativeTimeTests(unittest.TestCase):
    def test_table(self):
        cases = [
            ("3 days ago", 3 * 86400),
            ("1 week ago", 7 * 86400),
            ("Streamed 2 hours ago", 2 * 3600),
            ("23 hours ago", 23 * 3600),
            ("5 minutes ago", 300),
            ("1 month ago", 30 * 86400),
            ("2 years ago", 2 * 365 * 86400),
            ("Streamed 1 day ago", 86400),
            ("Just now", 0),
            (None, None),
            ("", None),
            ("Premieres soon", None),
            (42, None),
        ]
        for text, expected in cases:
            self.assertEqual(ys.min_age_seconds(text), expected, text)


class ParsingTests(unittest.TestCase):
    def test_view_count(self):
        self.assertEqual(ys.parse_view_count("7,259 views"), 7259)
        self.assertEqual(ys.parse_view_count("37933"), 37933)
        self.assertEqual(ys.parse_view_count("No views"), 0)
        self.assertEqual(ys.parse_view_count(None), 0)

    def test_clock_duration(self):
        self.assertEqual(ys.parse_clock_duration("13:42"), 822)
        self.assertEqual(ys.parse_clock_duration("1:02:03"), 3723)
        self.assertIsNone(ys.parse_clock_duration("LIVE"))

    def test_published_at_normalised_to_utc(self):
        self.assertEqual(
            ys.parse_published_at("2026-11-07T16:00:21-08:00").isoformat(), "2026-11-08T00:00:21+00:00"
        )
        self.assertIsNone(ys.parse_published_at("garbage"))


class SearchTests(unittest.TestCase):
    def test_happy_path_shape(self):
        result = run({"q one": [hit("aaaaaaaaaaa")]}, {"aaaaaaaaaaa": info()})
        self.assertEqual(result["failedQueries"], [])
        self.assertEqual(
            result["videos"],
            [
                {
                    "videoId": "aaaaaaaaaaa",
                    "title": "title aaaaaaaaaaa",
                    "channelName": "Chan",
                    "channelId": "UCabc",
                    "url": "https://www.youtube.com/watch?v=aaaaaaaaaaa",
                    "publishedAt": "2026-11-08T00:00:21Z",
                    "viewCount": 37933,
                    "durationSec": 822,
                    "description": "desc",
                    "thumbnailUrl": "https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg",
                }
            ],
        )

    def test_relative_time_skips_getinfo_for_old_results(self):
        calls = []

        def info_fn(video_id):
            calls.append(video_id)
            return info()

        result = ys.search_youtube(
            ["q one"],
            14,
            5,
            search_fn=lambda q, n: [
                hit("aaaaaaaaaaa", "3 days ago"),
                hit("bbbbbbbbbbb", "1 month ago"),
                hit("ccccccccccc", None),
                hit("ddddddddddd", "Streamed 2 hours ago"),
            ],
            info_fn=info_fn,
            now=NOW,
        )
        self.assertEqual(sorted(calls), ["aaaaaaaaaaa", "ccccccccccc", "ddddddddddd"])
        self.assertEqual(len(result["videos"]), 3)

    def test_exact_date_drops_old_videos(self):
        result = run(
            {"q one": [hit("aaaaaaaaaaa", "2 weeks ago"), hit("bbbbbbbbbbb", None)]},
            {
                "aaaaaaaaaaa": info(published="2026-10-26T11:00:00+00:00"),
                "bbbbbbbbbbb": info(published="2026-11-08T12:00:00+00:00"),
            },
        )
        self.assertEqual([v["videoId"] for v in result["videos"]], ["bbbbbbbbbbb"])

    def test_dedupes_across_queries(self):
        seen = []

        def info_fn(video_id):
            seen.append(video_id)
            return info()

        result = ys.search_youtube(
            ["q one", "q two"],
            14,
            5,
            search_fn=lambda q, n: [hit("aaaaaaaaaaa"), hit("aaaaaaaaaaa")],
            info_fn=info_fn,
            now=NOW,
        )
        self.assertEqual(seen, ["aaaaaaaaaaa"])
        self.assertEqual(len(result["videos"]), 1)

    def test_ignores_non_videos_and_bad_ids(self):
        result = run(
            {"q one": [hit("aaaaaaaaaaa", type="channel"), hit("short"), hit("bbbbbbbbbbb"), "junk"]},
            {"bbbbbbbbbbb": info()},
        )
        self.assertEqual([v["videoId"] for v in result["videos"]], ["bbbbbbbbbbb"])

    def test_getinfo_failure_skips_that_video(self):
        result = run(
            {"q one": [hit("aaaaaaaaaaa"), hit("bbbbbbbbbbb")]},
            {"aaaaaaaaaaa": RuntimeError("boom"), "bbbbbbbbbbb": info()},
        )
        self.assertEqual([v["videoId"] for v in result["videos"]], ["bbbbbbbbbbb"])

    def test_missing_publish_date_is_dropped(self):
        result = run({"q one": [hit("aaaaaaaaaaa")]}, {"aaaaaaaaaaa": {"description": "x"}})
        self.assertEqual(result["videos"], [])

    def test_partial_failure_reports_failed_queries(self):
        result = run(
            {"good q": [hit("aaaaaaaaaaa")], "bad q": TypeError("broken")},
            {"aaaaaaaaaaa": info()},
        )
        self.assertEqual(result["failedQueries"], ["bad q"])
        self.assertEqual(len(result["videos"]), 1)

    def test_total_failure_raises(self):
        with self.assertRaises(ys.SearchFailed):
            run({"bad one": TypeError("x"), "bad two": TypeError("y")}, {})

    def test_empty_results_are_not_a_failure(self):
        self.assertEqual(run({"q one": []}, {}), {"status": "ok", "videos": [], "failedQueries": []})


class ValidationTests(unittest.TestCase):
    def good(self, **over):
        body = {"queries": ["open source ai"], "maxAgeDays": 14, "perQueryLimit": 5}
        body.update(over)
        return body

    def test_accepts_valid(self):
        self.assertEqual(ys.validate_search_request(self.good()), (["open source ai"], 14, 5))
        ys.validate_search_request(self.good(queries=["ab"] * 30, maxAgeDays=30, perQueryLimit=20))
        ys.validate_search_request(self.good(maxAgeDays=1, perQueryLimit=1))

    def test_rejects_invalid(self):
        bad = [
            "not a dict",
            self.good(queries=[]),
            self.good(queries=["ab"] * 31),
            self.good(queries="open source"),
            self.good(queries=["a"]),
            self.good(queries=["x" * 101]),
            self.good(queries=[5]),
            self.good(queries=["  a  "]),
            self.good(maxAgeDays=0),
            self.good(maxAgeDays=31),
            self.good(maxAgeDays="7"),
            self.good(maxAgeDays=True),
            self.good(maxAgeDays=7.5),
            self.good(perQueryLimit=0),
            self.good(perQueryLimit=21),
            {"queries": ["abc"]},
        ]
        for payload in bad:
            with self.assertRaises(RenderError) as ctx:
                ys.validate_search_request(payload)
            self.assertEqual(ctx.exception.code, "invalid_input")


if __name__ == "__main__":
    unittest.main()
