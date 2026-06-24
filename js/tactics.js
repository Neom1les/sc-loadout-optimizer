/* ============================================================
   SC Optimizer — Tactics tab
   Pick a target ship → armor weakness + optimal damage type +
   ranked hard-counters (stock vs stock combat math).
   ============================================================ */
import { getCombatShips, duel, damageAdvice } from './ship-combat.js';
import { formatNumber } from './stats-calculator.js';

let ROOT = null;
let SHIPS = [];
let selected = null;

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtTime(s) { if (!isFinite(s) || s <= 0) return '∞'; if (s < 60) return s.toFixed(1) + 's'; return Math.floor(s / 60) + 'm ' + Math.round(s % 60) + 's'; }

export async function initTactics(root) {
  ROOT = root;
  try {
    SHIPS = await getCombatShips();
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Ship data unavailable</h3><p>${e.message}</p></div>`;
    return;
  }
  renderShell();
}

function renderShell() {
  ROOT.innerHTML = `
    <div class="ph-head"><h2>Tactics — Counter-Pick &amp; Armor Intel</h2>
      <div class="ef-sub">Pick a target ship to see its armor weaknesses, the optimal damage type to bring, and which ships hard-counter it (stock vs stock).</div></div>
    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Target ship</div>
        <input type="text" class="search-input" id="tacSearch" placeholder="Search ${SHIPS.length} combat ships...">
        <div class="ship-list" id="tacList"></div>
      </div>
      <div class="tac-analysis" id="tacAnalysis">
        <div class="empty-state"><h3>Select a target</h3><p>Choose an enemy ship on the left to analyze it.</p></div>
      </div>
    </div>`;
  const search = ROOT.querySelector('#tacSearch');
  search.addEventListener('input', () => renderList(search.value.toLowerCase().trim()));
  renderList('');
}

function renderList(q) {
  const list = q
    ? SHIPS.filter(s => s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q) || s.role.toLowerCase().includes(q))
    : SHIPS;
  const el = ROOT.querySelector('#tacList');
  el.innerHTML = list.slice(0, 140).map(s =>
    `<div class="ship-item${selected && s.uuid === selected.uuid ? ' active' : ''}" data-uuid="${s.uuid}"><span>${esc(s.name)}</span><span class="ship-role">${esc(s.role)}</span></div>`
  ).join('') || '<div class="empty-state"><p>No ships found</p></div>';
  el.querySelectorAll('.ship-item').forEach(it => it.onclick = () => {
    selected = SHIPS.find(s => s.uuid === it.dataset.uuid);
    renderList(q);
    renderAnalysis();
    ROOT.querySelector('#tacAnalysis')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
}

function bar(label, mult) {
  const pct = Math.max(4, Math.min(100, (mult / 1.5) * 100));
  const color = mult >= 1 ? 'var(--status-crit)' : mult >= 0.8 ? 'var(--status-warn)' : 'var(--status-ok)';
  return `<div class="tac-bar-row"><span class="tac-bar-label">${label}</span><div class="tac-bar"><span style="width:${pct}%;background:${color}"></span></div><span class="tac-bar-val">${mult}×</span></div>`;
}

function renderAnalysis() {
  const t = selected;
  if (!t) return;
  const adv = damageAdvice(t.armorMult);
  const uniform = adv.best.mult === adv.worst.mult;

  const counters = SHIPS.filter(s => s.combatRole && s.sizeRank <= t.sizeRank + 1)
    .map(s => ({ s, ...duel(s, t) }))
    .filter(c => isFinite(c.aKillsB))
    .sort((a, b) => (a.aKillsB - b.aKillsB) || (b.margin - a.margin))
    .slice(0, 12);

  const counterRows = counters.map((c, i) => {
    const cls = c.margin > 0 ? 'ok' : c.margin < 0 ? 'crit' : 'warn';
    const speedAdv = Math.round(c.s.scm - t.scm);
    const usesTorp = t.sizeRank >= 3 && (c.s.missileDamage || 0) >= t.effShieldHp && t.effShieldHp > 0;
    const mirror = c.s.uuid === t.uuid;
    const reason = `${mirror ? 'mirror match · ' : ''}${usesTorp ? 'torpedo strike · ' : ''}kills in ${fmtTime(c.aKillsB)} vs your ${fmtTime(c.bKillsA)}${speedAdv > 30 ? ` · +${speedAdv} m/s` : ''}`;
    const marginText = c.margin >= 1e9 ? 'DOMINANT' : (c.margin > 0 ? '+' : '−') + fmtTime(Math.abs(c.margin));
    return `<div class="tac-counter">
      <span class="tc-rank">#${i + 1}</span>
      <div class="tc-body"><b>${esc(c.s.name)}</b> <span class="ship-role">${esc(c.s.role)}</span>
        <span class="tc-reason">${reason}</span></div>
      <span class="tc-margin ${cls}">${marginText}</span>
    </div>`;
  }).join('') || `<div class="empty-state"><p>${t.sizeRank >= 3 ? 'Capital &amp; large targets resist single-ship stock counters — bring coordinated torpedo bombers or a fighter wing.' : 'No clear stock counter in this size class — try an optimized loadout in the Loadout Optimizer.'}</p></div>`;

  const adviceText = uniform
    ? `Armor is uniform (${adv.best.mult}× across types) — any damage type works; pick for shield bleed-through and range.`
    : `<b>Bring ${esc(adv.best.label)}</b> — armor takes <b>${adv.best.mult}×</b> from it${adv.worst.mult < adv.best.mult ? `. Avoid ${esc(adv.worst.label)} (${adv.worst.mult}×).` : '.'}`;

  ROOT.querySelector('#tacAnalysis').innerHTML = `
    <div class="panel tac-target">
      <div class="tac-target-head">
        <div><div class="tac-target-name">${esc(t.name)}</div><div class="ship-role">${esc(t.manufacturer)} · ${esc(t.role)}${t.size ? ' · ' + esc(t.size) : ''}</div></div>
        <div class="tac-ehp"><span>${formatNumber(t.ehp)}</span><label>EHP</label></div>
      </div>
      <div class="tac-def-grid">
        <div class="stat-row"><span class="stat-label">Shield HP</span><span class="stat-value">${formatNumber(t.shieldHp)}</span></div>
        <div class="stat-row"><span class="stat-label">Shield Regen</span><span class="stat-value">${formatNumber(t.shieldRegen)}/s</span></div>
        <div class="stat-row"><span class="stat-label">Armor HP</span><span class="stat-value">${formatNumber(t.armorHp)}</span></div>
        <div class="stat-row"><span class="stat-label">Hull HP</span><span class="stat-value">${formatNumber(t.hullHp)}</span></div>
        <div class="stat-row"><span class="stat-label">Stock DPS</span><span class="stat-value dps-number">${formatNumber(t.dps)}</span></div>
        <div class="stat-row"><span class="stat-label">SCM Speed</span><span class="stat-value">${formatNumber(t.scm)} m/s</span></div>
      </div>
    </div>
    <div class="panel tac-armor">
      <div class="panel-header">Armor weakness — damage-type advisor</div>
      ${bar('Ballistic / Physical', t.armorMult.physical)}
      ${bar('Energy / Laser', t.armorMult.energy)}
      ${bar('Distortion', t.armorMult.distortion)}
      <div class="tac-advice">${adviceText}</div>
    </div>
    <div class="panel tac-counters">
      <div class="panel-header">Top counters vs ${esc(t.name)} <span class="pc-note">stock vs stock</span></div>
      <div class="tac-counter-list">${counterRows}</div>
    </div>`;
}
