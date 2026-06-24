import { getPatchInfo, getShip, loadShipIndex } from './data-loader.js';
import { initShipSelector, renderShipPreview } from './ship-selector.js';
import { optimizeLoadout, getProfile } from './optimizer.js';
import { renderLoadout, setSlotChangeCallback, clearShoppingChecks } from './loadout-renderer.js';
import { getSavedLoadouts, saveLoadout, deleteLoadout } from './storage.js';
import { calculateMatchup, renderMatchup } from './matchup.js';
import { applyBudgetMode } from './budget.js';

let currentShip = null;
let currentLoadout = null;
let targetShipIndex = [];
let activeTargetUuid = null;

async function init() {
    const ls = document.getElementById('loadingScreen');
    const setStatus = (msg) => { ls.querySelector('.loading-text').textContent = msg; };

    try {
        setStatus('LOADING PATCH INFO...');
        const patchInfo = await getPatchInfo();
        document.getElementById('patchInfo').textContent =
            `PATCH ${patchInfo.patch_version || patchInfo.patch || '4.8.0-LIVE'} // DATA: ${patchInfo.data_collection_date || 'LIVE'}`;

        setStatus('LOADING SHIP DATABASE...');
        await initShipSelector('shipList', 'shipSearch', onShipSelected);

        setStatus('CONFIGURING UI...');
        document.getElementById('btnOptimize').addEventListener('click', onOptimize);
        document.getElementById('btnSaveLoadout').addEventListener('click', onSave);

        renderSavedLoadouts();

        setStatus('LOADING TARGET DATABASE...');
        await initTargetSelector();
        setSlotChangeCallback(onSlotChanged);

        ls.classList.add('hidden');
        document.getElementById('appContainer').style.display = '';
    } catch (err) {
        console.error('Init failed at step:', err);
        ls.innerHTML = `
            <div class="loading-text" style="color:var(--status-crit)">INITIALIZATION FAILED</div>
            <div style="color:var(--text-secondary);margin-top:12px;font-size:0.85rem;">${err.message}</div>
            <div style="color:var(--text-dim);margin-top:8px;font-size:0.75rem;">${err.stack || ''}</div>`;
    }
}

async function initTargetSelector() {
    targetShipIndex = await loadShipIndex();

    const searchInput = document.getElementById('targetSearch');
    const container = document.getElementById('targetList');

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = q
            ? targetShipIndex.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.manufacturer.toLowerCase().includes(q) ||
                s.role.toLowerCase().includes(q))
            : targetShipIndex;
        renderTargetList(container, filtered);
    });
}

function renderTargetList(container, ships) {
    if (!currentLoadout) {
        container.innerHTML = '<div class="empty-state"><p>Optimize loadout first</p></div>';
        return;
    }

    const grouped = {};
    for (const s of ships) {
        const mfr = s.manufacturer;
        if (!grouped[mfr]) grouped[mfr] = [];
        grouped[mfr].push(s);
    }

    let html = '';
    for (const [mfr, list] of Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))) {
        html += `<div class="ship-group-label">${mfr}</div>`;
        for (const s of list) {
            const active = s.uuid === activeTargetUuid ? ' active' : '';
            const isSelf = currentShip && s.uuid === currentShip.uuid;
            html += `<div class="ship-item${active}" data-uuid="${s.uuid}" ${isSelf ? 'style="opacity:0.5"' : ''}>
                <span>${s.name}</span>
                <span class="ship-role">${s.role}</span>
            </div>`;
        }
    }

    if (!ships.length) html = '<div class="empty-state"><p>No ships found</p></div>';
    container.innerHTML = html;

    container.querySelectorAll('.ship-item').forEach(el => {
        el.addEventListener('click', async () => {
            activeTargetUuid = el.dataset.uuid;
            container.querySelectorAll('.ship-item').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            await onTargetSelected(activeTargetUuid);
        });
    });
}

async function onTargetSelected(uuid) {
    if (!currentShip || !currentLoadout) return;
    const targetShip = await getShip(uuid);
    if (!targetShip) return;

    const matchup = calculateMatchup(currentShip, currentLoadout, targetShip);
    renderMatchup(matchup, document.getElementById('matchupResult'));
}

async function onShipSelected(uuid) {
    currentShip = await getShip(uuid);
    renderShipPreview(document.getElementById('shipPreview'), currentShip);
    document.getElementById('btnOptimize').disabled = false;
    document.getElementById('resultsSection').style.display = 'none';
    currentLoadout = null;
    activeTargetUuid = null;
    document.getElementById('btnSaveLoadout').disabled = true;
    document.getElementById('matchupResult').innerHTML =
        '<div class="empty-state"><h3>Select a target</h3><p>Choose an enemy ship to see damage calculations, TTK, and armor effectiveness.</p></div>';
    renderTargetList(document.getElementById('targetList'), targetShipIndex);
}

async function onOptimize() {
    if (!currentShip) return;

    const pvE = document.getElementById('cbPvE').checked;
    const pvP = document.getElementById('cbPvP').checked;
    if (!pvE && !pvP) {
        document.getElementById('cbPvE').checked = true;
    }

    const profile = getProfile(
        document.getElementById('cbPvE').checked,
        document.getElementById('cbPvP').checked
    );

    const btn = document.getElementById('btnOptimize');
    btn.textContent = '>>> CALCULATING... <<<';
    btn.disabled = true;

    try {
        clearShoppingChecks();
        currentLoadout = await optimizeLoadout(currentShip, profile);

        const budgetEl = document.getElementById('budgetSummary');
        if (document.getElementById('cbBudget')?.checked) {
            const r = applyBudgetMode(currentLoadout);
            budgetEl.innerHTML = `<div class="budget-banner"><span class="bb-ico">💰</span> Budget build — ${r.picked} purchasable component${r.picked === 1 ? '' : 's'} for <b>${r.cost.toLocaleString('en-US')} aUEC</b>, chosen for best performance-per-credit. Untick Budget build for the meta loadout.</div>`;
            budgetEl.style.display = '';
        } else if (budgetEl) {
            budgetEl.innerHTML = '';
            budgetEl.style.display = 'none';
        }

        document.getElementById('resultsSection').style.display = '';

        renderLoadout(currentShip, currentLoadout, {
            weapons: document.getElementById('weaponsResult'),
            components: document.getElementById('componentsResult'),
            stats: document.getElementById('statsResult'),
            shopping: document.getElementById('shoppingResult')
        });

        document.getElementById('btnSaveLoadout').disabled = false;

        renderTargetList(document.getElementById('targetList'), targetShipIndex);

        if (activeTargetUuid) {
            await onTargetSelected(activeTargetUuid);
        }

        document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
        console.error('Optimization error:', err);
        document.getElementById('resultsSection').style.display = '';
        document.getElementById('weaponsResult').innerHTML =
            `<div class="empty-state" style="color:var(--status-crit)"><p>Error: ${err.message}</p></div>`;
    } finally {
        btn.textContent = '>>> Optimize Loadout <<<';
        btn.disabled = false;
    }
}

function onSlotChanged(category, index, selectedUuid) {
    if (!currentLoadout) return;

    let slotArray;
    if (category === 'weapons') slotArray = currentLoadout.weapons;
    else if (category === 'shields') slotArray = currentLoadout.shields;
    else if (category === 'powerplants') slotArray = currentLoadout.powerplants;
    else if (category === 'coolers') slotArray = currentLoadout.coolers;
    else if (category === 'quantumDrive') slotArray = [currentLoadout.quantumDrive];
    else if (category === 'turrets') slotArray = currentLoadout.turretWeapons;
    else return;

    const slotData = slotArray[index];
    if (!slotData) return;

    const candidate = slotData.allCandidates.find(c =>
        (c.item.uuid || c.item.name) === selectedUuid);
    if (candidate) {
        slotData.selected = candidate.item;
        slotData.shop = candidate.shop;
    }

    reRenderResults();
}

function reRenderResults() {
    renderLoadout(currentShip, currentLoadout, {
        weapons: document.getElementById('weaponsResult'),
        components: document.getElementById('componentsResult'),
        stats: document.getElementById('statsResult'),
        shopping: document.getElementById('shoppingResult')
    });

    if (activeTargetUuid) {
        onTargetSelected(activeTargetUuid);
    }
}

function onSave() {
    if (!currentShip || !currentLoadout) return;

    const pvE = document.getElementById('cbPvE').checked;
    const pvP = document.getElementById('cbPvP').checked;
    const profileLabel = pvE && pvP ? 'Balanced' : pvP ? 'PvP' : 'PvE';
    const defaultName = `${currentShip.name} ${profileLabel}`;
    const name = prompt('Loadout name:', defaultName);
    if (!name) return;

    const slimLoadout = {
        weapons: currentLoadout.weapons.map(w => ({ name: w.selected?.name, size: w.selected?.size })),
        shields: currentLoadout.shields.map(s => ({ name: s.selected?.name })),
        profile: currentLoadout.profile
    };

    saveLoadout(name, currentShip.uuid, currentShip.name, profileLabel, slimLoadout);
    renderSavedLoadouts();
}

function renderSavedLoadouts() {
    const container = document.getElementById('savedLoadouts');
    const saved = getSavedLoadouts();

    let html = '';
    for (const s of saved) {
        html += `<div class="saved-loadout-chip" data-id="${s.id}" title="${s.shipName} — ${s.profile}">
            ${s.name}
            <span class="delete-btn" data-delete="${s.id}">&times;</span>
        </div>`;
    }
    html += '<div class="add-loadout-chip" id="btnNewLoadout">+ New Loadout</div>';

    container.innerHTML = html;

    container.querySelectorAll('.saved-loadout-chip').forEach(el => {
        el.addEventListener('click', async (e) => {
            if (e.target.classList.contains('delete-btn')) {
                const id = e.target.dataset.delete;
                if (confirm('Delete this loadout?')) {
                    deleteLoadout(id);
                    renderSavedLoadouts();
                }
                return;
            }
            const saved = getSavedLoadouts().find(s => s.id === el.dataset.id);
            if (saved) {
                await onShipSelected(saved.shipUuid);
                const listItems = document.querySelectorAll('.ship-item');
                listItems.forEach(li => {
                    li.classList.toggle('active', li.dataset.uuid === saved.shipUuid);
                });
            }
        });
    });

    const newBtn = document.getElementById('btnNewLoadout');
    if (newBtn) newBtn.addEventListener('click', onSave);
}

init();
