/* Production-record gallery of the Dataset V2 page: one folded block per family, one card per branch category, the
   record's metadata under each card. Data: static/data/dataset_v2_records.js (window.DATASET_V2_RECORDS). */
(function () {
  'use strict';
  var D = window.DATASET_V2_RECORDS; var host = document.getElementById('dv2-records-gallery');
  if (!D || !host) { return; }
  function el(tag, attrs, children) {
    var e = document.createElement(tag); attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) { if (k === 'text') { e.textContent = attrs[k]; } else if (k === 'html') { e.innerHTML = attrs[k]; } else { e.setAttribute(k, attrs[k]); } });
    (children || []).forEach(function (c) { if (c) { e.appendChild(c); } }); return e;
  }
  function table(head, rows) {
    var t = el('table', {class: 'table is-striped is-fullwidth wm-table compact'});
    t.appendChild(el('thead', {}, [el('tr', {}, head.map(function (h) { return el('th', {text: h}); }))]));
    t.appendChild(el('tbody', {}, rows.map(function (r) { return el('tr', {}, r.map(function (c) { return el('td', {text: c == null ? '' : String(c)}); })); })));
    return el('div', {class: 'table-container'}, [t]);
  }
  function card(r) {
    var v = el('video', {controls: '', muted: '', loop: '', playsinline: '', preload: 'none', src: r.clip});
    if (r.poster) { v.setAttribute('poster', r.poster); }
    v.addEventListener('mouseenter', function () { v.play().catch(function () {}); }); v.addEventListener('mouseleave', function () { v.pause(); });
    return el('div', {class: 'card'}, [v, el('p', {class: 'lab', html: '<b>' + r.category + '</b> · ' + r.branch + ' · ' + r.duration_s + ' s · ' + r.change})]);
  }
  function meta(r) {   /* the record's metadata, full width under the clip row: its tables do not fit inside a card */
    var valid = r.physics_valid === true ? 'valid physics' : (r.physics_valid === false ? 'invalid physics' : 'unlabelled');
    return el('details', {class: 'meta'}, [
      el('summary', {style: 'overflow-wrap:anywhere', html: '<b>' + r.category + '</b> · ' + r.record_id + ': events, questions, explanation, camera'}),   // long record ids wrap on a phone (4 November: 36 px over)
      el('div', {class: 'inner'}, [
        el('p', {class: 'wm-note', html: '<b>' + r.record_id + '</b> · tier ' + r.tier + ' · ' + r.split + ' split · ' + valid + ' · expectation ' + (r.expectation_met ? 'met' : 'not met' + (r.failed_checks.length ? ' (' + r.failed_checks.join(', ') + ')' : '')) + ' · ' + r.bodies + ' dynamic bodies · ' + r.horizon_s + ' s at ' + r.fps_saved + ' Hz'}),
        el('p', {class: 'wm-note', html: '<b>Action:</b> ' + r.action_text + '. <b>This branch:</b> ' + r.change + '.'}),
        el('p', {class: 'wm-note', html: '<b>Events</b> (' + r.events.length + ' of ' + r.events_total + ', floor and wall contacts left out):'}),
        table(['t (s)', 'kind', 'objects', 'description'], r.events.map(function (e) { return [e.t, e.kind, e.objects.join(', '), e.text]; })),
        el('p', {class: 'wm-note', html: '<b>Measured questions</b> (' + r.qa.length + ' of ' + r.qa_total + '; answers from the saved states, never a model):'}),
        table(['question', 'answer', 'unit', 'status'], r.qa.map(function (q) { return [q.q, q.a, q.unit, q.status]; })),
        el('p', {class: 'wm-note', html: '<b>Template explanation</b> (written from the event ledger): ' + (r.explanation || 'none written')}),
        el('p', {class: 'wm-note', html: '<b>Camera</b> inside the room, fitted to the action: eye ' + JSON.stringify(r.camera.eye) + ' m, target ' + JSON.stringify(r.camera.target) + ' m, focal ' + r.camera.focal_mm + ' mm' + (r.camera.fits === false ? ' (the widest lens at the front wall: the full sweep does not fit from inside the room)' : '') + (r.camera.context && r.camera.context.length ? ', framed with ' + r.camera.context.join(', ') : '') + ' (camera_v2.json in the action folder).'})
      ])
    ]);
  }
  host.textContent = ''; host.className = '';
  var names = Object.keys(D.families).sort();
  var pend = D.pending_families || [];
  host.appendChild(el('p', {class: 'wm-note', text: names.length + ' families rendered, ' + D.records_n + ' records; the first run only.' +
    (pend.length ? ' ' + pend.length + ' more families are selected and waiting for their render jobs: ' + pend.join(', ') + '.' : '')}));
  names.forEach(function (name) {
    var f = D.families[name];
    var det = el('details', {id: 'dv2-rec-' + name}, [
      el('summary', {style: 'overflow-wrap:anywhere', text: name + ': ' + f.root + ' / ' + f.action + ', ' + f.records.length + ' records'}),
      el('div', {class: 'inner'}, [el('div', {class: 'clips'}, f.records.map(card))].concat(f.records.map(meta)))
    ]);
    host.appendChild(det);
  });
})();
