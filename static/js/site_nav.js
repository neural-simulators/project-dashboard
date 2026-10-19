/* The project's tabs, in one place. Every standalone page carries an empty
     <nav class="tabs is-centered is-boxed wm-tabs" data-site-nav="KEY" aria-label="Project pages"></nav>
   and this script fills it, marking KEY as the current page. index.html keeps a static tab bar with the same
   entries (its in-page tabs need data-tab attributes); tools/check_nav.py checks that the two agree.
   To add a tab: add one line below, then mirror it in index.html's tab bar and run tools/check_nav.py. */
(function () {
  'use strict';
  var TABS = [
    { key: 'overview', label: 'Overview', icon: 'fa-home', href: './index.html#overview' },
    { key: 'design', label: 'World model', icon: 'fa-drafting-compass', href: './index.html#design' },
    { key: 'post-training', label: 'Post-training', icon: 'fa-graduation-cap', href: './index.html#post-training' },
    { key: 'how-it-works', label: 'How models are prompted', icon: 'fa-comment-dots', href: './how-it-works.html' },
    { key: 'results', label: 'Results', icon: 'fa-chart-bar', href: './index.html#results' },
    { key: 'end-to-end', label: 'End-to-end study', icon: 'fa-route', href: './end-to-end.html' },
    { key: 'scaled-results', label: 'Scaled results', icon: 'fa-project-diagram', href: './scaled-results.html' },
    { key: 'improved-results-v1', label: 'Improved Results V1', icon: 'fa-atom', href: './improved-results-v1.html' },
    { key: 'improved-results-v2', label: 'Improved Results V2', icon: 'fa-shapes', href: './improved-results-v2.html' },
    { key: 'improved-results-v3', label: 'Improved Results V3', icon: 'fa-car-crash', href: './improved-results-v3.html' },
    { key: 'improved-results-v4', label: 'Improved Results V4', icon: 'fa-sync-alt', href: './improved-results-v4.html' },
    { key: 'improved-results-v5', label: 'Improved Results V5', icon: 'fa-link', href: './improved-results-v5.html' },
    { key: 'failure-analysis', label: 'Failure analysis', icon: 'fa-stethoscope', href: './failure-analysis.html' },
    { key: 'rubble-demo', label: 'Rubble demo', icon: 'fa-hard-hat', href: './rubble-demo.html' },
    { key: 'video-models', label: 'Video models', icon: 'fa-film', href: './video-models.html' },
    { key: 'digital-twins', label: 'Digital twins', icon: 'fa-cube', href: './digital-twins.html' }
  ];
  window.SITE_TABS = TABS;

  function render() {
    var navs = document.querySelectorAll('[data-site-nav]');
    for (var n = 0; n < navs.length; n++) {
      var nav = navs[n], current = nav.getAttribute('data-site-nav'), ul = document.createElement('ul');
      TABS.forEach(function (tab) {
        var li = document.createElement('li'), a = document.createElement('a');
        var icon = document.createElement('span'), i = document.createElement('i'), label = document.createElement('span');
        a.href = tab.href;
        if (tab.key === current) { li.className = 'is-active'; a.setAttribute('aria-current', 'page'); }
        icon.className = 'icon is-small'; i.className = 'fas ' + tab.icon; i.setAttribute('aria-hidden', 'true');
        label.textContent = tab.label;
        icon.appendChild(i); a.appendChild(icon); a.appendChild(label); li.appendChild(a); ul.appendChild(li);
      });
      nav.innerHTML = '';
      nav.appendChild(ul);
    }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', render); } else { render(); }
})();
