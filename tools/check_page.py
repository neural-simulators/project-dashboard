#!/usr/bin/env python3
"""Static checks for index.html: strict tag balance, local link targets and
the per-block section convention.

    python3 tools/check_page.py [--root PATH]

Parses index.html with the standard-library HTML parser and requires that
every non-void element is closed in order, that every local ``src`` or
``href`` (no scheme, not a fragment) points to an existing file, that ids are
unique, and that every ``<section class="... proposal ...">`` has an id
``proposal-<slug>`` and every ``<section class="... result ...">`` an id
``result-<slug>``.  Prints the block ids it found.  Also checks that
static/data/world_model.js starts with ``window.WM_SAMPLE``.  Exit status 1
when anything fails.
"""
import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit

VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
LINK_ATTRS = {"src", "href", "xlink:href", "poster", "data"}
SLUG = re.compile(r"^[a-z0-9_-]+$")


class Checker(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.errors = []
        self.links = []
        self.ids = {}
        self.blocks = []

    def _attrs(self, tag, attrs):
        attrs = dict(attrs)
        line = self.getpos()[0]
        for name in LINK_ATTRS:
            if attrs.get(name):
                self.links.append((attrs[name], line))
        if attrs.get("id"):
            if attrs["id"] in self.ids:
                self.errors.append("line %d: duplicate id %r (first at line %d)" % (line, attrs["id"], self.ids[attrs["id"]]))
            else:
                self.ids[attrs["id"]] = line
        if tag == "section":
            classes = (attrs.get("class") or "").split()
            kind = "proposal" if "proposal" in classes else ("result" if "result" in classes else None)
            if kind:
                ident = attrs.get("id") or ""
                prefix = kind + "-"
                if not ident.startswith(prefix) or not SLUG.match(ident[len(prefix):] or "-"):
                    self.errors.append("line %d: <section class=%r> needs id %s<slug>, found %r" % (line, attrs.get("class"), prefix, ident))
                self.blocks.append((kind, ident, line))

    def handle_starttag(self, tag, attrs):
        self._attrs(tag, attrs)
        if tag in VOID:
            return
        self.stack.append((tag, self.getpos()[0]))

    def handle_startendtag(self, tag, attrs):
        self._attrs(tag, attrs)

    def handle_endtag(self, tag):
        if tag in VOID:
            self.errors.append("line %d: end tag for void element <%s>" % (self.getpos()[0], tag))
            return
        if not self.stack:
            self.errors.append("line %d: stray </%s>" % (self.getpos()[0], tag))
            return
        open_tag, line = self.stack.pop()
        if open_tag != tag:
            self.errors.append("line %d: </%s> closes <%s> opened at line %d" % (self.getpos()[0], tag, open_tag, line))


def is_local(url):
    parts = urlsplit(url)
    return not parts.scheme and not parts.netloc and bool(parts.path)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--page", default="index.html", help="page to check; the block convention is enforced for index.html only")
    args = parser.parse_args(argv)
    root = Path(args.root)
    text = (root / args.page).read_text(encoding="utf-8")
    checker = Checker()
    checker.feed(text)
    checker.close()
    errors = list(checker.errors)
    for tag, line in checker.stack:
        errors.append("line %d: <%s> never closed" % (line, tag))
    local = 0
    for url, line in checker.links:
        if not is_local(url):
            continue
        local += 1
        target = (root / urlsplit(url).path).resolve()
        if not target.is_file():
            errors.append("line %d: missing local file %s" % (line, url))
    for kind in ("proposal", "result"):
        if args.page == "index.html" and not any(b[0] == kind for b in checker.blocks):
            errors.append("no <section class=\"section %s\"> block found" % kind)
    data = root / "static" / "data" / "world_model.js"
    if not data.is_file():
        errors.append("missing %s" % data)
    else:
        first_code_line = next((ln for ln in data.read_text(encoding="utf-8").splitlines() if not ln.startswith("//")), "")
        if not first_code_line.startswith("window.WM_SAMPLE"):
            errors.append("%s does not start with window.WM_SAMPLE" % data)
    print("%s: %d links, %d local, %d element(s) left open, %d unique id(s), %d error(s)" % (args.page,
        len(checker.links), local, len(checker.stack), len(checker.ids), len(errors)))
    for kind, ident, line in checker.blocks:
        print("  block: %-8s id=%s (line %d)" % (kind, ident, line))
    for err in errors:
        print("  ERROR " + err)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
