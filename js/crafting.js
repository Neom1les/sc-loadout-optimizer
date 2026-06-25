/* ============================================================
   SC Optimizer — Crafting tab
   Two sub-modes:
   • Guide     — high-level, confidence-tagged crafting guide (crafting.json)
   • Workbench — interactive blueprint calculator over 1559 datamined recipes
                 (crafting-recipes.json): pick a blueprint, see materials +
                 quantities + output + dismantle, build a list and get a
                 consolidated material shopping list.
   Recipes are datamined and patch-accurate. SC has no player marketplace, so
   no resale value is shown — quantities and craft data only.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let GUIDE = null;
let RECIPES = [];
let GV = '';
let craftMode = 'guide';
let confOnly = false;
let wbSearch = '';
let wbCat = 'all';
let wbSelected = null;
const build = new Map();   // uuid -> qty

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtQty(q) { return Number.isInteger(q) ? '' + q : (Math.round(q * 100) / 100).toString(); }

const CONF = {
  'confirmed-live': { l: 'LIVE 4.8.2', cls: 'ok' },
  'ptu-4.9': { l: 'PTU / 4.9', cls: 'teal' },
  'planned': { l: 'PLANNED', cls: 'warn' },
  'community-estimate': { l: 'COMMUNITY', cls: 'dim' },
  'unclear': { l: 'UNCLEAR', cls: 'crit' },
};
function badge(c) { const x = CONF[c] || CONF['unclear']; return `<span class="cf-conf cf-${x.cls}" title="${esc(c)}">${x.l}</span>`; }
function shown(c) { return !confOnly || c === 'confirmed-live'; }

function bpCategory(tl) {
  tl = tl || '';
  if (/Armor|Undersuit|Backpack/.test(tl)) return 'Armor';
  if (/FPS Weapon|Weapon Attachment/.test(tl)) return 'FPS Gear';
  if (/Weapon Gun|Weapon Mining/.test(tl)) return 'Ship Weapons';
  if (/Power Plant|Cooler|Shield|Radar|Quantum Drive|Docking|Tractor/.test(tl)) return 'Ship Components';
  return 'Other';
}

export async function initCrafting(root) {
  ROOT = root;
  try {
    GUIDE = await loadJSON('crafting.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Crafting data unavailable</h3><p>${e.message}</p></div>`;
    return;
  }
  try {
    const r = await loadJSON('crafting-recipes.json');
    RECIPES = (r && r.recipes) || [];
    GV = (r && r.game_version) || '';
  } catch { RECIPES = []; }
  render();
}

function render() {
  ROOT.innerHTML = `
    <div class="ph-head"><h2>Crafting</h2>
      <div class="ef-sub">A plain-language guide to how crafting works, plus an interactive workbench over every datamined blueprint.</div></div>
    <div class="fleet-subtabs">
      <button class="fl-sub${craftMode === 'guide' ? ' active' : ''}" data-cmode="guide">Guide</button>
      <button class="fl-sub${craftMode === 'workbench' ? ' active' : ''}" data-cmode="workbench">Workbench${RECIPES.length ? ` · ${RECIPES.length} blueprints` : ''}</button>
    </div>
    <div id="craftBody"></div>`;
  ROOT.querySelectorAll('[data-cmode]').forEach(b => b.onclick = () => { craftMode = b.dataset.cmode; render(); });
  if (craftMode === 'guide') renderGuide();
  else renderWorkbench();
}

/* ─────────────────────────── Guide ─────────────────────────────────────── */
function renderGuide() {
  const body = ROOT.querySelector('#craftBody');
  const d = GUIDE;
  const none = '<div class="src-note">Nothing confirmed-live with this filter — untick to see community / PTU entries.</div>';
  const steps = d.steps.map((s, i) => `<li><div class="st-title">${i + 1}. ${esc(s.title)} ${badge(s.confidence)}</div><div class="st-detail">${esc(s.detail)}</div></li>`).join('');
  const mats = d.materials.filter(m => shown(m.confidence)).map(m => `<div class="craft-row"><b>${esc(m.name)}</b> ${badge(m.confidence)}<span class="craft-sub"><b>Source:</b> ${esc(m.source)}${m.note ? ' — ' + esc(m.note) : ''}</span></div>`).join('') || none;
  const bps = d.blueprints.filter(b => shown(b.confidence)).map(b => `<div class="craft-row"><b>${esc(b.name)}</b> ${badge(b.confidence)}<span class="craft-sub"><b>How:</b> ${esc(b.howToGet)}${b.note ? ' · ' + esc(b.note) : ''}</span></div>`).join('') || none;
  const recipes = d.recipes.filter(r => shown(r.confidence)).map(r => `<div class="craft-recipe"><div class="cr-head"><b>${esc(r.name)}</b> ${badge(r.confidence)}</div><div class="cr-line"><span>Makes</span> ${esc(r.makes)}</div>${r.needs ? `<div class="cr-line"><span>Needs</span> ${esc(r.needs)}</div>` : ''}${r.worthIt ? `<div class="cr-verdict">${esc(r.worthIt)}</div>` : ''}</div>`).join('') || none;
  const tips = d.tips.map(t => `<li>${esc(t)}</li>`).join('');
  const roadmap = d.roadmap.map(r => `<li>${esc(r)}</li>`).join('');
  const sources = d.sources.map(s => `<li>${esc(s)}</li>`).join('');
  const legend = Object.values(CONF).map(v => `<span class="cf-conf cf-${v.cls}">${v.l}</span>`).join('');

  body.innerHTML = `
    <div class="craft-status"><span class="ps-dot"></span><span>Patch <b>${esc(d.patch)}</b> · updated <b>${esc(d.updated)}</b> · Crafting is <b>LIVE</b> — selling economy not finished, so craft for yourself, not profit (yet)</span></div>
    <div class="craft-toolbar">
      <div class="cf-legend">${legend}</div>
      <label class="sc-checkbox"><input type="checkbox" id="cfConfOnly" ${confOnly ? 'checked' : ''}><span>Show only confirmed-live</span></label>
    </div>
    <div class="panel"><div class="panel-header">Overview</div><p class="craft-p">${esc(d.overview)}</p></div>
    <div class="panel"><div class="panel-header">How it works — the loop</div><ul class="guide-steps">${steps}</ul></div>
    <div class="panel"><div class="panel-header">Material quality — the key concept</div>
      <p class="craft-p">${esc(d.qualityNote)}</p>
      <div class="qcalc"><label for="qInput">Check a material quality score (1–1000):</label><input type="number" id="qInput" min="1" max="1000" placeholder="e.g. 720"><div id="qResult" class="qcalc-result"></div></div>
    </div>
    <div class="two-col">
      <div class="panel"><div class="panel-header">Materials &amp; where to get them</div><div class="craft-list">${mats}</div></div>
      <div class="panel"><div class="panel-header">Blueprints &amp; how to obtain them</div><div class="craft-list">${bps}</div></div>
    </div>
    <div class="panel"><div class="panel-header">What's worth crafting</div><div class="craft-recipes">${recipes}</div></div>
    <div class="panel"><div class="panel-header">Pro tips &amp; known bugs</div><ul class="guide-tips">${tips}</ul></div>
    <div class="panel craft-roadmap"><div class="panel-header">Coming / unconfirmed — 4.9 &amp; beyond</div><ul class="guide-tips">${roadmap}</ul></div>
    <div class="disclaimer"><b>Honesty note:</b> ${esc(d.uncertainty)}</div>
    <div class="panel"><div class="panel-header">Sources <span class="pc-note">ranked by reliability</span></div><ul class="craft-sources">${sources}</ul></div>`;

  body.querySelector('#cfConfOnly').onchange = (e) => { confOnly = e.target.checked; renderGuide(); };
  const qi = body.querySelector('#qInput'), qr = body.querySelector('#qResult');
  qi.oninput = () => {
    const v = parseInt(qi.value, 10);
    if (!v || v < 1) { qr.innerHTML = ''; return; }
    const cap = Math.min(v, 1000);
    const t = d.qualityTiers.find(t => cap >= t.min && cap <= t.max) || d.qualityTiers[d.qualityTiers.length - 1];
    qr.innerHTML = `<span class="cf-conf cf-${t.cls}">${esc(t.label)}</span> ${esc(t.advice)}`;
  };
}

/* ─────────────────────────── Workbench ─────────────────────────────────── */
function recipeCard(r) {
  const ing = r.ingredients.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${fmtQty(i.qty)} ${esc(i.unit)}</td><td class="cr-kind">${esc(i.kind)}</td></tr>`).join('') || '<tr><td colspan="3" class="src-note">No ingredients listed.</td></tr>';
  const dis = (r.dismantle || []).map(dd => `<span class="wb-dis">${esc(dd.name)} ${fmtQty(dd.qty)} ${esc(dd.unit)}</span>`).join('') || '<span class="src-note">—</span>';

  let unlock;
  if (r.default) {
    unlock = '<div class="wb-info"><span class="cf-conf cf-ok">Default</span><span class="wb-info-txt">Available from the start — no unlock needed.</span></div>';
  } else if (r.missions && r.missions.length) {
    const ms = r.missions.map(m => `<span class="wb-mission">${esc(m.title)} ${m.chance >= 1 ? '<span class="cf-conf cf-ok">guaranteed</span>' : `<span class="cf-conf cf-warn">${Math.round((m.chance || 0) * 100)}% drop</span>`}</span>`).join('');
    unlock = `<div class="wb-info"><span class="cf-conf cf-warn">Unlock</span><span class="wb-info-txt">Earn this blueprint by completing ${r.missions.length > 1 ? 'one of these missions:' : 'this mission:'}</span><div class="wb-missions">${ms}</div></div>`;
  } else {
    unlock = `<div class="wb-info"><span class="cf-conf cf-warn">Unlock</span><span class="wb-info-txt">Not a default blueprint — unlocked via ${r.unlockMissions || 1} mission / reputation source (specific source not in the data).</span></div>`;
  }

  let quality = '';
  if (r.quality && r.quality.length) {
    const qrows = r.quality.map(q => {
      const dir = q.betterWhen === 'higher' ? '↑ higher = better' : q.betterWhen === 'lower' ? '↓ lower = better' : '';
      const range = (q.atMin != null && q.atMax != null) ? `${q.atMin}× – ${q.atMax}×` : '—';
      return `<tr><td>${esc(q.stat)}</td><td class="cr-kind">${dir}</td><td class="num">${range}</td></tr>`;
    }).join('');
    quality = `<div class="wb-sub-h">Material-quality scaling <span class="pc-note">output multiplier at quality 0 → 1000</span></div><table class="fleet-table"><tbody>${qrows}</tbody></table>`;
  }

  return `<div class="panel">
    <div class="wb-head">
      <div><div class="wb-title">${esc(r.name)}</div><div class="ship-role">${esc(r.typeLabel)}${r.grade ? ' · Grade ' + esc(r.grade) : ''}${r.subType ? ' · ' + esc(r.subType) : ''}</div></div>
      <button class="btn-optimize wb-add" data-add="${r.uuid}">+ Add to build</button>
    </div>
    <div class="wb-meta"><span class="cf-conf cf-dim">Craft ${esc(r.craftLabel || r.craftSeconds + 's')}</span></div>
    ${unlock}
    <div class="wb-sub-h">Materials needed</div>
    <table class="fleet-table wb-ing"><thead><tr><th>Material</th><th class="num">Qty</th><th>Type</th></tr></thead><tbody>${ing}</tbody></table>
    ${quality}
    <div class="wb-dismantle"><span class="pc-note">Dismantle returns:</span> ${dis}</div>
  </div>`;
}

function buildListPanel() {
  const items = [...build.entries()].map(([uuid, qty]) => ({ r: RECIPES.find(x => x.uuid === uuid), qty })).filter(x => x.r);
  // aggregate materials by name+unit
  const agg = {};
  let totalSec = 0;
  for (const { r, qty } of items) {
    totalSec += (r.craftSeconds || 0) * qty;
    for (const i of r.ingredients) {
      const k = i.name + '|' + i.unit;
      agg[k] = agg[k] || { name: i.name, unit: i.unit, qty: 0, kind: i.kind };
      agg[k].qty += i.qty * qty;
    }
  }
  const rows = Object.values(agg).sort((a, b) => a.name.localeCompare(b.name))
    .map(m => `<tr><td>${esc(m.name)}</td><td class="num">${fmtQty(m.qty)} ${esc(m.unit)}</td><td class="cr-kind">${esc(m.kind)}</td></tr>`).join('');
  const list = items.map(({ r, qty }) => `<div class="wb-bl-row"><span class="wb-bl-q">${qty}×</span><b>${esc(r.name)}</b><span class="ship-role">${esc(r.typeLabel)}</span><span class="sq-remove" data-del="${r.uuid}">×</span></div>`).join('');
  const hrs = totalSec >= 3600 ? (totalSec / 3600).toFixed(1) + ' h' : Math.round(totalSec / 60) + ' min';
  return `<div class="panel">
    <div class="panel-header">Build list <span class="pc-note">${items.length} blueprint${items.length === 1 ? '' : 's'} · total craft ${hrs}</span></div>
    <div class="wb-buildlist">${list}</div>
    <div class="panel-header" style="margin-top:14px">Consolidated materials needed</div>
    <table class="fleet-table"><thead><tr><th>Material</th><th class="num">Total qty</th><th>Type</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="wb-actions"><button class="fl-sub" id="wbClear">Clear build</button></div>
    <div class="src-note">Quantities are datamined &amp; patch-accurate (${esc(GV)}). SC has no player marketplace, so no aUEC resale value is shown — see the Guide for why.</div>
  </div>`;
}

function renderWorkbench() {
  const body = ROOT.querySelector('#craftBody');
  if (!RECIPES.length) { body.innerHTML = '<div class="empty-state"><h3>Blueprint data unavailable</h3><p>crafting-recipes.json failed to load.</p></div>'; return; }
  const cats = ['all', 'Armor', 'FPS Gear', 'Ship Weapons', 'Ship Components', 'Other'];
  const sel = wbSelected ? RECIPES.find(r => r.uuid === wbSelected) : null;

  body.innerHTML = `
    <div class="craft-status"><span class="ps-dot"></span><span>Datenstand <b>${esc(GV)}</b> · <b>${RECIPES.length}</b> datamined blueprints · recipes &amp; quantities are game-accurate; no marketplace value exists in SC yet</span></div>
    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Blueprints</div>
        <div class="fleet-filters">${cats.map(c => `<button class="fl-chip${wbCat === c ? ' active' : ''}" data-cat="${c}">${c === 'all' ? 'All' : esc(c)}</button>`).join('')}</div>
        <input type="text" class="search-input" id="wbSearch" placeholder="Search blueprints..." value="${esc(wbSearch)}">
        <div class="ship-list" id="wbList"></div>
      </div>
      <div class="tac-analysis" id="wbDetail">
        ${sel ? recipeCard(sel) : '<div class="empty-state"><h3>Pick a blueprint</h3><p>Search or filter on the left, select a blueprint to see its materials and quantities, then add it to your build list.</p></div>'}
        ${build.size ? buildListPanel() : ''}
      </div>
    </div>`;

  body.querySelectorAll('[data-cat]').forEach(c => c.onclick = () => { wbCat = c.dataset.cat; renderWorkbench(); });
  const s = body.querySelector('#wbSearch');
  s.addEventListener('input', () => { wbSearch = s.value.toLowerCase().trim(); drawWbList(); });
  drawWbList();
  wireDetail();
}

function drawWbList() {
  const el = ROOT.querySelector('#wbList');
  if (!el) return;
  const list = RECIPES.filter(r => {
    if (wbCat !== 'all' && bpCategory(r.typeLabel) !== wbCat) return false;
    if (wbSearch && !(r.name || '').toLowerCase().includes(wbSearch)) return false;
    return true;
  });
  el.innerHTML = list.slice(0, 200).map(r =>
    `<div class="ship-item${wbSelected === r.uuid ? ' active' : ''}" data-bp="${r.uuid}"><span>${esc(r.name)}</span><span class="ship-role">${esc(r.typeLabel)}</span></div>`
  ).join('') + (list.length > 200 ? `<div class="src-note">Showing 200 of ${list.length} — refine your search.</div>` : '') || '<div class="empty-state"><p>No blueprints match.</p></div>';
  el.querySelectorAll('[data-bp]').forEach(it => it.onclick = () => { wbSelected = it.dataset.bp; renderWorkbench(); });
}

function wireDetail() {
  const body = ROOT.querySelector('#craftBody');
  body.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const id = b.dataset.add; build.set(id, (build.get(id) || 0) + 1); renderWorkbench(); });
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { build.delete(b.dataset.del); renderWorkbench(); });
  const clr = body.querySelector('#wbClear');
  if (clr) clr.onclick = () => { build.clear(); renderWorkbench(); };
}
