#!/usr/bin/env python3
"""Validate the public knowledge base and build a deterministic Markdown index.

No dependencies, network access, or execution of document content.
Frontmatter uses a restricted YAML-compatible format: key: <JSON value>.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urlsplit

TAGS = {
    "agent", "infra", "runtime", "recovery", "storage", "context", "memory",
    "tools", "security", "multi-agent", "evaluation", "sandbox", "research",
    "projects", "interview", "evidence", "budget", "inference", "performance",
    "gpu", "kubernetes", "learning",
}
TYPES = {"index", "source", "topic", "plan"}
CONFIDENCE = {"verified", "source-reported", "inferred", "experimental"}
STATUS = {"reference", "practice-reported", "design", "learning-plan"}
REQUIRED = {"id", "title", "type", "tags", "sources", "confidence", "status", "updated"}
PRIVATE_PATTERNS = {
    "local machine path": re.compile(r"/(?:Users|home)/[^\s/]+"),
    "private Feishu URL": re.compile(r"https?://[^/\s]+\.feishu\.cn/"),
    "raw chat identifier/link": re.compile(r"codex://|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"),
    "IP address": re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b"),
    "email address": re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}"),
    "private key": re.compile(r"-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----"),
    "credential": re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9_-]{20,})\b"),
}
LINK = re.compile(r"!?\[[^\]]*\]\(([^)\n]+)\)")
FENCE = chr(96) * 3


def parse_page(text: str) -> tuple[dict, str]:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise ValueError("missing frontmatter")
    try:
        end = lines.index("---", 1)
    except ValueError:
        raise ValueError("unclosed frontmatter") from None
    meta = {}
    for number, line in enumerate(lines[1:end], 2):
        if not line.strip():
            continue
        key, sep, value = line.partition(":")
        if not sep or not re.fullmatch(r"[a-z_]+", key):
            raise ValueError(f"invalid metadata line {number}")
        if key in meta:
            raise ValueError(f"duplicate metadata key: {key}")
        try:
            meta[key] = json.loads(value.strip())
        except json.JSONDecodeError:
            raise ValueError(f"{key}: use a single-line JSON value") from None
    return meta, "\n".join(lines[end + 1:])


def without_fences(text: str) -> str:
    return re.sub(r"(?ms)^" + FENCE + r"[^\n]*\n.*?^" + FENCE + r"\s*$", "", text)


def table_text(value: str) -> str:
    return value.replace("|", r"\|").replace("\n", " ")


def index_content(pages: dict[str, dict]) -> str:
    topics = [(p, m) for p, m in sorted(pages.items()) if m["type"] in {"topic", "plan"}]
    out = [
        "# 知识索引", "",
        "> 由 python3 kb.py --write-index 生成；不要手工维护。", "",
        "[首页](README.md) · [Agent](agent/README.md) · [Infra](infra/README.md)", "",
        "## 按问题查找", "",
        "| 主线 | 问题 / 页面 | 状态 |", "| --- | --- | --- |",
    ]
    for path, m in topics:
        out.append(f'| {path.split("/")[0]} | [{table_text(m["title"])}]({path}) | {m["status"]} |')
    out.extend(["", "## 按主题标签", ""])
    tagged = defaultdict(list)
    for path, m in topics:
        for tag in m["tags"]:
            tagged[tag].append((path, m))
    for tag in sorted(tagged):
        out.extend([f"### {tag}", ""])
        out.extend(f'- [{m["title"]}]({p})' for p, m in tagged[tag])
        out.append("")
    out.extend(["## 按来源追踪", ""])
    for source_path, source in sorted(pages.items()):
        if source["type"] != "source":
            continue
        out.extend([f'### {source["id"]}', "", f'来源：[{source["title"]}]({source_path})', ""])
        out.extend(f'- [{m["title"]}]({p})' for p, m in topics if source["id"] in m["sources"])
        out.append("")
    out.extend([
        "## 按时间与状态", "",
        "| 更新日期 | 状态 | 可信度 | 页面 |", "| --- | --- | --- | --- |",
    ])
    for path, m in sorted(topics, key=lambda pair: (pair[1]["updated"], pair[0]), reverse=True):
        out.append(
            f'| {m["updated"]} | {m["status"]} | {m["confidence"]} | '
            f'[{table_text(m["title"])}]({path}) |'
        )
    return "\n".join(out).rstrip() + "\n"


def validate(root: Path, check_index: bool = True) -> tuple[list[str], list[str], dict]:
    root = root.resolve()
    errors, warnings, pages, by_id = [], [], {}, {}
    paths = sorted(p for area in ("agent", "infra") for p in (root / area).rglob("*.md"))
    if not paths:
        errors.append("no knowledge pages")
    for path in paths:
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            errors.append(f"{rel}: symlinks are not allowed")
            continue
        try:
            meta, body = parse_page(path.read_text(encoding="utf-8"))
        except (ValueError, UnicodeError) as exc:
            errors.append(f"{rel}: {exc}")
            continue
        missing = REQUIRED - meta.keys()
        if missing:
            errors.append(f"{rel}: missing fields {sorted(missing)}")
            continue
        scalar_keys = ("id", "title", "type", "confidence", "status", "updated")
        if any(not isinstance(meta[k], str) or not meta[k].strip() for k in scalar_keys):
            errors.append(f"{rel}: scalar fields must be nonempty strings")
            continue
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", meta["id"]):
            errors.append(f"{rel}: invalid id")
        if meta["id"] in by_id:
            errors.append(f'{rel}: duplicate id {meta["id"]}')
        by_id[meta["id"]] = rel
        for field, values in (("type", TYPES), ("confidence", CONFIDENCE), ("status", STATUS)):
            if meta[field] not in values:
                errors.append(f"{rel}: unknown {field} {meta[field]}")
        valid_lists = True
        for field in ("tags", "sources"):
            value = meta[field]
            if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
                errors.append(f"{rel}: {field} must be a string list")
                valid_lists = False
            elif len(value) != len(set(value)):
                errors.append(f"{rel}: duplicate {field}")
        if not valid_lists:
            continue
        if not meta["tags"] or set(meta["tags"]) - TAGS:
            errors.append(f"{rel}: empty or unknown tags")
        if meta["type"] != "source" and not meta["sources"]:
            errors.append(f"{rel}: missing sources")
        if meta["type"] == "source" and meta["sources"]:
            errors.append(f"{rel}: source pages must not have transitive sources")
        if meta["type"] == "source" and path.parent.name != "sources":
            errors.append(f"{rel}: source page must be in sources/")
        if path.parent.name == "sources" and meta["type"] != "source":
            errors.append(f"{rel}: non-source page in sources/")
        if meta["confidence"] == "verified":
            evidence = meta.get("evidence", [])
            if not isinstance(evidence, list) or not evidence:
                errors.append(f"{rel}: verified requires evidence paths")
            else:
                for item in evidence:
                    target = (path.parent / str(item)).resolve()
                    if not target.is_relative_to(root) or not target.is_file():
                        errors.append(f"{rel}: missing or unsafe evidence")
        try:
            date = dt.date.fromisoformat(meta["updated"])
            age = (dt.date.today() - date).days
            if age < 0:
                warnings.append(f"{rel}: update date is in the future")
            if age > 90 and meta["status"] in {"reference", "learning-plan"}:
                warnings.append(f"{rel}: review freshness ({age} days)")
        except ValueError:
            errors.append(f"{rel}: invalid updated date")
        if not re.search(r"(?m)^# .+", body):
            errors.append(f"{rel}: missing page heading")
        pages[rel] = meta
    for rel, meta in pages.items():
        for source in meta["sources"]:
            target = by_id.get(source)
            if not target or pages.get(target, {}).get("type") != "source":
                errors.append(f"{rel}: unresolved source {source}")
    docs = sorted(set(paths + list(root.glob("*.md"))))
    for path in docs:
        rel = path.relative_to(root).as_posix()
        if path.is_symlink():
            errors.append(f"{rel}: symlinks are not allowed")
            continue
        text = path.read_text(encoding="utf-8")
        for label, pattern in PRIVATE_PATTERNS.items():
            if pattern.search(text):
                errors.append(f"{rel}: possible {label}; review before publishing")
        for raw in LINK.findall(without_fences(text)):
            url = raw.strip().split(' "', 1)[0].strip("<>")
            parsed = urlsplit(url)
            if parsed.scheme in {"http", "https"}:
                continue
            if parsed.scheme:
                errors.append(f"{rel}: unsupported link scheme")
                continue
            if not parsed.path:
                continue
            if parsed.path.startswith("/"):
                errors.append(f"{rel}: absolute local link")
                continue
            target = (path.parent / unquote(parsed.path)).resolve()
            if not target.is_relative_to(root):
                errors.append(f"{rel}: link escapes repository")
            elif not target.exists():
                if not check_index and target == root / "INDEX.md":
                    continue
                errors.append(f"{rel}: broken link {url}")
    if check_index and not errors:
        index = root / "INDEX.md"
        if not index.exists() or index.read_text(encoding="utf-8") != index_content(pages):
            errors.append("INDEX.md is missing or stale; run python3 kb.py --write-index")
    return errors, warnings, pages


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write-index", action="store_true", help="Regenerate INDEX.md after validation")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    errors, warnings, pages = validate(root, check_index=not args.write_index)
    for warning in warnings:
        print("WARN:", warning)
    if errors:
        for error in errors:
            print("ERROR:", error)
        return 1
    if args.write_index:
        (root / "INDEX.md").write_text(index_content(pages), encoding="utf-8")
        print("Updated INDEX.md")
    topics = sum(m["type"] in {"topic", "plan"} for m in pages.values())
    print(f"OK: {len(pages)} knowledge pages, {topics} topics; metadata, sources, local links and privacy checks passed.")
    print("Limits: does not verify technical claims, external URLs, heading fragments or all possible sensitive data.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
