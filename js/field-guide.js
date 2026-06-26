/* ============================================================
   NEMESIS Command Deck — Field Guide
   Browsable reference for Star Citizen's underground facilities, Onyx
   investigation contracts and special / event missions. Content is assembled
   from PUBLIC community sources (SC Wiki, RSI Spectrum/comm-links, community
   guides) — every entry carries its sources (with a Wiki/Forum/Official/Video
   marker) and an honest confidence tag. Volatile data; not official.

   Data: data/field-guide.json (researched + adversarially verified, never the
   author's screenshots). We summarise FACTS with attribution — no copied maps.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let ROOT = null;
let DATA = null;
let fgType = 'all';
let fgSearch = '';
let fgSel = null;
let showLegend = false;

function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const TYPES = [
  { k: 'all', l: 'All' },
  { k: 'underground-facility', l: 'Facilities' },
  { k: 'contract-chain', l: 'Contract Chains' },
  { k: 'special-mission', l: 'Special Missions' },
  { k: 'event-mission', l: 'Events' },
  { k: 'other', l: 'Intel' },
];
const TYPE_LABEL = {
  'underground-facility': 'Underground Facility',
  'contract-chain': 'Contract Chain',
  'special-mission': 'Special Mission',
  'event-mission': 'Event',
  'puzzle': 'Puzzle',
  'other': 'Intel',
};

const CONF = {
  confirmed: { l: 'CONFIRMED', cls: 'ok', t: 'Corroborated by the SC Wiki / official sources' },
  community: { l: 'COMMUNITY', cls: 'warn', t: 'From community guides & player reports — verify in-game' },
  datamined: { l: 'DATAMINED', cls: 'teal', t: 'From datamined files — may be unreleased / change' },
  unclear: { l: 'UNCLEAR', cls: 'crit', t: 'Weakly sourced — treat with caution' },
};
function confBadge(c) { const x = CONF[c] || CONF.unclear; return `<span class="cf-conf cf-${x.cls}" title="${esc(x.t)}">${x.l}</span>`; }

// derive a provenance marker from a source URL, so the player sees where a fact came from
function srcTag(s) {
  const u = (s.url || '').toLowerCase();
  if (u.includes('starcitizen.tools')) return { label: 'Wiki', cls: 'teal' };
  if (u.includes('api.star-citizen.wiki')) return { label: 'Wiki API', cls: 'teal' };
  if (u.includes('/spectrum')) return { label: 'Spectrum', cls: 'warn' };
  if (u.includes('reddit.com')) return { label: 'Reddit', cls: 'warn' };
  if (u.includes('youtube.com') || u.includes('youtu.be')) return { label: 'Video', cls: 'dim' };
  if (u.includes('robertsspaceindustries.com')) return { label: 'Official', cls: 'ok' };
  return { label: 'Community', cls: 'dim' };
}

export async function initFieldGuide(root) {
  ROOT = root;
  try {
    DATA = await loadJSON('field-guide.json');
  } catch (e) {
    root.innerHTML = `<div class="empty-state" style="color:var(--status-crit)"><h3>Field guide unavailable</h3><p>data/field-guide.json failed to load. ${e.message}</p></div>`;
    return;
  }
  if (DATA.entries && DATA.entries.length) fgSel = fgSel || DATA.entries[0].id;
  render();
}

function listFiltered() {
  return (DATA.entries || []).filter(e => {
    if (fgType !== 'all' && e.type !== fgType) return false;
    if (fgSearch) {
      const hay = (e.name + ' ' + (e.overview || '') + ' ' + (e.location || '')).toLowerCase();
      if (!hay.includes(fgSearch)) return false;
    }
    return true;
  });
}

function sectionList(title, items, ordered) {
  if (!items || !items.length) return '';
  const tag = ordered ? 'ol' : 'ul';
  return `<div class="fg-sec"><div class="wb-sub-h">${esc(title)}</div><${tag} class="fg-${ordered ? 'steps' : 'list'}">${items.map(i => `<li>${esc(i)}</li>`).join('')}</${tag}></div>`;
}

function detail(e) {
  if (!e) return '<div class="empty-state"><h3>Pick an entry</h3><p>Select a facility or mission on the left to read its walkthrough, rewards, hazards and sources.</p></div>';
  const sources = (e.sources || []).map(s => { const t = srcTag(s); return `<a class="fg-src" href="${esc(s.url)}" target="_blank" rel="noopener"><span class="cf-conf cf-${t.cls}">${t.label}</span> ${esc(s.label)}</a>`; }).join('');
  return `<div class="panel">
    <div class="wb-head">
      <div><div class="wb-title">${esc(e.name)}</div><div class="ship-role">${esc(TYPE_LABEL[e.type] || e.type)}</div></div>
      ${confBadge(e.confidence)}
    </div>
    ${e.location ? `<div class="fg-meta"><span class="fg-meta-k">Location</span> ${esc(e.location)}</div>` : ''}
    ${e.access ? `<div class="fg-meta"><span class="fg-meta-k">Access</span> ${esc(e.access)}</div>` : ''}
    ${e.overview ? `<p class="craft-p">${esc(e.overview)}</p>` : ''}
    ${sectionList('Objectives', e.objectives)}
    ${sectionList('Walkthrough', e.steps, true)}
    <div class="two-col">
      ${sectionList('Rewards', e.rewards)}
      ${sectionList('Hazards', e.hazards)}
    </div>
    ${sectionList('Tips', e.tips)}
    <div class="fg-sources"><div class="wb-sub-h">Sources <span class="pc-note">where this is documented — click to verify</span></div>${sources || '<span class="src-note">No sources recorded.</span>'}</div>
  </div>`;
}

function render() {
  const list = listFiltered();
  const sel = DATA.entries.find(e => e.id === fgSel) || list[0];
  const counts = {};
  (DATA.entries || []).forEach(e => { counts[e.type] = (counts[e.type] || 0) + 1; });

  const items = list.map(e => `<div class="ship-item fg-item${sel && sel.id === e.id ? ' active' : ''}" data-id="${esc(e.id)}">
      <span class="fg-item-name">${esc(e.name)}</span>
      <span class="ship-role">${esc(TYPE_LABEL[e.type] || e.type)} ${confBadge(e.confidence)}</span>
    </div>`).join('') || '<div class="empty-state"><p>No entries match.</p></div>';

  const legend = (DATA.legend || []).map(l => `<div class="fg-leg-row"><b>${esc(l.icon)}</b><span>${esc(l.meaning)}</span></div>`).join('');
  const caveats = (DATA.caveats || []).map(c => `<li>${esc(c)}</li>`).join('');

  ROOT.innerHTML = `
    <div class="ph-head"><h2>Field Guide</h2>
      <div class="ef-sub">Underground facilities, Onyx investigation contracts and special / event missions — what they are, how to run them, rewards &amp; hazards. Every entry is community-sourced and cited.</div></div>

    <div class="craft-status"><span class="ps-dot"></span><span>Patch <b>${esc(DATA.patch || '?')}</b> · ${(DATA.entries || []).length} entries · assembled from <b>public sources</b> (SC Wiki, Spectrum, community guides) and tagged by confidence. This content changes between patches — <b>verify in-game</b>. Unofficial; not CIG.</span></div>

    <div class="trade-toolbar">
      <div class="fleet-filters">${TYPES.map(t => `<button class="fl-chip${fgType === t.k ? ' active' : ''}" data-type="${t.k}">${t.l}${t.k !== 'all' && counts[t.k] ? ` · ${counts[t.k]}` : ''}</button>`).join('')}</div>
      <button class="fl-chip${showLegend ? ' active' : ''}" id="fgLegendBtn">⊞ Map legend</button>
      <input type="text" class="search-input trade-search" id="fgSearch" placeholder="Search facilities & missions..." value="${esc(fgSearch)}">
    </div>

    ${showLegend ? `<div class="panel fg-legend"><div class="panel-header">Facility map legend <span class="pc-note">generic interactables — recreated, not copied from any guide</span></div><div class="fg-leg-grid">${legend}</div></div>` : ''}

    <div class="tac-layout">
      <div class="panel tac-pick">
        <div class="panel-header">Entries</div>
        <div class="ship-list fg-list" id="fgList">${items}</div>
      </div>
      <div class="tac-analysis" id="fgDetail">${detail(sel)}</div>
    </div>

    <div class="panel fg-caveats"><div class="panel-header">Honesty &amp; caveats</div><ul class="guide-tips">${caveats}</ul></div>
    <div class="src-note">Built from publicly available community documentation (SC Wiki — CC BY-SA, RSI Spectrum/comm-links, community guides), summarised with attribution. No third-party guide images/maps are reproduced. Star Citizen data is volatile — confirm in-game. Unofficial — not affiliated with Cloud Imperium Games.</div>`;

  ROOT.querySelectorAll('[data-type]').forEach(b => b.onclick = () => { fgType = b.dataset.type; render(); });
  ROOT.querySelector('#fgLegendBtn').onclick = () => { showLegend = !showLegend; render(); };
  const se = ROOT.querySelector('#fgSearch');
  se.oninput = () => { fgSearch = se.value.toLowerCase().trim(); render(); const el = ROOT.querySelector('#fgSearch'); if (el) { el.focus(); const v = el.value; el.value = ''; el.value = v; } };
  ROOT.querySelectorAll('[data-id]').forEach(it => it.onclick = () => { fgSel = it.dataset.id; render(); });
}
