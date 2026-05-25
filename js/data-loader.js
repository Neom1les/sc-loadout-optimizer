const cache = {};

export async function loadJSON(filename) {
    if (cache[filename]) return cache[filename];
    const res = await fetch(`data/${filename}`);
    const json = await res.json();
    cache[filename] = json.data || json;
    return cache[filename];
}

export async function loadShipIndex() {
    const ships = await loadJSON('ships.json');

    const seen = new Set();
    return ships.filter(s => {
        if (!s.is_spaceship && !s.is_vehicle) return false;
        if (!s.name || seen.has(s.name)) return false;
        seen.add(s.name);
        const hasWeapons = s.weaponry && ((s.weaponry.pilot_dps || 0) > 0 || (s.weaponry.fixed_weapons?.weapons?.length > 0));
        const hasTurrets = (s.turrets?.manned?.length > 0) || (s.turrets?.remote?.length > 0);
        return hasWeapons || hasTurrets;
    }).map(s => ({
        uuid: s.uuid,
        name: s.name,
        manufacturer: s.manufacturer?.name || 'Unknown',
        manufacturerCode: s.manufacturer?.code || '?',
        role: s.role || 'Unknown',
        career: s.career || '',
        thumbnail: s.images?.[0]?.thumbnail_url || null,
        image: s.images?.[0]?.original_url || null,
        pilotDps: s.weaponry?.pilot_dps || 0,
        shieldHp: s.shield?.shield_hp || 0,
        hullHp: s.hull_health || 0
    })).sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.name.localeCompare(b.name));
}

export async function getShip(uuid) {
    const ships = await loadJSON('ships.json');
    return ships.find(s => s.uuid === uuid);
}

export async function getWeapons() { return loadJSON('weapons.json'); }
export async function getShields() { return loadJSON('shields.json'); }
export async function getPowerplants() { return loadJSON('powerplants.json'); }
export async function getCoolers() { return loadJSON('coolers.json'); }
export async function getQuantumDrives() { return loadJSON('quantum-drives.json'); }
export async function getMissiles() { return loadJSON('missiles.json'); }

export async function getPatchInfo() {
    try {
        return await loadJSON('patch-info.json');
    } catch { return { patch_version: '4.8.0-LIVE' }; }
}
