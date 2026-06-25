/* ============================================================
   NEMESIS Command Deck — Armory (FPS / personal weapon reference)
   A browsable, sortable database of personal weapons from the Star Citizen
   Wiki API (data/fps-weapons.json, built by scripts/ingest-weapons.py).
   Cosmetic skins are deduped to the base gun (stats are identical across
   skins). Complements the ship Loadout Optimizer, which covers ship weapons.

   Honesty: the wiki's dps_total is a THEORETICAL sustained figure (no reload);
   for single-shot / charge / explosive weapons the per-shot Alpha is the more
   meaningful number, so both are shown and sortable.
   ============================================================ */
import { loadJSON } from './data-loader.js';
import { formatNumber } from './stats-calculator.js';

let ROOT = null;
let DATA = null;
let cls = 'all';
let search = '';
let craftOnly = false;
let sort = { col: 'dps', dir: -1 };

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function num(v) { return (v == null || v === 0) ? '<span class="cf-conf cf-dim">—</span>' : formatNumber(v); }

const RARITY = { Common: 'dim', Uncommon: 'ok', Rare: 'teal', Heirloom: 'warn', Legendary: 'crit' };
const DTYPE = { energy: 'teal', physical: 'warn', thermal: 'crit', distortion: 'dim', biochemical: 'ok', stun: 'dim' };
function rarityTag(r) { return r ? `<span class="cf-conf cf-${RARITY[r] || 'dim'}">${esc(r)}</span>` : ''; }
function typeTag(t) { return t ? `<span class="cf-conf cf-${DTYPE[t] || 'dim'}">${esc(t)}</span>` : '<span class="cf-conf cf-dim">—</span>'; }

const COLS = [
  {
    k: 'name', l: 'Weapon', num: false, fmt: (v, w) => `${esc(v)}<span class="tr-loc">${esc(w.manufacturer || '')}${w.subType ? ' · ' + esc(w.subType) : ''}${w.skins > 1 ? ' · ' + w.skins + ' skins' : ''}${w.craftable ? ' · <span class="cf-conf cf-ok">craftable</span>' : ''}${(w.fireModes && w.fireModes.length) ? ' · ' + esc(w.fireModes.join('/')) : ''}</span>`,
  },
  { k: 'class', l: 'Class', num: false },
  { k: 'alpha', l: 'Alpha', num: true, fmt: v => num(v) },
  { k: 'dps', l: 'DPS*', num: true, fmt: v => num(v) },
  { k: 'rpm', l: 'RPM', num: true, fmt: v => num(v) },
  { k: 'magSize', l: 'Mag', num: true, fmt: v => num(v) },
  { k: 'effRange', l: 'Range', num: true, fmt: v => v ? formatNumber(v) + ' m' : '<span class="cf-conf cf-dim">—</span>' },
  { k: 'dmgType', l: 'Type', num: false, fmt: v => typeTag(v) },
  { k: 'rarity', l: 'Rarity', num: false, fmt: v => rarityTag(v) },
];

export async function initWeapons(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('fps-weapons.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Weapon data unavailable</h3><p>data/fps-weapons.json failed to load. ${e.message}</p></div>`;
    return;
  }
  render();
}

function render() {
  const classes = ['all', 'Small Weapon', 'Medium Weapon', 'Large Weapon', 'Knife', 'Grenade', 'Gadget'];
  const list = (DATA.weapons || []).filter(w => {
    if (cls !== 'all' && w.class !== cls) return false;
    if (craftOnly && !w.craftable) return false;
    if (search && !((w.name || '').toLowerCase().includes(search) || (w.manufacturer || '').toLowerCase().includes(search))) return false;
    return true;
  });
  const sorted = [...list].sort((a, b) => {
    const av = a[sort.col], bv = b[sort.col];
    if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * sort.dir;
    return String(av || '').localeCompare(String(bv || '')) * sort.dir;
  });

  const head = COLS.map(c => `<th data-col="${c.k}" class="${c.num ? 'num' : ''}${sort.col === c.k ? ' sorted' : ''}">${c.l}${sort.col === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const rows = sorted.map(w => `<tr>${COLS.map(c => {
    const v = w[c.k];
    const disp = c.fmt ? c.fmt(v, w) : esc(String(v == null ? '' : v));
    return `<td class="${c.num ? 'num' : ''}">${disp}</td>`;
  }).join('')}</tr>`).join('')
    || `<tr><td colspan="${COLS.length}" class="src-note">No weapons match this filter.</td></tr>`;

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Armory</h2>
      <div class="ef-sub">Every personal weapon in the 'verse — damage, fire rate, range and rarity. Complements the ship Loadout Optimizer (which covers ship weapons).</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>Star Citizen Wiki · game <b>${esc(DATA.game_version || '?')}</b> · <b>${DATA.count || 0}</b> weapons (cosmetic skins deduped) · <b>DPS*</b> is a theoretical max (no reload) — for single-shot &amp; charge weapons, <b>Alpha</b> (per shot) matters more.</span></div>

    <div class="trade-toolbar">
      <div class="fleet-filters">
        ${classes.map(c => `<button class="fl-chip${cls === c ? ' active' : ''}" data-cls="${esc(c)}">${c === 'all' ? 'All' : esc(c.replace(' Weapon', ''))}</button>`).join('')}
        <button class="fl-chip${craftOnly ? ' active' : ''}" id="wpCraft">Craftable only</button>
      </div>
      <input type="text" class="search-input trade-search" id="wpSearch" placeholder="Search weapon / maker..." value="${esc(search)}">
    </div>

    <div class="panel fleet-tablewrap">
      <table class="fleet-table trade-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="src-note">Source: Star Citizen Wiki (api.star-citizen.wiki), CC BY-SA. Stats are datamined for ${esc(DATA.game_version || 'the current patch')} and can change between patches. Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  ROOT.querySelectorAll('[data-cls]').forEach(b => b.onclick = () => { cls = b.dataset.cls; render(); });
  const cb = ROOT.querySelector('#wpCraft');
  if (cb) cb.onclick = () => { craftOnly = !craftOnly; render(); };
  const se = ROOT.querySelector('#wpSearch');
  se.oninput = () => { search = se.value.toLowerCase().trim(); render(); restoreFocus('#wpSearch'); };
  ROOT.querySelectorAll('.trade-table th[data-col]').forEach(th => th.onclick = () => { const c = th.dataset.col; if (sort.col === c) sort.dir *= -1; else { sort.col = c; sort.dir = COLS.find(x => x.k === c).num ? -1 : 1; } render(); });
}

function restoreFocus(sel) {
  const el = ROOT.querySelector(sel);
  if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
}
