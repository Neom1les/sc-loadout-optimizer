#!/usr/bin/env python3
"""
SC Loadout Optimizer — Full Fleet Validation Script
Mirrors the data-driven Expected Effective DPS scoring from optimizer.js.
No hardcoded weapon-type bonuses — pure math against reference fleets.
"""

import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

# ─── Data Loading ─────────────────────────────────────────────────────────────

def load_json(filename):
    with open(os.path.join(DATA_DIR, filename), 'r', encoding='utf-8') as f:
        data = json.load(f)
        return data.get('data', data) if isinstance(data, dict) and 'data' in data else data


# ─── Reference Fleets (extracted from ships.json — mirrors JS) ─────────────

PVP_FLEET = [
    {'name': 'Gladius',          'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 226, 'crossSection': 8654,  'weight': 1},
    {'name': 'Arrow',            'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 229, 'crossSection': 7473,  'weight': 1},
    {'name': 'Sabre',            'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 223, 'crossSection': 6467,  'weight': 1},
    {'name': 'F7C Hornet Mk II', 'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 220, 'crossSection': 8040,  'weight': 1},
    {'name': 'Buccaneer',        'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 240, 'crossSection': 9145,  'weight': 1},
    {'name': 'Avenger Titan',    'armorMults': {'physical': 0.80, 'energy': 0.65, 'distortion': 1.0}, 'scm': 262, 'crossSection': 7617,  'weight': 1},
    {'name': 'Mustang Delta',    'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 226, 'crossSection': 8240,  'weight': 1},
    {'name': 'Talon',            'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 225, 'crossSection': 5017,  'weight': 1},
]

PVE_FLEET = [
    {'name': 'Gladius',                'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 226, 'crossSection': 8654,  'weight': 1.0},
    {'name': 'Cutlass Black',          'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 217, 'crossSection': 13713, 'weight': 1.5},
    {'name': 'Constellation Andromeda','armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 190, 'crossSection': 23935, 'weight': 1.5},
    {'name': 'Hammerhead',             'armorMults': {'physical': 0.70, 'energy': 0.50, 'distortion': 1.0}, 'scm': 160, 'crossSection': 39312, 'weight': 1.0},
    {'name': 'Vanguard Warden',        'armorMults': {'physical': 0.75, 'energy': 0.60, 'distortion': 1.0}, 'scm': 210, 'crossSection': 17021, 'weight': 1.5},
    {'name': 'Valkyrie',              'armorMults': {'physical': 0.70, 'energy': 0.50, 'distortion': 1.0}, 'scm': 207, 'crossSection': 23736, 'weight': 1.0},
]

BALANCED_FLEET = PVP_FLEET + PVE_FLEET


# ─── Profile Definitions (mirrors JS PROFILES) ────────────────────────────

PROFILES = {
    'pve': {
        'name': 'PvE',
        'fleet': PVE_FLEET,
        'engagementRange': 1200,
        'fightDuration': 60,
    },
    'pvp': {
        'name': 'PvP',
        'fleet': PVP_FLEET,
        'engagementRange': 800,
        'fightDuration': 30,
    },
}


# ─── Scoring Functions (mirrors JS optimizer.js) ──────────────────────────

def extract_slot_size(class_name):
    if not class_name:
        return None
    m = re.search(r'S0?(\d+)', class_name)
    return int(m.group(1)) if m else None


def extract_hardpoints(ship):
    """Extract weapon hardpoints from ship data — mirrors JS extractHardpoints()."""
    slots = {'weapons': [], 'shields': [], 'missiles': []}
    hardpoints = ship.get('hardpoints') or {}
    relay = (hardpoints.get('relays') or [None])[0]
    if not relay:
        return slots
    for cat in relay.get('connected_hardpoints', []):
        if cat.get('category') == 'Turrets':
            for item in cat.get('items', []):
                size = extract_slot_size(item.get('class_name'))
                if size:
                    is_gimbal = 'Gimbal' in (item.get('class_name') or '')
                    slots['weapons'].append({
                        'hardpoint': item.get('hardpoint'),
                        'hardpointSize': size,
                        'weaponSize': size - 1 if is_gimbal else size,
                        'mountType': 'gimbal' if is_gimbal else 'fixed',
                        'class_name': item.get('class_name', ''),
                        'item_name': item.get('item_name', ''),
                    })
    return slots


def get_damage_type_fractions(weapon):
    """Get fraction of damage for each type. Mirrors JS getDamageTypeFractions."""
    alpha = weapon.get('damage', {}).get('alpha', {})
    phys = alpha.get('physical', 0) or 0
    energy = alpha.get('energy', 0) or 0
    distortion = alpha.get('distortion', 0) or 0
    total = phys + energy + distortion
    if total <= 0:
        return {'physical': 0, 'energy': 1, 'distortion': 0}
    return {
        'physical': phys / total,
        'energy': energy / total,
        'distortion': distortion / total
    }


def calc_armor_mult(weapon, target_armor_mults):
    """Calculate weighted armor multiplier. Mirrors JS calcArmorMult."""
    fractions = get_damage_type_fractions(weapon)
    return (
        fractions['physical'] * target_armor_mults.get('physical', 1) +
        fractions['energy'] * target_armor_mults.get('energy', 1) +
        fractions['distortion'] * target_armor_mults.get('distortion', 1)
    )


def calc_hit_probability(proj_speed, spread_deg, target_scm, target_cross_section, rng,
                         pellets_per_shot, weapon_range):
    """Calculate hit probability. Mirrors JS calcHitProbability."""
    if rng > weapon_range:
        return 0

    lead_factor = proj_speed / (proj_speed + target_scm * 0.5)

    spread_factor = 1.0
    if spread_deg > 0.01:
        spread_rad = rng * math.tan(spread_deg * math.pi / 180)
        target_radius = math.sqrt(target_cross_section) / 2

        if pellets_per_shot > 1:
            spread_factor = min(1.0, (target_radius / max(spread_rad, 0.01)) ** 2)
        else:
            if spread_rad <= target_radius:
                spread_factor = 1.0
            else:
                spread_factor = (target_radius / spread_rad) ** 1.5

    return max(lead_factor * spread_factor, 0.01)


def calc_effective_dps(weapon, cap_pool=4):
    """Mirror of JS calcEffectiveDps — returns (sustained60, burst_duration, ammo_endurance)."""
    burst_dps = weapon.get('damage', {}).get('burst_dps') or 0
    if burst_dps <= 0:
        return 0, 0, 0

    rpm = weapon.get('fire_rate', {}).get('rpm') or 300
    fire_rate = rpm / 60
    damage_per_shot = weapon.get('damage', {}).get('damage_per_shot') or (burst_dps / max(fire_rate, 0.1))
    modes = weapon.get('fire_rate', {}).get('modes') or [{}]
    ammo_per_shot = modes[0].get('ammo_per_shot', 1)

    ammo_cap = weapon.get('ammo', {}).get('capacity') or 0
    ammo_regen = weapon.get('ammo', {}).get('regeneration') or 0
    is_capacitor = ammo_cap == 0 and ammo_regen > 0
    is_ballistic = ammo_cap > 0 and not ammo_regen

    sustained60 = burst_dps
    burst_duration = 60
    ammo_endurance = 1.0

    if is_capacitor:
        consumption = fire_rate * ammo_per_shot
        if consumption > ammo_regen:
            pool = cap_pool or 4
            burst_duration = pool / (consumption - ammo_regen)
            sust_fr = ammo_regen / max(ammo_per_shot, 0.01)
            sust_dps = sust_fr * damage_per_shot
            burst_dmg = burst_duration * burst_dps
            remain = max(0, 60 - burst_duration)
            sustained60 = (burst_dmg + sust_dps * remain) / 60
            ammo_endurance = 0.7 + 0.3 * min(burst_duration / 10, 1.0)
    elif is_ballistic:
        total_fire = ammo_cap / max(fire_rate, 0.1)
        overheat_time = weapon.get('heat', {}).get('overheat_max_time') or total_fire
        cooldown_time = weapon.get('heat', {}).get('overheat_cooldown') or 0
        if overheat_time < total_fire and cooldown_time > 0:
            duty_cycle = overheat_time / (overheat_time + cooldown_time)
            sustained60 = burst_dps * duty_cycle
        if total_fire < 60:
            sustained60 = burst_dps * min(total_fire, 60) / 60
        ammo_endurance = min(total_fire / 120, 1.0)

    return sustained60, burst_duration, ammo_endurance


def calc_sustained_dps(weapon, cap_pool, fight_duration):
    """Calculate sustained DPS for a given fight duration. Mirrors JS calcSustainedDps."""
    burst_dps = weapon.get('damage', {}).get('burst_dps') or 0
    if burst_dps <= 0:
        return 0

    sustained60, burst_duration, _ = calc_effective_dps(weapon, cap_pool)

    if fight_duration <= 0:
        return burst_dps

    if fight_duration < 60:
        rpm = weapon.get('fire_rate', {}).get('rpm') or 300
        fire_rate = rpm / 60
        damage_per_shot = weapon.get('damage', {}).get('damage_per_shot') or (burst_dps / max(fire_rate, 0.1))
        modes = weapon.get('fire_rate', {}).get('modes') or [{}]
        ammo_per_shot = modes[0].get('ammo_per_shot', 1)

        ammo_cap = weapon.get('ammo', {}).get('capacity') or 0
        ammo_regen = weapon.get('ammo', {}).get('regeneration') or 0
        is_capacitor = ammo_cap == 0 and ammo_regen > 0
        is_ballistic = ammo_cap > 0 and not ammo_regen

        if is_capacitor:
            consumption = fire_rate * ammo_per_shot
            if consumption > ammo_regen:
                pool = cap_pool or 4
                bd = pool / (consumption - ammo_regen)
                if bd >= fight_duration:
                    return burst_dps
                sust_fr = ammo_regen / max(ammo_per_shot, 0.01)
                sust_dps = sust_fr * damage_per_shot
                return (bd * burst_dps + sust_dps * (fight_duration - bd)) / fight_duration
            return burst_dps
        elif is_ballistic:
            total_fire = ammo_cap / max(fire_rate, 0.1)
            if total_fire >= fight_duration:
                return burst_dps
            return (burst_dps * total_fire) / fight_duration
        return burst_dps

    return sustained60


PEN_REFERENCE = {1: 0.66, 2: 0.88, 3: 1.32, 4: 2.20, 5: 4.50, 6: 5.50, 7: 10.50, 8: 21.60, 9: 15.0, 10: 28.0, 12: 63.0}


def calc_penetration_factor(penetration, weapon_size, profile_name):
    """
    Calculate penetration quality factor. Mirrors JS calcPenetrationFactor.
    """
    if not penetration or penetration <= 0:
        return 0.85

    ref = PEN_REFERENCE.get(weapon_size, 1.0)
    ratio = penetration / ref

    if ratio < 0.5:
        factor = 0.75
    elif ratio <= 1.0:
        factor = 0.75 + 0.25 * (ratio - 0.5) / 0.5
    elif ratio <= 3.0:
        factor = 1.0 + 0.15 * (ratio - 1.0) / 2.0
    else:
        factor = 1.075

    if profile_name == 'PvE':
        factor = 1.0 + (factor - 1.0) * 1.5
    elif profile_name == 'PvP':
        factor = 1.0 + (factor - 1.0) * 0.7

    return factor


def score_weapon(weapon, profile, slot_size, cap_pool=4, ref_size=None):
    """
    Score weapon by Expected Effective DPS against reference fleet.
    Mirrors JS scoreWeapon — no hardcoded weapon-type bonuses.
    """
    if weapon.get('size') != slot_size:
        return -float('inf')
    wtype = weapon.get('weapon_type') or ''
    wname = weapon.get('name') or ''
    if any(x in wtype for x in ['Mining', 'Utility', 'Salvage']):
        return -float('inf')
    if 'Turret' in wtype:
        return -float('inf')
    if 'Beam' in wtype:
        return -float('inf')
    if 'Tractor' in wtype or 'Tractor' in wname:
        return -float('inf')
    burst_dps = weapon.get('damage', {}).get('burst_dps') or 0
    if burst_dps <= 0:
        return -float('inf')

    engagement_range = profile['engagementRange']
    fight_duration = profile['fightDuration']
    fleet = profile['fleet']
    weapon_range = weapon.get('projectile', {}).get('range') or 2000
    proj_speed = weapon.get('projectile', {}).get('speed') or 1400
    spread_deg = weapon.get('spread', {}).get('min') or weapon.get('spread', {}).get('max') or 0
    pellets = ((weapon.get('fire_rate', {}).get('modes') or [{}])[0]).get('pellets_per_shot', 1)

    penetration = (weapon.get('projectile', {}).get('penetration', {}).get('base_distance')) or 0
    pen_factor = calc_penetration_factor(penetration, slot_size, profile['name'])

    sustained_dps = calc_sustained_dps(weapon, cap_pool, fight_duration)

    total_weighted_dps = 0
    total_weight = 0

    for target in fleet:
        hit_prob = calc_hit_probability(
            proj_speed, spread_deg, target['scm'], target['crossSection'],
            engagement_range, pellets, weapon_range
        )
        armor_mult = calc_armor_mult(weapon, target['armorMults'])
        effective_dps = sustained_dps * hit_prob * armor_mult * pen_factor

        total_weighted_dps += effective_dps * target['weight']
        total_weight += target['weight']

    if total_weight <= 0:
        return 0

    return total_weighted_dps / total_weight


# ─── Optimization (mirrors JS optimizeLoadout for weapons) ───────────────────

def optimize_weapons(ship, weapons, profile_key):
    """Run weapon optimization for a ship and profile. Returns list of slot results."""
    profile = PROFILES[profile_key]
    slots = extract_hardpoints(ship)
    cap_pool = (ship.get('power_pools') or {}).get('WeaponGun', {}).get('size', 4)

    results = []
    for slot in slots['weapons']:
        fixed_size = slot['hardpointSize']
        gimbal_size = slot['hardpointSize'] - 1 if slot['mountType'] == 'gimbal' else slot['hardpointSize']

        scored = []
        for w in weapons:
            if w.get('size') == fixed_size:
                s = score_weapon(w, profile, fixed_size, cap_pool)
            elif gimbal_size != fixed_size and w.get('size') == gimbal_size:
                s = score_weapon(w, profile, gimbal_size, cap_pool, ref_size=fixed_size) * 0.95
            else:
                s = -float('inf')
            if math.isfinite(s):
                scored.append((w, s))
        scored.sort(key=lambda x: -x[1])

        best = scored[0] if scored else None
        results.append({
            'slot': slot,
            'best': best,
            'all_count': len(scored),
        })
    return results


# ─── TTK Calculation (simplified matchup against reference target) ───────────

def guess_dmg_type_from_weapon(weapon):
    """Determine damage type from weapon data."""
    dmg = weapon.get('damage', {}).get('alpha', {})
    if (dmg.get('physical') or 0) > 0:
        return 'physical'
    if (dmg.get('distortion') or 0) > 0:
        return 'distortion'
    return 'energy'


def calc_ttk(weapon_list, target_ship):
    """
    Calculate time-to-kill against target ship with the given weapon loadout.
    weapon_list: list of (weapon_data, burst_dps) tuples
    Returns dict with ttk data.
    """
    target_shield_hp = target_ship.get('shield', {}).get('shield_hp', 0)
    target_shield_regen = (target_ship.get('shield', {}).get('details') or {}).get('regeneration', 0)
    target_face = target_ship.get('shield', {}).get('face_type', 'Bubble')
    target_armor = target_ship.get('armor', {}).get('damage_multipliers', {})
    target_armor_hp = target_ship.get('armor', {}).get('armor_health', 0)
    target_hull = target_ship.get('hull_health', 0)

    eff_shield = target_shield_hp / 4 if target_face == 'Quadrant' else target_shield_hp

    total_raw_dps = 0
    total_eff_dps = 0

    for w, dps in weapon_list:
        dmg_type = guess_dmg_type_from_weapon(w)
        mult = target_armor.get(dmg_type, target_armor.get('energy', 1))
        total_raw_dps += dps
        total_eff_dps += dps * mult

    # Shield absorption: simplified — full absorption
    shield_absorption = target_ship.get('shield', {}).get('details', {}).get('absorption', {})
    total_dps_to_shield = 0
    total_bleedthrough = 0
    for w, dps in weapon_list:
        dmg_type = guess_dmg_type_from_weapon(w)
        abs_key = 'physical' if dmg_type == 'physical' else ('distortion' if dmg_type == 'distortion' else 'energy')
        abs_max = (shield_absorption.get(abs_key, {}) or {}).get('maximum', 1.0) if shield_absorption else 1.0
        if abs_max is None:
            abs_max = 1.0
        total_dps_to_shield += dps * abs_max
        mult = target_armor.get(dmg_type, target_armor.get('energy', 1))
        total_bleedthrough += dps * (1 - abs_max) * mult

    net_vs_shield = total_dps_to_shield - target_shield_regen
    can_break = net_vs_shield > 0
    ttk_shield = eff_shield / net_vs_shield if can_break else float('inf')
    bleed_during_shield = total_bleedthrough * ttk_shield if can_break else 0
    remaining_hull = max(0, (target_armor_hp + target_hull) - bleed_during_shield)
    ttk_hull = remaining_hull / total_eff_dps if total_eff_dps > 0 else float('inf')
    ttk_total = ttk_shield + ttk_hull

    return {
        'can_break': can_break,
        'ttk_shield': ttk_shield,
        'ttk_hull': ttk_hull,
        'ttk_total': ttk_total,
        'raw_dps': total_raw_dps,
        'eff_dps': total_eff_dps,
    }


# ─── Ship Classification ────────────────────────────────────────────────────

def get_ship_category(ship):
    """Categorize ship based on role and size for statistics."""
    role = (ship.get('role') or '').lower()
    size_class = ship.get('size_class', 0)
    career = (ship.get('career') or '').lower()

    if any(x in role for x in ['fighter', 'interceptor', 'superiority']):
        return 'Fighter'
    if any(x in role for x in ['bomber', 'gunship']):
        return 'Bomber/Gunship'
    if any(x in role for x in ['dropship', 'assault']):
        return 'Dropship/Assault'
    if 'combat' in career and size_class <= 3:
        return 'Combat Small/Med'
    if 'combat' in career:
        return 'Combat Large'
    if any(x in role for x in ['hauler', 'freight', 'cargo']):
        return 'Hauler'
    if any(x in role for x in ['mining', 'salvage', 'refinery']):
        return 'Industrial'
    if any(x in role for x in ['exploration', 'pathfinder', 'expedition']):
        return 'Explorer'
    if any(x in role for x in ['multi', 'medium']):
        return 'Multi-Role'
    return 'Other'


# ─── Main Validation ────────────────────────────────────────────────────────

def run_validation():
    print("=" * 70)
    print("  SC LOADOUT OPTIMIZER — FULL FLEET VALIDATION")
    print("  Scoring: Expected Effective DPS (data-driven, no type bonuses)")
    print("=" * 70)
    print()

    # Load data
    ships = load_json('ships.json')
    weapons = load_json('weapons.json')

    # Find Gladius as TTK reference
    gladius = None
    for s in ships:
        if s.get('name') == 'Gladius':
            gladius = s
            break

    if not gladius:
        print("FATAL: Gladius not found in ships.json! Cannot run validation.")
        return 1

    gladius_shield_hp = gladius.get('shield', {}).get('shield_hp', 0)
    gladius_hull = gladius.get('hull_health', 0)
    gladius_armor_hp = gladius.get('armor', {}).get('armor_health', 0)
    print(f"Reference target: Gladius (Shield={gladius_shield_hp} HP, "
          f"Hull={gladius_hull} HP, Armor={gladius_armor_hp} HP)")
    print()

    # Stats tracking
    pass_count = 0
    fail_count = 0
    skip_count = 0
    failures = []
    pve_weapon_counter = Counter()
    pvp_weapon_counter = Counter()
    pve_type_counter = Counter()
    pvp_type_counter = Counter()
    category_dps = defaultdict(list)

    tested_ships = 0

    for ship in ships:
        name = ship.get('name', '???')
        pilot_dps = (ship.get('weaponry') or {}).get('pilot_dps', 0)
        turrets = ship.get('turrets', {})
        has_turrets = any(len(turrets.get(t, [])) > 0 for t in ['manned', 'remote', 'pdc'])

        if not pilot_dps and not has_turrets:
            skip_count += 1
            continue

        slots = extract_hardpoints(ship)
        weapon_slots = slots['weapons']

        if not weapon_slots:
            skip_count += 1
            continue

        tested_ships += 1
        ship_issues = []
        category = get_ship_category(ship)

        # Validate hardpoint sizes
        for slot in weapon_slots:
            hp_size = slot['hardpointSize']
            if hp_size <= 0 or hp_size > 7:
                ship_issues.append(f"Invalid hardpoint size {hp_size} on {slot['hardpoint']}")

        # ─── PvE Optimization ────────────────────────────────────────────
        pve_results = optimize_weapons(ship, weapons, 'pve')
        pve_total_dps = 0
        pve_best_name = '?'

        for i, r in enumerate(pve_results):
            best = r['best']
            if not best:
                ship_issues.append(f"PvE Slot {i}: no weapon found")
                continue

            w_data, w_score = best
            w_name = w_data.get('name', '?')
            w_type = w_data.get('weapon_type', '?')
            w_size = w_data.get('size', 0)
            w_dps = w_data.get('damage', {}).get('burst_dps', 0) or 0
            hp_size = r['slot']['hardpointSize']
            mount_type = r['slot']['mountType']

            if mount_type == 'gimbal':
                valid_sizes = [hp_size, hp_size - 1]
            else:
                valid_sizes = [hp_size]
            if w_size not in valid_sizes:
                ship_issues.append(
                    f"PvE Slot {i}: S{hp_size} {mount_type} got S{w_size} weapon '{w_name}' "
                    f"(expected {valid_sizes})")

            if 'scattergun' in w_type.lower():
                ship_issues.append(f"PvE Slot {i}: Scattergun '{w_name}' recommended (bad for PvE)")

            if w_dps <= 0:
                ship_issues.append(f"PvE Slot {i}: DPS is 0 for '{w_name}'")

            if not math.isfinite(w_score):
                ship_issues.append(f"PvE Slot {i}: score is NaN/Inf for '{w_name}'")
            if not math.isfinite(w_dps):
                ship_issues.append(f"PvE Slot {i}: DPS is NaN/Inf for '{w_name}'")

            pve_total_dps += w_dps
            pve_weapon_counter[w_name] += 1
            pve_type_counter[w_type] += 1

        if pve_results and pve_results[0]['best']:
            pve_best_name = pve_results[0]['best'][0].get('name', '?')

        # ─── PvP Optimization ────────────────────────────────────────────
        pvp_results = optimize_weapons(ship, weapons, 'pvp')
        pvp_total_dps = 0

        for i, r in enumerate(pvp_results):
            best = r['best']
            if not best:
                ship_issues.append(f"PvP Slot {i}: no weapon found")
                continue

            w_data, w_score = best
            w_name = w_data.get('name', '?')
            w_type = w_data.get('weapon_type', '?')
            w_size = w_data.get('size', 0)
            w_dps = w_data.get('damage', {}).get('burst_dps', 0) or 0
            hp_size = r['slot']['hardpointSize']
            mount_type = r['slot']['mountType']

            if mount_type == 'gimbal':
                valid_sizes = [hp_size, hp_size - 1]
            else:
                valid_sizes = [hp_size]
            if w_size not in valid_sizes:
                ship_issues.append(
                    f"PvP Slot {i}: S{hp_size} {mount_type} got S{w_size} weapon '{w_name}' "
                    f"(expected {valid_sizes})")

            if w_dps <= 0:
                ship_issues.append(f"PvP Slot {i}: DPS is 0 for '{w_name}'")

            if not math.isfinite(w_score):
                ship_issues.append(f"PvP Slot {i}: score is NaN/Inf for '{w_name}'")

            pvp_total_dps += w_dps
            pvp_weapon_counter[w_name] += 1
            pvp_type_counter[w_type] += 1

        # ─── TTK Calculation vs Gladius ──────────────────────────────────
        ttk_issues = []
        weapon_loadout = []
        if pve_results:
            for r in pve_results:
                if r['best']:
                    w_data = r['best'][0]
                    w_dps = w_data.get('damage', {}).get('burst_dps', 0) or 0
                    weapon_loadout.append((w_data, w_dps))

            if weapon_loadout:
                ttk_data = calc_ttk(weapon_loadout, gladius)

                if ttk_data['can_break']:
                    if ttk_data['ttk_total'] <= 0:
                        ttk_issues.append(f"TTK is <= 0 ({ttk_data['ttk_total']:.2f}s)")
                    elif ttk_data['ttk_total'] > 1000:
                        ttk_issues.append(f"TTK is > 1000s ({ttk_data['ttk_total']:.1f}s) — implausible")
                    if not math.isfinite(ttk_data['ttk_total']):
                        ttk_issues.append(f"TTK is NaN/Inf")
                else:
                    if ttk_data['raw_dps'] > 1500:
                        ttk_issues.append(
                            f"Cannot break Gladius shields despite {ttk_data['raw_dps']:.0f} raw DPS")

        ship_issues.extend(ttk_issues)

        # Category DPS stats
        category_dps[category].append((name, pve_total_dps))

        # ─── Result ──────────────────────────────────────────────────────
        if ship_issues:
            fail_count += 1
            sizes = [f"S{s['hardpointSize']}" for s in weapon_slots]
            sizes_str = '+'.join(sizes)
            ttk_str = ""
            if weapon_loadout:
                ttk_d = calc_ttk(weapon_loadout, gladius)
                if ttk_d['can_break'] and math.isfinite(ttk_d['ttk_total']):
                    ttk_str = f", TTK={ttk_d['ttk_total']:.1f}s"
            print(f"Testing {name:30s} ... FAIL ({sizes_str}{ttk_str})")
            for iss in ship_issues:
                print(f"    -> {iss}")
            failures.append((name, ship_issues))
        else:
            pass_count += 1
            sizes = [f"S{s['hardpointSize']}" for s in weapon_slots]
            sizes_str = '+'.join(sizes)

            ttk_str = ""
            if pve_results and any(r['best'] for r in pve_results):
                weapon_loadout_disp = []
                for r in pve_results:
                    if r['best']:
                        w_data = r['best'][0]
                        w_dps = w_data.get('damage', {}).get('burst_dps', 0) or 0
                        weapon_loadout_disp.append((w_data, w_dps))
                if weapon_loadout_disp:
                    ttk_d = calc_ttk(weapon_loadout_disp, gladius)
                    if ttk_d['can_break'] and math.isfinite(ttk_d['ttk_total']):
                        ttk_str = f", TTK={ttk_d['ttk_total']:.1f}s"
                    elif not ttk_d['can_break']:
                        ttk_str = ", TTK=N/A (can't break shields)"

            print(f"Testing {name:30s} ... PASS ({sizes_str}, best={pve_best_name}, "
                  f"DPS={pve_total_dps:.0f}{ttk_str})")

    # ─── Summary ─────────────────────────────────────────────────────────────
    print()
    print("=" * 70)
    print("  SUMMARY")
    print("=" * 70)
    print(f"  Ships in database:    {len(ships)}")
    print(f"  Ships tested:         {tested_ships}")
    print(f"  Ships skipped:        {skip_count} (no pilot weapons / no extractable hardpoints)")
    print(f"  PASS:                 {pass_count}")
    print(f"  FAIL:                 {fail_count}")
    print()

    if failures:
        print("  FAILURES:")
        print("  " + "-" * 66)
        for ship_name, issues in failures:
            print(f"  {ship_name}:")
            for iss in issues:
                print(f"    - {iss}")
        print()

    # Top weapons by name
    print("  TOP 10 PvE WEAPONS (most recommended):")
    print("  " + "-" * 66)
    for wname, count in pve_weapon_counter.most_common(10):
        print(f"    {wname:40s} ({count}x)")
    print()

    print("  TOP 10 PvP WEAPONS (most recommended):")
    print("  " + "-" * 66)
    for wname, count in pvp_weapon_counter.most_common(10):
        print(f"    {wname:40s} ({count}x)")
    print()

    # Top weapon TYPES
    print("  PvE WEAPON TYPES (distribution):")
    print("  " + "-" * 66)
    for wtype, count in pve_type_counter.most_common():
        print(f"    {wtype:40s} ({count}x)")
    print()

    print("  PvP WEAPON TYPES (distribution):")
    print("  " + "-" * 66)
    for wtype, count in pvp_type_counter.most_common():
        print(f"    {wtype:40s} ({count}x)")
    print()

    # DPS statistics by category
    print("  DPS STATISTICS BY CATEGORY (PvE burst DPS):")
    print("  " + "-" * 66)
    print(f"  {'Category':25s} {'Ships':>6s} {'Min DPS':>10s} {'Avg DPS':>10s} {'Max DPS':>10s}")
    print("  " + "-" * 66)
    for cat in sorted(category_dps.keys()):
        entries = category_dps[cat]
        dps_vals = [d for _, d in entries]
        min_d = min(dps_vals)
        max_d = max(dps_vals)
        avg_d = sum(dps_vals) / len(dps_vals)
        print(f"  {cat:25s} {len(entries):>6d} {min_d:>10.0f} {avg_d:>10.0f} {max_d:>10.0f}")
    print()

    # Plausibility checks
    print("  PLAUSIBILITY CHECKS:")
    print("  " + "-" * 66)

    # No scattergun in any top 5
    pve_top5_names = [n for n, _ in pve_weapon_counter.most_common(5)]
    pvp_top5_names = [n for n, _ in pvp_weapon_counter.most_common(5)]
    scatter_in_top = False
    for n in pve_top5_names + pvp_top5_names:
        if 'scatter' in n.lower():
            scatter_in_top = True
            print(f"  [!!] Scattergun '{n}' in top 5 — suspicious!")
    if not scatter_in_top:
        print("  [OK] No Scatterguns in top 5 (expected)")

    # Check that PvP favors higher proj-speed weapons (ballistic cannons have ~1200 m/s)
    pvp_top3_types = set()
    for wname, _ in pvp_weapon_counter.most_common(3):
        for w in weapons:
            if w.get('name') == wname:
                pvp_top3_types.add(w.get('weapon_type', ''))
                break

    # Check PvE favors sustained-DPS weapons
    pve_top3_types = set()
    for wname, _ in pve_weapon_counter.most_common(3):
        for w in weapons:
            if w.get('name') == wname:
                pve_top3_types.add(w.get('weapon_type', ''))
                break

    print(f"  PvE top 3 weapon types: {sorted(pve_top3_types)}")
    print(f"  PvP top 3 weapon types: {sorted(pvp_top3_types)}")

    # Distortion weapons should be rare/absent (they do 0 hull damage)
    if 'Distortion Repeater' in pve_top3_types or 'Distortion Cannon' in pve_top3_types:
        print("  [!!] Distortion weapon in PvE top 3 — unexpected (0 hull damage)")
    else:
        print("  [OK] No distortion weapons in PvE top 3")

    if 'Distortion Repeater' in pvp_top3_types or 'Distortion Cannon' in pvp_top3_types:
        print("  [!!] Distortion weapon in PvP top 3 — unexpected (0 hull damage)")
    else:
        print("  [OK] No distortion weapons in PvP top 3")

    print()
    if fail_count == 0:
        print("  >>> ALL SHIPS PASSED <<<")
    else:
        print(f"  >>> {fail_count} SHIP(S) FAILED <<<")
    print()

    return 0 if fail_count == 0 else 1


if __name__ == '__main__':
    sys.exit(run_validation())
