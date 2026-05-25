import { getWeapons, getShields, getPowerplants, getCoolers, getQuantumDrives } from './data-loader.js';
import { isPurchasable, findPurchasableAlternative, getShopInfo } from './shop-finder.js';

// ─── Reference Fleets (extracted from ships.json) ───────────────────────────
// Each entry: { name, armorMults: {physical, energy, distortion}, scm, crossSection, weight }

const PVP_FLEET = [
    { name: 'Gladius',           armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 226, crossSection: 8654,  weight: 1 },
    { name: 'Arrow',             armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 229, crossSection: 7473,  weight: 1 },
    { name: 'Sabre',             armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 223, crossSection: 6467,  weight: 1 },
    { name: 'F7C Hornet Mk II',  armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 220, crossSection: 8040,  weight: 1 },
    { name: 'Buccaneer',         armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 240, crossSection: 9145,  weight: 1 },
    { name: 'Avenger Titan',     armorMults: { physical: 0.80, energy: 0.65, distortion: 1.0 }, scm: 262, crossSection: 7617,  weight: 1 },
    { name: 'Mustang Delta',     armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 226, crossSection: 8240,  weight: 1 },
    { name: 'Talon',             armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 225, crossSection: 5017,  weight: 1 },
];

const PVE_FLEET = [
    { name: 'Gladius',                armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 226, crossSection: 8654,   weight: 1.0 },
    { name: 'Cutlass Black',          armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 217, crossSection: 13713,  weight: 1.5 },
    { name: 'Constellation Andromeda', armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 190, crossSection: 23935, weight: 1.5 },
    { name: 'Hammerhead',             armorMults: { physical: 0.70, energy: 0.50, distortion: 1.0 }, scm: 160, crossSection: 39312,  weight: 1.0 },
    { name: 'Vanguard Warden',        armorMults: { physical: 0.75, energy: 0.60, distortion: 1.0 }, scm: 210, crossSection: 17021,  weight: 1.5 },
    { name: 'Valkyrie',              armorMults: { physical: 0.70, energy: 0.50, distortion: 1.0 }, scm: 207, crossSection: 23736,  weight: 1.0 },
];

const BALANCED_FLEET = [...PVP_FLEET, ...PVE_FLEET];

// ─── Combat Profiles ────────────────────────────────────────────────────────

const PROFILES = {
    pve: {
        name: 'PvE',
        fleet: PVE_FLEET,
        engagementRange: 1200,
        fightDuration: 60,
        shieldPrio: 'regen'
    },
    pvp: {
        name: 'PvP',
        fleet: PVP_FLEET,
        engagementRange: 800,
        fightDuration: 30,
        shieldPrio: 'hp'
    },
    balanced: {
        name: 'Balanced',
        fleet: BALANCED_FLEET,
        engagementRange: 1000,
        fightDuration: 45,
        shieldPrio: 'balanced'
    }
};

// ─── Utility ────────────────────────────────────────────────────────────────

function extractSlotSize(className) {
    if (!className) return null;
    const m = className.match(/S0?(\d+)/);
    return m ? parseInt(m[1]) : null;
}

/**
 * Determine the dominant damage type of a weapon from its alpha breakdown.
 * Returns 'physical', 'energy', or 'distortion'.
 */
function getWeaponDamageType(weapon) {
    const alpha = weapon.damage?.alpha || {};
    const phys = alpha.physical || 0;
    const energy = alpha.energy || 0;
    const distortion = alpha.distortion || 0;
    if (phys >= energy && phys >= distortion) return 'physical';
    if (distortion >= energy) return 'distortion';
    return 'energy';
}

/**
 * Get the fraction of damage for each type (for mixed-damage weapons).
 * Returns { physical: 0-1, energy: 0-1, distortion: 0-1 }.
 */
function getDamageTypeFractions(weapon) {
    const alpha = weapon.damage?.alpha || {};
    const phys = alpha.physical || 0;
    const energy = alpha.energy || 0;
    const distortion = alpha.distortion || 0;
    const total = phys + energy + distortion;
    if (total <= 0) return { physical: 0, energy: 1, distortion: 0 };
    return {
        physical: phys / total,
        energy: energy / total,
        distortion: distortion / total
    };
}

// ─── Hardpoint Extraction ───────────────────────────────────────────────────

export function extractHardpoints(ship) {
    const slots = { weapons: [], turretWeapons: [], shields: [], powerplants: [], coolers: [], quantumDrive: null, missiles: [] };
    const relays = ship.hardpoints?.relays || [];
    if (!relays.length) return slots;

    for (const relay of relays) {
    for (const cat of relay.connected_hardpoints || []) {
        switch (cat.category) {
            case 'Turrets':
                for (const item of cat.items || []) {
                    const cn = item.class_name || '';
                    const size = extractSlotSize(cn);
                    const isMannedTurret = cn.includes('Turret') && !cn.includes('Mount');
                    if (isMannedTurret) continue;
                    if (size) {
                        const isGimbal = cn.includes('Gimbal');
                        slots.weapons.push({
                            hardpoint: item.hardpoint,
                            hardpointSize: size,
                            weaponSize: isGimbal ? size - 1 : size,
                            mountType: isGimbal ? 'gimbal' : 'fixed',
                            currentWeapon: item.sub_items?.[0]?.item_name || null,
                            currentUuid: item.sub_items?.[0]?.item_uuid || null
                        });
                    }
                }
                break;
            case 'Shields':
                for (const item of cat.items || [])
                    slots.shields.push({ hardpoint: item.hardpoint, size: extractSlotSize(item.class_name) || 1, currentItem: item.item_name, currentUuid: item.item_uuid });
                break;
            case 'Power Plants':
                for (const item of cat.items || [])
                    slots.powerplants.push({ hardpoint: item.hardpoint, size: extractSlotSize(item.class_name) || 1, currentItem: item.item_name });
                break;
            case 'Coolers':
                for (const item of cat.items || [])
                    slots.coolers.push({ hardpoint: item.hardpoint, size: extractSlotSize(item.class_name) || 1, currentItem: item.item_name });
                break;
            case 'Quantum Drives':
                for (const item of cat.items || [])
                    slots.quantumDrive = { hardpoint: item.hardpoint, size: extractSlotSize(item.class_name) || 1, currentItem: item.item_name };
                break;
            case 'Missile & Bomb Racks':
                for (const item of cat.items || []) {
                    const cn = item.class_name || '';
                    const sizeMatches = cn.match(/S0?(\d+)/g);
                    let count = 1;
                    if (cn.includes('Dual') || cn.includes('x2')) count = 2;
                    else if (cn.includes('Tri') || cn.includes('x3')) count = 3;
                    else if (cn.includes('Quad') || cn.includes('x4')) count = 4;
                    slots.missiles.push({
                        hardpoint: item.hardpoint,
                        rackSize: extractSlotSize(cn),
                        missileSize: sizeMatches?.length >= 2 ? parseInt(sizeMatches[1].replace(/S0?/, '')) : null,
                        count, currentItem: item.item_name
                    });
                }
                break;
        }
    }
    }

    for (const ttype of ['manned', 'remote', 'pdc']) {
        for (const turret of ship.turrets?.[ttype] || []) {
            const weaponSizes = turret.weapon_sizes || [];
            const turretWeaponsList = turret.weapons || [];
            for (let wi = 0; wi < Math.max(weaponSizes.length, turretWeaponsList.length); wi++) {
                const wSize = weaponSizes[wi] || turretWeaponsList[wi]?.size || 3;
                slots.turretWeapons.push({
                    hardpoint: `${turret.hardpoint_name || ttype}_gun_${wi}`,
                    hardpointSize: wSize,
                    weaponSize: wSize,
                    mountType: 'turret',
                    turretType: ttype,
                    currentWeapon: turretWeaponsList[wi]?.name || null
                });
            }
        }
    }

    return slots;
}

// ─── Sustained DPS (unchanged — this is correct) ───────────────────────────

/**
 * Compute sustained DPS over 60s considering capacitor drain and ballistic ammo.
 * Returns computed metrics for scoring AND for downstream stats display.
 */
export function calcEffectiveDps(weapon, shipCapPool) {
    const burstDps = weapon.damage?.burst_dps || 0;
    if (burstDps <= 0) return { sustained60: 0, burstDuration: 0, ammoEndurance: 0, pelletsPerShot: 1, damagePerShot: 0 };

    const rpm = weapon.fire_rate?.rpm || 300;
    const fireRate = rpm / 60;
    const damagePerShot = weapon.damage?.damage_per_shot || (burstDps / Math.max(fireRate, 0.1));
    const mode = weapon.fire_rate?.modes?.[0] || {};
    const ammoPerShot = mode.ammo_per_shot || 1;
    const pelletsPerShot = mode.pellets_per_shot || 1;

    const ammoCapacity = weapon.ammo?.capacity || 0;
    const ammoRegen = weapon.ammo?.regeneration || 0;
    const isCapacitor = ammoCapacity === 0 && ammoRegen > 0;
    const isBallistic = ammoCapacity > 0 && !ammoRegen;

    let sustained60 = burstDps;
    let burstDuration = 60;
    let ammoEndurance = 1.0;

    if (isCapacitor) {
        const consumptionRate = fireRate * ammoPerShot;
        if (consumptionRate > ammoRegen) {
            const pool = shipCapPool || 4;
            burstDuration = pool / (consumptionRate - ammoRegen);
            const sustainedFireRate = ammoRegen / Math.max(ammoPerShot, 0.01);
            const sustainedDps = sustainedFireRate * damagePerShot;
            const burstDamage = burstDuration * burstDps;
            const remainingTime = Math.max(0, 60 - burstDuration);
            sustained60 = (burstDamage + sustainedDps * remainingTime) / 60;
            ammoEndurance = 0.7 + 0.3 * Math.min(burstDuration / 10, 1.0);
        } else {
            ammoEndurance = 1.0;
        }
    } else if (isBallistic) {
        const totalFireTime = ammoCapacity / Math.max(fireRate, 0.1);
        const overheatTime = weapon.heat?.overheat_max_time || totalFireTime;
        const cooldownTime = weapon.heat?.overheat_cooldown || 0;

        if (overheatTime < totalFireTime && cooldownTime > 0) {
            const dutyCycle = overheatTime / (overheatTime + cooldownTime);
            sustained60 = burstDps * dutyCycle;
        }

        if (totalFireTime < 60) {
            sustained60 = (burstDps * Math.min(totalFireTime, 60)) / 60;
        }
        ammoEndurance = Math.min(totalFireTime / 120, 1.0);
    }

    return { sustained60, burstDuration, ammoEndurance, pelletsPerShot, damagePerShot };
}

// ─── Hit Probability ────────────────────────────────────────────────────────

/**
 * Calculate hit probability against a specific target at a given range.
 * Pure math — no opinions, no hardcoded bonuses.
 *
 * @param {number} projSpeed       - Projectile speed (m/s)
 * @param {number} spreadDeg       - Weapon spread (degrees)
 * @param {number} targetScm       - Target SCM speed (m/s)
 * @param {number} targetCrossSection - Target cross_section_max (m^2)
 * @param {number} range           - Engagement range (m)
 * @param {number} pelletsPerShot  - Number of pellets per shot (for shotguns)
 * @param {number} weaponRange     - Weapon maximum range (m)
 * @returns {number} 0.0 - 1.0
 */
function calcHitProbability(projSpeed, spreadDeg, targetScm, targetCrossSection, range, pelletsPerShot, weaponRange) {
    // Out of range = 0
    if (range > weaponRange) return 0;

    // Factor 1: Lead difficulty — can you lead a fast target with slow projectiles?
    const leadFactor = projSpeed / (projSpeed + targetScm * 0.5);

    // Factor 2: Spread vs target size
    let spreadFactor = 1.0;
    if (spreadDeg > 0.01) {
        const spreadRad = range * Math.tan(spreadDeg * Math.PI / 180);
        const targetRadius = Math.sqrt(targetCrossSection) / 2; // approximate radius from cross-section area

        if (pelletsPerShot > 1) {
            // Shotgun: fraction of pellets that hit
            spreadFactor = Math.min(1.0, (targetRadius / Math.max(spreadRad, 0.01)) ** 2);
        } else {
            // Single projectile
            if (spreadRad <= targetRadius) {
                spreadFactor = 1.0;
            } else {
                spreadFactor = (targetRadius / spreadRad) ** 1.5;
            }
        }
    }

    return Math.max(leadFactor * spreadFactor, 0.01);
}

// ─── Armor Multiplier ───────────────────────────────────────────────────────

/**
 * Calculate effective armor multiplier for a weapon against a target.
 * Uses the weapon's damage type fractions against the target's armor multipliers.
 * Lower armor multiplier = more damage reduction = harder to damage.
 */
function calcArmorMult(weapon, targetArmorMults) {
    const fractions = getDamageTypeFractions(weapon);
    // armor multiplier is the damage reduction factor (0.75 means 75% damage gets through)
    return (
        fractions.physical * (targetArmorMults.physical || 1) +
        fractions.energy * (targetArmorMults.energy || 1) +
        fractions.distortion * (targetArmorMults.distortion || 1)
    );
}

// ─── Sustain Factor ─────────────────────────────────────────────────────────

/**
 * Calculate sustained DPS over a given fight duration.
 * Uses calcEffectiveDps for 60s baseline and adjusts for shorter fights.
 */
function calcSustainedDps(weapon, shipCapPool, fightDuration) {
    const burstDps = weapon.damage?.burst_dps || 0;
    if (burstDps <= 0) return 0;

    const { sustained60, burstDuration } = calcEffectiveDps(weapon, shipCapPool);

    if (fightDuration <= 0) return burstDps;

    // For fights shorter than 60s, we need to recalculate
    if (fightDuration < 60) {
        const rpm = weapon.fire_rate?.rpm || 300;
        const fireRate = rpm / 60;
        const damagePerShot = weapon.damage?.damage_per_shot || (burstDps / Math.max(fireRate, 0.1));
        const mode = weapon.fire_rate?.modes?.[0] || {};
        const ammoPerShot = mode.ammo_per_shot || 1;

        const ammoCapacity = weapon.ammo?.capacity || 0;
        const ammoRegen = weapon.ammo?.regeneration || 0;
        const isCapacitor = ammoCapacity === 0 && ammoRegen > 0;
        const isBallistic = ammoCapacity > 0 && !ammoRegen;

        if (isCapacitor) {
            const consumptionRate = fireRate * ammoPerShot;
            if (consumptionRate > ammoRegen) {
                const pool = shipCapPool || 4;
                const bd = pool / (consumptionRate - ammoRegen);
                if (bd >= fightDuration) {
                    // Can sustain burst for full fight
                    return burstDps;
                }
                const sustainedFireRate = ammoRegen / Math.max(ammoPerShot, 0.01);
                const sustainedDps = sustainedFireRate * damagePerShot;
                return (bd * burstDps + sustainedDps * (fightDuration - bd)) / fightDuration;
            }
            return burstDps;
        } else if (isBallistic) {
            const totalFireTime = ammoCapacity / Math.max(fireRate, 0.1);
            if (totalFireTime >= fightDuration) return burstDps;
            return (burstDps * totalFireTime) / fightDuration;
        }
        return burstDps;
    }

    return sustained60;
}

// ─── Penetration Factor ────────────────────────────────────────────────────

/**
 * Reference penetration thresholds per weapon size (median values from data).
 * Weapons at or above this threshold get a neutral-to-positive factor.
 * Weapons below get penalized proportionally.
 *
 * Data source (from weapons.json analysis):
 *   S1: median 0.66m    S2: median 0.88m    S3: median 1.32m
 *   S4: median 2.20m    S5: median 4.50m    S6: median 5.50m
 *   S7: median 10.50m   S8: median 21.60m   S9+: very high
 */
const PEN_REFERENCE = { 1: 0.66, 2: 0.88, 3: 1.32, 4: 2.20, 5: 4.50, 6: 5.50, 7: 10.50, 8: 21.60, 9: 15.0, 10: 28.0, 12: 63.0 };

/**
 * Calculate a penetration quality factor for scoring.
 *
 * How it works:
 * - ratio = weapon_pen / size_median_pen
 * - ratio < 0.5  =>  factor = 0.75  (low-pen weapons are penalized, but not eliminated)
 * - ratio 0.5-1  =>  factor = 0.75 + 0.25 * (ratio - 0.5) / 0.5  (linear ramp to 1.0)
 * - ratio 1-3    =>  factor = 1.0 + 0.15 * (ratio - 1) / 2  (mild bonus up to 1.075)
 * - ratio > 3    =>  capped at 1.075
 *
 * For PvP (lighter armor), the bonus is smaller. For PvE (heavier armor), the bonus is larger.
 *
 * @param {number} penetration  - weapon.projectile.penetration.base_distance
 * @param {number} weaponSize   - weapon size (1-12)
 * @param {string} profileName  - 'PvP', 'PvE', or 'Balanced'
 * @returns {number} 0.75 - 1.15 multiplicative factor
 */
function calcPenetrationFactor(penetration, weaponSize, profileName) {
    if (!penetration || penetration <= 0) {
        // Rocket pods etc — no penetration data, neutral factor
        return 0.85;
    }

    const ref = PEN_REFERENCE[weaponSize] || 1.0;
    const ratio = penetration / ref;

    let factor;
    if (ratio < 0.5) {
        factor = 0.75;
    } else if (ratio <= 1.0) {
        factor = 0.75 + 0.25 * (ratio - 0.5) / 0.5;
    } else if (ratio <= 3.0) {
        factor = 1.0 + 0.15 * (ratio - 1.0) / 2.0;
    } else {
        factor = 1.075;
    }

    // Profile adjustment: PvE targets have heavier armor, penetration matters more
    if (profileName === 'PvE') {
        // Amplify the factor deviation from 1.0
        factor = 1.0 + (factor - 1.0) * 1.5;
    } else if (profileName === 'PvP') {
        // Dampen — light fighters have thin armor
        factor = 1.0 + (factor - 1.0) * 0.7;
    }

    return factor;
}

// ─── Weapon Scoring — Expected Effective DPS ────────────────────────────────

/**
 * Score a weapon by its expected effective DPS against a reference fleet.
 * NO hardcoded weapon-type bonuses. Pure data-driven.
 *
 * Filters applied:
 *   - Wrong size
 *   - Mining / Utility / Tractor / Salvage weapon types
 *   - Turret weapon types (not pilot-controlled)
 *   - Beam weapon types (special mechanics, not comparable)
 *   - "Tractor" in weapon name
 *   - burst_dps <= 0
 *
 * @param {Object} weapon       - Weapon data object
 * @param {Object} profile      - Combat profile (fleet, engagementRange, fightDuration)
 * @param {number} slotSize     - Required weapon size
 * @param {number} shipCapPool  - Ship capacitor pool
 * @param {number} [refSize]    - Reference size for gimbal normalization
 * @returns {number} Expected effective DPS (weighted average across fleet)
 */
function scoreWeapon(weapon, profile, slotSize, shipCapPool, refSize) {
    if (weapon.size !== slotSize) return -Infinity;
    const wtype = weapon.weapon_type || '';
    const wname = weapon.name || '';

    // Exclude non-combat weapon types
    if (wtype.includes('Mining') || wtype.includes('Utility') || wtype.includes('Salvage')) return -Infinity;
    if (wtype.includes('Turret')) return -Infinity;
    if (wtype.includes('Beam')) return -Infinity;
    if (wtype.includes('Tractor') || wname.includes('Tractor')) return -Infinity;

    // Exclude ground vehicle weapons (not usable on ships)
    if (wname.includes('Slayer') || wname.includes('Reign-') || wname === 'NV57 Ballistic Gatling') return -Infinity;

    // Guard against weapons with no DPS data
    const burstDps = weapon.damage?.burst_dps || 0;
    if (burstDps <= 0) return -Infinity;

    // Exclude known data errors (DPS > 5x median for their size)
    const dpsLimits = { 1: 1500, 2: 2500, 3: 3500, 4: 5000, 5: 5000, 6: 6000, 7: 8000 };
    if (burstDps > (dpsLimits[weapon.size] || 10000)) return -Infinity;

    const range = profile.engagementRange;
    const fightDuration = profile.fightDuration;
    const fleet = profile.fleet;
    const weaponRange = weapon.projectile?.range || 2000;
    const projSpeed = weapon.projectile?.speed || 1400;
    const spreadDeg = weapon.spread?.min || weapon.spread?.max || 0;
    const pelletsPerShot = weapon.fire_rate?.modes?.[0]?.pellets_per_shot || 1;

    // Penetration factor — multiplicative quality modifier
    const penetration = weapon.projectile?.penetration?.base_distance || 0;
    const penFactor = calcPenetrationFactor(penetration, slotSize, profile.name);

    // Sustained DPS for the fight duration
    const sustainedDps = calcSustainedDps(weapon, shipCapPool, fightDuration);

    // Calculate expected effective DPS against each fleet target
    let totalWeightedDps = 0;
    let totalWeight = 0;

    for (const target of fleet) {
        const hitProb = calcHitProbability(
            projSpeed, spreadDeg, target.scm, target.crossSection,
            range, pelletsPerShot, weaponRange
        );
        const armorMult = calcArmorMult(weapon, target.armorMults);
        const effectiveDps = sustainedDps * hitProb * armorMult * penFactor;

        totalWeightedDps += effectiveDps * target.weight;
        totalWeight += target.weight;
    }

    if (totalWeight <= 0) return 0;

    let score = totalWeightedDps / totalWeight;

    // Normalize by reference size for fair gimbal comparison
    if (refSize && refSize !== slotSize) {
        // Gimbal weapons compete against fixed weapons of the hardpoint size.
        // Normalize: a S3 gimbal in an S4 slot should be compared fairly.
        // No additional penalty here — the DPS difference IS the penalty.
    }

    return score;
}

// ─── Component Scoring (unchanged) ──────────────────────────────────────────

function scoreShield(shield, profile, slotSize) {
    if (shield.size !== slotSize) return -Infinity;

    const grade = shield.grade || 'C';
    const itemClass = (shield.item_class || shield.class || '').toLowerCase();
    const powerDraw = shield.power?.draw_max || 1;
    const emSig = shield.signatures?.em_max || shield.power?.draw_max || 1;
    const distortionMax = shield.distortion?.max || 1000;
    const distortionDecay = shield.distortion?.decay_rate || 100;

    const gradeScores = { 'A': 1.0, 'B': 0.85, 'C': 0.7, 'D': 0.55 };
    const gradeScore = gradeScores[grade] || 0.6;

    const classScores = { 'military': 1.0, 'stealth': 0.85, 'civilian': 0.7, 'industrial': 0.65, 'competition': 0.9 };
    const classScore = classScores[itemClass] || 0.7;

    let score = gradeScore * 50 + classScore * 30;
    score += (distortionMax / 10000) * 10;
    score += (distortionDecay / 1000) * 5;

    if (profile.shieldPrio === 'hp') {
        score += powerDraw * 5;
    } else if (profile.shieldPrio === 'regen') {
        score += powerDraw * 3;
        score -= emSig * 0.001;
    } else {
        score += powerDraw * 4;
    }

    return score;
}

function scorePowerplant(pp, slotSize) {
    if (pp.size !== slotSize) return -Infinity;
    const grade = pp.grade || 'C';
    const gradeScores = { 'A': 1.0, 'B': 0.85, 'C': 0.7, 'D': 0.55 };
    return (gradeScores[grade] || 0.6) * 100 + (pp.power?.draw_max || 0) * 10;
}

function scoreCooler(cooler, slotSize) {
    if (cooler.size !== slotSize) return -Infinity;
    const grade = cooler.grade || 'C';
    const gradeScores = { 'A': 1.0, 'B': 0.85, 'C': 0.7, 'D': 0.55 };
    return (gradeScores[grade] || 0.6) * 100 + (cooler.power?.coolant_max || 0) * 10;
}

function scoreQD(qd, profile, slotSize) {
    if (qd.size !== slotSize) return -Infinity;
    const speed = qd.quantum_drive_data?.standard_jump?.drive_speed || 0;
    const spool = qd.quantum_drive_data?.standard_jump?.spool_up_time || 10;
    const fuel = qd.quantum_drive_data?.quantum_fuel_requirement || 1;
    if (profile.name === 'PvP') {
        return (speed / 2e8) * 0.3 + (1 / spool) * 0.5 + (1 / fuel) * 0.2;
    }
    return (speed / 2e8) * 0.5 + (1 / spool) * 0.2 + (1 / fuel) * 0.3;
}

// ─── Ranking & Slot Building ────────────────────────────────────────────────

function rankAll(items, scoreFn) {
    const scored = [];
    for (const item of items) {
        const score = scoreFn(item);
        if (!isFinite(score)) continue;
        scored.push({ item, score, purchasable: isPurchasable(item), shop: isPurchasable(item) ? getShopInfo(item) : null });
    }
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]?.item || null;
    const bestPurchasable = scored.find(s => s.purchasable)?.item || null;
    return { best, bestPurchasable, candidates: scored.slice(0, 30) };
}

function buildSlotResult(slot, ranked) {
    const selected = ranked.best || ranked.bestPurchasable;
    const bestPurchasable = ranked.bestPurchasable;
    const selectedIsPurchasable = selected ? isPurchasable(selected) : false;
    return {
        slot,
        selected,
        bestPurchasable,
        allCandidates: ranked.candidates,
        shop: selectedIsPurchasable ? getShopInfo(selected) : null,
        selectedIsPurchasable
    };
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function getProfile(pvE, pvP) {
    if (pvE && pvP) return PROFILES.balanced;
    if (pvP) return PROFILES.pvp;
    return PROFILES.pve;
}

export async function optimizeLoadout(ship, profileKey) {
    const profile = typeof profileKey === 'string' ? PROFILES[profileKey] : profileKey;
    const [weapons, shields, powerplants, coolers, quantumDrives] = await Promise.all([
        getWeapons(), getShields(), getPowerplants(), getCoolers(), getQuantumDrives()
    ]);

    const slots = extractHardpoints(ship);
    const shipCapPool = ship.power_pools?.WeaponGun?.size || 4;

    const weaponResults = slots.weapons.map(slot => {
        const fixedSize = slot.hardpointSize;
        const gimbalSize = slot.mountType === 'gimbal' ? slot.hardpointSize - 1 : slot.hardpointSize;
        const ranked = rankAll(weapons, w => {
            // Fixed mount: score at full size
            if (w.size === fixedSize) return scoreWeapon(w, profile, fixedSize, shipCapPool);
            // Gimbal mount: score the smaller weapon, apply 0.95x penalty for gimbal trade-off
            if (gimbalSize !== fixedSize && w.size === gimbalSize) return scoreWeapon(w, profile, gimbalSize, shipCapPool, fixedSize) * 0.95;
            return -Infinity;
        });
        return buildSlotResult(slot, ranked);
    });

    const shieldResults = slots.shields.map(slot =>
        buildSlotResult(slot, rankAll(shields, s => scoreShield(s, profile, slot.size)))
    );

    const ppResults = slots.powerplants.map(slot =>
        buildSlotResult(slot, rankAll(powerplants, p => scorePowerplant(p, slot.size)))
    );

    const coolerResults = slots.coolers.map(slot =>
        buildSlotResult(slot, rankAll(coolers, c => scoreCooler(c, slot.size)))
    );

    let qdResult = null;
    if (slots.quantumDrive) {
        qdResult = buildSlotResult(slots.quantumDrive,
            rankAll(quantumDrives, q => scoreQD(q, profile, slots.quantumDrive.size)));
    }

    const turretResults = slots.turretWeapons.map(slot => {
        const ranked = rankAll(weapons, w => {
            if (w.size === slot.weaponSize) return scoreWeapon(w, profile, slot.weaponSize, shipCapPool, slot.weaponSize);
            return -Infinity;
        });
        return buildSlotResult(slot, ranked);
    });

    return { profile: profile.name, weapons: weaponResults, shields: shieldResults, powerplants: ppResults, coolers: coolerResults, quantumDrive: qdResult, missiles: slots.missiles, turretWeapons: turretResults, shipCapPool };
}
