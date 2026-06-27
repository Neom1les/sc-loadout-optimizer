/* ============================================================
   NEMESIS Command Deck — Gear Locker
   Where to get notable / special Star Citizen armor and gear: which shop &
   location to buy it, which loot site / contested zone drops it, which event
   or mission rewards it, or whether it's craftable. Each entry is community-
   sourced and cited, with an honest confidence + availability tag.

   Data: data/gear.json (researched + adversarially verified). Acquisition is
   patch-volatile — every entry carries its sources and a confidence flag.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let DATA = null;
let gGroup = 'all';
let gSearch = '';
let gSel = null;

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const GROUPS = [
  { k: 'all', l: 'All' },
  { k: 'armor', l: 'Armor' },
  { k: 'utility', l: 'Utility' },
  { k: 'medical', l: 'Medical' },
  { k: 'shop', l: 'Shops' },
];
const CAT_LABEL = {
  'special-armor': 'Special Armor', 'armor-set': 'Armor Set', 'helmet': 'Helmet',
  'undersuit': 'Undersuit', 'utility': 'Utility Gear', 'medical': 'Medical', 'shop': 'Shop', 'other': 'Gear',
};

// how you obtain it — the heart of this tab
const METHOD = {
  shop: { l: 'BUY', cls: 'teal', t: 'Purchasable at an in-game shop' },
  loot: { l: 'LOOT', cls: 'warn', t: 'Found as loot (contested zones, facilities, bunkers)' },
  event: { l: 'EVENT', cls: 'crit', t: 'Earned during a time-limited / seasonal event' },
  'mission-reward': { l: 'REWARD', cls: 'ok', t: 'Reward for completing a mission / contract' },
  craft: { l: 'CRAFT', cls: 'ok', t: 'Craftable from a blueprint' },
  subscriber: { l: 'SUBSCRIBER', cls: 'dim', t: 'Subscriber Store flair (real-money / subscription)' },
  pledge: { l: 'PLEDGE', cls: 'dim', t: 'Pledge Store item (real money)' },
  unknown: { l: 'OTHER', cls: 'dim', t: 'Other / player marketplace' },
};
const RARITY = { common: 'dim', uncommon: 'ok', rare: 'teal', 'very-rare': 'warn', unknown: 'dim' };
const STATUS = {
  live: { l: 'LIVE', cls: 'ok' }, seasonal: { l: 'SEASONAL', cls: 'teal' },
  concluded: { l: 'CONCLUDED', cls: 'dim' }, unknown: { l: '', cls: '' },
};
const CONF = {
  confirmed: { l: 'CONFIRMED', cls: 'ok', t: 'Corroborated by the SC Wiki / official sources' },
  community: { l: 'COMMUNITY', cls: 'warn', t: 'From community guides & player reports — verify in-game' },
  unclear: { l: 'UNCLEAR', cls: 'crit', t: 'Weakly sourced — treat with caution' },
};
function badge(map, key) { const x = map[key]; return x && x.l ? `<span class="cf-conf cf-${x.cls}"${x.t ? ` title="${esc(x.t)}"` : ''}>${x.l}</span>` : ''; }
function rarityTag(r) { return r && r !== 'unknown' ? `<span class="cf-conf cf-${RARITY[r] || 'dim'}">${esc(r.replace('-', ' '))}</span>` : ''; }

function srcTag(s) {
  const u = (s.url || '').toLowerCase();
  if (u.includes('starcitizen.tools')) return { label: 'Wiki', cls: 'teal' };
  if (u.includes('uexcorp.space')) return { label: 'UEX', cls: 'teal' };
  if (u.includes('/spectrum')) return { label: 'Spectrum', cls: 'warn' };
  if (u.includes('reddit.com')) return { label: 'Reddit', cls: 'warn' };
  if (u.includes('youtube.com') || u.includes('youtu.be')) return { label: 'Video', cls: 'dim' };
  if (u.includes('/community-hub')) return { label: 'Community', cls: 'dim' };
  if (u.includes('robertsspaceindustries.com')) return { label: 'Official', cls: 'ok' };
  return { label: 'Community', cls: 'dim' };
}

export async function initGear(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('gear.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Gear data unavailable</h3><p>data/gear.json failed to load. ${e.message}</p></div>`;
    return;
  }
  if (DATA.entries && DATA.entries.length) gSel = gSel || DATA.entries[0].id;
  render();
}

function filtered() {
  return (DATA.entries || []).filter(e => {
    if (gGroup !== 'all' && e.group !== gGroup) return false;
    if (gSearch) {
      const hay = (e.name + ' ' + (e.notableFor || '') + ' ' + (e.manufacturer || '') + ' ' + (e.acquisition || []).map(a => a.where + ' ' + (a.location || '')).join(' ')).toLowerCase();
      if (!hay.includes(gSearch)) return false;
    }
    return true;
  });
}

function detail(e) {
  if (!e) return '<div class="empty-state"><h3>Pick an item</h3><p>Select an armor set, gear item or shop on the left to see where and how to get it.</p></div>';
  const acq = (e.acquisition || []).map(a => `<div class="gl-acq-row">
      ${badge(METHOD, a.method)}
      <div class="gl-acq-body"><div class="gl-acq-where">${esc(a.where)}</div>${a.location ? `<div class="tr-loc">⌖ ${esc(a.location)}</div>` : ''}</div>
    </div>`).join('') || '<div class="src-note">Acquisition not documented.</div>';
  const sources = (e.sources || []).map(s => { const t = srcTag(s); return `<a class="fg-src" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="cf-conf cf-${t.cls}">${t.label}</span> ${esc(s.label)}</a>`; }).join('');
  return `<div class="panel">
    <div class="wb-head">
      <div><div class="wb-title">${esc(e.name)}</div><div class="ship-role">${esc(CAT_LABEL[e.category] || e.category)}${e.type ? ' · ' + esc(e.type) : ''}${e.manufacturer ? ' · ' + esc(e.manufacturer) : ''}</div></div>
      <div class="fg-badges">${rarityTag(e.rarity)}${badge(STATUS, e.status)}${badge(CONF, e.confidence)}</div>
    </div>
    ${e.img ? `<div class="gl-hero"><img src="${esc(e.img)}" loading="lazy" alt="${esc(e.name)}"></div>` : ''}
    ${e.notableFor ? `<p class="craft-p">${esc(e.notableFor)}</p>` : ''}
    <div class="wb-sub-h">How to get it</div>
    <div class="gl-acq">${acq}</div>
    <div class="fg-sources"><div class="wb-sub-h">Sources <span class="pc-note">click to verify</span></div>${sources || '<span class="src-note">No sources recorded.</span>'}</div>
  </div>`;
}

function render() {
  const list = filtered();
  const sel = DATA.entries.find(e => e.id === gSel) || list[0];
  const counts = {};
  (DATA.entries || []).forEach(e => { counts[e.group] = (counts[e.group] || 0) + 1; });

  const items = list.map(e => {
    const methods = [...new Set((e.acquisition || []).map(a => a.method))];
    return `<div class="ship-item fg-item gl-item${sel && sel.id === e.id ? ' active' : ''}" data-id="${esc(e.id)}">
      ${e.img ? `<img class="gl-thumb" src="${esc(e.img)}" loading="lazy" alt="">` : '<span class="gl-thumb gl-thumb-none">⬢</span>'}
      <span class="gl-item-txt"><span class="fg-item-name">${esc(e.name)}</span><span class="ship-role">${esc(CAT_LABEL[e.category] || e.category)} ${methods.map(m => badge(METHOD, m)).join('')}</span></span>
    </div>`;
  }).join('') || '<div class="empty-state"><p>No items match.</p></div>';
  const caveats = (DATA.caveats || []).map(c => `<li>${esc(c)}</li>`).join('');

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Gear Locker</h2>
      <div class="ef-sub">Where to get special armor &amp; gear — which shop &amp; location to buy it, which loot site or contested zone drops it, and which events reward it. Community-sourced and cited.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>Patch <b>${esc(DATA.patch || '?')}</b> · ${(DATA.entries || []).length} items · loot tables, drops &amp; shop stock <b>shift between patches</b> — verify in-game. Unofficial; not CIG.</span></div>

    <div class="trade-toolbar">
      <div class="fleet-filters">${GROUPS.map(g => `<button class="fl-chip${gGroup === g.k ? ' active' : ''}" data-group="${g.k}">${g.l}${g.k !== 'all' && counts[g.k] ? ` · ${counts[g.k]}` : ''}</button>`).join('')}</div>
      <input type="text" class="search-input trade-search" id="gSearch" placeholder="Search armor, gear, shop, location..." value="${esc(gSearch)}">
    </div>

    <div class="gl-legend"><b>How to get:</b> ${['shop', 'loot', 'event', 'mission-reward', 'craft', 'subscriber'].map(m => badge(METHOD, m)).join(' ')}</div>

    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Items</div>
        <div class="ship-list fg-list" id="gList">${items}</div>
      </div>
      <div class="tac-analysis" id="gDetail">${detail(sel)}</div>
    </div>

    <div class="panel fg-caveats"><div class="panel-header">Honesty &amp; caveats</div><ul class="guide-tips">${caveats}</ul></div>
    <div class="src-note">Built from public community documentation (SC Wiki — CC BY-SA, UEX Corp, RSI comm-links, community guides), summarised with attribution. SC loot/shop data is volatile — confirm in-game. Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  ROOT.querySelectorAll('[data-group]').forEach(b => b.onclick = () => { gGroup = b.dataset.group; render(); });
  const se = ROOT.querySelector('#gSearch');
  se.oninput = () => { gSearch = se.value.toLowerCase().trim(); render(); const el = ROOT.querySelector('#gSearch'); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
  ROOT.querySelectorAll('[data-id]').forEach(it => it.onclick = () => { gSel = it.dataset.id; render(); });
}
