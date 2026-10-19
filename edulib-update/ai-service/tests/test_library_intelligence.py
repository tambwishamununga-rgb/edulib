import unittest

from app.analyzer import analyze, summarize
from app.extractors import _author
from app.recommender import recommend, similar


def item(i, title, subject, kws, weight=1.0):
    return {"id": i, "title": title, "subject": subject, "keywords": kws, "topics": [subject], "weight": weight}


DB1 = item("db1", "Intro to Relational Databases", "Databases and Information Management Systems",
           ["database", "sql", "primary key", "normalization"])
DB2 = item("db2", "SQL Joins Workbook", "Databases and Information Management Systems",
           ["sql", "join", "database", "select"])
ADV = item("adv", "Query Optimisation", "Advanced Databases", ["query planner", "index", "sql", "database"])
OS1 = item("os1", "Process Scheduling", "Operating Systems", ["process", "scheduling", "deadlock"])
OS2 = item("os2", "Virtual Memory", "Operating Systems", ["paging", "virtual memory", "kernel"])
NET = item("net", "TCP and Routing", "Data Communications and Networks", ["tcp", "routing", "packet"])


class SummaryAndAuthor(unittest.TestCase):
    TEXT = ("A database stores records in tables and every table has a primary key. "
            "Normalization removes redundancy from a relational database design. "
            "The weather in Lusaka is usually pleasant during the dry season months. "
            "SQL queries retrieve records from a database table using select statements.")

    def test_summary_prefers_on_topic_sentences(self):
        s = summarize(self.TEXT)
        self.assertIn("database", s.lower())
        self.assertNotIn("weather", s.lower())

    def test_summary_survives_hard_wrapped_pdf_lines(self):
        wrapped = ("A database stores records in tables, and every table has a primary key that\n"
                   "identifies each record uniquely. Normalization removes redundancy from a\n"
                   "relational database design by splitting data into well structured tables.\n"
                   "Unrelated filler sentence about the weather being pleasant in the dry season.")
        out = summarize(wrapped)
        self.assertIn("identifies each record uniquely.", out)     # sentence kept whole across the line break
        self.assertNotIn("weather", out)

    def test_summary_none_for_tiny_text(self):
        self.assertIsNone(summarize("Too short."))
        self.assertIsNone(summarize(""))

    def test_summary_is_in_analysis(self):
        r = analyze("notes.txt", self.TEXT.encode())
        self.assertTrue(r["summary"])
        self.assertIsNone(r["author"])

    def test_junk_authors_dropped(self):
        for junk in ("admin", "Microsoft Office User", "", None, "ab"):
            self.assertIsNone(_author(junk))
        self.assertEqual(_author("Dr. L. Phiri"), "Dr. L. Phiri")


class Keywords(unittest.TestCase):
    TEXT = ("A record is stored in a table. Several records share another table, and each table links records "
            "by key. The relational database keeps every record safe. A relational database uses SQL.")

    def test_filler_words_removed(self):
        from app.analyzer import extract_keywords
        kws = extract_keywords(self.TEXT)
        for junk in ("several", "another", "every", "each"):
            self.assertNotIn(junk, kws)

    def test_plurals_are_folded(self):
        from app.analyzer import extract_keywords
        kws = extract_keywords(self.TEXT)
        self.assertFalse("record" in kws and "records" in kws)
        self.assertIn("relational database", kws)


class Similarity(unittest.TestCase):
    def test_database_books_are_most_similar(self):
        r = similar(DB1, [DB2, ADV, OS1, NET], top_n=3)
        self.assertEqual(r[0]["id"], "db2")
        self.assertNotIn("net", [x["id"] for x in r])       # unrelated, below threshold
        self.assertTrue(r[0]["reason"].startswith("Shares"))

    def test_target_not_returned(self):
        self.assertNotIn("db1", [x["id"] for x in similar(DB1, [DB1, DB2])])


class Recommendations(unittest.TestCase):
    def test_cold_start_is_empty(self):
        self.assertEqual(recommend([], [DB1, OS1]), [])

    def test_recommends_related_and_excludes_history(self):
        r = recommend([DB1], [DB1, DB2, ADV, OS1, NET])
        ids = [x["id"] for x in r]
        self.assertNotIn("db1", ids)
        self.assertEqual(ids[0], "db2")
        self.assertIn("Because you read", r[0]["reason"])
        self.assertIn("Intro to Relational Databases", r[0]["reason"])

    def test_downloads_outweigh_views(self):
        hist = [dict(DB1, weight=1.0), dict(OS1, weight=5.0)]       # OS1 heavily used
        r = recommend(hist, [DB2, OS2])
        self.assertEqual(r[0]["id"], "os2")

    def test_diversity_mixes_courses(self):
        """A student reads two courses; three close database matches should not crowd out the OS one."""
        S_DB = "Databases and Information Management Systems"
        hist = [item("h1", "DB basics", S_DB, ["sql", "database", "table"]),
                item("h2", "OS basics", "Operating Systems", ["process", "kernel", "scheduling"])]
        cands = [item("d1", "D1", S_DB, ["sql", "database", "table", "join"]),
                 item("d2", "D2", S_DB, ["sql", "database", "table", "select"]),
                 item("d3", "D3", S_DB, ["sql", "database", "table", "record"]),
                 item("o1", "O1", "Operating Systems", ["process", "kernel", "thread"])]

        from app import recommender
        original = recommender.DIVERSITY_DECAY
        try:
            recommender.DIVERSITY_DECAY = 1.0                    # penalty off
            plain = [x["id"] for x in recommend(hist, cands, top_n=3)]
            recommender.DIVERSITY_DECAY = original               # penalty on
            diverse = [x["id"] for x in recommend(hist, cands, top_n=3)]
        finally:
            recommender.DIVERSITY_DECAY = original
        self.assertNotIn("o1", plain)       # without the penalty the database items fill the shelf
        self.assertIn("o1", diverse)        # with it, the other course is surfaced


if __name__ == "__main__":
    unittest.main()
