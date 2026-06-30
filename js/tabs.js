/* ============================================================
   SC Optimizer — tab router + home hub
   Home is the default view: app-style tiles into each tool.
   ============================================================ */
import { initEarnings } from './earnings-finder.js';
import { initPatchHub, showGuide } from './patch-hub.js';
import { initTactics } from './tactics.js';
import { initFleet } from './fleet.js';
import { initCrafting } from './crafting.js';
import { initTrade } from './trade.js';
import { initWeapons } from './weapons.js';
import { initFieldGuide } from './field-guide.js';
import { initGear } from './gear.js';
import { initShipsBuy } from './ships-buy.js';
import { initCrewOps } from './crew-ops.js';
import { initMining } from './mining.js';

const TABS = ['home', 'optimizer', 'earnings', 'patch', 'tactics', 'fleet', 'crafting', 'trade', 'weapons', 'fieldguide', 'gear', 'shipbuy', 'mining', 'crew'];
const inited = {};

function panelId(tab) { return 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1); }

function renderHome() {
  const root = document.getElementById('homeRoot');
  if (!root) return;
  const T = {
    optimizer: { tab: 'optimizer', ico: '⬡', img: 'assets/bg2.webp', title: 'Loadout Optimizer', desc: 'Optimize weapons, shields & components for any combat ship — with damage matchups, TTK and shopping lists.' },
    tactics: { tab: 'tactics', ico: '⊕', img: 'assets/tactics.jpg', title: 'Tactics', desc: 'Counter-pick any enemy ship, read its armor weakness, and see which ships hard-counter it.' },
    fleet: { tab: 'fleet', ico: '⊟', img: 'assets/fleet.jpg', title: 'Fleet Ops', desc: 'Build squad comps, track your org’s fleet & crews, and share standard loadout presets.' },
    shipbuy: { tab: 'shipbuy', ico: '◈', img: 'assets/shipdealer.jpg', title: 'Ship Dealer', desc: 'Which ships you can buy in-game for aUEC — at which dealer / showroom and for how much.' },
    mining: { tab: 'mining', ico: '⛏', img: 'assets/mining.jpg', title: 'Mining Fits', desc: 'Recommended laser-head & module fits for every mining ship, a full gear catalog with prices, and how the mining minigame works.' },
    weapons: { tab: 'weapons', ico: '⌖', img: 'assets/armory.jpg', title: 'Armory', desc: 'Every personal weapon — damage, fire rate, range, rarity and which ones you can craft.' },
    gear: { tab: 'gear', ico: '⬢', img: 'assets/gear.jpg', title: 'Gear Locker', desc: 'Where to get special armor & gear — which shop, loot site or event, with locations and sources.' },
    fieldguide: { tab: 'fieldguide', ico: '▤', img: 'assets/fieldguide.jpg', title: 'Field Guide', desc: 'Underground facilities, Onyx contracts & special missions — community-sourced walkthroughs with citations.' },
    trade: { tab: 'trade', ico: '⇄', img: 'assets/trade.jpg', title: 'Trade Routes', desc: 'Best buy→sell commodity runs by profit per SCU — with a cargo calculator and legal / single-system filters.' },
    crafting: { tab: 'crafting', ico: '⚒', img: 'assets/crafting.jpg', title: 'Crafting Guide', desc: 'Materials, blueprints, recipes and what’s worth making — every claim tagged live / PTU / community.' },
    earnings: { tab: 'earnings', ico: '◎', img: 'assets/bg.jpg', title: 'Earnings Finder', desc: 'Find the fastest way to earn aUEC or grind a faction’s reputation — ranked by your goal, with full guides.' },
    patch: { tab: 'patch', ico: '❖', img: 'assets/bg3.webp', title: 'Patch Hub', desc: 'What’s new each patch with step-by-step guides — plus the upcoming Alpha 4.9 roadmap.' },
    crew: { tab: 'crew', ico: '✦', img: 'assets/crewops.jpg', title: 'Crew Ops', desc: 'Online with friends? Pick your crew size and vibe — get co-op op ideas with a role split for each player.' },
  };
  const sections = [
    { title: 'Ship Operations', ico: '⬡', sub: 'Buy, fit, fight & fleet — everything ships', keys: ['shipbuy', 'optimizer', 'mining', 'tactics', 'fleet'] },
    { title: 'On Foot', ico: '⌖', sub: 'Personal weapons, armor & ground missions', keys: ['weapons', 'gear', 'fieldguide'] },
    { title: 'Economy & Career', ico: '⇄', sub: 'Earn aUEC, craft and run trade routes', keys: ['trade', 'crafting', 'earnings'] },
  ];
  const tile = t => `<button class="home-tile" data-go="${t.tab}">
        <span class="ht-img" style="background-image:url('${t.img}')"></span>
        <span class="ht-shade"></span>
        <span class="ht-body">
          <span class="ht-ico">${t.ico}</span>
          <span class="ht-title">${t.title}</span>
          <span class="ht-desc">${t.desc}</span>
          <span class="ht-cta">Open ▸</span>
        </span>
      </button>`;
  const p = T.patch;
  const c = T.crew;
  root.innerHTML = `
    <div class="home-hero">
      <div class="hh-kicker">Star Citizen · Alpha 4.8.2-LIVE</div>
      <h1 class="hh-title">Command Deck</h1>
      <p class="hh-sub">Your toolkit for the ’verse — choose a station to begin.</p>
    </div>
    <button class="patch-banner crew-banner" data-go="crew">
      <span class="pb-img" style="background-image:url('${c.img}')"></span>
      <span class="pb-shade"></span>
      <span class="pb-body">
        <span class="pb-kicker"><span class="pb-dot"></span>${c.ico} Playing with friends?</span>
        <span class="pb-title">${c.title}</span>
        <span class="pb-desc">${c.desc}</span>
      </span>
      <span class="pb-cta">Plan it ▸</span>
    </button>
    <button class="patch-banner" data-go="patch">
      <span class="pb-img" style="background-image:url('${p.img}')"></span>
      <span class="pb-shade"></span>
      <span class="pb-body">
        <span class="pb-kicker"><span class="pb-dot"></span>${p.ico} Latest patch · Alpha 4.8.2-LIVE</span>
        <span class="pb-title">${p.title}</span>
        <span class="pb-desc">${p.desc}</span>
      </span>
      <span class="pb-cta">Open ▸</span>
    </button>
    ${sections.map((s, i) => `<section class="home-section">
      <div class="hs-head"><span class="hs-num">0${i + 1}</span><span class="hs-ico">${s.ico}</span><span class="hs-title">${s.title}</span><span class="hs-rule"></span><span class="hs-sub">${s.sub}</span></div>
      <div class="home-grid">${s.keys.map(k => tile(T[k])).join('')}</div>
    </section>`).join('')}`;
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
}

function show(tab) {
  if (!TABS.includes(tab)) tab = 'home';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const panel = document.getElementById(panelId(tab));
  if (panel) panel.classList.add('active');
  document.body.classList.remove('tab-home', 'tab-optimizer', 'tab-earnings', 'tab-patch', 'tab-tactics', 'tab-fleet', 'tab-crafting', 'tab-trade', 'tab-weapons', 'tab-fieldguide', 'tab-gear', 'tab-shipbuy', 'tab-mining', 'tab-crew');
  document.body.classList.add('tab-' + tab);
  if (!(location.hash || '').startsWith('#squad=') && location.hash.slice(1) !== tab) {
    history.replaceState(null, '', '#' + tab);
  }

  if (tab === 'home' && !inited.home) { inited.home = true; renderHome(); }
  if (tab === 'earnings' && !inited.earnings) { inited.earnings = true; initEarnings(document.getElementById('earningsRoot')); }
  if (tab === 'patch' && !inited.patch) { inited.patch = true; initPatchHub(document.getElementById('patchRoot')); }
  if (tab === 'tactics' && !inited.tactics) { inited.tactics = true; initTactics(document.getElementById('tacticsRoot')); }
  if (tab === 'fleet' && !inited.fleet) { inited.fleet = true; initFleet(document.getElementById('fleetRoot')); }
  if (tab === 'crafting' && !inited.crafting) { inited.crafting = true; initCrafting(document.getElementById('craftingRoot')); }
  if (tab === 'trade' && !inited.trade) { inited.trade = true; initTrade(document.getElementById('tradeRoot')); }
  if (tab === 'weapons' && !inited.weapons) { inited.weapons = true; initWeapons(document.getElementById('weaponsRoot')); }
  if (tab === 'fieldguide' && !inited.fieldguide) { inited.fieldguide = true; initFieldGuide(document.getElementById('fieldGuideRoot')); }
  if (tab === 'gear' && !inited.gear) { inited.gear = true; initGear(document.getElementById('gearRoot')); }
  if (tab === 'shipbuy' && !inited.shipbuy) { inited.shipbuy = true; initShipsBuy(document.getElementById('shipBuyRoot')); }
  if (tab === 'mining' && !inited.mining) { inited.mining = true; initMining(document.getElementById('miningRoot')); }
  if (tab === 'crew' && !inited.crew) { inited.crew = true; initCrewOps(document.getElementById('crewRoot')); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('tabBar').addEventListener('click', e => {
  const b = e.target.closest('.tab-btn');
  if (b) show(b.dataset.tab);
});

const goHome = document.getElementById('goHome');
if (goHome) goHome.addEventListener('click', () => show('home'));

/* cross-tab helpers used by the Earnings Finder */
window.scOpenTab = show;
window.scOpenGuide = (guideId) => {
  if (!inited.patch) { inited.patch = true; initPatchHub(document.getElementById('patchRoot')); }
  show('patch');
  setTimeout(() => showGuide(guideId), 60);
};
window.scPrefillShipSearch = (text) => {
  show('optimizer');
  const s = document.getElementById('shipSearch');
  if (s && text) { s.value = text; s.dispatchEvent(new Event('input')); s.focus(); }
};

/* initial view — the hub (or Fleet if opened via a shared squad link) */
const initialHash = location.hash.slice(1);
show((location.hash || '').startsWith('#squad=') ? 'fleet' : (initialHash || 'home'));
