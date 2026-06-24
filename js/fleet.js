/* ============================================================
   SC Optimizer — Fleet tab (org / clan tools)
   Three sub-tools: Squad Composition Builder, Fleet & Crew Roster,
   and Squad Loadout Presets (with shareable links). All client-side
   (LocalStorage + URL-hash sharing), built for NEMESIS coordination.
   ============================================================ */
import { getCombatShips } from './ship-combat.js';
import { getSavedLoadouts } from './storage.js';
import { formatNumber } from './stats-calculator.js';

const RKEY = 'sc-fleet-roster';
const PKEY = 'sc-squad-presets';

let ROOT = null;
let SHIPS = [];
let mode = 'squad';
let squad = [];          // array of ship profiles
let sharedSquad = null;  // decoded from URL hash, if any

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function lget(k) { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
function lset(k, v) { localStorage.setItem(k, JSON.stringify(v)); }

function roleClass(role) {
  const r = (role || '').toLowerCase();
  if (/bomber|torpedo/.test(r)) return 'Bomber';
  if (/heavy fighter|gunship/.test(r)) return 'Heavy';
  if (/light fighter|interceptor|snub/.test(r)) return 'Interceptor';
  if (/medical|support|refuel|repair|tanker/.test(r)) return 'Support';
  if (/capital|corvette|frigate|destroyer|cruiser/.test(r)) return 'Capital';
  if (/fighter/.test(r)) return 'Fighter';
  return 'Other';
}

export async function initFleet(root) {
  ROOT = root;
  try {
    SHIPS = await getCombatShips();
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
      <div class="ef-sub">Plan squad compositions, track your org's fleet &amp; crews, and share standard loadout presets — all stored locally, no account needed.</div></div>
    <div class="fleet-subtabs">
      <button class="fl-sub${mode === 'squad' ? ' active' : ''}" data-mode="squad">Squad Builder</button>
      <button class="fl-sub${mode === 'roster' ? ' active' : ''}" data-mode="roster">Fleet &amp; Crew Roster</button>
      <button class="fl-sub${mode === 'presets' ? ' active' : ''}" data-mode="presets">Loadout Presets</button>
    </div>
    <div id="fleetBody"></div>`;
  ROOT.querySelectorAll('.fl-sub').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
  if (mode === 'squad') renderSquad();
  else if (mode === 'roster') renderRoster();
  else renderPresets();
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
        <input type="text" class="search-input" id="sqSearch" placeholder="Search ${SHIPS.length} ships...">
        <div class="ship-list" id="sqList"></div>
      </div>
      <div class="tac-analysis">
        <div class="panel">
          <div class="panel-header">Squad — ${squad.length} ship${squad.length === 1 ? '' : 's'}</div>
          <div id="sqMembers">${squad.length ? '' : '<div class="empty-state"><p>Add 2–8 ships to compose a squad.</p></div>'}</div>
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
    const list = q ? SHIPS.filter(s => s.name.toLowerCase().includes(q) || s.manufacturer.toLowerCase().includes(q) || s.role.toLowerCase().includes(q)) : SHIPS;
    body.querySelector('#sqList').innerHTML = list.slice(0, 140).map(s =>
      `<div class="ship-item${inSquad.has(s.uuid) ? ' active' : ''}" data-uuid="${s.uuid}"><span>${esc(s.name)}</span><span class="ship-role">${esc(s.role)}</span></div>`
    ).join('') || '<div class="empty-state"><p>No ships</p></div>';
    body.querySelectorAll('#sqList .ship-item').forEach(it => it.onclick = () => {
      const s = SHIPS.find(x => x.uuid === it.dataset.uuid);
      if (inSquad.has(s.uuid)) squad = squad.filter(x => x.uuid !== s.uuid);
      else if (squad.length < 8) squad.push(s);
      renderSquad();
    });
  };
  search.addEventListener('input', () => drawList(search.value.toLowerCase().trim()));
  drawList('');

  body.querySelector('#sqMembers').innerHTML = squad.map(s =>
    `<div class="sq-member"><div><b>${esc(s.name)}</b> <span class="ship-role">${esc(s.role)}</span><span class="sq-mstats">${formatNumber(s.dps)} DPS · ${formatNumber(s.ehp)} EHP · ${s.crew.max > 1 ? s.crew.min + '–' + s.crew.max + ' crew' : 'solo'}</span></div><span class="sq-remove" data-x="${s.uuid}">×</span></div>`
  ).join('');
  body.querySelectorAll('.sq-remove').forEach(x => x.onclick = () => { squad = squad.filter(s => s.uuid !== x.dataset.x); renderSquad(); });
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

/* ─────────────────────────── Fleet & Crew Roster ──────────────────────── */
function renderRoster() {
  const body = ROOT.querySelector('#fleetBody');
  const assets = lget(RKEY);
  const shipOpts = ['<option value="">— select ship —</option>'].concat(SHIPS.map(s => `<option value="${s.uuid}">${esc(s.name)}</option>`)).join('');

  // fleet aggregate + crew demand
  let totalCrew = 0, multicrew = 0;
  const byMember = {};
  for (const a of assets) {
    (byMember[a.member] = byMember[a.member] || []).push(a);
    const ship = SHIPS.find(s => s.uuid === a.shipUuid);
    if (ship) { totalCrew += ship.crew.max; if (ship.crew.max > 1) multicrew++; }
  }

  body.innerHTML = `
    <div class="panel">
      <div class="panel-header">Add fleet asset</div>
      <div class="roster-form">
        <input type="text" class="search-input" id="rMember" placeholder="Member / handle">
        <select class="search-input" id="rShip">${shipOpts}</select>
        <input type="text" class="search-input" id="rLoc" placeholder="Stored at (e.g. Area18)">
        <select class="search-input" id="rStatus"><option value="ready">Ready</option><option value="maintenance">Maintenance</option><option value="loaned">Loaned out</option></select>
        <button class="btn-optimize" id="rAdd" style="white-space:nowrap">+ Add</button>
      </div>
    </div>
    ${assets.length ? `
    <div class="panel">
      <div class="panel-header">Fleet overview <span class="pc-note">${assets.length} ships · ${Object.keys(byMember).length} members · ${multicrew} multicrew · ${totalCrew} seats total</span></div>
      <div id="rosterList"></div>
    </div>
    <div class="roster-io">
      <button class="fl-sub" id="rExport">Export JSON</button>
      <button class="fl-sub" id="rImport">Import JSON</button>
    </div>` : '<div class="empty-state"><p>No fleet assets yet. Add ships above to track who owns what and who can crew them.</p></div>'}`;

  body.querySelector('#rAdd').onclick = () => {
    const member = body.querySelector('#rMember').value.trim();
    const shipUuid = body.querySelector('#rShip').value;
    const ship = SHIPS.find(s => s.uuid === shipUuid);
    if (!member || !ship) return;
    const assets = lget(RKEY);
    assets.push({ id: Math.random().toString(36).slice(2, 9), member, shipUuid, shipName: ship.name, location: body.querySelector('#rLoc').value.trim(), status: body.querySelector('#rStatus').value });
    lset(RKEY, assets);
    renderRoster();
  };

  const listEl = body.querySelector('#rosterList');
  if (listEl) {
    listEl.innerHTML = Object.entries(byMember).sort((a, b) => a[0].localeCompare(b[0])).map(([member, ships]) => `
      <div class="roster-member">
        <div class="rm-head">${esc(member)} <span class="pc-note">${ships.length} ship${ships.length === 1 ? '' : 's'}</span></div>
        ${ships.map(a => {
          const ship = SHIPS.find(s => s.uuid === a.shipUuid);
          const crew = ship && ship.crew.max > 1 ? `${ship.crew.min}–${ship.crew.max} crew` : 'solo';
          return `<div class="roster-asset">
            <div><b>${esc(a.shipName)}</b> <span class="ship-role">${crew}</span>${a.location ? `<span class="sq-mstats">@ ${esc(a.location)}</span>` : ''}</div>
            <span class="rstatus rs-${a.status}">${a.status}</span>
            <span class="sq-remove" data-del="${a.id}">×</span>
          </div>`;
        }).join('')}
      </div>`).join('');
    listEl.querySelectorAll('[data-del]').forEach(x => x.onclick = () => { lset(RKEY, lget(RKEY).filter(a => a.id !== x.dataset.del)); renderRoster(); });
  }

  const exp = body.querySelector('#rExport');
  if (exp) exp.onclick = () => {
    const blob = new Blob([JSON.stringify(lget(RKEY), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'nemesis-fleet-roster.json'; a.click();
  };
  const imp = body.querySelector('#rImport');
  if (imp) imp.onclick = () => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/json';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { const data = JSON.parse(rd.result); if (Array.isArray(data)) { lset(RKEY, data); renderRoster(); } } catch {} }; rd.readAsText(f); };
    inp.click();
  };
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
