#!/usr/bin/env python3
"""Check that every page shows the same project tabs.

    python3 tools/check_nav.py [--root PATH]

The tab list lives in static/js/site_nav.js. Standalone pages must carry a
``<nav ... data-site-nav="KEY">`` (filled by that script) and load the script;
index.html keeps a static tab bar, whose labels and links must match the list
in the same order. Exit status 1 on any mismatch.
"""
import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

PAGES = {"end-to-end.html": "end-to-end", "scaled-results.html": "scaled-results", "how-it-works.html": "how-it-works",
         "digital-twins.html": "digital-twins", "benchmark.html": "results",
         "physics-guided.html": "physics-guided"}


def site_tabs(root):
    text = (root / "static/js/site_nav.js").read_text(encoding="utf-8")
    return [(label, href) for label, href in re.findall(r"label: '([^']+)', icon: '[^']+', href: '([^']+)'", text)]


class IndexTabs(HTMLParser):
    """Labels and hrefs of the <ul> inside the element with id="wm-tabs"."""
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth, self.inside, self.href, self.span, self.tabs = 0, False, None, False, []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get("id") == "wm-tabs":
            self.inside, self.depth = True, 0
        if not self.inside:
            return
        self.depth += 1
        if tag == "a":
            self.href = attrs.get("href")
        if tag == "span" and "icon" not in (attrs.get("class") or ""):
            self.span = True

    def handle_endtag(self, tag):
        if not self.inside:
            return
        self.depth -= 1
        if tag == "span":
            self.span = False
        if self.depth < 0:
            self.inside = False

    def handle_data(self, data):
        if self.inside and self.span and data.strip():
            self.tabs.append((data.strip(), self.href))


def normalise(href):
    return href.replace("./index.html#", "#")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    root = Path(args.root)
    tabs, errors = site_tabs(root), []
    if not tabs:
        errors.append("no tabs found in static/js/site_nav.js")
    parser_ = IndexTabs()
    parser_.feed((root / "index.html").read_text(encoding="utf-8"))
    index_tabs = [(label, normalise(href or "")) for label, href in parser_.tabs]
    if index_tabs != [(label, normalise(href)) for label, href in tabs]:
        errors.append("index.html tab bar %s differs from site_nav.js %s" % (index_tabs, tabs))
    for page, key in PAGES.items():
        path = root / page
        if not path.is_file():
            continue
        html = path.read_text(encoding="utf-8")
        if 'data-site-nav="%s"' % key not in html:
            errors.append('%s lacks <nav data-site-nav="%s">' % (page, key))
        if "static/js/site_nav.js" not in html:
            errors.append("%s does not load static/js/site_nav.js" % page)
    print("site tabs: %s" % ", ".join(label for label, _ in tabs))
    for error in errors:
        print("  ERROR " + error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
