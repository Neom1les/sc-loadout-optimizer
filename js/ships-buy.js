/* ============================================================
   NEMESIS Command Deck — Ship Dealer
   Which ships you can buy IN-GAME for aUEC, at which dealer / showroom and for
   how much — from a periodic UEX snapshot (data/ship-buy.json, built by
   scripts/ingest-ships.py). Sortable, searchable, filter by system.
   Prices are a community snapshot, not live — the UI stamps the snapshot time.
   ============================================================ */
import { loadJSON } from './data-loader.js';
import { formatNumber } from './stats-calculator.js';

let ROOT = null;
let DATA = null;
let sys = 'all';        // all | Stanton | Pyro
let search = '';
let sort = { col: 'minPrice', dir: 1 };   // cheapest first by default

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function systemsOf(s) { return [...new Set((s.locations || []).map(l => l.system).filter(Boolean))]; }

const COLS = [
  {
    k: 'fullName', l: 'Ship', num: false,
    fmt: (s) => `<div class="wp-namecell">${s.img ? `<img class="wp-thumb" src="${esc(s.img)}" loading="lazy" alt="">` : '<span class="wp-thumb wp-thumb-none">◈</span>'}<span class="wp-nametext">${esc(s.fullName)}<span class="tr-loc">${esc(s.manufacturer || '')}${(s.roles && s.roles.length) ? ' · ' + esc(s.roles.join('/')) : ''}</span></span></div>`,
  },
  { k: 'scu', l: 'Cargo', num: true, fmt: (s) => s.scu ? formatNumber(s.scu) + ' SCU' : '<span class="cf-conf cf-dim">—</span>' },
  { k: 'crew', l: 'Crew', num: true, fmt: (s) => esc(s.crew || '—') },
  { k: 'minPrice', l: 'Cheapest', num: true, fmt: (s) => s.minPrice ? `<b class="tr-profit">${formatNumber(s.minPrice)}</b><span class="tr-loc">aUEC</span>` : '—' },
  {
    k: 'where', l: 'Buy at', num: false,
    fmt: (s) => (s.locations || []).map(l => `<div class="sd-loc"><b>${esc(l.terminal || '')}</b><span class="tr-loc">${esc(l.system || '')}${l.place ? ' · ' + esc(l.place) : ''} — ${formatNumber(l.price)}</span></div>`).join(''),
  },
];

function sortVal(s, col) {
  if (col === 'scu') return s.scu || 0;
  if (col === 'crew') return parseInt(s.crew, 10) || 0;
  if (col === 'minPrice') return s.minPrice || 0;
  return s[col];
}

export async function initShipsBuy(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('ship-buy.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Ship-buy data unavailable</h3><p>data/ship-buy.json failed to load. ${e.message}</p></div>`;
    return;
  }
  render();
}

function render() {
  const list = (DATA.ships || []).filter(s => {
    if (sys !== 'all' && !systemsOf(s).includes(sys)) return false;
    if (search && !((s.fullName || '').toLowerCase().includes(search) || (s.manufacturer || '').toLowerCase().includes(search) || (s.roles || []).join(' ').toLowerCase().includes(search))) return false;
    return true;
  });
  const sorted = [...list].sort((a, b) => {
    const av = sortVal(a, sort.col), bv = sortVal(b, sort.col);
    if (typeof av === 'number' || typeof bv === 'number') return ((av || 0) - (bv || 0)) * sort.dir;
    return String(av || '').localeCompare(String(bv || '')) * sort.dir;
  });

  const allSystems = [...new Set((DATA.ships || []).flatMap(systemsOf))].sort();
  const head = COLS.map(c => `<th data-col="${c.k}" class="${c.num ? 'num' : ''}${sort.col === c.k ? ' sorted' : ''}">${c.l}${sort.col === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const rows = sorted.map(s => `<tr>${COLS.map(c => `<td class="${c.num ? 'num' : ''}">${c.fmt(s)}</td>`).join('')}</tr>`).join('')
    || `<tr><td colspan="${COLS.length}" class="src-note">No ships match this filter.</td></tr>`;

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Ship Dealer</h2>
      <div class="ef-sub">Which ships you can buy in-game for aUEC — at which dealer / showroom and for how much. Rental terminals and pledge-store (real money) ships are not listed here.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>UEX community snapshot <b>${esc(DATA.snapshot || 'unknown')}</b> · ${DATA.count || 0} buyable ships · prices &amp; stock <b>drift between patches</b> — this is a periodic snapshot, not live. Verify in-game before a big purchase.</span></div>

    <div class="trade-toolbar">
      <div class="fleet-filters">
        <button class="fl-chip${sys === 'all' ? ' active' : ''}" data-sys="all">All systems</button>
        ${allSystems.map(sy => `<button class="fl-chip${sys === sy ? ' active' : ''}" data-sys="${esc(sy)}">${esc(sy)}</button>`).join('')}
      </div>
      <input type="text" class="search-input trade-search" id="sdSearch" placeholder="Search ship, maker or role..." value="${esc(search)}">
    </div>

    <div class="panel fleet-tablewrap">
      <table class="fleet-table trade-table sd-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    </div>
    <div class="src-note">Source: UEX Corp (uexcorp.space), community-run — in-game ship purchase prices are player-reported and approximate. Ship images: Star Citizen Wiki (CC BY-SA). Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  ROOT.querySelectorAll('[data-sys]').forEach(b => b.onclick = () => { sys = b.dataset.sys; render(); });
  const se = ROOT.querySelector('#sdSearch');
  se.oninput = () => { search = se.value.toLowerCase().trim(); render(); const el = ROOT.querySelector('#sdSearch'); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
  ROOT.querySelectorAll('.sd-table th[data-col]').forEach(th => th.onclick = () => { const c = th.dataset.col; if (sort.col === c) sort.dir *= -1; else { sort.col = c; sort.dir = c === 'fullName' ? 1 : -1; } render(); });
}
