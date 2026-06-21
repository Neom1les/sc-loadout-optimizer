/* ============================================================
   SC Optimizer — tab router
   Switches the three top-level tabs and lazy-inits the new modules.
   ============================================================ */
import { initEarnings } from './earnings-finder.js';
import { initPatchHub, showGuide } from './patch-hub.js';

const TABS = ['optimizer', 'earnings', 'patch'];
const inited = {};

function panelId(tab) { return 'tab' + tab.charAt(0).toUpperCase() + tab.slice(1); }

function show(tab) {
  if (!TABS.includes(tab)) tab = 'optimizer';
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const panel = document.getElementById(panelId(tab));
  if (panel) panel.classList.add('active');
  document.body.classList.remove('tab-optimizer', 'tab-earnings', 'tab-patch');
  document.body.classList.add('tab-' + tab);
  if (location.hash.slice(1) !== tab) history.replaceState(null, '', '#' + tab);

  if (tab === 'earnings' && !inited.earnings) { inited.earnings = true; initEarnings(document.getElementById('earningsRoot')); }
  if (tab === 'patch' && !inited.patch) { inited.patch = true; initPatchHub(document.getElementById('patchRoot')); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.getElementById('tabBar').addEventListener('click', e => {
  const b = e.target.closest('.tab-btn');
  if (b) show(b.dataset.tab);
});

/* cross-tab helpers used by the Earnings Finder */
window.scOpenTab = show;
window.scOpenGuide = (guideId) => {
  if (!inited.patch) { inited.patch = true; initPatchHub(document.getElementById('patchRoot')); }
  show('patch');
  // defer so the hub has rendered before opening the guide
  setTimeout(() => showGuide(guideId), 60);
};
window.scPrefillShipSearch = (text) => {
  show('optimizer');
  const s = document.getElementById('shipSearch');
  if (s && text) { s.value = text; s.dispatchEvent(new Event('input')); s.focus(); }
};

/* initial tab from hash */
show(location.hash.slice(1) || 'optimizer');
