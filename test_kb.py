"""Self-tests for the documentation validator; no network or external services."""
import json
import tempfile
import unittest
from pathlib import Path

from kb import FENCE, index_content, parse_page, validate


def document(page_id, *, kind="topic", sources=None, body="# Test\n", **extra):
    meta = {
        "id": page_id, "title": "测试页面", "type": kind, "tags": ["agent"],
        "sources": sources if sources is not None else (["src-test"] if kind != "source" else []),
        "confidence": "inferred", "status": "reference", "updated": "2026-10-08",
    }
    meta.update(extra)
    return "---\n" + "\n".join(k + ": " + json.dumps(v, ensure_ascii=False) for k, v in meta.items()) + "\n---\n\n" + body


class KnowledgeBaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="agent-kb-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.write("agent/sources/test.md", document("src-test", kind="source"))
        self.write("README.md", "# Test knowledge base\n")
        self.write("agent/README.md", document("agent-index", kind="index"))
        self.write("infra/README.md", document("infra-index", kind="index"))
        self.write("agent/topic.md", document("agent-test", body="# Test\n\n[来源](sources/test.md)\n"))

    def write(self, path, text):
        target = self.root / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")

    def errors(self):
        return validate(self.root, check_index=False)[0]

    def test_valid_and_reproducible_index(self):
        errors, _, pages = validate(self.root, check_index=False)
        self.assertEqual(errors, [])
        generated = index_content(pages)
        self.assertEqual(generated, index_content(dict(reversed(list(pages.items())))))
        self.write("INDEX.md", generated)
        self.assertEqual(validate(self.root)[0], [])

    def test_duplicate_id(self):
        self.write("infra/another.md", document("agent-test"))
        self.assertTrue(any("duplicate id" in e for e in self.errors()))

    def test_unresolved_source(self):
        self.write("agent/topic.md", document("agent-test", sources=["src-missing"]))
        self.assertTrue(any("unresolved source" in e for e in self.errors()))

    def test_broken_link_and_fenced_example(self):
        self.write("agent/topic.md", document("agent-test", body="# Test\n\n[bad](missing.md)\n"))
        self.assertTrue(any("broken link" in e for e in self.errors()))
        body = "# Test\n\n" + FENCE + "md\n[example](missing.md)\n" + FENCE + "\n"
        self.write("agent/topic.md", document("agent-test", body=body))
        self.assertEqual(self.errors(), [])

    def test_private_information(self):
        sample = "# Test\n\nhttps://private.feishu.cn/wiki/secret\n"
        self.write("agent/topic.md", document("agent-test", body=sample))
        self.assertTrue(any("private Feishu" in e for e in self.errors()))

    def test_unknown_tag_and_invalid_date(self):
        self.write("agent/topic.md", document("agent-test", tags=["made-up"], updated="yesterday"))
        result = self.errors()
        self.assertTrue(any("unknown tags" in e for e in result))
        self.assertTrue(any("invalid updated" in e for e in result))

    def test_verified_requires_evidence(self):
        self.write("agent/topic.md", document("agent-test", confidence="verified"))
        self.assertTrue(any("requires evidence" in e for e in self.errors()))

    def test_stale_index(self):
        self.write("INDEX.md", "# out of date\n")
        self.assertTrue(any("stale" in e for e in validate(self.root)[0]))

    def test_link_cannot_escape_repository(self):
        self.write("agent/topic.md", document("agent-test", body="# Test\n\n[escape](../../outside.md)\n"))
        self.assertTrue(any("escapes repository" in e for e in self.errors()))

    def test_duplicate_metadata_key(self):
        with self.assertRaisesRegex(ValueError, "duplicate metadata"):
            parse_page('---\nid: "one"\nid: "two"\n---\n# Test\n')

    def test_wrong_list_type_does_not_crash(self):
        self.write("agent/topic.md", document("agent-test", sources="src-test"))
        self.assertTrue(any("string list" in e for e in self.errors()))


if __name__ == "__main__":
    unittest.main()
