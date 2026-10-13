#!/usr/bin/env python3
"""Copy the post-training proposal and result blocks from post_training.html into index.html.

``post_training.html`` is the standalone preview and the source of truth for
the two blocks (``proposal-post_training`` and ``result-post_training_poc``),
each delimited by the dashboard's marker comments.  This script inserts them
at the "append the next ... block here" comments of ``index.html`` or
replaces an earlier copy between the same markers, touching nothing else, and
then runs ``tools/check_page.py``.  Idempotent.

    python3 tools/install_post_training_block.py [--root PATH] [--dry-run]
"""
import argparse
import subprocess
import sys
from pathlib import Path

BLOCKS = (("proposal", "post_training", "  <!-- install the post-training block here -->"),   # its own tab (#post-training)
          ("result", "post_training_poc", "  <!-- append the next result block here -->"))


def markers(kind, slug):
    return "  <!-- ---------- %s: %s ---------- -->" % (kind, slug), "  <!-- ---------- end %s: %s ---------- -->" % (kind, slug)


def extract(text, kind, slug):
    start, end = markers(kind, slug)
    a, b = text.find(start), text.find(end)
    if a < 0 or b < 0 or b < a:
        raise SystemExit("post_training.html lacks the %s block markers for %s" % (kind, slug))
    return text[a:b + len(end)]


def install(index, block, kind, slug, anchor):
    start, end = markers(kind, slug)
    a, b = index.find(start), index.find(end)
    if a >= 0 and b >= 0 and b > a:
        return index[:a] + block + index[b + len(end):], "replaced"
    if anchor not in index:
        raise SystemExit("index.html lacks the anchor comment %r" % anchor.strip())
    return index.replace(anchor, block + "\n\n" + anchor, 1), "inserted"


ASSETS = ("static/data/post_training.js", "static/js/post_training/main.js", "static/css/post_training.css")


def stamp_versions(root, text):
    """Append ?v=<content hash> to the block's script URLs, so browsers never run a stale cached copy."""
    import hashlib
    import re
    digest = hashlib.sha256(b"".join((root / a).read_bytes() for a in ASSETS)).hexdigest()[:10]
    for asset in ASSETS[:2]:
        text = re.sub(r'src="\./%s(\?v=[0-9a-f]+)?"' % re.escape(asset), 'src="./%s?v=%s"' % (asset, digest), text)
    return text, digest


def stamp_head(root, index):
    """Version the shared tab script in the head the same way (it changed when the post-training tab was added)."""
    import hashlib
    import re
    digest = hashlib.sha256((root / "static/js/project.js").read_bytes()).hexdigest()[:10]
    return re.sub(r'src="\./static/js/project\.js(\?v=[0-9a-f]+)?"', 'src="./static/js/project.js?v=%s"' % digest, index), digest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--dry-run", action="store_true", help="report what would change without writing")
    args = parser.parse_args(argv)
    root = Path(args.root)
    source, version = stamp_versions(root, (root / "post_training.html").read_text(encoding="utf-8"))
    source, _ = stamp_head(root, source)
    if not args.dry_run:
        (root / "post_training.html").write_text(source, encoding="utf-8")
    print("block assets version %s" % version)
    index_path = root / "index.html"
    index, head_version = stamp_head(root, index_path.read_text(encoding="utf-8"))
    print("project.js version %s" % head_version)
    for kind, slug, anchor in BLOCKS:
        block = extract(source, kind, slug)
        index, action = install(index, block, kind, slug, anchor)
        print("%s block %s-%s (%d lines)" % (action, kind, slug, block.count("\n") + 1))
    if args.dry_run:
        print("dry run: index.html not written")
        return 0
    index_path.write_text(index, encoding="utf-8")
    subprocess.call([sys.executable, str(root / "tools" / "stamp_assets.py"), "--root", str(root)])   # per-file versions on every page
    return subprocess.call([sys.executable, str(root / "tools" / "check_page.py"), "--root", str(root)])


if __name__ == "__main__":
    sys.exit(main())
