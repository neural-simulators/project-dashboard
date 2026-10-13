#!/usr/bin/env python3
"""Static checks for the standalone post_training.html and its script.

    python3 tools/check_post_training.py [--root PATH]

Reuses the parser of tools/check_page.py: tag balance, local link targets,
unique ids, the two block markers, the data file's global, and a bracket
balance scan of static/js/post_training/main.js outside strings and comments
(no JavaScript engine is available on the cluster; this catches truncated or
mismatched blocks, not type errors).
"""
import argparse
import sys
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check_page import Checker, is_local  # noqa: E402

REQUIRED_IDS = ('proposal-post_training', 'result-post_training_poc', 'pt-examples', 'pt-grpo', 'pt-dpo', 'pt-experiment-table',
                'pt-strip', 'pt-status', 'pt-results-table', 'pt-failed-checks')


def js_balance(text):
    stack, problems, i, n, line = [], [], 0, len(text), 1
    pairs = {')': '(', ']': '[', '}': '{'}
    while i < n:
        ch = text[i]
        if ch == '\n':
            line += 1
        if ch == '/' and i + 1 < n and text[i + 1] == '/':
            while i < n and text[i] != '\n':
                i += 1
            continue
        if ch == '/' and i + 1 < n and text[i + 1] == '*':
            end = text.find('*/', i + 2)
            line += text[i:end].count('\n')
            i = end + 2 if end != -1 else n
            continue
        if ch in ('"', "'", '`'):
            quote, i = ch, i + 1
            while i < n and text[i] != quote:
                if text[i] == '\\':
                    i += 1
                if i < n and text[i] == '\n':
                    line += 1
                i += 1
            i += 1
            continue
        if ch in '([{':
            stack.append((ch, line))
        elif ch in ')]}':
            if not stack or stack[-1][0] != pairs[ch]:
                problems.append('line %d: unexpected %r' % (line, ch))
                if stack:
                    stack.pop()
            else:
                stack.pop()
        i += 1
    for ch, at in stack:
        problems.append('line %d: %r never closed' % (at, ch))
    return problems


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--root', default=str(Path(__file__).resolve().parents[1]))
    args = parser.parse_args(argv)
    root = Path(args.root)
    html = (root / 'post_training.html').read_text(encoding='utf-8')
    checker = Checker()
    checker.feed(html)
    checker.close()
    errors = list(checker.errors) + ['line %d: <%s> never closed' % (line, tag) for tag, line in checker.stack]
    local = 0
    for url, line in checker.links:
        if not is_local(url):
            continue
        local += 1
        if not (root / urlsplit(url).path).resolve().is_file():
            errors.append('line %d: missing local file %s' % (line, url))
    for needed in REQUIRED_IDS:
        if needed not in checker.ids:
            errors.append('post_training.html lacks id="%s"' % needed)
    for marker in ('<!-- ---------- proposal: post_training ---------- -->', '<!-- ---------- end proposal: post_training ---------- -->',
                   '<!-- ---------- result: post_training_poc ---------- -->', '<!-- ---------- end result: post_training_poc ---------- -->'):
        if marker not in html:
            errors.append('missing marker ' + marker)
    data = root / 'static/data/post_training.js'
    if not data.is_file():
        errors.append('missing %s' % data)
    else:
        first = next((ln for ln in data.read_text(encoding='utf-8').splitlines() if not ln.startswith('//')), '')
        if not first.startswith('window.POST_TRAINING_DATA'):
            errors.append('%s does not start with window.POST_TRAINING_DATA' % data)
    script = root / 'static/js/post_training/main.js'
    if not script.is_file():
        errors.append('missing %s' % script)
    else:
        errors += ['main.js ' + p for p in js_balance(script.read_text(encoding='utf-8'))]
    print('post_training.html: %d links, %d local, %d unique id(s), %d error(s)' % (len(checker.links), local, len(checker.ids), len(errors)))
    for err in errors:
        print('  ERROR ' + err)
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
