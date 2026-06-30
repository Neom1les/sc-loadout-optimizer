/* ============================================================
   NEMESIS Command Deck — Mining Fits
   The mining counterpart to the combat Loadout Optimizer: pick a mining ship
   and get recommended head + module fits for different goals (max yield, hard
   rocks, beginner-safe, gem hunting), a browsable gear catalog with live-ish
   prices & shop locations, and a "how mining works" guide.

   Data:
     - data/mining-gear.json  (deterministic UEX + SC-Wiki ingest: heads,
       modules, gadgets with real specs, prices, shop locations, images)
     - data/mining-fits.json  (researched + adversarially verified fits +
       mechanics explainer + ore/locations)
   Fits reference real gear ids and are joined to the catalog at render time.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let GEAR = null;       // mining-gear.json
let FITS = null;       // mining-fits.json
let gearById = {};
let mode = 'fits';     // fits | gear | guide
let shipSel = null;    // ship id in fits mode
let gearGroup = 'heads';
let gearSearch = '';

function esc(s) { return (s == null ? '' : String(s)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtP(n) { return (n || n === 0) ? Number(n).toLocaleString('en-US') + ' aUEC' : '—'; }

const KIND = {
  passive: { l: 'PASSIVE', cls: 'teal', t: 'Always-on modifier while slotted' },
  active: { l: 'ACTIVE', cls: 'warn', t: 'Triggered manually — limited uses, short duration' },
};
const CONF = {
  confirmed: { l: 'STANDARD META', cls: 'ok', t: 'Established community meta' },
  community: { l: 'COMMUNITY', cls: 'warn', t: 'Community suggestion — try it and adjust' },
};
function badge(map, key) { const x = map[key]; return x && x.l ? `<span class="cf-conf cf-${x.cls}"${x.t ? ` title="${esc(x.t)}"` : ''}>${x.l}</span>` : ''; }

const MODES = [{ k: 'fits', l: 'Recommended Fits' }, { k: 'gear', l: 'Gear Catalog' }, { k: 'guide', l: 'How Mining Works' }];
const GEAR_GROUPS = [{ k: 'heads', l: 'Laser Heads' }, { k: 'modules', l: 'Modules' }, { k: 'gadgets', l: 'Gadgets' }];

export async function initMining(root) {
  ROOT = root;
  try {
    GEAR = await loadJSON('mining-gear.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Mining gear unavailable</h3><p>data/mining-gear.json failed to load. ${esc(e.message)}</p></div>`;
    return;
  }
  try {
    FITS = await loadJSON('mining-fits.json');
  } catch { FITS = null; }
  for (const g of ['heads', 'modules', 'gadgets']) for (const it of (GEAR[g] || [])) gearById[it.id] = { ...it, _group: g };
  if (FITS && FITS.ships && FITS.ships.length) shipSel = shipSel || FITS.ships[0].id;
  render();
}

/* Map a ships.json ship name to a mining-fits.json ship id. */
function shipToFitId(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('prospector')) return 'prospector';
  if (/\bmole\b/.test(n)) return 'mole';
  if (n.includes('golem')) return 'golem';
  if (n.includes('roc')) return 'roc';
  if (n.includes('atls')) return 'atls';
  return null;
}

/* Embedded view: render one mining ship's recommended fits into `container`
   (reused by the Loadout hub when a mining ship is selected). */
export async function renderShipFits(container, shipName, onOpenFull) {
  if (!GEAR) { try { GEAR = await loadJSON('mining-gear.json'); } catch (e) { container.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><p>Mining gear failed to load.</p></div>`; return; } }
  if (!FITS) { try { FITS = await loadJSON('mining-fits.json'); } catch { FITS = null; } }
  if (!Object.keys(gearById).length) for (const g of ['heads', 'modules', 'gadgets']) for (const it of (GEAR[g] || [])) gearById[it.id] = { ...it, _group: g };

  const id = shipToFitId(shipName);
  const ship = id && FITS && (FITS.ships || []).find(s => s.id === id);
  if (!ship) {
    container.innerHTML = `<div class="empty-state"><h3>No preset mining fits</h3><p>No recommended fits are catalogued for this ship yet — open the Mining tab for the full gear catalog and guide.</p><button class="co-link" data-openfull>Open Mining Fits ▸</button></div>`;
    container.querySelectorAll('[data-openfull]').forEach(b => b.onclick = () => onOpenFull && onOpenFull());
    return;
  }
  container.innerHTML = `
    <div class="ph-head" style="margin-bottom:10px;"><h2 style="font-size:1.15rem;">⛏ Mining fits — ${esc(ship.name)}</h2>
      <div class="ef-sub">Recommended laser-head + module fits for your goal. Prices are a UEX snapshot.</div></div>
    <div class="mn-fits">${(ship.fits || []).map(f => fitCard(f, ship)).join('')}</div>
    <div style="margin-top:14px;"><button class="co-link" data-openfull>Open full Mining tab — gear catalog &amp; guide ▸</button></div>`;
  container.querySelectorAll('.co-link[data-tab]').forEach(b => b.onclick = () => { if (window.scOpenTab) window.scOpenTab(b.dataset.tab); });
  container.querySelectorAll('[data-openfull]').forEach(b => b.onclick = () => onOpenFull && onOpenFull());
}

/* ── gear bits ─────────────────────────────────────────────── */
function gearImg(it, cls) {
  return it && it.img
    ? `<img class="${cls}" src="${esc(it.img)}" loading="lazy" alt="${esc(it.name)}" onerror="this.outerHTML='<span class=\\'${cls} mn-noimg\\'>⛏</span>'">`
    : `<span class="${cls} mn-noimg">⛏</span>`;
}
function modChips(mods) {
  return (mods || []).map(m => `<span class="mn-mod">${esc(m.label)} <b>${esc(m.value)}</b></span>`).join('');
}
function locLine(it) {
  const l = (it && it.locations && it.locations[0]) || null;
  if (!l) return '';
  return `<div class="tr-loc">⌖ Buy at ${esc(l.terminal)}${l.system ? ' · ' + esc(l.system) : ''} — ${fmtP(l.price)}</div>`;
}

/* ── FITS mode ─────────────────────────────────────────────── */
function fitCard(fit, ship) {
  const head = fit.headId != null ? gearById[fit.headId] : null;
  const gadget = fit.gadgetId != null ? gearById[fit.gadgetId] : null;
  const mods = (fit.moduleIds || []).map(id => gearById[id]).filter(Boolean);
  let cost = 0; let priced = false;
  for (const it of [head, gadget, ...mods]) { if (it && it.price) { cost += it.price; priced = true; } }

  const headBlock = head ? `<div class="mn-fit-head">
      ${gearImg(head, 'mn-fit-img')}
      <div class="mn-fit-headinfo">
        <div class="mn-fit-headname">${esc(head.name)}</div>
        <div class="mn-fit-headstats">S${esc(head.size)} · ${head.moduleSlots != null ? head.moduleSlots + ' module slot' + (head.moduleSlots === 1 ? '' : 's') : 'no module slots'} · power ${esc(head.laserPower && head.laserPower.max)} · throughput ${esc(head.throughput)}</div>
        ${head.modifiers && head.modifiers.length ? `<div class="mn-mods">${modChips(head.modifiers)}</div>` : ''}
        ${locLine(head)}
      </div>
    </div>` : (fit.headName ? `<div class="mn-fit-head"><span class="mn-fit-img mn-noimg">⛏</span><div class="mn-fit-headinfo"><div class="mn-fit-headname">${esc(fit.headName)}</div><div class="mn-fit-headstats">Fixed laser — no head/module swap</div></div></div>` : '');

  const modBlock = mods.length ? `<div class="mn-fit-sec"><div class="mn-fit-lbl">Modules</div>${mods.map(m => `<div class="mn-fit-mod">
      <span class="mn-fit-modname">${esc(m.name)}</span> ${badge(KIND, m.kind)}
      <div class="mn-mods">${modChips(m.modifiers)}</div>
    </div>`).join('')}</div>` : '';
  const gadgetBlock = gadget ? `<div class="mn-fit-sec"><div class="mn-fit-lbl">Gadget</div>
      <div class="mn-fit-mod"><span class="mn-fit-modname">${esc(gadget.name)}</span> <span class="cf-conf cf-dim">GADGET</span><div class="mn-gdesc">${esc(gadget.desc)}</div></div></div>` : '';

  return `<div class="panel mn-fit">
    <div class="mn-fit-top">
      <div><span class="mn-goal">${esc(fit.goal)}</span><div class="mn-tagline">${esc(fit.tagline)}</div></div>
      <div class="fg-badges">${badge(CONF, fit.confidence)}${priced ? `<span class="cf-conf cf-teal" title="Sum of cheapest UEX prices — snapshot">~${cost.toLocaleString('en-US')} aUEC</span>` : ''}</div>
    </div>
    ${headBlock}${modBlock}${gadgetBlock}
    <div class="mn-fit-why"><span class="co-mk">Why</span> ${esc(fit.why)}</div>
    ${fit.playstyle ? `<div class="mn-fit-why"><span class="co-mk">How to mine</span> ${esc(fit.playstyle)}</div>` : ''}
    ${fit.bestFor ? `<div class="mn-fit-why"><span class="co-mk">Best for</span> ${esc(fit.bestFor)}</div>` : ''}
  </div>`;
}

function renderFits() {
  if (!FITS || !FITS.ships || !FITS.ships.length) {
    return `<div class="empty-state"><h3>Fits not loaded yet</h3><p>The recommended-fit data (data/mining-fits.json) isn't available. The Gear Catalog and Guide still work.</p></div>`;
  }
  const ship = FITS.ships.find(s => s.id === shipSel) || FITS.ships[0];
  const chips = FITS.ships.map(s => `<button class="fl-chip${ship.id === s.id ? ' active' : ''}" data-ship="${esc(s.id)}">${esc(s.name.replace(/\s*\(.*\)/, ''))}</button>`).join('');
  return `
    <div class="fleet-filters mn-shipchips">${chips}</div>
    <div class="panel mn-shipnote">
      <div class="mn-shipname">${esc(ship.name)}</div>
      <div class="ship-role">Crew ${esc(ship.crew)} · ${ship.swappable ? (ship.headSlots > 1 ? ship.headSlots + ' mining heads' : '1 swappable S' + ship.headSize + ' head') : 'fixed laser'}</div>
      <p class="craft-p">${esc(ship.note)}</p>
    </div>
    <div class="mn-fits">${(ship.fits || []).map(f => fitCard(f, ship)).join('') || '<div class="empty-state"><p>No fits authored for this ship.</p></div>'}</div>`;
}

/* ── GEAR mode ─────────────────────────────────────────────── */
function headCard(h) {
  return `<div class="panel mn-card">
    <div class="mn-card-top">${gearImg(h, 'mn-card-img')}
      <div><div class="mn-card-name">${esc(h.name)}</div><div class="ship-role">S${esc(h.size)} · ${esc(h.company)}</div></div>
      <div class="mn-card-price">${fmtP(h.price)}</div>
    </div>
    <div class="mn-card-stats">
      <span>${h.moduleSlots != null ? h.moduleSlots + ' slot' + (h.moduleSlots === 1 ? '' : 's') : 'fixed'}</span>
      <span>power ${esc(h.laserPower && h.laserPower.max)}</span>
      <span>throughput ${esc(h.throughput)}</span>
      <span>range ${esc(h.optimalRange)}–${esc(h.maxRange)}m</span>
    </div>
    ${h.modifiers && h.modifiers.length ? `<div class="mn-mods">${modChips(h.modifiers)}</div>` : '<div class="src-note">No passive modifiers.</div>'}
    ${locLine(h)}
  </div>`;
}
function moduleCard(m) {
  return `<div class="panel mn-card">
    <div class="mn-card-top">${gearImg(m, 'mn-card-img')}
      <div><div class="mn-card-name">${esc(m.name)}</div><div class="ship-role">${badge(KIND, m.kind)}${m.uses ? ' · ' + esc(m.uses) + ' uses' : ''}${m.duration ? ' · ' + esc(m.duration) : ''}</div></div>
      <div class="mn-card-price">${fmtP(m.price)}</div>
    </div>
    <div class="mn-mods">${modChips(m.modifiers) || '<span class="src-note">No modifiers recorded.</span>'}</div>
    ${locLine(m)}
  </div>`;
}
function gadgetCard(g) {
  return `<div class="panel mn-card">
    <div class="mn-card-top">${gearImg(g, 'mn-card-img')}
      <div><div class="mn-card-name">${esc(g.name)}</div><div class="ship-role">${esc(g.company)}</div></div>
      <div class="mn-card-price">${fmtP(g.price)}</div>
    </div>
    <p class="craft-p">${esc(g.desc)}</p>
    ${locLine(g)}
  </div>`;
}
function renderGear() {
  const q = gearSearch;
  const list = (GEAR[gearGroup] || []).filter(it => !q || (it.name + ' ' + (it.company || '') + ' ' + (it.mods || '') + ' ' + (it.modifiers || []).map(m => m.label).join(' ')).toLowerCase().includes(q));
  const cardFn = gearGroup === 'heads' ? headCard : gearGroup === 'modules' ? moduleCard : gadgetCard;
  const counts = { heads: (GEAR.heads || []).length, modules: (GEAR.modules || []).length, gadgets: (GEAR.gadgets || []).length };
  return `
    <div class="trade-toolbar">
      <div class="fleet-filters">${GEAR_GROUPS.map(g => `<button class="fl-chip${gearGroup === g.k ? ' active' : ''}" data-gg="${g.k}">${g.l} · ${counts[g.k]}</button>`).join('')}</div>
      <input type="text" class="search-input trade-search" id="mnSearch" placeholder="Search gear, modifier, brand..." value="${esc(gearSearch)}">
    </div>
    <div class="mn-grid">${list.map(cardFn).join('') || '<div class="empty-state"><p>No gear matches.</p></div>'}</div>`;
}

/* ── GUIDE mode ────────────────────────────────────────────── */
function renderGuide() {
  const m = (FITS && FITS.mechanics) || null;
  const loc = (FITS && FITS.locations) || null;
  if (!m) return `<div class="empty-state"><h3>Guide not loaded</h3><p>data/mining-fits.json isn't available yet.</p></div>`;
  const loop = (m.loop || []).map((s, i) => `<div class="mn-step"><span class="hs-num">0${i + 1}</span><div><b>${esc(s.title)}</b><div class="craft-p">${esc(s.detail)}</div></div></div>`).join('');
  const stats = (m.stats || []).map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.what)}</td><td class="mn-better">${esc(s.better)}</td></tr>`).join('');
  const tips = (m.tips || []).map(t => `<li>${esc(t)}</li>`).join('');
  const tiers = loc ? (loc.oreTiers || []).map(o => `<tr><td><b>${esc(o.ore)}</b></td><td><span class="cf-conf cf-${o.tier === 'top' ? 'crit' : o.tier === 'high' ? 'warn' : o.tier === 'mid' ? 'teal' : 'dim'}">${esc(o.tier)}</span></td><td>${esc(o.note)}</td></tr>`).join('') : '';
  const spots = loc ? (loc.spots || []).map(s => `<div class="mn-metarow"><span class="co-mk">${esc(s.system)}</span> <b>${esc(s.place)}</b> — ${esc(s.what)}</div>`).join('') : '';
  const allSources = [...new Set([...(m.sources || []), ...((loc && loc.sources) || [])])];
  return `
    <div class="panel"><div class="panel-header">The mining loop</div><div class="mn-loop">${loop}</div></div>
    <div class="panel"><div class="panel-header">The stats that matter</div>
      <table class="sd-table mn-table"><thead><tr><th>Stat</th><th>What it is</th><th>Good direction</th></tr></thead><tbody>${stats}</tbody></table></div>
    <div class="two-col">
      <div class="panel"><div class="panel-header">Modifier types</div>
        <div class="mn-metarow"><span class="co-mk">Passive</span> ${esc(m.moduleTypes && m.moduleTypes.passive)}</div>
        <div class="mn-metarow"><span class="co-mk">Active</span> ${esc(m.moduleTypes && m.moduleTypes.active)}</div>
        <div class="mn-metarow"><span class="co-mk">Gadget</span> ${esc(m.moduleTypes && m.moduleTypes.gadget)}</div>
        <div class="wb-sub-h">Refining</div><p class="craft-p">${esc(m.refining)}</p>
      </div>
      <div class="panel"><div class="panel-header">Tips</div><ul class="guide-tips">${tips}</ul></div>
    </div>
    ${tiers ? `<div class="panel"><div class="panel-header">Mineral value tiers</div><table class="sd-table mn-table"><thead><tr><th>Mineral</th><th>Tier</th><th>Note</th></tr></thead><tbody>${tiers}</tbody></table><div class="src-note">Exact prices fluctuate — check a live tool (UEX / Regolith) before a sell run.</div></div>` : ''}
    ${spots ? `<div class="panel"><div class="panel-header">Where to mine</div>${spots}</div>` : ''}
    ${allSources.length ? `<div class="fg-sources"><div class="wb-sub-h">Sources</div>${allSources.map(s => `<a class="fg-src" href="${esc(s)}" target="_blank" rel="noopener">${esc(s.replace(/^https?:\/\//, '').slice(0, 60))}</a>`).join('')}</div>` : ''}`;
}

/* ── shell ─────────────────────────────────────────────────── */
function render() {
  const body = mode === 'fits' ? renderFits() : mode === 'gear' ? renderGear() : renderGuide();
  ROOT.innerHTML = `
    <div class="ph-head"><h2>Mining Fits</h2>
      <div class="ef-sub">The mining side of the loadout bay — pick a mining ship and get recommended laser-head + module fits for your goal, browse every head/module/gadget with prices &amp; shop locations, and learn how the mining minigame works.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>Patch <b>${esc(GEAR.patch || '?')}</b> · ${(GEAR.heads || []).length} heads · ${(GEAR.modules || []).length} modules · ${(GEAR.gadgets || []).length} gadgets · prices are a <b>UEX community snapshot</b>, not live. Unofficial; not CIG.</span></div>

    <div class="fleet-filters mn-modes">${MODES.map(o => `<button class="fl-chip${mode === o.k ? ' active' : ''}" data-mode="${o.k}">${o.l}</button>`).join('')}</div>

    <div id="mnBody">${body}</div>

    <div class="src-note">Gear specs &amp; images from the Star Citizen Wiki (CC BY-SA); prices &amp; shop locations from UEX Corp (community snapshot). Fits are community-sourced &amp; verified — try them and tune to your rock. Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  ROOT.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; render(); });
  ROOT.querySelectorAll('[data-ship]').forEach(b => b.onclick = () => { shipSel = b.dataset.ship; render(); });
  ROOT.querySelectorAll('[data-gg]').forEach(b => b.onclick = () => { gearGroup = b.dataset.gg; render(); });
  const se = ROOT.querySelector('#mnSearch');
  if (se) se.oninput = () => { gearSearch = se.value.toLowerCase().trim(); render(); const el = ROOT.querySelector('#mnSearch'); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
}
