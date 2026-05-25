const STORAGE_KEY = 'sc-loadout-optimizer-saved';

export function getSavedLoadouts() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch { return []; }
}

export function saveLoadout(name, shipUuid, shipName, profile, loadout) {
    const saved = getSavedLoadouts();
    const entry = {
        id: Date.now().toString(36),
        name,
        shipUuid,
        shipName,
        profile,
        loadout,
        timestamp: new Date().toISOString()
    };
    saved.push(entry);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    return entry;
}

export function deleteLoadout(id) {
    const saved = getSavedLoadouts().filter(s => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export function getLoadoutById(id) {
    return getSavedLoadouts().find(s => s.id === id) || null;
}
