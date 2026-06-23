/* ============================================================
   SC Optimizer — Patch Hub & Guides
   Patch timeline · feature cards · full step-by-step guides with
   an embedded schematic location map.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let GUIDES = [];
let PATCH_INFO = {};
let selectedPatch = 'all';
let currentGuide = null;

function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function diffDots(d) { d = Math.max(0, Math.min(4, d || 0)); return '◆'.repeat(d) + '◇'.repeat(4 - d); }

export async function initPatchHub(root) {
  ROOT = root;
  try {
    GUIDES = (await loadJSON('guides.json')) || [];
    try { PATCH_INFO = (await loadJSON('patch-info.json')) || {}; } catch { PATCH_INFO = {}; }
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Guide database not found</h3><p>data/guides.json is being built. ${e.message}</p></div>`;
    return;
  }
  render();
}

export function showGuide(id) {
  if (!GUIDES.length) return;
  currentGuide = GUIDES.find(g => g.id === id) || null;
  render();
}

function patches() {
  const ps = [...new Set(GUIDES.map(g => g.patch).filter(Boolean))].sort().reverse();
  return ps;
}

function render() {
  if (!ROOT) return;
  if (currentGuide) return renderDetail(currentGuide);

  const ps = patches();
  const timeline = `<button class="patch-pill ${selectedPatch==='all'?'active':''}" data-patch="all">ALL</button>` +
    ps.map(p => `<button class="patch-pill ${selectedPatch===p?'active':''}" data-patch="${esc(p)}">${esc(p)}</button>`).join('');

  const list = GUIDES.filter(g => selectedPatch === 'all' || g.patch === selectedPatch);
  const cards = list.map(g => {
    const badge = g.status === 'new' ? '<span class="fc-badge new">NEW</span>'
      : g.status === 'changed' ? '<span class="fc-badge changed">CHANGED</span>' : '';
    const sub = g.rewards ? esc(g.rewards) : (g.steps ? g.steps.length + ' steps' : '');
    return `<div class="feature-card" data-open="${esc(g.id)}">
      ${badge}
      <div class="fc-cat">${esc(g.category || 'feature')} · ${esc(g.patch || '')}</div>
      <div class="fc-name">${esc(g.name)}</div>
      <div class="fc-sum">${sub}</div>
      <div class="fc-meta"><span>Difficulty ${diffDots(g.difficulty)}</span>${g.timeMinutes?`<span>~${g.timeMinutes} min</span>`:''}<span>${(g.steps||[]).length} steps</span></div>
    </div>`;
  }).join('') || `<div class="empty-state"><p>No guides for this patch yet.</p></div>`;

  const pv = esc(PATCH_INFO.patch_version || (GUIDES[0] && GUIDES[0].patch) || '4.8');
  const upd = esc(PATCH_INFO.auto_updated || PATCH_INFO.data_collection_date || '');
  const status = `<div class="patch-status"><span class="ps-dot"></span><span>Data patch <b>${pv}</b>${upd ? ' · updated <b>' + upd + '</b>' : ''} · auto-refreshed weekly from live sources</span></div>`;

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Patch Hub &amp; Guides</h2>
      <div class="ef-sub">New &amp; changed gameplay since the last patches — pick a feature for a complete step-by-step walkthrough with maps.</div></div>
    ${status}
    <div class="patch-timeline">${timeline}</div>
    <div class="feature-grid">${cards}</div>`;

  ROOT.querySelectorAll('[data-patch]').forEach(b => b.onclick = () => { selectedPatch = b.dataset.patch; render(); });
  ROOT.querySelectorAll('[data-open]').forEach(c => c.onclick = () => { showGuide(c.dataset.open); });
}

function renderDetail(g) {
  const steps = (g.steps || []).map(s => `<li><div class="st-title">${esc(s.title)}</div><div class="st-detail">${esc(s.detail)}</div></li>`).join('');
  const tips = (g.tips || []).length ? `<div class="panel"><div class="gs-h">Pro Tips</div><ul class="guide-tips">${g.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : '';
  const links = (g.links || []).length ? `<div class="panel guide-links"><div class="gs-h">References</div>${g.links.map(l => `<a href="${esc(l)}" target="_blank" rel="noopener">${esc(l.replace(/^https?:\/\//,'').slice(0,46))}…</a>`).join('')}</div>` : '';
  const reqs = g.requirements ? `<div class="gs-row"><b>Needs:</b> ${esc(g.requirements)}</div>` : '';
  const rew = g.rewards ? `<div class="gs-row"><b>Reward:</b> ${esc(g.rewards)}</div>` : '';
  const map = (g.locations && g.locations.length) ? `<div class="panel"><div class="gs-h">Route / Locations</div>${locationMap(g.locations)}</div>` : '';
  const src = (g.sources || []).length ? `<div class="src-note">Sources: ${g.sources.length} · verify in-game — values shift per patch.</div>` : '';

  ROOT.innerHTML = `
    <div class="guide-detail">
      <button class="guide-back" id="guideBack">‹ Back to all guides</button>
      <div class="fc-cat" style="font-family:var(--font-mono);font-size:.66rem;letter-spacing:.14em;color:var(--sc-teal-dim);text-transform:uppercase">${esc(g.category||'feature')} · Patch ${esc(g.patch||'')} ${g.status?('· '+g.status.toUpperCase()):''}</div>
      <div class="guide-title">${esc(g.name)}</div>
      <div class="guide-meta">
        <span><b>Difficulty</b> ${diffDots(g.difficulty)}</span>
        ${g.timeMinutes?`<span><b>Time</b> ~${g.timeMinutes} min</span>`:''}
        <span><b>Steps</b> ${(g.steps||[]).length}</span>
      </div>
      <div class="guide-cols">
        <ol class="guide-steps">${steps || '<li><div class="st-detail">No steps recorded.</div></li>'}</ol>
        <div class="guide-side">
          ${(reqs||rew)?`<div class="panel"><div class="gs-h">Briefing</div>${reqs}${rew}</div>`:''}
          ${map}
          ${tips}
          ${links}
          ${src}
        </div>
      </div>
    </div>`;

  ROOT.querySelector('#guideBack').onclick = () => { currentGuide = null; render(); };
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- embedded schematic location map (SVG) ---------- */
function locationMap(locs) {
  const nodes = locs.slice(0, 6);
  const W = 290, padX = 28, rowH = 62;
  const H = padX + nodes.length * rowH;
  const cx = 40;
  let svg = `<svg class="loc-map" viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Route map">`;
  // connecting path
  for (let i = 0; i < nodes.length - 1; i++) {
    const y1 = padX + i * rowH + 14, y2 = padX + (i + 1) * rowH + 14;
    svg += `<line x1="${cx}" y1="${y1}" x2="${cx}" y2="${y2}" stroke="#1a8f88" stroke-width="2" stroke-dasharray="4 4"/>`;
  }
  nodes.forEach((n, i) => {
    const y = padX + i * rowH + 14;
    svg += `<circle cx="${cx}" cy="${y}" r="11" fill="#0a1118" stroke="#3dfff2" stroke-width="2"/>`;
    svg += `<text x="${cx}" y="${y + 4}" fill="#3dfff2" font-size="11" text-anchor="middle">${i + 1}</text>`;
    svg += `<text x="${cx + 24}" y="${y - 1}" fill="#d4e8f0" font-size="12">${esc(String(n).slice(0, 30))}</text>`;
    svg += `<text x="${cx + 24}" y="${y + 13}" fill="#3d5565" font-size="9">WAYPOINT ${String(i + 1).padStart(2, '0')}</text>`;
  });
  svg += `</svg>`;
  return svg;
}
