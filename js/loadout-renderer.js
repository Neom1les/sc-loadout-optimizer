import { formatPrice, formatShopShort, isPurchasable, getShopInfo } from './shop-finder.js';
import { calculateLoadoutStats, formatNumber, formatSpeed } from './stats-calculator.js';

let slotChangeCallback = null;

export function setSlotChangeCallback(cb) { slotChangeCallback = cb; }

// ---- FEATURE 1: Location proximity regions ----
const LOCATION_REGIONS = {
    'microTech':  ['New Babbage', 'Port Tressler', 'MIC-L2', 'MIC-L3'],
    'ArcCorp':    ['Area18', 'Baijini Point', 'ARC-L1', 'ARC-L2', 'ARC-L3', 'ARC-L5'],
    'Hurston':    ['Lorville', 'Everus Harbor', 'HUR-L2', 'HUR-L3', 'HUR-L4', 'HUR-L5'],
    'Crusader':   ['Orison', 'Seraphim Station', 'CRU-L1', 'CRU-L4', 'CRU-L5'],
    'Yela':       ['Grim HEX'],
    'Nyx':        ['Levski', 'Nyx Gateway', 'Pyro Gateway (Nyx)', 'Stanton Gateway (Nyx)'],
    'Pyro':       ['Patch City', 'Pyro Gateway (Stanton)', 'Stanton Gateway (Pyro)', 'Nyx Gateway (Stanton)'],
};

const ALL_LOCATIONS = [
    'New Babbage (microTech)', 'Area18 (ArcCorp)', 'Lorville (Hurston)', 'Orison (Crusader)',
    'Grim HEX (Yela)', 'Levski (Nyx)',
    'Port Tressler (microTech)', 'Everus Harbor (Hurston)', 'Baijini Point (ArcCorp)', 'Seraphim Station (Crusader)',
    'ARC-L1', 'ARC-L2', 'ARC-L3', 'ARC-L5',
    'CRU-L1', 'CRU-L4', 'CRU-L5',
    'HUR-L2', 'HUR-L3', 'HUR-L4', 'HUR-L5',
    'MIC-L2', 'MIC-L3',
    'Patch City (Pyro)',
    'Pyro Gateway (Stanton)', 'Stanton Gateway (Pyro)',
    'Pyro Gateway (Nyx)', 'Stanton Gateway (Nyx)',
    'Nyx Gateway',
];

function getPlayerRegion() {
    const loc = localStorage.getItem('sc-loadout-player-location') || '';
    if (!loc) return null;
    // Extract the short name before the parenthetical region tag
    const shortName = loc.replace(/\s*\(.*\)$/, '');
    for (const [region, members] of Object.entries(LOCATION_REGIONS)) {
        if (members.some(m => shortName === m || loc.includes(m))) return region;
    }
    return null;
}

function getLocationRegion(locationStr) {
    if (!locationStr) return null;
    for (const [region, members] of Object.entries(LOCATION_REGIONS)) {
        if (members.some(m => locationStr.includes(m))) return region;
    }
    return null;
}

// ---- FEATURE 2: Shopping checklist state ----
const CHECKED_KEY = 'sc-loadout-shopping-checked';

function getCheckedItems() {
    try { return JSON.parse(localStorage.getItem(CHECKED_KEY) || '{}'); }
    catch { return {}; }
}

function setCheckedItem(itemKey, checked) {
    const state = getCheckedItems();
    if (checked) state[itemKey] = true;
    else delete state[itemKey];
    localStorage.setItem(CHECKED_KEY, JSON.stringify(state));
}

export function clearShoppingChecks() {
    localStorage.removeItem(CHECKED_KEY);
}

export function renderLoadout(ship, loadout, containers) {
    renderSlots('weapons', loadout.weapons, containers.weapons, formatWeaponStats, null, null, null, loadout.turretWeapons);
    renderSlots('shields', loadout.shields, containers.components, formatShieldStats,
        loadout.powerplants, loadout.coolers, loadout.quantumDrive);
    renderStats(ship, loadout, containers.stats);
    renderShoppingList(loadout, containers.shopping);
}

function renderTurretWeapons(turretSlots) {
    if (!turretSlots?.length) return '';

    let totalDps = 0;
    for (const ts of turretSlots) {
        totalDps += ts.selected?.damage?.burst_dps || 0;
    }

    let html = `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,184,48,0.2);">
        <div style="font-family:var(--font-heading);font-size:0.75rem;letter-spacing:0.15em;color:var(--sc-amber);margin-bottom:8px;">
            TURRET WEAPONS (crew-operated) — ${formatNumber(totalDps)} DPS total
        </div>`;

    for (let i = 0; i < turretSlots.length; i++) {
        const ts = turretSlots[i];
        html += renderSingleSlot('turrets', i, ts, formatWeaponStats,
            'border:1px solid rgba(255,184,48,0.15);background:rgba(255,184,48,0.03);');
    }

    html += '</div>';
    return html;
}

function slotLabel(hp) {
    if (!hp) return 'Slot';
    return hp.replace('hardpoint_gun_', '').replace('hardpoint_', '').replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function formatWeaponStats(w) {
    if (!w) return '';
    const dps = w.damage?.burst_dps || 0;
    const alpha = w.damage?.alpha_total || 0;
    const pen = w.projectile?.penetration?.base_distance || 0;
    const spd = w.projectile?.speed || 0;
    const rng = w.projectile?.range || 0;
    const type = w.weapon_type || '';
    const dmgType = getDmgType(w);
    const badge = dmgType === 'physical' ? 'badge-ballistic' : dmgType === 'distortion' ? 'badge-distortion' : 'badge-energy';
    return `<span class="badge ${badge}">${dmgType}</span> ${type}
        <span class="stat-value" style="margin-left:12px;">DPS ${formatNumber(dps)}</span>
        <span style="margin-left:8px;">Alpha ${formatNumber(alpha)}</span>
        <span style="margin-left:8px;">Pen ${formatNumber(pen)}</span>
        <span style="margin-left:8px;color:var(--text-dim);">Speed ${formatNumber(spd)} | Range ${formatNumber(rng)}m</span>`;
}

function formatShieldStats(s) {
    if (!s) return '';
    const grade = s.grade || '?';
    const cls = s.item_class || s.class || '';
    return `Grade ${grade} ${cls}`;
}

function formatPPStats(p) {
    if (!p) return '';
    return `Grade ${p.grade || '?'} — ${formatNumber(p.power?.draw_max)} pwr`;
}

function formatCoolerStats(c) {
    if (!c) return '';
    return `Grade ${c.grade || '?'} — ${formatNumber(c.power?.coolant_max)} cool`;
}

function formatQDStats(q) {
    if (!q) return '';
    const speed = q.quantum_drive_data?.standard_jump?.drive_speed;
    return speed ? formatSpeed(speed) : `Grade ${q.grade || '?'}`;
}

function renderSlots(category, slots, container, statsFn, ppSlots, coolerSlots, qdSlot, turretWeapons) {
    let html = '';

    if (category === 'shields' && ppSlots) {
        html += renderSlotGroup('Shields', 'shields', slots, formatShieldStats);
        html += renderSlotGroup('Power Plants', 'powerplants', ppSlots, formatPPStats);
        html += renderSlotGroup('Coolers', 'coolers', coolerSlots, formatCoolerStats);
        if (qdSlot && qdSlot.selected) html += renderSlotGroup('Quantum Drive', 'quantumDrive', [qdSlot], formatQDStats);
        if (!html) {
            html = `<div class="empty-state" style="font-size:0.82rem;color:var(--text-secondary);text-align:left;padding:6px 2px;">
                No individually-swappable shield / power / cooler slots are exposed for this ship in the game data — common for capital &amp; sub-capital ships, whose components are fixed or crew-managed. Weapon &amp; turret loadout above still applies.</div>`;
        }
    } else {
        for (let i = 0; i < slots.length; i++) {
            html += renderSingleSlot(category, i, slots[i], statsFn);
        }
    }

    if (!slots.length && category === 'weapons') {
        html = '<div class="empty-state"><p>No weapon hardpoints</p></div>';
    }

    if (turretWeapons?.length) {
        html += renderTurretWeapons(turretWeapons);
    }

    container.innerHTML = html;
    bindDropdowns(container);
}

function renderSlotGroup(label, category, slots, statsFn) {
    if (!slots || !slots.length) return '';   // skip empty groups (e.g. capital ships expose no swappable component slots)
    let html = `<div style="margin-bottom:16px;">
        <div style="font-family:var(--font-heading);font-size:0.7rem;letter-spacing:0.15em;color:var(--text-dim);margin-bottom:6px;">${label.toUpperCase()}</div>`;
    for (let i = 0; i < slots.length; i++) {
        html += renderSingleSlot(category, i, slots[i], statsFn);
    }
    html += '</div>';
    return html;
}

function renderSingleSlot(category, index, slotData, statsFn, extraStyle) {
    const { slot, selected, bestPurchasable, allCandidates, shop } = slotData;
    const size = slot.hardpointSize || slot.weaponSize || slot.size || '?';
    const label = slotLabel(slot.hardpoint);

    const selectedUuid = selected?.uuid || selected?.name || '';
    let optionsHtml = '';
    for (const c of allCandidates || []) {
        const name = c.item.name;
        const uuid = c.item.uuid || c.item.name;
        const sel = uuid === selectedUuid ? ' selected' : '';
        const shopTag = c.purchasable ? '' : ' (no shop)';
        const scoreTag = c.score > 0 ? ` [${c.score.toFixed(1)}]` : '';
        optionsHtml += `<option value="${uuid}"${sel}${!c.purchasable ? ' style="color:#666"' : ''}>${name}${shopTag}${scoreTag}</option>`;
    }
    if (!optionsHtml) optionsHtml = '<option value="">— none available —</option>';

    const selPurchasable = selected ? isPurchasable(selected) : false;
    const selShop = selPurchasable ? getShopInfo(selected) : null;

    let shopHtml;
    if (selPurchasable && selShop) {
        shopHtml = `<span style="color:var(--status-ok);font-weight:bold;">BUY</span> ${formatShopShort(selShop)} — ${formatPrice(selShop.price)}`;
    } else if (selected) {
        const altName = bestPurchasable?.name || '';
        shopHtml = `<span style="color:var(--status-crit);font-weight:bold;">NOT IN SHOPS</span>`;
        if (altName) {
            const altShop = getShopInfo(bestPurchasable);
            shopHtml += `<span style="margin-left:10px;font-size:0.8rem;color:var(--sc-amber);">Switch to <strong>${altName}</strong> in dropdown to buy`;
            if (altShop) shopHtml += ` (${formatShopShort(altShop)}, ${formatPrice(altShop.price)})`;
            shopHtml += `</span>`;
        }
    } else {
        shopHtml = '';
    }

    const statsHtml = statsFn(selected);

    const defaultStyle = 'background:var(--bg-surface);border:1px solid var(--border-panel);';
    return `<div class="slot-block" style="margin-bottom:8px;padding:10px 14px;${extraStyle || defaultStyle}">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:6px;">
            <span style="font-family:var(--font-heading);font-size:0.75rem;letter-spacing:0.1em;color:var(--text-dim);min-width:80px;">${label}</span>
            <span class="stat-value" style="font-size:0.8rem;">S${size}</span>
            <select class="slot-dropdown" data-category="${category}" data-index="${index}" style="flex:1;">
                ${optionsHtml}
            </select>
        </div>
        <div style="font-size:0.8rem;margin-bottom:4px;">${statsHtml}</div>
        <div style="font-size:0.8rem;">${shopHtml}</div>
    </div>`;
}

function bindDropdowns(container) {
    container.querySelectorAll('.slot-dropdown').forEach(sel => {
        sel.addEventListener('change', () => {
            if (slotChangeCallback) {
                slotChangeCallback(sel.dataset.category, parseInt(sel.dataset.index), sel.value);
            }
        });
    });
}

function renderStats(ship, loadout, container) {
    const stats = calculateLoadoutStats(ship, loadout);
    const powerClass = stats.powerPercent > 100 ? 'crit' : stats.powerPercent > 85 ? 'warn' : 'ok';

    let issuesHtml = '';
    for (const issue of stats.issues) {
        const cls = issue.severity === 'critical' ? 'badge-crit' : 'badge-warn';
        issuesHtml += `<div style="margin-top:8px;"><span class="badge ${cls}">${issue.type}</span> ${issue.message}</div>`;
    }

    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-row"><span class="stat-label">Burst DPS</span><span class="stat-value dps-number">${formatNumber(stats.totalBurstDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Sustained DPS</span><span class="stat-value">${formatNumber(stats.totalSustainedDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Total Alpha</span><span class="stat-value">${formatNumber(stats.totalAlpha)}</span></div>
            ${stats.turretBurstDps > 0 ? `<div class="stat-row"><span class="stat-label">Turret DPS <span style="color:var(--sc-amber);font-size:0.85em;">(crewed)</span></span><span class="stat-value dps-number">${formatNumber(stats.turretBurstDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Turret Alpha</span><span class="stat-value">${formatNumber(stats.turretAlpha)}</span></div>` : ''}
            <div class="stat-row"><span class="stat-label">Shield HP</span><span class="stat-value">${formatNumber(stats.shieldHp)}</span></div>
            <div class="stat-row"><span class="stat-label">Shield Regen</span><span class="stat-value">${formatNumber(stats.shieldRegen)}/s</span></div>
            <div class="stat-row"><span class="stat-label">Hull HP</span><span class="stat-value">${formatNumber(stats.hullHp)}</span></div>
            <div class="stat-row"><span class="stat-label">Armor HP</span><span class="stat-value">${formatNumber(stats.armorHp)}</span></div>
            <div class="stat-row"><span class="stat-label">SCM Speed</span><span class="stat-value">${stats.scmSpeed} m/s</span></div>
            <div class="stat-row"><span class="stat-label">Missiles</span><span class="stat-value">${stats.missileCount}x (${formatNumber(stats.totalMissileDamage)} dmg)</span></div>
            <div class="stat-row"><span class="stat-label">EM Idle</span><span class="stat-value">${formatNumber(stats.emIdle)}</span></div>
        </div>
        <div style="margin-top:12px;">
            <div class="stat-row">
                <span class="stat-label">Power Budget</span>
                <span class="stat-value">${stats.powerUsed.toFixed(1)} / ${stats.powerSegments}</span>
            </div>
            <div class="power-bar"><div class="power-bar-fill ${powerClass}" style="width:${Math.min(stats.powerPercent, 100)}%"></div></div>
        </div>
        ${issuesHtml}`;
}

function renderShoppingList(loadout, container) {
    const locationGroups = {};
    const unavailable = [];

    function addItem(slotResult) {
        const item = slotResult.selected;
        if (!item) return;
        const shop = isPurchasable(item) ? getShopInfo(item) : null;
        if (!shop) {
            unavailable.push(item.name);
            return;
        }
        const locKey = shop.location || shop.terminal || 'Unknown';
        if (!locationGroups[locKey]) locationGroups[locKey] = { terminal: shop.terminal, location: shop.location, items: [] };
        const existing = locationGroups[locKey].items.find(i => i.name === item.name);
        if (existing) { existing.qty++; }
        else { locationGroups[locKey].items.push({ name: item.name, price: shop.price, qty: 1 }); }
    }

    loadout.weapons.forEach(addItem);
    loadout.shields.forEach(addItem);
    loadout.powerplants.forEach(addItem);
    loadout.coolers.forEach(addItem);
    if (loadout.quantumDrive) addItem(loadout.quantumDrive);

    // ---- Location Dropdown (Feature 1) ----
    const savedLoc = localStorage.getItem('sc-loadout-player-location') || '';
    let html = `<div style="margin-bottom:14px;display:flex;align-items:center;gap:10px;">
        <span style="font-family:var(--font-heading);font-size:0.8rem;letter-spacing:0.08em;color:var(--sc-teal);">CURRENT LOCATION</span>
        <select id="playerLocationSelect" style="flex:1;max-width:320px;background:var(--bg-input);color:var(--text-primary);border:1px solid var(--border-active);padding:6px 10px;font-family:var(--font-mono);font-size:0.8rem;outline:none;">
            <option value="">-- not set --</option>
            ${ALL_LOCATIONS.map(loc => `<option value="${loc}"${loc === savedLoc ? ' selected' : ''}>${loc}</option>`).join('')}
        </select>
    </div>`;

    const playerRegion = getPlayerRegion();

    // ---- Checklist state (Feature 2) ----
    const checkedItems = getCheckedItems();
    let totalItemCount = 0;
    let checkedCount = 0;

    // Collect all items for counting
    const allShopItems = [];
    for (const group of Object.values(locationGroups)) {
        for (const item of group.items) {
            totalItemCount++;
            const itemKey = item.name;
            if (checkedItems[itemKey]) checkedCount++;
            allShopItems.push(item);
        }
    }

    // Progress counter + clear button
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
        <span style="font-family:var(--font-heading);font-size:0.8rem;letter-spacing:0.08em;color:var(--text-secondary);">
            <span id="shoppingCheckedCount">${checkedCount}</span>/${totalItemCount} items purchased
        </span>
        <button id="btnClearChecks" style="background:transparent;border:1px solid var(--border-panel);color:var(--text-dim);font-family:var(--font-mono);font-size:0.7rem;padding:4px 10px;cursor:pointer;letter-spacing:0.05em;">CLEAR ALL</button>
    </div>`;

    let grandTotal = 0;

    if (unavailable.length) {
        html += `<div style="margin-bottom:12px;padding:8px 12px;background:rgba(255,184,48,0.06);border:1px solid rgba(255,184,48,0.15);font-size:0.8rem;">
            <span class="badge badge-warn">NOTE</span> ${unavailable.length} item(s) have no shop data: ${unavailable.join(', ')}
        </div>`;
    }

    // Sort location groups: nearby first (Feature 1), then alphabetical
    const sortedEntries = Object.entries(locationGroups).sort((a, b) => {
        if (playerRegion) {
            const aRegion = getLocationRegion(a[1].location || a[1].terminal || a[0]);
            const bRegion = getLocationRegion(b[1].location || b[1].terminal || b[0]);
            const aNear = aRegion === playerRegion;
            const bNear = bRegion === playerRegion;
            if (aNear && !bNear) return -1;
            if (!aNear && bNear) return 1;
        }
        return a[0].localeCompare(b[0]);
    });

    for (const [loc, group] of sortedEntries) {
        let subtotal = 0;
        const locRegion = getLocationRegion(group.location || group.terminal || loc);
        const isNearby = playerRegion && locRegion === playerRegion;

        html += `<div style="margin-bottom:12px;padding:10px 14px;background:var(--bg-surface);border:1px solid ${isNearby ? 'rgba(45,255,110,0.25)' : 'var(--border-panel)'};">
            <div style="font-family:var(--font-heading);font-size:0.8rem;color:var(--sc-teal);letter-spacing:0.1em;margin-bottom:8px;display:flex;align-items:center;gap:8px;">
                <span>${group.terminal}${group.location ? ` — ${group.location}` : ''}</span>
                ${isNearby ? '<span style="font-size:0.65rem;padding:2px 6px;background:rgba(45,255,110,0.12);color:var(--status-ok);border:1px solid rgba(45,255,110,0.3);letter-spacing:0.1em;">NEARBY</span>' : ''}
            </div>`;
        for (const item of group.items) {
            const lineTotal = (item.price || 0) * item.qty;
            subtotal += lineTotal;
            const itemKey = item.name;
            const isChecked = !!checkedItems[itemKey];
            const checkedStyle = isChecked ? 'text-decoration:line-through;opacity:0.5;' : '';

            html += `<div class="shopping-item-row" style="display:flex;align-items:center;gap:8px;font-size:0.85rem;padding:3px 0;${checkedStyle}" data-item-key="${itemKey}">
                <input type="checkbox" class="shopping-check" data-item-key="${itemKey}" data-line-total="${lineTotal}" ${isChecked ? 'checked' : ''}
                    style="accent-color:var(--status-ok);cursor:pointer;width:14px;height:14px;flex-shrink:0;">
                <span style="flex:1;">${item.name}${item.qty > 1 ? ` x${item.qty}` : ''}</span>
                <span class="stat-value">${formatPrice(lineTotal)}</span>
            </div>`;
        }
        grandTotal += subtotal;
        html += `<div style="display:flex;justify-content:space-between;margin-top:6px;padding-top:6px;border-top:1px solid var(--border-panel);font-size:0.8rem;color:var(--text-secondary);">
                <span>Subtotal</span><span>${formatPrice(subtotal)}</span>
            </div>
        </div>`;
    }

    const locationCount = Object.keys(locationGroups).length;

    // Sum already-purchased (checked) items so they leave the open total
    let spentTotal = 0;
    for (const item of allShopItems) {
        if (checkedItems[item.name]) spentTotal += (item.price || 0) * item.qty;
    }
    const remainingTotal = grandTotal - spentTotal;

    html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;font-size:0.9rem;color:var(--status-ok);">
        <span style="font-family:var(--font-heading);letter-spacing:0.1em;">SPENT</span>
        <span class="stat-value" id="shoppingSpent">${formatPrice(spentTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;font-size:1rem;border-top:1px solid var(--border-panel);">
        <span style="font-family:var(--font-heading);letter-spacing:0.1em;">TOTAL REMAINING</span>
        <span class="stat-value dps-number" id="shoppingRemaining">${formatPrice(remainingTotal)}</span>
    </div>
    <div style="font-size:0.75rem;color:var(--text-dim);">Full loadout: ${formatPrice(grandTotal)} • ${locationCount} location(s) to visit</div>`;

    container.innerHTML = html;

    // ---- Bind location dropdown ----
    const locSelect = container.querySelector('#playerLocationSelect');
    if (locSelect) {
        locSelect.addEventListener('change', () => {
            localStorage.setItem('sc-loadout-player-location', locSelect.value);
            // Re-render to apply new sort
            renderShoppingList(loadout, container);
        });
    }

    // Recompute purchased count, spent and remaining total from the live checkboxes
    function updateShoppingProgress() {
        const checked = getCheckedItems();
        let cnt = 0;
        let spent = 0;
        container.querySelectorAll('.shopping-check').forEach(c => {
            if (checked[c.dataset.itemKey]) {
                cnt++;
                spent += parseFloat(c.dataset.lineTotal) || 0;
            }
        });
        const cntEl = container.querySelector('#shoppingCheckedCount');
        if (cntEl) cntEl.textContent = cnt;
        const spentEl = container.querySelector('#shoppingSpent');
        if (spentEl) spentEl.textContent = formatPrice(spent);
        const remEl = container.querySelector('#shoppingRemaining');
        if (remEl) remEl.textContent = formatPrice(grandTotal - spent);
    }

    // ---- Bind checkboxes (Feature 2) ----
    container.querySelectorAll('.shopping-check').forEach(cb => {
        cb.addEventListener('change', () => {
            const key = cb.dataset.itemKey;
            setCheckedItem(key, cb.checked);
            // Update row styling
            const row = cb.closest('.shopping-item-row');
            if (row) {
                row.style.textDecoration = cb.checked ? 'line-through' : 'none';
                row.style.opacity = cb.checked ? '0.5' : '1';
            }
            // Update counter, spent and remaining total
            updateShoppingProgress();
        });
    });

    // ---- Bind clear-all button ----
    const clearBtn = container.querySelector('#btnClearChecks');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearShoppingChecks();
            renderShoppingList(loadout, container);
        });
    }
}

function getDmgType(weapon) {
    const dmg = weapon.damage?.alpha || {};
    if ((dmg.physical || 0) > 0) return 'physical';
    if ((dmg.distortion || 0) > 0) return 'distortion';
    return 'energy';
}
