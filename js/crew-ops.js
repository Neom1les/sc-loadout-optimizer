/* ============================================================
   NEMESIS Command Deck — Crew Ops
   "We're 2-3 online, what should we do?" — pick crew size + a vibe and get
   ranked co-op activity suggestions with a per-player role split, ships to
   bring, rough reward, where to start, and a deep link into the relevant tab.
   Data: data/crew-ops.json (researched + verified, community-sourced).
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let DATA = null;
let crew = 3;
let vibe = 'any';
let time = 'any';
let rolled = null;

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const VIBES = [
  { k: 'any', l: 'Any vibe' },
  { k: 'money', l: 'Make aUEC' },
  { k: 'shipcombat', l: 'Ship combat' },
  { k: 'fpscombat', l: 'FPS combat' },
  { k: 'pvp', l: 'PvP' },
  { k: 'industry', l: 'Industry' },
  { k: 'explore', l: 'Explore' },
  { k: 'chill', l: 'Chill' },
];
const VIBE_LABEL = { money: 'Money', shipcombat: 'Ship combat', fpscombat: 'FPS', pvp: 'PvP', industry: 'Industry', explore: 'Explore', chill: 'Chill', social: 'Social', learn: 'Learn' };
const TIMES = [{ k: 'any', l: 'Any length' }, { k: 'quick', l: 'Quick' }, { k: 'session', l: 'A session' }, { k: 'long', l: 'Long haul' }];
const TIME_LABEL = { quick: 'Quick (<30m)', session: 'A session (1-2h)', long: 'Long haul (2h+)' };
const RISK = { safe: { l: 'Lawful', cls: 'ok' }, 'pvp-risk': { l: 'PvP risk', cls: 'warn' }, illegal: { l: 'Illegal', cls: 'crit' } };
const TAB_LABEL = { fieldguide: 'Field Guide', earnings: 'Earnings Finder', trade: 'Trade Routes', tactics: 'Tactics', optimizer: 'Loadout Optimizer', shipbuy: 'Ship Dealer', gear: 'Gear Locker', crafting: 'Crafting', fleet: 'Fleet Ops' };

function matches(a) {
  if (!(a.crewMin <= crew && crew <= (a.crewMax || 99))) return false;
  if (vibe !== 'any' && !(a.vibes || []).includes(vibe)) return false;
  if (time !== 'any' && a.time !== time) return false;
  return true;
}
function score(a) {
  let s = 0;
  if (vibe !== 'any' && (a.vibes || []).includes(vibe)) s += 4;
  if (a.crewIdeal === crew) s += 3; else if (Math.abs((a.crewIdeal || crew) - crew) <= 1) s += 1;
  if (time !== 'any' && a.time === time) s += 2;
  return s;
}

export async function initCrewOps(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('crew-ops.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Crew Ops unavailable</h3><p>data/crew-ops.json failed to load. ${e.message}</p></div>`;
    return;
  }
  render();
}

function card(a, featured) {
  const roles = a.roles || [];
  const shown = roles.slice(0, crew);
  const extraRoles = roles.length - crew;
  const moreHands = crew - roles.length;
  const roleHtml = shown.map((r, i) => `<div class="co-role"><span class="co-pn">P${i + 1}</span> ${esc(r)}</div>`).join('')
    + (extraRoles > 0 ? `<div class="src-note">+ ${extraRoles} more role${extraRoles === 1 ? '' : 's'} if your crew grows</div>` : '')
    + (moreHands > 0 ? `<div class="src-note">${moreHands} spare hand${moreHands === 1 ? '' : 's'} → double up on the above</div>` : '');
  const vibeTags = (a.vibes || []).map(v => `<span class="co-vibe">${esc(VIBE_LABEL[v] || v)}</span>`).join('');
  const risk = RISK[a.risk];
  const link = a.appTab && a.appTab !== 'none' && TAB_LABEL[a.appTab]
    ? `<button class="co-link" data-tab="${esc(a.appTab)}">Open ${esc(TAB_LABEL[a.appTab])} ▸</button>` : '';
  return `<div class="panel co-card${featured ? ' co-featured' : ''}">
    ${featured ? `<div class="co-ribbon">${rolled ? '🎲 Rolled for you' : '★ Top pick'}</div>` : ''}
    <div class="co-head">
      <div><div class="co-name">${esc(a.name)}</div><div class="ship-role">${esc(a.type || '')}</div></div>
      <div class="co-badges"><span class="co-crew">👥 ${a.crewMin}–${a.crewMax >= 99 ? '∞' : a.crewMax} · best ${a.crewIdeal || a.crewMin}</span><span class="cf-conf cf-teal">${esc(TIME_LABEL[a.time] || a.time)}</span>${risk ? `<span class="cf-conf cf-${risk.cls}">${risk.l}</span>` : ''}</div>
    </div>
    <div class="co-vibes">${vibeTags}</div>
    <p class="craft-p">${esc(a.overview)}</p>
    <div class="wb-sub-h">Your ${crew}-player role split</div>
    <div class="co-roles">${roleHtml}</div>
    ${(a.ships && a.ships.length) ? `<div class="wb-sub-h">Bring</div><div class="co-ships">${a.ships.map(s => `<span class="co-ship">${esc(s)}</span>`).join('')}</div>` : ''}
    <div class="co-meta">
      ${a.reward ? `<div class="co-metarow"><span class="co-mk">Reward</span> ${esc(a.reward)}</div>` : ''}
      ${a.start ? `<div class="co-metarow"><span class="co-mk">Start</span> ${esc(a.start)}</div>` : ''}
    </div>
    ${link}
  </div>`;
}

function render() {
  const all = (DATA.activities || []).filter(matches).sort((a, b) => score(b) - score(a));
  let ordered = all;
  if (rolled) {
    const r = (DATA.activities || []).find(a => a.id === rolled);
    if (r) ordered = [r, ...all.filter(a => a.id !== rolled)];
  }
  const caveats = (DATA.caveats || []).map(c => `<li>${esc(c)}</li>`).join('');

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Crew Ops</h2>
      <div class="ef-sub">You're online with friends — what should you do? Set your crew size and vibe and get co-op suggestions with a role split for each player.</div></div>

    <div class="panel co-controls">
      <div class="co-ctl"><span class="co-ctl-l">Crew size</span><div class="fleet-filters">${[2, 3, 4, 5].map(n => `<button class="fl-chip${crew === n ? ' active' : ''}" data-crew="${n}">${n === 5 ? '5+' : n}</button>`).join('')}</div></div>
      <div class="co-ctl"><span class="co-ctl-l">Vibe</span><div class="fleet-filters">${VIBES.map(v => `<button class="fl-chip${vibe === v.k ? ' active' : ''}" data-vibe="${v.k}">${v.l}</button>`).join('')}</div></div>
      <div class="co-ctl"><span class="co-ctl-l">Time</span><div class="fleet-filters">${TIMES.map(tm => `<button class="fl-chip${time === tm.k ? ' active' : ''}" data-time="${tm.k}">${tm.l}</button>`).join('')}<button class="fl-chip co-roll" id="coRoll">🎲 Surprise us</button></div></div>
    </div>

    <div class="craft-status"><span class="ps-dot"></span><span><b>${ordered.length}</b> op${ordered.length === 1 ? '' : 's'} match a crew of <b>${crew === 5 ? '5+' : crew}</b>${vibe !== 'any' ? ' · ' + esc(VIBE_LABEL[vibe]) : ''}. Suggestions are community-sourced — see each op's start tip, then jump into the linked guide.</span></div>

    <div class="co-results">${ordered.length ? ordered.map((a, i) => card(a, i === 0)).join('') : '<div class="empty-state"><h3>No match</h3><p>Loosen the vibe or time filter for more ideas.</p></div>'}</div>

    <div class="panel fg-caveats"><div class="panel-header">Notes</div><ul class="guide-tips">${caveats}</ul></div>`;

  ROOT.querySelectorAll('[data-crew]').forEach(b => b.onclick = () => { crew = +b.dataset.crew; rolled = null; render(); });
  ROOT.querySelectorAll('[data-vibe]').forEach(b => b.onclick = () => { vibe = b.dataset.vibe; rolled = null; render(); });
  ROOT.querySelectorAll('[data-time]').forEach(b => b.onclick = () => { time = b.dataset.time; rolled = null; render(); });
  const roll = ROOT.querySelector('#coRoll');
  if (roll) roll.onclick = () => { if (all.length) { rolled = all[Math.floor((Date.now() % all.length))].id; render(); ROOT.scrollIntoView({ behavior: 'smooth', block: 'start' }); } };
  ROOT.querySelectorAll('.co-link[data-tab]').forEach(b => b.onclick = () => { if (window.scOpenTab) window.scOpenTab(b.dataset.tab); });
}
