#!/usr/bin/env python3
"""Tag every local stylesheet and script link on every page with ?v=<content hash>.

    python3 tools/stamp_assets.py [--root PATH] [--check]

Python's http.server sends no cache headers and a normal browser reload keeps
scripts it considers fresh, so an edited file can keep running in its old
form. A link whose URL changes with the file's content is always fetched anew.
Idempotent; run it after editing anything under static/css, static/js or
static/data. ``--check`` only reports links whose version is missing or stale.
"""
import argparse
import hashlib
import re
import sys
from pathlib import Path

LINK = re.compile(r'(?P<attr>src|href)="(?P<path>\./static/(?:css|js|data)/[^"?#]+)(?:\?v=[0-9a-f]+)?"')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    root, stale = Path(args.root), []
    for page in sorted(root.glob("*.html")):
        text = page.read_text(encoding="utf-8")

        def stamp(match):
            target = root / match.group("path")
            if not target.is_file():
                return match.group(0)
            wanted = '%s="%s?v=%s"' % (match.group("attr"), match.group("path"), hashlib.sha256(target.read_bytes()).hexdigest()[:10])
            if wanted != match.group(0):
                stale.append("%s: %s" % (page.name, match.group("path")))
            return wanted

        new = LINK.sub(stamp, text)
        if new != text and not args.check:
            page.write_text(new, encoding="utf-8")
    print("%s %d link(s)%s" % ("stale:" if args.check else "stamped", len(stale), "" if not stale else ": " + ", ".join(stale[:12]) + (" ..." if len(stale) > 12 else "")))
    return 1 if (args.check and stale) else 0


if __name__ == "__main__":
    sys.exit(main())
