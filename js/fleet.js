/* ============================================================
   SC Optimizer — Fleet tab (org / clan tools)
   Sub-tools: My Fleet (visual fleet builder with previews + to-scale
   size comparison), Squad Composition Builder, and Squad Loadout
   Presets (shareable). All client-side (LocalStorage + URL-hash).
   ============================================================ */
import { getCombatShips } from './ship-combat.js';
import { getSavedLoadouts } from './storage.js';
import { formatNumber } from './stats-calculator.js';
import { loadJSON } from './data-loader.js';

const FKEY = 'sc-my-fleet';
const PKEY = 'sc-squad-presets';

let ROOT = null;
let COMBAT = [];
let ALL = null;
let mode = 'myfleet';
let squad = [];
let sharedSquad = null;
let mfView = 'cards';            // 'cards' | 'table'
let mfFilter = new Set();        // active career filters (empty = all)
let mfSort = { col: 'name', dir: 1 };

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function lget(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
function lset(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function roleClass(role) {
  const r = (role || '').toLowerCase();
  if (/bomber|torpedo/.test(r)) return 'Bomber';
  if (/heavy fighter|gunship/.test(r)) return 'Heavy';
  if (/light fighter|interceptor|snub/.test(r)) return 'Interceptor';
  if (/medical|support|refuel|repair|tanker/.test(r)) return 'Support';
  if (/capital|corvette|frigate|destroyer|cruiser|carrier/.test(r)) return 'Capital';
  if (/cargo|freight|haul|transport/.test(r)) return 'Cargo';
  if (/mining|salvage|refinery/.test(r)) return 'Industrial';
  if (/explor|pathfinder|expedition/.test(r)) return 'Explorer';
  if (/fighter/.test(r)) return 'Fighter';
  return 'Other';
}

function szClass(size) { return ({ small: 's', medium: 'm', large: 'l', capital: 'c', vehicle: 'v' }[(size || '').toLowerCase()]) || 'm'; }

/* all ships (every type), basic fields for the fleet view */
async function loadAllShips() {
  if (ALL) return ALL;
  const ships = await loadJSON('ships.json');
  const seen = new Set();
  ALL = [];
  for (const s of ships) {
    if (!(s.is_spaceship || s.is_vehicle) || !s.name || seen.has(s.name)) continue;
    seen.add(s.name);
    ALL.push({
      uuid: s.uuid,
      name: s.name,
      manufacturer: s.manufacturer?.name || 'Unknown',
      role: s.role || 'Unknown',
      size: s.size?.en_EN || '',
      length: s.dimensions?.length || 0,
      crewMin: s.crew?.min || 1,
      crewMax: s.crew?.max || 1,
      cargo: s.cargo_capacity || 0,
      ore: s.ore_capacity || 0,
      scm: s.speed?.scm || 0,
      career: s.career || 'Other',
      dps: s.weaponry?.pilot_dps || 0,
      missile: s.weaponry?.total_missile_damage || 0,
      hull: s.hull_health || 0,
      shield: s.shield?.shield_hp || 0,
      ehp: (s.hull_health || 0) + (s.shield?.shield_hp || 0),
      qtRange: s.quantum?.quantum_range || 0,
      image: s.images?.[0]?.thumbnail_url || s.images?.[0]?.original_url || null,
    });
  }
  ALL.sort((a, b) => a.name.localeCompare(b.name));
  return ALL;
}

export async function initFleet(root) {
  ROOT = root;
  try {
    [COMBAT, ALL] = await Promise.all([getCombatShips(), loadAllShips()]);
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Ship data unavailable</h3><p>${e.message}</p></div>`;
    return;
  }
  checkSharedSquad();
  if (sharedSquad) mode = 'presets';
  render();
}

function render() {
  ROOT.innerHTML = `
    <div class="ph-head"><h2>Fleet Operations</h2>
      <div class="ef-sub">Build &amp; visualize your fleet, plan combat squads, and share standard loadout presets — all stored locally, no account needed.</div></div>
    <div class="fleet-subtabs">
      <button class="fl-sub${mode === 'myfleet' ? ' active' : ''}" data-mode="myfleet">My Fleet</button>
      <button class="fl-sub${mode === 'squad' ? ' active' : ''}" data-mode="squad">Squad Builder</button>
      <button class="fl-sub${mode === 'presets' ? ' active' : ''}" data-mode="presets">Loadout Presets</button>
    </div>
    <div id="fleetBody"></div>`;
  ROOT.querySelectorAll('.fl-sub[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
  if (mode === 'myfleet') renderMyFleet();
  else if (mode === 'squad') renderSquad();
  else renderPresets();
}

/* ─────────────────────────── My Fleet ─────────────────────────────────── */
function shipCard(s) {
  const img = s.image
    ? `<img src="${s.image}" alt="${esc(s.name)}" loading="lazy" onerror="this.closest('.fleet-card').classList.add('no-img')">`
    : '';
  return `<div class="fleet-card${s.image ? '' : ' no-img'}">
    <div class="fc-img">${img}<span class="fc-noimg">NO IMAGE</span><span class="sq-remove" data-x="${s.uuid}">×</span></div>
    <div class="fc-info">
      <div class="fc-title">${esc(s.name)}</div>
      <div class="ship-role">${esc(s.manufacturer)} · ${esc(s.role)}${s.size ? ' · ' + esc(s.size) : ''}</div>
      <div class="fc-stats">
        <span>${s.crewMax > 1 ? s.crewMin + '–' + s.crewMax + ' crew' : 'solo'}</span>
        <span>${s.cargo ? formatNumber(s.cargo) + ' SCU' : 'no cargo'}</span>
        ${s.length ? `<span>${s.length} m</span>` : ''}
        ${s.scm ? `<span>${formatNumber(s.scm)} m/s</span>` : ''}
      </div>
    </div>
  </div>`;
}

function renderSizeBars(ships) {
  const withLen = ships.filter(s => s.length > 0).sort((a, b) => b.length - a.length);
  if (!withLen.length) return '<div class="src-note">No dimension data for these ships.</div>';
  const maxLen = withLen[0].length;
  return withLen.map(s => {
    const pct = Math.max(2, (s.length / maxLen) * 100);
    return `<div class="sizebar-row"><span class="sizebar-name">${esc(s.name)}</span><div class="sizebar-track"><span class="sizebar-fill sz-${szClass(s.size)}" style="width:${pct}%"></span></div><span class="sizebar-len">${s.length} m</span></div>`;
  }).join('');
}

function fmtRange(m) {
  if (!m) return '—';
  return m >= 1e9 ? (m / 1e9).toFixed(1) + ' Gm' : Math.round(m / 1e6) + ' Mm';
}

const FLEET_COLS = [
  { k: 'name', l: 'Ship', num: false },
  { k: 'manufacturer', l: 'Mfr', num: false },
  { k: 'career', l: 'Career', num: false },
  { k: 'crewMax', l: 'Crew', num: true },
  { k: 'cargo', l: 'Cargo', num: true, fmt: v => v ? formatNumber(v) : '—' },
  { k: 'length', l: 'Length', num: true, fmt: v => v ? v + ' m' : '—' },
  { k: 'scm', l: 'SCM', num: true, fmt: v => v ? formatNumber(v) : '—' },
  { k: 'qtRange', l: 'QT', num: true, fmt: fmtRange },
  { k: 'dps', l: 'DPS', num: true, fmt: v => v ? formatNumber(v) : '—' },
  { k: 'ehp', l: 'EHP', num: true, fmt: v => formatNumber(v) },
];

function fleetDashboard(ships) {
  const sum = f => ships.reduce((a, s) => a + (f(s) || 0), 0);
  const cargo = sum(s => s.cargo), ore = sum(s => s.ore), seats = sum(s => s.crewMax);
  const dps = sum(s => s.dps), missile = sum(s => s.missile), ehp = sum(s => s.ehp);
  const ranges = ships.map(s => s.qtRange).filter(r => r > 0);
  const minRange = ranges.length ? Math.min(...ranges) : 0;
  const car = {};
  for (const s of ships) car[s.career] = (car[s.career] || 0) + 1;
  const carEntries = Object.entries(car).sort((a, b) => b[1] - a[1]);
  const maxCar = Math.max(1, ...carEntries.map(e => e[1]));
  const careers = new Set(ships.map(s => s.career));
  const warn = [];
  if (!careers.has('Support')) warn.push('No Support ship (medical / repair / refuel).');
  if (cargo === 0) warn.push('No cargo capacity — the fleet can\'t haul.');
  if (!careers.has('Combat') && !careers.has('Gunship') && !careers.has('Destroyer')) warn.push('No combat ship — no firepower.');
  const stat = (l, v, cls) => `<div class="dash-stat"><label>${l}</label><span class="${cls || ''}">${v}</span></div>`;
  const chart = carEntries.map(([c, n]) => `<div class="dash-bar-row"><span class="dash-bar-label">${esc(c)}</span><div class="dash-bar"><span style="width:${(n / maxCar) * 100}%"></span></div><span class="dash-bar-n">${n}</span></div>`).join('');
  return `
    <div class="dash-grid">
      ${stat('Total cargo', formatNumber(cargo) + ' SCU')}
      ${ore ? stat('Ore capacity', formatNumber(ore) + ' SCU') : ''}
      ${stat('Crew seats', seats)}
      ${stat('Pilot DPS', formatNumber(dps), 'dps-number')}
      ${missile ? stat('Missile dmg', formatNumber(missile)) : ''}
      ${stat('Fleet EHP', formatNumber(ehp))}
      ${stat('Min QT range', fmtRange(minRange))}
    </div>
    <div class="dash-chart">${chart}</div>
    ${warn.length ? `<div class="sq-feedback">${warn.map(w => `<div class="sq-fb warn">${esc(w)}</div>`).join('')}</div>` : '<div class="sq-fb ok">Balanced — combat, cargo and support covered.</div>'}`;
}

function renderSpecTable(ships) {
  const sorted = [...ships].sort((a, b) => {
    const c = mfSort.col, av = a[c], bv = b[c];
    if (typeof av === 'number') return (av - bv) * mfSort.dir;
    return String(av).localeCompare(String(bv)) * mfSort.dir;
  });
  const maxes = {};
  for (const col of FLEET_COLS) if (col.num) maxes[col.k] = Math.max(0, ...ships.map(s => s[col.k] || 0));
  const head = FLEET_COLS.map(col => `<th data-col="${col.k}" class="${col.num ? 'num' : ''}${mfSort.col === col.k ? ' sorted' : ''}">${col.l}${mfSort.col === col.k ? (mfSort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const rows = sorted.map(s => `<tr>${FLEET_COLS.map(col => {
    const v = s[col.k];
    const disp = col.fmt ? col.fmt(v) : esc(String(v));
    const best = col.num && v > 0 && v === maxes[col.k];
    return `<td class="${col.num ? 'num' : ''}${best ? ' best' : ''}">${disp}</td>`;
  }).join('')}<td class="num"><span class="sq-remove" data-x="${s.uuid}">×</span></td></tr>`).join('');
  return `<table class="fleet-table"><thead><tr>${head}<th></th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderMyFleet() {
  const body = ROOT.querySelector('#fleetBody');
  const fleetIds = lget(FKEY);
  const inFleet = new Set(fleetIds);
  const all = fleetIds.map(id => ALL.find(s => s.uuid === id)).filter(Boolean);
  const ships = mfFilter.size ? all.filter(s => mfFilter.has(s.career)) : all;
  const careers = [...new Set(all.map(s => s.career))].sort();
  const longest = ships.reduce((m, s) => Math.max(m, s.length || 0), 0);

  body.innerHTML = `
    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Add ship (${all.length} in fleet)</div>
        <input type="text" class="search-input" id="mfSearch" placeholder="Search ${ALL.length} ships...">
        <div class="ship-list" id="mfList"></div>
      </div>
      <div class="tac-analysis">
        ${all.length ? `
        <div class="panel">
          <div class="panel-header">Fleet dashboard <span class="pc-note">${all.length} ships${mfFilter.size ? ` · ${ships.length} shown` : ''}</span></div>
          ${fleetDashboard(ships)}
          <div class="fleet-io">
            <button class="fl-sub" id="mfExport">Export JSON</button>
            <button class="fl-sub" id="mfImport">Import JSON</button>
            <button class="fl-sub" id="mfClear">Clear fleet</button>
          </div>
        </div>
        <div class="fleet-controls">
          <div class="fleet-filters">${careers.map(c => `<button class="fl-chip${mfFilter.has(c) ? ' active' : ''}" data-career="${esc(c)}">${esc(c)}</button>`).join('')}</div>
          <div class="fleet-viewtoggle"><button class="fl-chip${mfView === 'cards' ? ' active' : ''}" data-view="cards">Cards</button><button class="fl-chip${mfView === 'table' ? ' active' : ''}" data-view="table">Table</button></div>
        </div>
        <div class="panel">
          <div class="panel-header">Size comparison <span class="pc-note">to scale · longest ${Math.round(longest)} m</span></div>
          <div class="fleet-sizecmp">${renderSizeBars(ships)}</div>
        </div>
        ${mfView === 'table' ? `<div class="panel fleet-tablewrap">${renderSpecTable(ships)}</div>` : `<div class="fleet-grid">${ships.map(shipCard).join('')}</div>`}
        ` : '<div class="empty-state"><h3>Your fleet is empty</h3><p>Search on the left and add the ships you own (or want). You\'ll see render previews, a fleet dashboard, a sortable spec table and a to-scale size comparison.</p></div>'}
      </div>
    </div>`;

  const search = body.querySelector('#mfSearch');
  const drawList = (q) => {
    const list = q ? ALL.filter(s => s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q) || s.role.toLowerCase().includes(q)) : ALL;
    body.querySelector('#mfList').innerHTML = list.slice(0, 160).map(s =>
      `<div class="ship-item${inFleet.has(s.uuid) ? ' active' : ''}" data-uuid="${s.uuid}"><span>${esc(s.name)}</span><span class="ship-role">${esc(s.role)}</span></div>`
    ).join('') || '<div class="empty-state"><p>No ships</p></div>';
    body.querySelectorAll('#mfList .ship-item').forEach(it => it.onclick = () => {
      const id = it.dataset.uuid;
      let f = lget(FKEY);
      f = f.includes(id) ? f.filter(x => x !== id) : [...f, id];
      lset(FKEY, f);
      renderMyFleet();
    });
  };
  search.addEventListener('input', () => drawList(search.value.toLowerCase().trim()));
  drawList('');

  body.querySelectorAll('.fl-chip[data-career]').forEach(c => c.onclick = () => { const k = c.dataset.career; mfFilter.has(k) ? mfFilter.delete(k) : mfFilter.add(k); renderMyFleet(); });
  body.querySelectorAll('.fl-chip[data-view]').forEach(b => b.onclick = () => { mfView = b.dataset.view; renderMyFleet(); });
  body.querySelectorAll('.fleet-table th[data-col]').forEach(th => th.onclick = () => { const c = th.dataset.col; if (mfSort.col === c) mfSort.dir *= -1; else { mfSort.col = c; mfSort.dir = 1; } renderMyFleet(); });
  body.querySelectorAll('.sq-remove[data-x]').forEach(x => x.onclick = () => { lset(FKEY, lget(FKEY).filter(id => id !== x.dataset.x)); renderMyFleet(); });

  const exp = body.querySelector('#mfExport');
  if (exp) exp.onclick = () => {
    const out = all.map(s => ({ uuid: s.uuid, name: s.name }));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'my-fleet.json'; a.click();
  };
  const imp = body.querySelector('#mfImport');
  if (imp) imp.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const data = JSON.parse(rd.result); const ids = (Array.isArray(data) ? data : []).map(x => x.uuid || x).filter(Boolean); if (ids.length) { lset(FKEY, ids); renderMyFleet(); } } catch {} }; rd.readAsText(f); };
    inp.click();
  };
  const clr = body.querySelector('#mfClear');
  if (clr) clr.onclick = () => { if (confirm('Clear your whole fleet?')) { lset(FKEY, []); renderMyFleet(); } };
}

/* ─────────────────────────── Squad Composition Builder ─────────────────── */
function renderSquad() {
  const body = ROOT.querySelector('#fleetBody');
  const inSquad = new Set(squad.map(s => s.uuid));
  const agg = squadAggregate(squad);

  body.innerHTML = `
    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Add ships (${squad.length}/8)</div>
        <input type="text" class="search-input" id="sqSearch" placeholder="Search ${COMBAT.length} combat ships...">
        <div class="ship-list" id="sqList"></div>
      </div>
      <div class="tac-analysis">
        <div class="panel">
          <div class="panel-header">Squad — ${squad.length} ship${squad.length === 1 ? '' : 's'}</div>
          <div id="sqMembers">${squad.length ? '' : '<div class="empty-state"><p>Add 2–8 combat ships to compose a squad.</p></div>'}</div>
        </div>
        ${squad.length ? `
        <div class="panel">
          <div class="panel-header">Combined strength</div>
          <div class="tac-def-grid">
            <div class="stat-row"><span class="stat-label">Total stock DPS</span><span class="stat-value dps-number">${formatNumber(agg.dps)}</span></div>
            <div class="stat-row"><span class="stat-label">Combined EHP</span><span class="stat-value">${formatNumber(agg.ehp)}</span></div>
            <div class="stat-row"><span class="stat-label">Crew required</span><span class="stat-value">${agg.crewMin}–${agg.crewMax}</span></div>
            <div class="stat-row"><span class="stat-label">Avg SCM speed</span><span class="stat-value">${formatNumber(agg.avgScm)} m/s</span></div>
            <div class="stat-row"><span class="stat-label">Slowest ship</span><span class="stat-value">${formatNumber(agg.minScm)} m/s</span></div>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header">Role balance</div>
          <div class="sq-roles">${Object.entries(agg.roles).map(([r, n]) => `<span class="sq-role-chip">${esc(r)} ×${n}</span>`).join('')}</div>
          ${agg.feedback.length ? `<div class="sq-feedback">${agg.feedback.map(f => `<div class="sq-fb ${f.kind}">${esc(f.text)}</div>`).join('')}</div>` : '<div class="sq-fb ok">Well-rounded composition.</div>'}
        </div>` : ''}
      </div>
    </div>`;

  const search = body.querySelector('#sqSearch');
  const drawList = (q) => {
    const list = q ? COMBAT.filter(s => s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q) || s.role.toLowerCase().includes(q)) : COMBAT;
    body.querySelector('#sqList').innerHTML = list.slice(0, 140).map(s =>
      `<div class="ship-item${inSquad.has(s.uuid) ? ' active' : ''}" data-uuid="${s.uuid}"><span>${esc(s.name)}</span><span class="ship-role">${esc(s.role)}</span></div>`
    ).join('') || '<div class="empty-state"><p>No ships</p></div>';
    body.querySelectorAll('#sqList .ship-item').forEach(it => it.onclick = () => {
      const s = COMBAT.find(x => x.uuid === it.dataset.uuid);
      if (inSquad.has(s.uuid)) squad = squad.filter(x => x.uuid !== s.uuid);
      else if (squad.length < 8) squad.push(s);
      renderSquad();
    });
  };
  search.addEventListener('input', () => drawList(search.value.toLowerCase().trim()));
  drawList('');

  const mem = body.querySelector('#sqMembers');
  if (mem && squad.length) {
    mem.innerHTML = squad.map(s =>
      `<div class="sq-member"><div><b>${esc(s.name)}</b> <span class="ship-role">${esc(s.role)}</span><span class="sq-mstats">${formatNumber(s.dps)} DPS · ${formatNumber(s.ehp)} EHP · ${s.crew.max > 1 ? s.crew.min + '–' + s.crew.max + ' crew' : 'solo'}</span></div><span class="sq-remove" data-x="${s.uuid}">×</span></div>`
    ).join('');
    mem.querySelectorAll('.sq-remove').forEach(x => x.onclick = () => { squad = squad.filter(s => s.uuid !== x.dataset.x); renderSquad(); });
  }
}

function squadAggregate(list) {
  const agg = { dps: 0, ehp: 0, crewMin: 0, crewMax: 0, avgScm: 0, minScm: Infinity, roles: {}, feedback: [] };
  if (!list.length) return agg;
  let scmSum = 0;
  for (const s of list) {
    agg.dps += s.dps; agg.ehp += s.ehp;
    agg.crewMin += s.crew.min; agg.crewMax += s.crew.max;
    scmSum += s.scm; agg.minScm = Math.min(agg.minScm, s.scm);
    const rc = roleClass(s.role);
    agg.roles[rc] = (agg.roles[rc] || 0) + 1;
  }
  agg.avgScm = scmSum / list.length;
  if (!isFinite(agg.minScm)) agg.minScm = 0;
  const has = (r) => (agg.roles[r] || 0) > 0;
  if (!has('Interceptor') && !has('Fighter') && !has('Heavy')) agg.feedback.push({ kind: 'warn', text: 'No dedicated fighter — light on dogfighting power.' });
  if (!has('Support')) agg.feedback.push({ kind: 'warn', text: 'No support ship (medical/repair/refuel) — no in-field sustain.' });
  if (!has('Bomber') && !has('Capital')) agg.feedback.push({ kind: 'warn', text: 'No bomber or capital — limited anti-large firepower.' });
  if (agg.minScm < 200 && list.length > 1) agg.feedback.push({ kind: 'warn', text: `Slowest ship at ${Math.round(agg.minScm)} m/s will hold the group back.` });
  return agg;
}

/* ─────────────────────────── Squad Loadout Presets ────────────────────── */
function encodeSquadLink(preset) {
  const payload = { n: preset.name, t: preset.tag, l: preset.loadouts };
  return location.origin + location.pathname + '#squad=' + btoa(encodeURIComponent(JSON.stringify(payload)));
}
function checkSharedSquad() {
  const m = (location.hash || '').match(/squad=([^&]+)/);
  if (m) { try { sharedSquad = JSON.parse(decodeURIComponent(atob(m[1]))); } catch { sharedSquad = null; } }
}

function renderPresets() {
  const body = ROOT.querySelector('#fleetBody');
  const saved = getSavedLoadouts();
  const presets = lget(PKEY);

  const sharedBlock = sharedSquad ? `
    <div class="panel" style="border-left:3px solid var(--sc-teal)">
      <div class="panel-header">Shared squad preset <span class="pc-note">from link</span></div>
      <div class="sq-preset-head"><b>${esc(sharedSquad.n || 'Squad')}</b> ${sharedSquad.t ? `<span class="sq-role-chip">${esc(sharedSquad.t)}</span>` : ''}</div>
      ${(sharedSquad.l || []).map(l => `<div class="sq-member"><div><b>${esc(l.shipName)}</b> <span class="ship-role">${esc(l.profile || '')}</span><span class="sq-mstats">${(l.weapons || []).filter(Boolean).map(w => esc(w.name || w)).join(', ') || 'stock'}</span></div></div>`).join('')}
      <button class="btn-optimize" id="impShared" style="margin-top:10px">Import this preset</button>
    </div>` : '';

  body.innerHTML = `
    ${sharedBlock}
    <div class="panel">
      <div class="panel-header">Build a squad preset from saved loadouts</div>
      ${saved.length ? `
        <div class="preset-pick">${saved.map(s => `<label class="sc-checkbox preset-cb"><input type="checkbox" value="${s.id}"><span>${esc(s.name)} <span class="ship-role">${esc(s.shipName)}</span></span></label>`).join('')}</div>
        <div class="roster-form" style="margin-top:10px">
          <input type="text" class="search-input" id="pName" placeholder="Preset name (e.g. Bounty Wing)">
          <input type="text" class="search-input" id="pTag" placeholder="Tag (Bounty / Mining / Anti-Fighter)">
          <button class="btn-optimize" id="pAdd" style="white-space:nowrap">+ Create</button>
        </div>`
        : '<div class="empty-state"><p>No saved loadouts yet. Save a few in the Loadout Optimizer first, then bundle them into a squad preset here.</p></div>'}
    </div>
    ${presets.length ? `
    <div class="panel">
      <div class="panel-header">Your squad presets</div>
      <div id="presetList"></div>
    </div>` : ''}`;

  if (sharedSquad) {
    body.querySelector('#impShared').onclick = () => {
      const presets = lget(PKEY);
      presets.push({ id: Math.random().toString(36).slice(2, 9), name: sharedSquad.n || 'Imported squad', tag: sharedSquad.t || '', loadouts: sharedSquad.l || [] });
      lset(PKEY, presets);
      sharedSquad = null;
      history.replaceState(null, '', location.pathname + location.search + '#fleet');
      render();
    };
  }

  const addBtn = body.querySelector('#pAdd');
  if (addBtn) addBtn.onclick = () => {
    const name = body.querySelector('#pName').value.trim();
    if (!name) return;
    const picked = [...body.querySelectorAll('.preset-cb input:checked')].map(c => c.value);
    if (!picked.length) return;
    const saved = getSavedLoadouts();
    const loadouts = picked.map(id => saved.find(s => s.id === id)).filter(Boolean).map(s => ({ shipName: s.shipName, profile: s.profile, weapons: s.loadout?.weapons || [] }));
    const presets = lget(PKEY);
    presets.push({ id: Math.random().toString(36).slice(2, 9), name, tag: body.querySelector('#pTag').value.trim(), loadouts });
    lset(PKEY, presets);
    renderPresets();
  };

  const listEl = body.querySelector('#presetList');
  if (listEl) {
    listEl.innerHTML = presets.map(p => `
      <div class="sq-preset">
        <div class="sq-preset-head"><b>${esc(p.name)}</b> ${p.tag ? `<span class="sq-role-chip">${esc(p.tag)}</span>` : ''} <span class="pc-note">${p.loadouts.length} ships</span></div>
        <div class="sq-preset-ships">${p.loadouts.map(l => `<span class="sq-role-chip">${esc(l.shipName)}</span>`).join('')}</div>
        <div class="sq-preset-actions">
          <button class="fl-sub" data-share="${p.id}">Copy share link</button>
          <button class="fl-sub" data-del="${p.id}">Delete</button>
        </div>
      </div>`).join('');
    listEl.querySelectorAll('[data-share]').forEach(b => b.onclick = () => {
      const p = lget(PKEY).find(x => x.id === b.dataset.share);
      if (!p) return;
      const link = encodeSquadLink(p);
      navigator.clipboard?.writeText(link).then(() => { b.textContent = 'Copied!'; setTimeout(() => { b.textContent = 'Copy share link'; }, 1500); }, () => { prompt('Share link:', link); });
    });
    listEl.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { lset(PKEY, lget(PKEY).filter(x => x.id !== b.dataset.del)); renderPresets(); });
  }
}
