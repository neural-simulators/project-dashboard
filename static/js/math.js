/* Typesets the formal sections (elements with class wm-math) with the vendored KaTeX in static/vendor/katex
   (MIT licence, no CDN). Inline math is written \( ... \), display math \[ ... \]; without JavaScript the
   LaTeX source stays readable. */
(function () {
  'use strict';
  function run() {
    if (!window.renderMathInElement) { return; }
    var roots = document.querySelectorAll('.wm-math');
    for (var i = 0; i < roots.length; i++) {
      window.renderMathInElement(roots[i], {
        delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
        throwOnError: false, strict: 'ignore'
      });
    }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', run); } else { run(); }
})();
