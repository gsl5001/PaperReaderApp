#!/usr/bin/env python3
"""Find PDF page numbers for sections, for plan/v1 page references.

Page numbers printed by this script are PDF page numbers (1 = first page of the
file), which is what the Learning Planner reader uses.

Usage:
  python pdf_pages.py info FILE.pdf
  python pdf_pages.py outline FILE.pdf [--depth N]
  python pdf_pages.py find FILE.pdf REGEX [--from N] [--to M]

Requires pypdf:  pip install pypdf
"""
import argparse
import re
import sys

try:
    from pypdf import PdfReader
except ImportError:
    sys.exit("pypdf is not installed. Run: pip install pypdf")


def cmd_info(reader, args):
    print(f"pages: {len(reader.pages)}")
    first = reader.pages[0].extract_text() or ""
    m = re.search(r"arXiv:(\d{4}\.\d{4,5}v\d+)", first)
    print(f"arXiv version stamp: {m.group(1) if m else 'not found'}")
    meta = reader.metadata or {}
    if meta.get("/Title"):
        print(f"title metadata: {meta.get('/Title')}")


def cmd_outline(reader, args):
    try:
        outline = reader.outline
    except Exception as e:  # malformed outlines exist in the wild
        print(f"could not read outline: {e}")
        return
    if not outline:
        print("no outline (bookmarks); use `find` to search headings")
        return

    def walk(items, depth):
        for item in items:
            if isinstance(item, list):
                if depth < args.depth:
                    walk(item, depth + 1)
                continue
            try:
                page = reader.get_destination_page_number(item) + 1
            except Exception:
                page = "?"
            print(f"{'  ' * depth}{item.title.strip()[:90]}  -> p.{page}")

    walk(outline, 0)


def page_lines(page):
    text = page.extract_text() or ""
    return [line.strip() for line in text.splitlines() if line.strip()]


def cmd_find(reader, args):
    pattern = re.compile(args.regex)
    n = len(reader.pages)
    start = max(1, args.from_page)
    end = min(n, args.to_page or n)
    hits = 0
    for i in range(start, end + 1):
        for line in page_lines(reader.pages[i - 1]):
            if pattern.search(line):
                print(f"p.{i}: {line[:110]}")
                hits += 1
    if not hits:
        print(f"no lines matched on pages {start}-{end}")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("info", help="page count and arXiv version")
    p.add_argument("file")

    p = sub.add_parser("outline", help="bookmarks with PDF page numbers")
    p.add_argument("file")
    p.add_argument("--depth", type=int, default=1, help="nesting levels to show below the top (default 1)")

    p = sub.add_parser("find", help="lines matching a regex, with PDF page numbers")
    p.add_argument("file")
    p.add_argument("regex")
    p.add_argument("--from", dest="from_page", type=int, default=1)
    p.add_argument("--to", dest="to_page", type=int, default=0)

    args = parser.parse_args()
    reader = PdfReader(args.file)
    {"info": cmd_info, "outline": cmd_outline, "find": cmd_find}[args.cmd](reader, args)


if __name__ == "__main__":
    main()
