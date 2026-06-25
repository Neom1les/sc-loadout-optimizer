/* ============================================================
   SC Optimizer — Crafting guide tab
   Data-driven from crafting.json. Every claim is tagged with a
   confidence badge so live facts never get mixed up with
   community guesses or unconfirmed 4.9 features.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let DATA = null;
let confOnly = false;

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const CONF = {
  'confirmed-live': { l: 'LIVE 4.8.2', cls: 'ok' },
  'ptu-4.9': { l: 'PTU / 4.9', cls: 'teal' },
  'planned': { l: 'PLANNED', cls: 'warn' },
  'community-estimate': { l: 'COMMUNITY', cls: 'dim' },
  'unclear': { l: 'UNCLEAR', cls: 'crit' },
};
function badge(c) { const x = CONF[c] || CONF['unclear']; return `<span class="cf-conf cf-${x.cls}" title="${esc(c)}">${x.l}</span>`; }
function shown(c) { return !confOnly || c === 'confirmed-live'; }

export async function initCrafting(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('crafting.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Crafting data unavailable</h3><p>${e.message}</p></div>`;
    return;
  }
  render();
}

function render() {
  const d = DATA;
  const none = '<div class="src-note">Nothing confirmed-live with this filter — untick to see community / PTU entries.</div>';
  const steps = d.steps.map((s, i) => `<li><div class="st-title">${i + 1}. ${esc(s.title)} ${badge(s.confidence)}</div><div class="st-detail">${esc(s.detail)}</div></li>`).join('');
  const mats = d.materials.filter(m => shown(m.confidence)).map(m => `<div class="craft-row"><b>${esc(m.name)}</b> ${badge(m.confidence)}<span class="craft-sub"><b>Source:</b> ${esc(m.source)}${m.note ? ' — ' + esc(m.note) : ''}</span></div>`).join('') || none;
  const bps = d.blueprints.filter(b => shown(b.confidence)).map(b => `<div class="craft-row"><b>${esc(b.name)}</b> ${badge(b.confidence)}<span class="craft-sub"><b>How:</b> ${esc(b.howToGet)}${b.note ? ' · ' + esc(b.note) : ''}</span></div>`).join('') || none;
  const recipes = d.recipes.filter(r => shown(r.confidence)).map(r => `<div class="craft-recipe"><div class="cr-head"><b>${esc(r.name)}</b> ${badge(r.confidence)}</div><div class="cr-line"><span>Makes</span> ${esc(r.makes)}</div>${r.needs ? `<div class="cr-line"><span>Needs</span> ${esc(r.needs)}</div>` : ''}${r.worthIt ? `<div class="cr-verdict">${esc(r.worthIt)}</div>` : ''}</div>`).join('') || none;
  const tips = d.tips.map(t => `<li>${esc(t)}</li>`).join('');
  const roadmap = d.roadmap.map(r => `<li>${esc(r)}</li>`).join('');
  const sources = d.sources.map(s => `<li>${esc(s)}</li>`).join('');
  const legend = Object.values(CONF).map(v => `<span class="cf-conf cf-${v.cls}">${v.l}</span>`).join('');

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Crafting Guide</h2>
      <div class="ef-sub">How crafting works, what materials &amp; blueprints you need, and what's actually worth making — every claim tagged by how confirmed it is.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>Patch <b>${esc(d.patch)}</b> · updated <b>${esc(d.updated)}</b> · Crafting is <b>LIVE</b> — the selling economy isn't finished, so craft for yourself, not for profit (yet)</span></div>

    <div class="craft-toolbar">
      <div class="cf-legend">${legend}</div>
      <label class="sc-checkbox"><input type="checkbox" id="cfConfOnly" ${confOnly ? 'checked' : ''}><span>Show only confirmed-live</span></label>
    </div>

    <div class="panel"><div class="panel-header">Overview</div><p class="craft-p">${esc(d.overview)}</p></div>

    <div class="panel"><div class="panel-header">How it works — the loop</div><ul class="guide-steps">${steps}</ul></div>

    <div class="panel"><div class="panel-header">Material quality — the key concept</div>
      <p class="craft-p">${esc(d.qualityNote)}</p>
      <div class="qcalc">
        <label for="qInput">Check a material quality score (1–1000):</label>
        <input type="number" id="qInput" min="1" max="1000" placeholder="e.g. 720">
        <div id="qResult" class="qcalc-result"></div>
      </div>
    </div>

    <div class="two-col">
      <div class="panel"><div class="panel-header">Materials &amp; where to get them</div><div class="craft-list">${mats}</div></div>
      <div class="panel"><div class="panel-header">Blueprints &amp; how to obtain them</div><div class="craft-list">${bps}</div></div>
    </div>

    <div class="panel"><div class="panel-header">What's worth crafting</div><div class="craft-recipes">${recipes}</div></div>

    <div class="panel"><div class="panel-header">Pro tips &amp; known bugs</div><ul class="guide-tips">${tips}</ul></div>

    <div class="panel craft-roadmap"><div class="panel-header">Coming / unconfirmed — 4.9 &amp; beyond</div><ul class="guide-tips">${roadmap}</ul></div>

    <div class="disclaimer"><b>Honesty note:</b> ${esc(d.uncertainty)}</div>

    <div class="panel"><div class="panel-header">Sources <span class="pc-note">ranked by reliability</span></div><ul class="craft-sources">${sources}</ul></div>
  `;

  ROOT.querySelector('#cfConfOnly').onchange = (e) => { confOnly = e.target.checked; render(); };

  const qi = ROOT.querySelector('#qInput');
  const qr = ROOT.querySelector('#qResult');
  const calc = () => {
    const v = parseInt(qi.value, 10);
    if (!v || v < 1) { qr.innerHTML = ''; return; }
    const cap = Math.min(v, 1000);
    const t = d.qualityTiers.find(t => cap >= t.min && cap <= t.max) || d.qualityTiers[d.qualityTiers.length - 1];
    qr.innerHTML = `<span class="cf-conf cf-${t.cls}">${esc(t.label)}</span> ${esc(t.advice)}`;
  };
  qi.oninput = calc;
}
