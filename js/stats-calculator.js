import { calcEffectiveDps } from './optimizer.js';

export function calculateLoadoutStats(ship, loadout) {
    const stats = {
        totalBurstDps: 0,
        totalSustainedDps: 0,
        totalAlpha: 0,
        turretBurstDps: 0,
        turretSustainedDps: 0,
        turretAlpha: 0,
        shieldHp: ship.shield?.shield_hp || 0,
        shieldRegen: ship.shield?.details?.regeneration || 0,
        hullHp: ship.hull_health || 0,
        armorHp: ship.armor?.armor_health || 0,
        armorPhysical: ship.armor?.damage_multipliers?.physical ?? 1,
        armorEnergy: ship.armor?.damage_multipliers?.energy ?? 1,
        scmSpeed: ship.speed?.scm || 0,
        maxSpeed: ship.speed?.max || 0,
        boostForward: ship.speed?.boost_forward || 0,
        zeroToScm: ship.speed?.zero_to_scm || 0,
        pitch: ship.agility?.pitch || 0,
        yaw: ship.agility?.yaw || 0,
        roll: ship.agility?.roll || 0,
        emIdle: ship.emission?.em_idle || 0,
        emMax: ship.emission?.em_max || 0,
        irSignature: ship.emission?.ir || 0,
        mass: ship.mass?.total || 0,
        quantumSpeed: ship.quantum?.quantum_speed || 0,
        quantumFuel: ship.quantum?.quantum_fuel_capacity || 0,
        powerSegments: ship.power?.generation_segments || 0,
        powerUsed: 0,
        coolingSegments: ship.cooling?.generation_segments || 0,
        coolingUsed: 0,
        totalMissileDamage: ship.weaponry?.total_missile_damage || 0,
        missileCount: 0,
        weaponDetails: [],
        issues: []
    };

    const shipCapPool = loadout.shipCapPool || 4;

    for (const wr of loadout.weapons) {
        const w = wr.selected;
        if (!w) continue;
        const dps = w.damage?.burst_dps || 0;
        const alpha = w.damage?.alpha_total || 0;

        // Compute real sustained DPS using the same algorithm as the optimizer
        const { sustained60 } = calcEffectiveDps(w, shipCapPool);

        stats.totalBurstDps += dps;
        stats.totalSustainedDps += sustained60;
        stats.totalAlpha += alpha;
        stats.powerUsed += w.power?.draw_max || 0;

        stats.weaponDetails.push({
            name: w.name,
            size: w.size,
            type: w.weapon_type,
            dps,
            sustainedDps: sustained60,
            alpha,
            penetration: w.projectile?.penetration?.base_distance || 0,
            range: w.projectile?.range || 0,
            speed: w.projectile?.speed || 0,
            damageType: getDamageType(w),
            ammo: w.ammo?.capacity || null
        });
    }

    // Turret / crew-operated weapons — tracked separately from pilot guns
    // (a solo pilot can't fire these, so they don't fold into the pilot DPS,
    // but a capital/multicrew ship is NOT "0 DPS" — surface the crewed total).
    for (const tr of loadout.turretWeapons || []) {
        const w = tr.selected;
        if (!w) continue;
        const { sustained60 } = calcEffectiveDps(w, shipCapPool);
        stats.turretBurstDps += w.damage?.burst_dps || 0;
        stats.turretSustainedDps += sustained60;
        stats.turretAlpha += w.damage?.alpha_total || 0;
        stats.powerUsed += w.power?.draw_max || 0;
    }

    for (const sr of loadout.shields) {
        stats.powerUsed += sr.selected?.power?.draw_max || 0;
    }
    for (const pr of loadout.powerplants) {
        stats.powerUsed += pr.selected?.power?.draw_max || 0;
    }
    for (const cr of loadout.coolers) {
        stats.powerUsed += cr.selected?.power?.draw_max || 0;
    }

    for (const m of loadout.missiles || []) {
        stats.missileCount += m.count || 1;
    }

    const powerPct = stats.powerSegments > 0 ? (stats.powerUsed / stats.powerSegments) * 100 : 0;
    if (powerPct > 100) {
        stats.issues.push({ type: 'POWER', severity: 'critical', message: `Power exceeded: ${stats.powerUsed.toFixed(1)}/${stats.powerSegments} segments` });
    } else if (powerPct > 85) {
        stats.issues.push({ type: 'POWER', severity: 'warn', message: `Power usage high: ${powerPct.toFixed(0)}%` });
    }

    stats.powerPercent = Math.min(powerPct, 100);

    return stats;
}

function getDamageType(weapon) {
    const dmg = weapon.damage?.alpha || {};
    if ((dmg.physical || 0) > 0 && (dmg.energy || 0) > 0) return 'mixed';
    if ((dmg.physical || 0) > 0) return 'ballistic';
    if ((dmg.distortion || 0) > 0) return 'distortion';
    return 'energy';
}

export function formatNumber(n) {
    if (n === null || n === undefined) return 'N/A';
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (Number.isInteger(n)) return n.toString();
    return n.toFixed(1);
}

export function formatSpeed(mps) {
    if (!mps) return 'N/A';
    if (mps >= 1e6) return (mps / 1e6).toFixed(0) + ' Mm/s';
    return formatNumber(mps) + ' m/s';
}
