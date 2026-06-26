/* ============================================================
   NEMESIS Command Deck — Trade Routes board (stock-aware)
   Best buy→sell commodity routes from a periodic UEX snapshot
   (data/trade-routes.json, built by scripts/ingest-trade.py). Every route
   carries the available SCU, the UEX inventory status (0..7) and the report
   age at BOTH terminals, so routes are ranked by REALISABLE profit (margin ×
   how much you can actually move), not by raw unit margin.

   Honesty: prices/stock are a community SNAPSHOT, not live. There is no restock
   timer in the source — we never invent one; we show inventory level + data age.
   UEX status is INVERTED on the sell side (a near-empty terminal is hungry =
   good to sell into; a full one is saturated = bad).
   ============================================================ */
import { loadJSON } from './data-loader.js';
import { formatNumber } from './stats-calculator.js';

let ROOT = null;
let DATA = null;
let scu = 0;                 // ship cargo SCU (0 = unknown → rank by clear-the-stock)
let legal = 'all';           // all | legal | illegal
let sameSystemOnly = false;
let includeNoData = false;   // show status==0 (no inventory report) routes in the ranking
let maxAge = 30;             // hide routes whose worse side is older than N days
let search = '';
let sort = { col: 'score', dir: -1 };

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ── UEX inventory status (0..7) → label / abbr / fill band ──────────────── */
const STATUS = {
  0: { abbr: '—', label: 'No data', range: 'no report' },
  1: { abbr: 'OS', label: 'Out of Stock', range: '0–14%' },
  2: { abbr: 'VL', label: 'Very Low', range: '15–28%' },
  3: { abbr: 'LO', label: 'Low', range: '29–43%' },
  4: { abbr: 'ME', label: 'Medium', range: '44–57%' },
  5: { abbr: 'HI', label: 'High', range: '58–71%' },
  6: { abbr: 'VH', label: 'Very High', range: '72–85%' },
  7: { abbr: 'MA', label: 'Maximum', range: '86–100%' },
};
// buy side: more stock = better (favourable green at the top)
const BUY_CLS = { 0: 'dim', 1: 'crit', 2: 'crit', 3: 'warn', 4: 'teal', 5: 'teal', 6: 'ok', 7: 'ok' };
// sell side INVERTED: empty demand bins = hungry buyer = good (green); full = saturated (red)
const SELL_CLS = { 0: 'dim', 1: 'ok', 2: 'ok', 3: 'teal', 4: 'teal', 5: 'warn', 6: 'crit', 7: 'crit' };
// sell side reads as DEMAND, so its abbr/label are inverted too (not just colours):
// a near-empty terminal is a hungry buyer = high demand.
const SELL_ABBR = { 0: '—', 1: 'HD', 2: 'HD', 3: 'MD', 4: 'MD', 5: 'LD', 6: 'SAT', 7: 'SAT' };
const SELL_LABEL = { 0: 'No data', 1: 'Empty bins · high demand', 2: 'Low fill · high demand', 3: 'Some fill · good demand', 4: 'Moderate fill · fair demand', 5: 'Filling up · weak demand', 6: 'Saturated · little demand', 7: 'Maximum · no demand' };

function statusBadge(code, side) {
  const s = STATUS[code] || STATUS[0];
  const cls = (side === 'sell' ? SELL_CLS : BUY_CLS)[code] || 'dim';
  const abbr = side === 'sell' ? (SELL_ABBR[code] || s.abbr) : s.abbr;
  const label = side === 'sell' ? (SELL_LABEL[code] || s.label) : s.label;
  return `<span class="cf-conf cf-${cls}" title="${esc(label)} (${s.range})">${abbr}</span>`;
}

/* ── freshness (precomputed age in days, relative to snapshot) ───────────── */
function ageTier(d) {
  if (d == null) return ['dim', 'no date'];
  if (d <= 2) return ['ok', d + 'd ago'];
  if (d <= 7) return ['warn', d + 'd ago'];
  if (d <= 30) return ['crit', d + 'd ago'];
  return ['dim', d + 'd ago'];
}
function worseAge(r) {
  const a = r.buyAgeDays == null ? 9999 : r.buyAgeDays;
  const b = r.sellAgeDays == null ? 9999 : r.sellAgeDays;
  return Math.max(a, b);
}
function ageMult(d) {
  if (d == null) return 0.15;
  if (d <= 2) return 1.0;
  if (d <= 7) return 0.85;
  if (d <= 30) return 0.5;
  return 0.15;
}

/* ── effective figures (fall back to averages when the point reading is stale) */
function buyPriceOf(r) { return r.buyStale ? r.buyPriceAvg : r.buyPrice; }
function sellPriceOf(r) { return r.sellStale ? r.sellPriceAvg : r.sellPrice; }
function supplyOf(r) {
  const pt = r.buyScu || 0, av = r.buyScuAvg || 0;
  // when stale we use the running average, but never let it inflate the qty above the
  // last observed point reading — take the conservative (smaller) of the two.
  if (r.buyStale) return pt > 0 ? Math.min(pt, av || pt) : av;
  return pt;
}
function demandOf(r) {                       // SCU the destination will absorb (often unreported → null)
  const v = (r.sellStale ? r.sellDemandScuAvg : r.sellDemandScu) || 0;
  return v > 0 ? v : null;
}

/* ── realisable quantity + score ────────────────────────────────────────── */
function runQty(r) {
  const supply = supplyOf(r);
  if (supply <= 0) return 0;                       // empty shelf → nothing movable, whatever the cargo
  let q = supply;
  if (scu > 0) q = Math.min(q, scu);
  const demand = demandOf(r);
  if (demand != null) q = Math.min(q, demand);
  return Math.max(0, Math.round(q));
}
function qtyLimiter(r) {
  const supply = supplyOf(r), demand = demandOf(r);
  if (supply <= 0) return 'supply';                // the binding constraint is an empty shelf
  const caps = [['supply', supply]];
  if (scu > 0) caps.push(['cargo', scu]);
  if (demand != null) caps.push(['demand', demand]);
  return caps.reduce((a, b) => b[1] < a[1] ? b : a)[0];
}
function unitMargin(r) { return sellPriceOf(r) - buyPriceOf(r); }

const DQ = -1; // disqualified score sentinel
function scoreOf(r) {
  const supply = supplyOf(r), margin = unitMargin(r);
  if (margin <= 0) return DQ;
  if ([1, 2].includes(r.buyStatus) || supply <= 0) return DQ;          // source empty
  if ([6, 7].includes(r.sellStatus)) return DQ;                        // destination saturated
  if ((r.buyStatus === 0 || r.sellStatus === 0) && !includeNoData) return DQ;
  const qty = runQty(r);
  if (qty <= 0) return DQ;
  // realisable profit (margin × what you can actually move — supply & demand caps are
  // already inside qty) discounted only by DATA FRESHNESS, a real reliability signal.
  const freshness = Math.min(ageMult(r.buyAgeDays), ageMult(r.sellAgeDays));
  return margin * qty * freshness;
}

const COLS = [
  { k: 'commodity', l: 'Commodity', num: false },
  {
    k: 'buyPrice', l: 'Buy', num: true,
    fmt: (r) => `${formatNumber(buyPriceOf(r))}${r.buyStale ? '<span class="tr-avg">avg</span>' : ''}<span class="tr-loc">${esc(r.buyTerminal || '')}${r.buySystem ? ' · ' + esc(r.buySystem) : ''}</span>`,
  },
  {
    k: 'supply', l: 'Supply', num: true,
    fmt: (r) => { const s = supplyOf(r); const z = r.buyStatus === 0; return `<span class="${z ? 'cf-dim' : ''}">${s > 0 ? formatNumber(s) + ' SCU' : '—'}</span> ${statusBadge(r.buyStatus, 'buy')}`; },
  },
  {
    k: 'sellPrice', l: 'Sell', num: true,
    fmt: (r) => `${formatNumber(sellPriceOf(r))}${r.sellStale ? '<span class="tr-avg">avg</span>' : ''}<span class="tr-loc">${esc(r.sellTerminal || '')}${r.sellSystem ? ' · ' + esc(r.sellSystem) : ''}</span>`,
  },
  {
    k: 'demand', l: 'Demand', num: true,
    fmt: (r) => { const d = demandOf(r); return `${d != null ? formatNumber(d) + ' SCU' : '<span class="cf-dim">n/a</span>'} ${statusBadge(r.sellStatus, 'sell')}`; },
  },
  { k: 'profit', l: 'Profit/SCU', num: true, fmt: (r) => { const bp = buyPriceOf(r); const pct = bp ? Math.round(unitMargin(r) / bp * 100) : 0; return `<b class="tr-profit">+${formatNumber(Math.round(unitMargin(r)))}</b>${pct ? `<span class="tr-loc">${pct}% margin</span>` : ''}`; } },
  {
    k: 'run', l: 'Max / run', num: true,
    fmt: (r) => { const q = runQty(r); const lim = qtyLimiter(r); return q > 0 ? `${formatNumber(q)} SCU${lim ? `<span class="tr-loc">capped by ${lim}</span>` : ''}` : '—'; },
  },
  { k: 'realisable', l: 'Profit / run', num: true, fmt: (r) => { const q = runQty(r); const p = Math.round(unitMargin(r) * q); return q > 0 ? `<b class="tr-profit">${formatNumber(p)}</b>` : '—'; } },
  {
    k: 'updated', l: 'Updated', num: true,
    fmt: (r) => { const [cls, txt] = ageTier(worseAge(r) === 9999 ? null : worseAge(r)); return `<span class="cf-conf cf-${cls}">${txt}</span>`; },
  },
];

function sortVal(r, col) {
  switch (col) {
    case 'score': return scoreOf(r);
    case 'supply': return supplyOf(r);
    case 'demand': return demandOf(r) || 0;
    case 'profit': return unitMargin(r);
    case 'run': return runQty(r);
    case 'realisable': return unitMargin(r) * runQty(r);
    case 'updated': return -worseAge(r);
    case 'buyPrice': return buyPriceOf(r);
    case 'sellPrice': return sellPriceOf(r);
    default: return r[col];
  }
}

export async function initTrade(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('trade-routes.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Trade data unavailable</h3><p>data/trade-routes.json failed to load. ${e.message}</p></div>`;
    return;
  }
  render();
}

function render() {
  const all = (DATA.routes || []).filter(r => {
    if (legal === 'legal' && r.illegal) return false;
    if (legal === 'illegal' && !r.illegal) return false;
    if (sameSystemOnly && !r.sameSystem) return false;
    const undated = worseAge(r) === 9999;
    if (maxAge < 999 && undated && !includeNoData) return false;       // no report date → only with "incl. no-data"
    if (maxAge < 999 && !undated && worseAge(r) > maxAge) return false;
    if (search && !(r.commodity || '').toLowerCase().includes(search)) return false;
    return true;
  });

  // split qualified (real, stocked, in-demand) from disqualified (empty / saturated / no-data / stale-out)
  const scored = all.map(r => ({ r, s: scoreOf(r) }));
  const ok = scored.filter(x => x.s !== DQ);
  const dq = scored.filter(x => x.s === DQ);

  const cmp = (a, b) => {
    const av = sortVal(a.r, sort.col), bv = sortVal(b.r, sort.col);
    if (typeof av === 'number') return (av - bv) * sort.dir;
    return String(av).localeCompare(String(bv)) * sort.dir;
  };
  ok.sort(sort.col === 'score' ? (a, b) => b.s - a.s : cmp);
  // hidden bucket: order by unit margin alone — runQty inflates empty/no-demand rows
  dq.sort((a, b) => unitMargin(b.r) - unitMargin(a.r));

  const head = COLS.map(c => `<th data-col="${c.k}" class="${c.num ? 'num' : ''}${sort.col === c.k ? ' sorted' : ''}">${c.l}${sort.col === c.k ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
  const rowHtml = (r, dim) => `<tr class="${dim ? 'tr-dq' : ''}">${COLS.map(c => {
    const disp = c.fmt ? c.fmt(r) : esc(String(r[c.k] == null ? '' : r[c.k]));
    return `<td class="${c.num ? 'num' : ''}">${disp}</td>`;
  }).join('')}<td>${r.illegal ? '<span class="cf-conf cf-crit">illegal</span>' : ''}${r.sameSystem ? '<span class="cf-conf cf-ok">1-sys</span>' : ''}</td></tr>`;

  const okRows = ok.map(x => rowHtml(x.r, false)).join('')
    || `<tr><td colspan="${COLS.length + 1}" class="src-note">No tradeable routes with stock under this filter — widen the data-age limit or enable “incl. no-data”.</td></tr>`;
  const dqRows = dq.length
    ? `<tr class="tr-divider"><td colspan="${COLS.length + 1}">▾ ${dq.length} route${dq.length === 1 ? '' : 's'} hidden from ranking — out of stock, saturated destination, or no inventory report</td></tr>` + dq.map(x => rowHtml(x.r, true)).join('')
    : '';

  const sortName = { score: 'Best (stock-aware)', realisable: 'Profit per run', profit: 'Profit per SCU', supply: 'Available supply', updated: 'Freshest data' };

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Trade Routes</h2>
      <div class="ef-sub">Best buy→sell commodity runs, ranked by <b>realisable profit</b> — unit margin × how much you can actually move, given the stock on the shelf and the destination's demand.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>UEX community snapshot <b>${esc(DATA.snapshot || 'unknown')}</b> · ${ok.length} ranked of ${DATA.count || 0} · stock &amp; prices are the <b>last community report, not live</b>. There is no restock timer in the data — terminals replenish gradually, so buy when overstocked, sell when understocked.</span></div>

    <div class="trade-toolbar">
      <label class="trade-scu">Cargo SCU <input type="number" id="trScu" min="0" placeholder="e.g. 96" value="${scu || ''}"></label>
      <label class="trade-scu">Sort <select id="trSort" class="tr-select">${Object.entries(sortName).map(([k, v]) => `<option value="${k}"${sort.col === k ? ' selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="trade-scu">Max age <select id="trAge" class="tr-select">${[2, 7, 14, 30, 999].map(n => `<option value="${n}"${maxAge === n ? ' selected' : ''}>${n === 999 ? 'any' : n + ' days'}</option>`).join('')}</select></label>
      <div class="fleet-filters">
        <button class="fl-chip${legal === 'all' ? ' active' : ''}" data-legal="all">All</button>
        <button class="fl-chip${legal === 'legal' ? ' active' : ''}" data-legal="legal">Legal</button>
        <button class="fl-chip${legal === 'illegal' ? ' active' : ''}" data-legal="illegal">Illegal</button>
        <button class="fl-chip${sameSystemOnly ? ' active' : ''}" id="trSameSys">1-system</button>
        <button class="fl-chip${includeNoData ? ' active' : ''}" id="trNoData">incl. no-data</button>
      </div>
      <input type="text" class="search-input trade-search" id="trSearch" placeholder="Search commodity..." value="${esc(search)}">
    </div>

    <div class="panel fleet-tablewrap">
      <table class="fleet-table trade-table"><thead><tr>${head}<th></th></tr></thead><tbody>${okRows}${dqRows}</tbody></table>
    </div>
    <div class="tr-legend">
      <span><b>Supply</b> = SCU on the shelf to buy · <b>Demand</b> = SCU the destination will absorb (n/a = unreported)</span>
      <span class="tr-legend-badges">Inventory ${[1, 3, 4, 6, 7].map(c => statusBadge(c, 'buy')).join(' ')} <span class="src-note">buy: green = full · sell colours inverted (green = hungry buyer, red = saturated)</span></span>
    </div>
    <div class="src-note">Source: UEX Corp (uexcorp.space), community-run — stock, demand &amp; prices are player-reported and approximate; each row shows its report age. Stale rows (&gt; ${DATA.staleDays || 7}d) fall back to the running average, tagged <span class="tr-avg">avg</span>. Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  // wire controls (re-render keeps focus on the active text input)
  const si = ROOT.querySelector('#trScu');
  si.oninput = () => { scu = Math.max(0, parseInt(si.value, 10) || 0); render(); restoreFocus('#trScu'); };
  const se = ROOT.querySelector('#trSearch');
  se.oninput = () => { search = se.value.toLowerCase().trim(); render(); restoreFocus('#trSearch'); };
  ROOT.querySelector('#trSort').onchange = (e) => { sort = { col: e.target.value, dir: -1 }; render(); };
  ROOT.querySelector('#trAge').onchange = (e) => { maxAge = parseInt(e.target.value, 10); render(); };
  ROOT.querySelectorAll('[data-legal]').forEach(b => b.onclick = () => { legal = b.dataset.legal; render(); });
  ROOT.querySelector('#trSameSys').onclick = () => { sameSystemOnly = !sameSystemOnly; render(); };
  ROOT.querySelector('#trNoData').onclick = () => { includeNoData = !includeNoData; render(); };
  ROOT.querySelectorAll('.trade-table th[data-col]').forEach(th => th.onclick = () => { const c = th.dataset.col; if (sort.col === c) sort.dir *= -1; else { sort.col = c; sort.dir = -1; } render(); });
}

function restoreFocus(sel) {
  const el = ROOT.querySelector(sel);
  if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; }
}
