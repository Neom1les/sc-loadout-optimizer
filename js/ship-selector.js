import { loadShipIndex } from './data-loader.js';

let shipIndex = [];
let onSelectCallback = null;
let activeUuid = null;

export async function initShipSelector(containerId, searchId, onSelect) {
    onSelectCallback = onSelect;
    shipIndex = await loadShipIndex();
    const container = document.getElementById(containerId);
    const searchInput = document.getElementById(searchId);

    renderShipList(container, shipIndex);

    searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = q
            ? shipIndex.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.manufacturer.toLowerCase().includes(q) ||
                s.role.toLowerCase().includes(q))
            : shipIndex;
        renderShipList(container, filtered);
    });
}

function renderShipList(container, ships) {
    const grouped = {};
    for (const s of ships) {
        const mfr = s.manufacturer;
        if (!grouped[mfr]) grouped[mfr] = [];
        grouped[mfr].push(s);
    }

    let html = '';
    for (const [mfr, list] of Object.entries(grouped).sort((a, b) => a[0].localeCompare(b[0]))) {
        html += `<div class="ship-group-label">${mfr} (${list.length})</div>`;
        for (const s of list) {
            const active = s.uuid === activeUuid ? ' active' : '';
            html += `<div class="ship-item${active}" data-uuid="${s.uuid}">
                <span>${s.name}</span>
                <span class="ship-role">${s.role}</span>
            </div>`;
        }
    }

    if (!ships.length) {
        html = '<div class="empty-state"><p>No ships found</p></div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.ship-item').forEach(el => {
        el.addEventListener('click', () => {
            activeUuid = el.dataset.uuid;
            container.querySelectorAll('.ship-item').forEach(e => e.classList.remove('active'));
            el.classList.add('active');
            if (onSelectCallback) onSelectCallback(activeUuid);
        });
    });
}

export function renderShipPreview(container, ship) {
    if (!ship) {
        container.innerHTML = '<div class="empty-state"><h3>Select a ship</h3><p>Choose a combat ship from the list.</p></div>';
        return;
    }

    const imgUrl = ship.images?.[0]?.original_url || ship.images?.[0]?.thumbnail_url || null;
    const imgHtml = imgUrl
        ? `<img src="${imgUrl}" alt="${ship.name}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=ship-image-placeholder>NO IMAGE</div>'">`
        : '<div class="ship-image-placeholder">NO IMAGE AVAILABLE</div>';

    const armor = ship.armor?.damage_multipliers || {};
    const speed = ship.speed || {};
    const agility = ship.agility || {};
    const emission = ship.emission || {};
    const weaponry = ship.weaponry || {};

    container.innerHTML = `
        <div class="ship-preview">
            <div class="ship-image-container">${imgHtml}</div>
            <div>
                <h3 style="margin-bottom:4px;font-size:1.2rem;">${ship.name}</h3>
                <div style="color:var(--text-secondary);font-size:0.8rem;margin-bottom:12px;">
                    ${ship.manufacturer?.name || ''} &mdash; ${ship.role || 'Unknown'} &mdash; ${ship.size?.en_EN || ''}
                </div>
                <div class="ship-stats-grid">
                    <div class="stat-row"><span class="stat-label">Hull HP</span><span class="stat-value">${fmt(ship.hull_health)}</span></div>
                    <div class="stat-row"><span class="stat-label">Armor HP</span><span class="stat-value">${fmt(ship.armor?.armor_health)}</span></div>
                    <div class="stat-row"><span class="stat-label">Shield HP</span><span class="stat-value">${fmt(ship.shield?.shield_hp)}</span></div>
                    <div class="stat-row"><span class="stat-label">Shield Regen</span><span class="stat-value">${fmt(ship.shield?.details?.regeneration)}/s</span></div>
                    <div class="stat-row"><span class="stat-label">SCM Speed</span><span class="stat-value">${fmt(speed.scm)} m/s</span></div>
                    <div class="stat-row"><span class="stat-label">Max Speed</span><span class="stat-value">${fmt(speed.max)} m/s</span></div>
                    <div class="stat-row"><span class="stat-label">Pitch / Yaw</span><span class="stat-value">${fmt(agility.pitch)} / ${fmt(agility.yaw)} d/s</span></div>
                    <div class="stat-row"><span class="stat-label">Roll</span><span class="stat-value">${fmt(agility.roll)} d/s</span></div>
                    <div class="stat-row"><span class="stat-label">Phys Mult</span><span class="stat-value">${armor.physical ?? 'N/A'}x</span></div>
                    <div class="stat-row"><span class="stat-label">Energy Mult</span><span class="stat-value">${armor.energy ?? 'N/A'}x</span></div>
                    <div class="stat-row"><span class="stat-label">Pilot DPS</span><span class="stat-value dps-number">${fmt(weaponry.pilot_dps)}</span></div>
                    <div class="stat-row"><span class="stat-label">Pilot Alpha</span><span class="stat-value">${fmt(weaponry.pilot_alpha)}</span></div>
                    <div class="stat-row"><span class="stat-label">EM Idle</span><span class="stat-value">${fmt(emission.em_idle)}</span></div>
                    <div class="stat-row"><span class="stat-label">IR</span><span class="stat-value">${fmt(emission.ir)}</span></div>
                    <div class="stat-row"><span class="stat-label">Mass</span><span class="stat-value">${fmt(ship.mass?.total)} kg</span></div>
                    <div class="stat-row"><span class="stat-label">Crew</span><span class="stat-value">${ship.crew?.min || 1}-${ship.crew?.max || 1}</span></div>
                </div>
            </div>
        </div>`;
}

function fmt(v) {
    if (v === null || v === undefined) return 'N/A';
    if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
    return v;
}
