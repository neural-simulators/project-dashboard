(function () {
  'use strict';
  const data = window.CHECKPOINT_TRANSFER_V2;
  if (!data) return;
  const names = data.models.map(m => m.name);
  const colors = ['#2463a6', '#b34d26', '#26826c', '#8a4ca1', '#b18820'];
  const fmt = v => v == null ? '-' : Number(v).toFixed(3);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const full = (c, name) => c.models[name].metrics.full;
  const positional = (c, name) => full(c,name).ade_moving_m ?? full(c,name).ade_all_m;
  const caseTitle = c => c.family.replaceAll('_',' ')+(c.supplemental ? ' (moving supplement)' : '');
  document.getElementById('case-winners').innerHTML = '<table class="table is-fullwidth is-striped"><thead><tr><th>Example</th><th>Horizon</th><th>Lowest position ADE</th><th>Lowest orientation error</th></tr></thead><tbody>' + data.cases.map(c => {
    const p = [...names].sort((a,b) => positional(c,a)-positional(c,b))[0];
    const r = [...names].sort((a,b) => (full(c,a).orientation_mae_deg ?? Infinity)-(full(c,b).orientation_mae_deg ?? Infinity))[0];
    return `<tr><td><a href="#case-${esc(c.case_key)}">${esc(caseTitle(c))}</a></td><td>${c.horizon_s} s</td><td>${esc(p)} (${fmt(positional(c,p))} m)</td><td>${full(c,r).orientation_mae_deg == null ? '-' : esc(r)+' ('+fmt(full(c,r).orientation_mae_deg)+' deg)'}</td></tr>`;
  }).join('')+'</tbody></table>';
  document.getElementById('transfer-coverage').innerHTML = '<table class="table is-fullwidth is-striped"><thead><tr><th>Family</th><th>Status</th><th>Audited compatible valid candidates / reason</th></tr></thead><tbody>'+data.coverage.map(c => `<tr><td>${esc(c.family)}</td><td>${c.supported_valid ? '1 example scored' : 'Unsupported'}</td><td>${c.supported_valid || esc(Object.keys(c.unsupported_reasons).join(', '))}</td></tr>`).join('')+'</tbody></table>';

  const container = document.getElementById('transfer-cases');
  data.cases.forEach(c => {
    const card = document.createElement('details');
    card.id = 'case-'+c.case_key;
    const rows = names.map(n => {const m=full(c,n), s=c.models[n].metrics.three_seconds;return `<tr data-model="${esc(n)}"><td>${esc(n)}</td><td>${fmt(s.ade_moving_m)}</td><td>${fmt(m.ade_moving_m)}</td><td>${fmt(m.ade_all_m)}</td><td>${fmt(m.fde_moving_m)}</td><td>${fmt(m.orientation_mae_deg)}</td><td>${fmt(m.velocity_rmse_all_m_s)}</td><td>${fmt(m.contacts.f1)}</td></tr>`;}).join('');
    card.innerHTML = `<summary>${esc(caseTitle(c))} · ${c.horizon_s} s · ${c.dynamic_objects} dynamic bodies</summary>
      ${c.supplemental ? '<p class="note"><strong>Supplemental diagnostic, excluded from the primary aggregate.</strong> Selected from the reference-motion census after the primary pulley case proved sub-centimetre. None of the original results was replaced.</p>' : ''}
      ${c.supplemental && data.rule_diagnostic ? '<p class="notification is-light"><strong>Observed guidance failure:</strong> all five predictions keep the mechanism fixed. In a separate analytical check, the cause gate erased valid motion from the reference first block. It treats nearby bodies as supported and has no moving object or explicit action to seed motion. This diagnoses the generation rule; it does not measure what the unguided neural networks could predict.</p>' : ''}
      <p class="note">${esc(c.record_id)}. Input: ${c.context_objects} object tokens, ${c.static_box_proxies} background box proxies, ${c.omitted_context.length} static objects outside the context cap.</p>
      <p class="note">Dynamic bodies: ${esc(c.dynamic_labels.join(', '))}. Fixed background objects keep their original poses.${full(c,names[0]).moving_objects === 0 ? ' This reference has no body translating over 1 cm; it measures false motion, not transfer of moving trajectories.' : ''}</p>
      <div class="controls"><label>Checkpoint <select aria-label="Checkpoint for ${esc(c.family)}">${names.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label><button class="button is-small play">Play comparison</button><button class="button is-small pause">Pause</button><button class="button is-small reset">Reset</button></div>
      <div class="pair"><figure><video class="truth" controls muted playsinline preload="none" poster="${c.media}/ground_truth.jpg" src="${c.media}/ground_truth.mp4"></video><figcaption>PhysX ground truth</figcaption></figure><figure><video class="pred" controls muted playsinline preload="none"></video><figcaption class="prediction-label"></figcaption></figure></div>
      <p class="diagnostic note"></p><svg class="chart" viewBox="0 0 700 225" role="img" aria-label="Position error through time"></svg><div class="legend">${names.map((n,i)=>`<span style="color:${colors[i]}">${esc(n)}</span>`).join('')}</div>
      <details><summary>Numerical measurements for this example</summary><div class="table-container"><table class="table is-striped is-fullwidth"><thead><tr><th>Checkpoint + rules</th><th>Moving ADE 3 s (m)</th><th>Moving ADE full (m)</th><th>All-body ADE full (m)</th><th>Moving FDE full (m)</th><th>Orientation (deg)</th><th>Velocity RMSE (m/s)</th><th>Contact F1</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
    container.appendChild(card);
    const truth = card.querySelector('.truth'), prediction = card.querySelector('.pred'), select=card.querySelector('select');
    const choose = () => {
      truth.pause(); prediction.pause(); truth.currentTime=0;
      prediction.src=c.media+'/'+select.value+'.mp4'; prediction.poster=c.media+'/'+select.value+'.jpg';
      card.querySelector('.prediction-label').textContent=select.value+' + rules';
      const d=c.models[select.value].diagnostic;
      card.querySelector('.diagnostic').textContent=`Largest sampled position miss: ${d.worst_body}, ${fmt(d.worst_position_error_m)} m at ${fmt(d.worst_time_s)} s. Endpoint miss for ${d.endpoint_body}: ${fmt(d.endpoint_error_m)} m. Camera follows the reference framing; incorrect bodies can leave the view.`;
    };
    select.addEventListener('change',choose); choose();
    card.querySelector('.play').addEventListener('click',()=>{prediction.currentTime=truth.currentTime;truth.play();prediction.play();});
    card.querySelector('.pause').addEventListener('click',()=>{truth.pause();prediction.pause();});
    card.querySelector('.reset').addEventListener('click',()=>{truth.pause();prediction.pause();truth.currentTime=0;prediction.currentTime=0;});
    truth.addEventListener('seeked',()=>{if(Math.abs(prediction.currentTime-truth.currentTime)>.08)prediction.currentTime=truth.currentTime;});
    truth.addEventListener('timeupdate',()=>{if(!truth.paused && Math.abs(prediction.currentTime-truth.currentTime)>.12)prediction.currentTime=truth.currentTime;});
    truth.addEventListener('ended',()=>prediction.pause());
    card.addEventListener('toggle',()=>{if(!card.open){truth.pause();prediction.pause();}});
    const curves=names.map(n=>full(c,n).error_by_frame_all_m);
    const maximum=Math.max(.01,...curves.flat()), left=52, right=685, top=14, bottom=180;
    const x=t=>left+(right-left)*t/c.horizon_s, y=v=>bottom-(bottom-top)*v/maximum;
    let svg=`<text x="${left}" y="214" font-size="11">Time (s); mean position error over all dynamic bodies (m)</text>`;
    [0,.5,1].forEach(f=>{const v=maximum*f;svg+=`<line x1="${left}" x2="${right}" y1="${y(v)}" y2="${y(v)}" stroke="#dfe5ec"/><text x="3" y="${y(v)+4}" font-size="11">${v.toFixed(2)}</text>`;});
    for(let t=0;t<=c.horizon_s;t++){svg+=`<text x="${x(t)}" y="197" font-size="11">${t}</text>`;}
    curves.forEach((values,i)=>{const points=values.map((v,j)=>`${x((j+1)/30)},${y(v)}`).join(' ');svg+=`<polyline points="${points}" stroke="${colors[i]}" stroke-width="1.8" fill="none"/>`;});
    card.querySelector('svg').innerHTML=svg;
  });
  function openHash(){const item=document.getElementById(location.hash.slice(1));if(item && item.tagName==='DETAILS'){item.open=true;let parent=item.parentElement.closest('details');while(parent){parent.open=true;parent=parent.parentElement.closest('details');}item.scrollIntoView();}}
  window.addEventListener('hashchange',openHash);openHash();
})();
