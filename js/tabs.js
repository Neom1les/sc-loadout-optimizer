/* ============================================================
   SC Optimizer — tab router + home hub
   Home is the default view: app-style tiles into each tool.
   ============================================================ */
import { initEarnings } from './earnings-finder.js';
import { initPatchHub, showGuide } from './patch-hub.js';
import { initTactics } from './tactics.js';
import { initFleet } from './fleet.js';

const TABS = ['home', 'optimizer', 'earnings', 'patch', 'tactics', 'fleet'];
const inited = {};

function panelId(tab) { return 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1); }

function renderHome() {
  const root = document.getElementById('homeRoot');
  if (!root) return;
  const tiles = [
    { tab: 'optimizer', ico: '⬡', img: 'assets/bg2.webp', title: 'Loadout Optimizer', desc: 'Optimize weapons, shields & components for any combat ship — with damage matchups, TTK and shopping lists.' },
    { tab: 'earnings', ico: '◎', img: 'assets/bg.jpg', title: 'Earnings Finder', desc: 'Find the fastest way to earn aUEC or grind a faction’s reputation — ranked by your goal, with full guides.' },
    { tab: 'patch', ico: '❖', img: 'assets/bg3.webp', title: 'Patch Hub', desc: 'What’s new each patch with step-by-step guides — plus the upcoming Alpha 4.9 roadmap.' },
    { tab: 'tactics', ico: '⊕', img: 'assets/bg2.webp', title: 'Tactics', desc: 'Counter-pick any enemy ship, read its armor weakness, and see which ships hard-counter it.' },
    { tab: 'fleet', ico: '⊟', img: 'assets/bg3.webp', title: 'Fleet Ops', desc: 'Build squad comps, track your org’s fleet & crews, and share standard loadout presets.' },
  ];
  root.innerHTML = `
    <div class="home-hero">
      <div class="hh-kicker">Star Citizen · Alpha 4.8.2-LIVE</div>
      <h1 class="hh-title">Command Deck</h1>
      <p class="hh-sub">Your toolkit for the ’verse — choose a station to begin.</p>
    </div>
    <div class="home-grid">
      ${tiles.map(t => `<button class="home-tile" data-go="${t.tab}">
        <span class="ht-img" style="background-image:url('${t.img}')"></span>
        <span class="ht-shade"></span>
        <span class="ht-body">
          <span class="ht-ico">${t.ico}</span>
          <span class="ht-title">${t.title}</span>
          <span class="ht-desc">${t.desc}</span>
          <span class="ht-cta">Open ▸</span>
        </span>
      </button>`).join('')}
    </div>`;
  root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => show(b.dataset.go));
}

function show(tab) {
  if (!TABS.includes(tab)) tab = 'home';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const panel = document.getElementById(panelId(tab));
  if (panel) panel.classList.add('active');
  document.body.classList.remove('tab-home', 'tab-optimizer', 'tab-earnings', 'tab-patch', 'tab-tactics', 'tab-fleet');
  document.body.classList.add('tab-' + tab);
  if (!(location.hash || '').startsWith('#squad=') && location.hash.slice(1) !== tab) {
    history.replaceState(null, '', '#' + tab);
  }

  if (tab === 'home' && !inited.home) { inited.home = true; renderHome(); }
  if (tab === 'earnings' && !inited.earnings) { inited.earnings = true; initEarnings(document.getElementById('earningsRoot')); }
  if (tab === 'patch' && !inited.patch) { inited.patch = true; initPatchHub(document.getElementById('patchRoot')); }
  if (tab === 'tactics' && !inited.tactics) { inited.tactics = true; initTactics(document.getElementById('tacticsRoot')); }
  if (tab === 'fleet' && !inited.fleet) { inited.fleet = true; initFleet(document.getElementById('fleetRoot')); }
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
