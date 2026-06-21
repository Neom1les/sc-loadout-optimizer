/* ============================================================
   SC Optimizer — Earnings & Activity Finder
   Goal-driven ranking of money / reputation / fun activities.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let ACT = [];
let FACTIONS = [];
let maxMoney = 1;

const state = {
  goal: 'money',          // money | rep | mix | fun
  repFaction: '',         // selected faction id/name for rep mode
  mix: 60,                // 0=all rep … 100=all money
  cats: new Set(),        // category filters (empty = all)
  group: 'any',           // any | solo | crew
  lawful: 'any',          // any | lawful | unlawful
};

const CONF_W = { verified: 1, estimated: 0.82, rough: 0.6 };
const SHIP_HINTS = ['Vulture','Reclaimer','SRV','Prospector','MOLE','Golem','ROC','C2','M2','A2','Hercules','RAFT','Ironclad','Hornet','Cutlass','Caterpillar','Hull','Prowler','Vanguard','Hammerhead','Corsair','Freelancer','Constellation','Starlite','890','Mercury','Zeus','Spirit'];

const GOALS = [
  { id:'money', lbl:'💰 Max aUEC',   d:'Fastest credits per hour' },
  { id:'rep',   lbl:'🎖 Reputation', d:'Grind a faction fast' },
  { id:'mix',   lbl:'⚖ Mix',         d:'Money + reputation' },
  { id:'fun',   lbl:'✨ Experience',  d:'Cool events, payout secondary' },
];
const CATS = ['salvage','mining','hauling','trading','combat','bounty','mercenary','medical','exploration','event'];
const FUN_TAGS = ['fun','event','scenic','story','unique','easter-egg','immersive'];

export async function initEarnings(root) {
  ROOT = root;
  try {
    ACT = (await loadJSON('activities.json')) || [];
    try { FACTIONS = (await loadJSON('factions.json')) || []; } catch { FACTIONS = []; }
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Activity database not found</h3><p>data/activities.json is being built. ${e.message}</p></div>`;
    return;
  }
  maxMoney = Math.max(1, ...ACT.map(a => (a.money && a.money.max) || 0));
  if (!state.repFaction && FACTIONS.length) state.repFaction = FACTIONS[0].name;
  render();
}

/* ---------- scoring ---------- */
function moneyScore(a) {
  const m = (a.money && a.money.max) || 0;
  const conf = CONF_W[(a.money && a.money.confidence)] ?? 0.6;
  return (m / maxMoney) * conf;
}
function repScore(a) {
  const f = (a.rep && a.rep.faction || '').toLowerCase();
  if (!f || f === 'none') return 0;
  const sel = (state.repFaction || '').toLowerCase();
  if (sel && f.includes(sel.split(' ')[0])) return 1;        // matches selected faction
  return 0.25;                                               // raises some faction
}
function funScore(a) {
  const tags = (a.tags || []).map(t => t.toLowerCase());
  let s = tags.filter(t => FUN_TAGS.includes(t)).length;
  if ((a.category || '') === 'event') s += 1;
  return Math.min(1, s / 2);
}
function isGated(a) { return !!(a.rep && a.rep.gate && a.rep.gate !== 'none' && a.rep.gate !== ''); }

function score(a) {
  let base;
  if (state.goal === 'money') base = moneyScore(a);
  else if (state.goal === 'rep') base = repScore(a) * 0.85 + moneyScore(a) * 0.15;
  else if (state.goal === 'fun') base = funScore(a) * 0.8 + moneyScore(a) * 0.2;
  else { const w = state.mix / 100; base = w * moneyScore(a) + (1 - w) * repScore(a); }
  if (isGated(a)) base *= 0.92;                              // soft demote, still shown with lock
  return base;
}

/* ---------- filters ---------- */
function passes(a) {
  if (state.cats.size && !state.cats.has(a.category)) return false;
  if (state.group === 'solo' && !(a.group && a.group.solo)) return false;
  if (state.group === 'crew' && !(a.group && a.group.crew)) return false;
  if (state.lawful === 'lawful' && a.lawful === false) return false;
  if (state.lawful === 'unlawful' && a.lawful !== false) return false;
  return true;
}

/* ---------- render ---------- */
function fmtMoney(n) { if (!n) return '0'; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M'; if (n >= 1e3) return Math.round(n / 1e3) + 'k'; return '' + n; }
function riskDots(r) { r = Math.max(0, Math.min(5, r || 0)); return '●'.repeat(r) + '○'.repeat(5 - r); }
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function render() {
  const ranked = ACT.filter(passes).map(a => ({ a, s: score(a) })).sort((x, y) => y.s - x.s);

  const goalBar = GOALS.map(g => `<button class="goal-btn ${state.goal===g.id?'active':''}" data-goal="${g.id}"><span class="gl">${g.lbl}</span><span class="gd">${g.d}</span></button>`).join('');

  let extra = '';
  if (state.goal === 'rep') {
    const opts = (FACTIONS.length ? FACTIONS.map(f => f.name) : [...new Set(ACT.map(a => a.rep && a.rep.faction).filter(f => f && f !== 'none'))])
      .map(n => `<option ${n===state.repFaction?'selected':''}>${esc(n)}</option>`).join('');
    extra = `<div class="goal-extra"><label>Target faction:</label><select class="fi-select" id="efFaction">${opts}</select></div>`;
  } else if (state.goal === 'mix') {
    extra = `<div class="goal-extra"><label>Reputation</label><input type="range" id="efMix" min="0" max="100" value="${state.mix}" style="flex:1;min-width:160px"><label>aUEC</label><span class="conf">${state.mix}% money</span></div>`;
  }

  const catChips = `<span class="filter-group-label">Type</span>` + CATS.map(c => `<button class="filter-chip ${state.cats.has(c)?'on':''}" data-cat="${c}">${c}</button>`).join('');
  const grpChips = `<span class="filter-group-label">Crew</span>` + ['any','solo','crew'].map(g => `<button class="filter-chip ${state.group===g?'on':''}" data-grp="${g}">${g}</button>`).join('');
  const lawChips = `<span class="filter-group-label">Legality</span>` + ['any','lawful','unlawful'].map(l => `<button class="filter-chip ${state.lawful===l?'on':''}" data-law="${l}">${l}</button>`).join('');

  const cards = ranked.map(({ a, s }) => activityCard(a, s)).join('') ||
    `<div class="empty-state"><p>No activities match these filters.</p></div>`;

  ROOT.innerHTML = `
    <div class="ef-head"><h2>Earnings &amp; Activity Finder</h2>
      <div class="ef-sub">Pick a goal, set filters — the best activities for Patch ${ (ACT[0]&&ACT[0]._patch)||'4.8' } are ranked instantly. aUEC/h are community-estimated ranges.</div></div>
    <div class="goal-bar">${goalBar}</div>
    ${extra}
    <div class="filter-bar">${catChips}</div>
    <div class="filter-bar">${grpChips}${lawChips}</div>
    <div class="ef-count">${ranked.length} activities · ranked by ${GOALS.find(g=>g.id===state.goal).lbl.replace(/^[^ ]+ /,'')}</div>
    <div class="activity-list">${cards}</div>
    <div class="disclaimer" style="margin-top:14px">Community-estimated values — not official CIG numbers. Actual aUEC/h varies by skill, server &amp; patch.</div>`;

  wire();
}

function activityCard(a, s) {
  const money = a.money || {}; const rep = a.rep || {}; const grp = a.group || {};
  const ship = (SHIP_HINTS.find(h => (a.requirements || '').includes(h)) || '');
  const moneyStr = money.max ? `${fmtMoney(money.min)}–${fmtMoney(money.max)}/h` : '—';
  const conf = money.confidence ? `<span class="conf ${money.confidence}">${money.confidence}</span>` : '';
  const repStr = (rep.faction && rep.faction !== 'none') ? `<span class="rep">▲ ${esc(rep.faction)}</span>` : '';
  const lock = isGated(a) ? `<span class="ac-lock">⚿ ${esc(rep.gate)}</span>` : '';
  const tags = (a.tags || []).slice(0, 6).map(t => `<span class="ac-tag">${esc(t)}</span>`).join('');
  const guideBtn = a.guideId ? `<button class="ac-btn amber" data-guide="${esc(a.guideId)}">⟶ How to play</button>` : '';
  const shipBtn = ship ? `<button class="ac-btn" data-ship="${esc(ship)}">⟶ Optimize ${esc(ship)}</button>` : '';
  return `<div class="activity-card ${isGated(a)?'locked':''}">
    <div class="ac-top"><span class="ac-name">${esc(a.name)}</span><span class="ac-score">${money.max ? '💰 '+moneyStr : '★ '+Math.round(s*100)}</span></div>
    <div class="ac-summary">${esc(a.summary)}</div>
    <div class="ac-meta">
      <span class="money">aUEC/h: ${moneyStr}${conf}</span>
      ${repStr ? '<span>Rep: '+repStr+'</span>' : ''}
      <span>Risk: <span class="risk-dots">${riskDots(a.risk)}</span></span>
      <span>${grp.solo?'Solo':''}${grp.solo&&grp.crew?' / ':''}${grp.crew?'Crew':''}</span>
      ${a.setupMinutes?`<span>Setup ~${a.setupMinutes}m</span>`:''}
      ${lock}
    </div>
    ${tags?`<div class="ac-tags">${tags}</div>`:''}
    ${(guideBtn||shipBtn)?`<div class="ac-actions">${guideBtn}${shipBtn}</div>`:''}
  </div>`;
}

function wire() {
  ROOT.querySelectorAll('[data-goal]').forEach(b => b.onclick = () => { state.goal = b.dataset.goal; render(); });
  ROOT.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => { const c = b.dataset.cat; state.cats.has(c) ? state.cats.delete(c) : state.cats.add(c); render(); });
  ROOT.querySelectorAll('[data-grp]').forEach(b => b.onclick = () => { state.group = b.dataset.grp; render(); });
  ROOT.querySelectorAll('[data-law]').forEach(b => b.onclick = () => { state.lawful = b.dataset.law; render(); });
  const fac = ROOT.querySelector('#efFaction'); if (fac) fac.onchange = () => { state.repFaction = fac.value; render(); };
  const mix = ROOT.querySelector('#efMix'); if (mix) mix.oninput = () => { state.mix = +mix.value; render(); };
  ROOT.querySelectorAll('[data-guide]').forEach(b => b.onclick = (e) => { e.stopPropagation(); window.scOpenGuide && window.scOpenGuide(b.dataset.guide); });
  ROOT.querySelectorAll('[data-ship]').forEach(b => b.onclick = (e) => { e.stopPropagation(); window.scPrefillShipSearch && window.scPrefillShipSearch(b.dataset.ship); });
}
