/* ============================================================
   SC Optimizer — shared stock-ship combat math
   Powers the Tactics (counter-pick / armor advisor) and Fleet
   (squad composition) tools. Uses each ship's STOCK weaponry and
   defenses from ships.json — no loadout optimization required.
   ============================================================ */
import { loadJSON } from './data-loader.js';

let COMBAT = null;

/* total stock DPS: pilot weapons + every turret gun */
function stockDps(ship) {
  const w = ship.weaponry || {};
  let dps = w.pilot_dps || 0;
  const sustained = w.pilot_sustained_dps || dps;
  const turrets = ship.turrets || {};
  for (const t of ['manned', 'remote', 'pdc']) {
    for (const turret of turrets[t] || []) {
      for (const gun of turret.weapons || []) dps += gun.dps || 0;
    }
  }
  return { dps, sustained: Math.max(sustained, 0) };
}

/* robust size rank: use size data, fall back to role when missing/odd ("vehicle", "") */
function sizeRankOf(ship) {
  const sz = (ship.size?.en_EN || '').toLowerCase();
  const map = { small: 1, medium: 2, large: 3, capital: 4 };
  if (map[sz]) return map[sz];
  const r = (ship.role || '').toLowerCase();
  if (/snub|light fighter|interceptor/.test(r)) return 1;
  if (/medium fighter|heavy fighter|gunship|fighter/.test(r)) return 2;
  if (/bomber|frigate|corvette/.test(r)) return 3;
  if (/destroyer|cruiser|carrier|capital|industrial/.test(r)) return 4;
  return 2;
}

export function shipCombatProfile(ship) {
  const { dps, sustained } = stockDps(ship);
  const arm = ship.armor?.damage_multipliers || {};
  const shield = ship.shield || {};
  const shieldHp = shield.shield_hp || 0;
  const faceType = shield.face_type || 'Bubble';
  const effShieldHp = faceType === 'Quadrant' ? shieldHp / 4 : shieldHp;
  const hullHp = ship.hull_health || 0;
  const armorHp = ship.armor?.armor_health || 0;
  return {
    uuid: ship.uuid,
    name: ship.name,
    role: ship.role || 'Unknown',
    manufacturer: ship.manufacturer?.name || 'Unknown',
    size: ship.size?.en_EN || '',
    sizeRank: sizeRankOf(ship),
    combatRole: /fighter|interceptor|gunship|bomber|combat|snub|corvette|frigate|destroyer|cruiser|carrier/i.test(ship.role || ''),
    crew: { min: ship.crew?.min || 1, max: ship.crew?.max || 1 },
    dps,
    sustained: sustained || dps,
    alpha: ship.weaponry?.pilot_alpha || 0,
    missileDamage: ship.weaponry?.total_missile_damage || 0,
    shieldHp,
    effShieldHp,
    shieldRegen: shield.details?.regeneration || 0,
    hullHp,
    armorHp,
    armorMult: {
      physical: arm.physical ?? 1,
      energy: arm.energy ?? 1,
      distortion: arm.distortion ?? 1,
      thermal: arm.thermal ?? 1,
    },
    scm: ship.speed?.scm || 0,
    maxSpeed: ship.speed?.max || 0,
    pitch: ship.agility?.pitch || 0,
    image: ship.images?.[0]?.thumbnail_url || ship.images?.[0]?.original_url || null,
    ehp: effShieldHp + armorHp + hullHp,
  };
}

/* all gun-bearing ships, deduped by name, as combat profiles (DPS desc) */
export async function getCombatShips() {
  if (COMBAT) return COMBAT;
  const ships = await loadJSON('ships.json');
  const seen = new Set();
  COMBAT = ships
    .filter(s => {
      if (!s.is_spaceship && !s.is_vehicle) return false;
      if (!s.name || seen.has(s.name)) return false;
      const hasGuns = (s.weaponry?.pilot_dps || 0) > 0 || (s.turrets?.manned?.length > 0) || (s.turrets?.remote?.length > 0);
      if (!hasGuns) return false;
      seen.add(s.name);
      return true;
    })
    .map(shipCombatProfile)
    .sort((a, b) => a.name.localeCompare(b.name));
  return COMBAT;
}

/* mean armor multiplier an attacker with mixed stock weapons faces */
function meanMult(def) {
  return (def.armorMult.physical + def.armorMult.energy) / 2;
}

/* time for attacker to kill defender (stock vs stock).
   Models sustained gun DPS AND torpedo/missile alpha — a torpedo salvo bursts
   through the shield (ignoring regen), which is how capitals actually kill each
   other. Returns Infinity only if the attacker can neither outpace the shield
   regen with guns nor punch it open with torpedoes. */
export function timeToKill(att, def) {
  const gunDps = att.sustained || att.dps || 0;
  // torpedoes only land reliably on large/capital targets — agile fighters dodge them
  const torp = def.sizeRank >= 3 ? (att.missileDamage || 0) : 0;
  const mult = meanMult(def);

  const torpBreaksShield = torp >= def.effShieldHp;
  const gunsBreakShield = gunDps > def.shieldRegen;
  if (!torpBreaksShield && !gunsBreakShield) return Infinity;

  let t = 0;
  let shieldPool = def.effShieldHp;
  let hullPool = def.armorHp + def.hullHp;

  // torpedo salvo first — bursts the shield, overflow spills into hull
  if (torp > 0) {
    t += 10; // approach + lock + fire a torpedo run
    if (torp >= shieldPool) { hullPool -= (torp - shieldPool); shieldPool = 0; }
    else shieldPool -= torp;
    if (hullPool <= 0) return t;
  }

  // finish the remaining shield with sustained guns (regen matters here)
  if (shieldPool > 0) {
    const net = gunDps - def.shieldRegen;
    if (net <= 0) return Infinity;
    t += shieldPool / net;
  }

  // grind the hull with sustained guns (armor multiplier applies)
  const eff = gunDps * mult;
  if (eff <= 0) return Infinity;
  return t + hullPool / eff;
}

/* bidirectional stock duel; margin > 0 means `a` wins (kills faster) */
export function duel(a, b) {
  const aKillsB = timeToKill(a, b);
  const bKillsA = timeToKill(b, a);
  let margin;
  if (!isFinite(aKillsB) && !isFinite(bKillsA)) margin = 0;
  else if (!isFinite(aKillsB)) margin = -1e9;
  else if (!isFinite(bKillsA)) margin = 1e9;
  else margin = bKillsA - aKillsB;
  return { aKillsB, bKillsA, margin };
}

/* damage-type weakness advice for a target's armor */
export function damageAdvice(armorMult) {
  const types = [
    { key: 'physical', label: 'Ballistic / Physical', mult: armorMult.physical ?? 1 },
    { key: 'energy', label: 'Energy / Laser', mult: armorMult.energy ?? 1 },
    { key: 'distortion', label: 'Distortion', mult: armorMult.distortion ?? 1 },
  ];
  const sorted = [...types].sort((x, y) => y.mult - x.mult);
  return { types, best: sorted[0], worst: sorted[sorted.length - 1] };
}
