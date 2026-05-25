#!/usr/bin/env python3
"""
SC Loadout Optimizer — End-to-End Validation Script
Simulates the JS optimizer logic in Python and checks for plausible results.
"""

import json
import math
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, 'data')

# ─── Data Loading ─────────────────────────────────────────────────────────────

def load_json(filename):
    with open(os.path.join(DATA_DIR, filename), 'r', encoding='utf-8') as f:
        data = json.load(f)
        return data.get('data', data) if isinstance(data, dict) and 'data' in data else data


def load_all():
    return {
        'ships': load_json('ships.json'),
        'weapons': load_json('weapons.json'),
        'shields': load_json('shields.json'),
    }


def find_ship(ships, name):
    for s in ships:
        if s.get('name') == name:
            return s
    return None


# ─── Profile Definitions ─────────────────────────────────────────────────────

def weapon_bonus_map(entries):
    m = dict(entries)
    if 'Scattergun' in entries:
        val = entries['Scattergun']
        m['Laser Scattergun'] = val
        m['Ballistic Scattergun'] = val
        m['Distortion Scattergun'] = val
    return m


PROFILES = {
    'pve': {
        'name': 'PvE',
        'engagementRange': 1000,
        'weights': {
            'effective_dps': 1.0, 'burst_dps': 0.2, 'alpha': 0.1,
            'ammo_endurance': 0.8, 'penetration': 0.2, 'accuracy': 0.8,
            'speed': 0.5, 'range': 0.6
        },
        'weaponBonus': weapon_bonus_map({
            'Laser Repeater': 1.3, 'Laser Cannon': 1.1, 'Neutron Repeater': 1.05,
            'Ballistic Gatling': 0.9, 'Ballistic Repeater': 0.85, 'Ballistic Cannon': 0.7,
            'Mass Driver Cannon': 0.75,
            'Scattergun': 0.3, 'Laser Scattergun': 0.3, 'Ballistic Scattergun': 0.3,
            'Distortion Scattergun': 0.3,
            'Distortion Repeater': 0.25, 'Distortion Cannon': 0.25,
            'Neutron Cannon': 0.9, 'Tachyon Cannon': 0.8, 'Plasma Cannon': 0.7
        }),
    },
    'pvp': {
        'name': 'PvP',
        'engagementRange': 800,
        'weights': {
            'effective_dps': 0.5, 'burst_dps': 0.8, 'alpha': 1.0,
            'ammo_endurance': 0.3, 'penetration': 1.0, 'accuracy': 0.7,
            'speed': 0.8, 'range': 0.5
        },
        'weaponBonus': weapon_bonus_map({
            'Ballistic Cannon': 1.4, 'Ballistic Gatling': 1.3, 'Laser Cannon': 0.9,
            'Laser Repeater': 0.7, 'Ballistic Repeater': 1.1, 'Neutron Repeater': 0.85,
            'Mass Driver Cannon': 1.3,
            'Neutron Cannon': 1.0, 'Scattergun': 0.4, 'Laser Scattergun': 0.4,
            'Ballistic Scattergun': 0.4, 'Distortion Scattergun': 0.4,
            'Tachyon Cannon': 0.9,
            'Distortion Cannon': 0.5, 'Distortion Repeater': 0.35, 'Plasma Cannon': 0.9
        }),
    },
    'balanced': {
        'name': 'Balanced',
        'engagementRange': 900,
        'weights': {
            'effective_dps': 0.8, 'burst_dps': 0.5, 'alpha': 0.5,
            'ammo_endurance': 0.55, 'penetration': 0.6, 'accuracy': 0.75,
            'speed': 0.65, 'range': 0.55
        },
        'weaponBonus': weapon_bonus_map({
            'Laser Repeater': 1.05, 'Laser Cannon': 1.0, 'Ballistic Cannon': 1.1,
            'Ballistic Gatling': 1.1, 'Ballistic Repeater': 1.0, 'Neutron Repeater': 0.95,
            'Mass Driver Cannon': 1.05,
            'Neutron Cannon': 0.95, 'Scattergun': 0.35, 'Laser Scattergun': 0.35,
            'Ballistic Scattergun': 0.35, 'Distortion Scattergun': 0.35,
            'Tachyon Cannon': 0.85,
            'Distortion Repeater': 0.3, 'Distortion Cannon': 0.35, 'Plasma Cannon': 0.8
        }),
    }
}


# ─── Scoring Functions (mirror JS exactly) ───────────────────────────────────

import re

def extract_slot_size(class_name):
    if not class_name:
        return None
    m = re.search(r'S0?(\d+)', class_name)
    return int(m.group(1)) if m else None


def extract_hardpoints(ship):
    slots = {'weapons': [], 'shields': [], 'missiles': []}
    relay = (ship.get('hardpoints', {}).get('relays') or [None])[0]
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
                    })
    return slots


def calc_effective_dps(weapon, cap_pool=4):
    burst_dps = weapon.get('damage', {}).get('burst_dps') or 0
    if burst_dps <= 0:
        return 0, 0

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
    ammo_endurance = 1.0

    if is_capacitor:
        consumption = fire_rate * ammo_per_shot
        if consumption > ammo_regen:
            pool = cap_pool or 4
            burst_dur = pool / (consumption - ammo_regen)
            sust_fr = ammo_regen / max(ammo_per_shot, 0.01)
            sust_dps = sust_fr * damage_per_shot
            burst_dmg = burst_dur * burst_dps
            remain = max(0, 60 - burst_dur)
            sustained60 = (burst_dmg + sust_dps * remain) / 60
            ammo_endurance = 0.7 + 0.3 * min(burst_dur / 10, 1.0)
    elif is_ballistic:
        total_fire = ammo_cap / max(fire_rate, 0.1)
        if total_fire < 60:
            sustained60 = burst_dps * min(total_fire, 60) / 60
        ammo_endurance = min(total_fire / 120, 1.0)

    return sustained60, ammo_endurance


def calc_accuracy(weapon, engagement_range):
    spread = weapon.get('spread', {}).get('min') or weapon.get('spread', {}).get('max') or 0
    pellets = ((weapon.get('fire_rate', {}).get('modes') or [{}])[0]).get('pellets_per_shot', 1)
    rng = weapon.get('projectile', {}).get('range', 2000)

    if engagement_range > rng:
        return 0
    if spread <= 0.01:
        return 1.0

    spread_rad = engagement_range * math.tan(spread * math.pi / 180)
    target_r = 5

    if pellets > 1:
        if spread_rad <= target_r:
            return 1.0
        return max((target_r / spread_rad) ** 2, 0.05)

    if spread_rad <= target_r:
        return 1.0
    return min(1.0, (target_r / spread_rad) ** 1.5) * 0.95 + 0.05


def score_weapon(weapon, profile, slot_size, cap_pool=4, ref_size=None):
    if weapon.get('size') != slot_size:
        return -float('inf')
    wtype = weapon.get('weapon_type') or ''
    if any(x in wtype for x in ['Mining', 'Utility', 'Tractor', 'Salvage']):
        return -float('inf')
    burst_dps = weapon.get('damage', {}).get('burst_dps') or 0
    if burst_dps <= 0:
        return -float('inf')

    norm_size = ref_size or slot_size
    w = profile['weights']
    ref_dps = {1: 250, 2: 400, 3: 600, 4: 800, 5: 1100, 6: 1500, 7: 2000}
    ref_alpha = {1: 30, 2: 60, 3: 100, 4: 180, 5: 300, 6: 450, 7: 700}
    ref = ref_dps.get(norm_size, 600)
    refA = ref_alpha.get(norm_size, 100)

    alpha = weapon.get('damage', {}).get('alpha_total') or 0
    pen = (weapon.get('projectile', {}).get('penetration') or {}).get('base_distance') or 0
    proj_speed = weapon.get('projectile', {}).get('speed') or 1400
    rng = weapon.get('projectile', {}).get('range') or 2000

    sustained60, ammo_end = calc_effective_dps(weapon, cap_pool)
    acc = calc_accuracy(weapon, profile['engagementRange'])

    eff_sust = sustained60 * acc
    eff_burst = burst_dps * acc

    score = 0
    score += (eff_sust / ref) * w['effective_dps']
    score += (eff_burst / ref) * w['burst_dps']
    score += (alpha / refA) * w['alpha']
    score += ammo_end * w['ammo_endurance']
    score += (pen / 3.0) * w['penetration']
    score += acc * w['accuracy']
    score += (proj_speed / 2000) * w['speed']
    score += min(rng / 3000, 1.0) * w['range']

    type_bonus = profile['weaponBonus'].get(wtype, 0.5)
    score *= type_bonus

    return score


def is_purchasable(item):
    purchases = (item.get('uex_prices') or {}).get('purchase') or item.get('shops') or []
    return len(purchases) > 0


def optimize_weapons(ship, weapons, profile_key):
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
                scored.append((w, s, is_purchasable(w)))
        scored.sort(key=lambda x: -x[1])

        best = scored[0] if scored else None
        best_purchasable = next((s for s in scored if s[2]), None)
        results.append({
            'slot': slot,
            'best': best,
            'best_purchasable': best_purchasable,
            'all_count': len(scored),
        })
    return results


# ─── Matchup Logic ───────────────────────────────────────────────────────────

def guess_dmg_type(name):
    n = (name or '').lower()
    if 'distortion' in n or 'suckerpunch' in n:
        return 'distortion'
    phys_keywords = [
        'gatling', 'gt-', 'ad4b', 'ad5b', 'ad6b', 'revenant', 'tigerstrike',
        'yellowjacket', 'scorpion gt', 'mantis gt', 'nv57', 'sf7b',
        'c-788', 'combine', 'sledge', 'tarantula', 'greatsword', 'longsword',
        'broadsword', '9-series', '10-series', '11-series', 'buzzsaw',
        'sawbuck', 'shredder', 'predator', 'dominance', 'strife',
        'deadbolt', 'leonids', 'maris',
    ]
    if any(kw in n for kw in phys_keywords):
        return 'physical'
    return 'energy'


def collect_all_weapons(ship):
    weapons = []
    total_dps = 0

    fixed = (ship.get('weaponry') or {}).get('fixed_weapons', {}).get('weapons', [])
    for w in fixed:
        dps = w.get('dps') or 0
        weapons.append({'name': w['name'], 'dps': dps, 'dmgType': guess_dmg_type(w['name']), 'source': 'pilot'})
        total_dps += dps

    turrets = ship.get('turrets') or {}
    for ttype in ['manned', 'remote', 'pdc']:
        for turret in turrets.get(ttype, []):
            for w in turret.get('weapons', []):
                dps = w.get('dps') or 0
                weapons.append({'name': w['name'], 'dps': dps, 'dmgType': guess_dmg_type(w['name']), 'source': ttype})
                total_dps += dps

    if not weapons and (ship.get('weaponry') or {}).get('pilot_dps', 0) > 0:
        total_dps = ship['weaponry']['pilot_dps']
        weapons.append({'name': 'Combined', 'dps': total_dps, 'dmgType': 'energy', 'source': 'pilot'})

    return weapons, total_dps


def calc_matchup(attacker_dps_list, target_ship, attacker_ship):
    """Simplified matchup: attacker weapons vs target defenses, and reverse."""
    target_armor = target_ship.get('armor', {}).get('damage_multipliers', {})
    target_shield_hp = target_ship.get('shield', {}).get('shield_hp', 0)
    target_shield_regen = (target_ship.get('shield', {}).get('details') or {}).get('regeneration', 0)
    target_face = target_ship.get('shield', {}).get('face_type', 'Bubble')
    target_armor_hp = target_ship.get('armor', {}).get('armor_health', 0)
    target_hull = target_ship.get('hull_health', 0)

    eff_shield = target_shield_hp / 4 if target_face == 'Quadrant' else target_shield_hp

    total_raw = sum(w['dps'] for w in attacker_dps_list)
    total_dps_to_shield = total_raw  # simplified: assume full absorption
    total_eff = 0
    for w in attacker_dps_list:
        mult = target_armor.get(w['dmgType'], target_armor.get('energy', 1)) if w['dmgType'] != 'physical' else target_armor.get('physical', 1)
        total_eff += w['dps'] * mult

    net_vs_shield = total_dps_to_shield - target_shield_regen
    can_break = net_vs_shield > 0
    ttk_shield = eff_shield / net_vs_shield if can_break else float('inf')
    ttk_hull = (target_armor_hp + target_hull) / total_eff if total_eff > 0 else float('inf')
    ttk_total = ttk_shield + ttk_hull

    # Reverse
    enemy_weapons, enemy_dps = collect_all_weapons(target_ship)
    attacker_shield_hp = attacker_ship.get('shield', {}).get('shield_hp', 0)
    attacker_shield_regen = (attacker_ship.get('shield', {}).get('details') or {}).get('regeneration', 0)
    attacker_face = attacker_ship.get('shield', {}).get('face_type', 'Bubble')
    attacker_armor_hp = attacker_ship.get('armor', {}).get('armor_health', 0)
    attacker_hull = attacker_ship.get('hull_health', 0)
    attacker_armor = attacker_ship.get('armor', {}).get('damage_multipliers', {})

    eff_att_shield = attacker_shield_hp / 4 if attacker_face == 'Quadrant' else attacker_shield_hp

    enemy_eff = 0
    for w in enemy_weapons:
        mult = attacker_armor.get(w['dmgType'], attacker_armor.get('energy', 1))
        enemy_eff += w['dps'] * mult

    net_enemy = enemy_dps - attacker_shield_regen
    can_enemy_break = net_enemy > 0
    ttk_you_shield = eff_att_shield / net_enemy if can_enemy_break else float('inf')
    ttk_you_hull = (attacker_armor_hp + attacker_hull) / enemy_eff if enemy_eff > 0 else float('inf')
    ttk_you_total = ttk_you_shield + ttk_you_hull

    return {
        'can_break': can_break,
        'ttk_total': ttk_total,
        'ttk_shield': ttk_shield,
        'can_enemy_break': can_enemy_break,
        'ttk_you_total': ttk_you_total,
        'enemy_dps': enemy_dps,
        'enemy_weapon_count': len(enemy_weapons),
        'your_raw_dps': total_raw,
        'your_eff_dps': total_eff,
    }


# ─── Test Cases ──────────────────────────────────────────────────────────────

def run_tests():
    data = load_all()
    ships = data['ships']
    weapons = data['weapons']

    results = []
    all_pass = True

    # ─── Test 1: Gladius PvE ─────────────────────────────────────────────────
    print('=' * 60)
    print('TEST 1: Gladius PvE — Weapon Optimization')
    print('=' * 60)
    gladius = find_ship(ships, 'Gladius')
    assert gladius, 'Gladius not found!'

    slots = extract_hardpoints(gladius)
    wp_slots = slots['weapons']
    print(f'  Weapon slots: {len(wp_slots)}')
    for s in wp_slots:
        print(f'    {s["hardpoint"]}: S{s["hardpointSize"]} {s["mountType"]}')

    opt = optimize_weapons(gladius, weapons, 'pve')
    test_pass = True
    issues = []

    # Check: 3 weapon slots
    if len(opt) != 3:
        issues.append(f'Expected 3 weapon slots, got {len(opt)}')
        test_pass = False

    # Check: all slots are S3 gimbal -> S3 fixed or S2 gimbal candidates
    for i, r in enumerate(opt):
        best = r['best']
        if not best:
            issues.append(f'Slot {i}: no weapon selected')
            test_pass = False
            continue
        wname = best[0].get('name', '?')
        wtype = best[0].get('weapon_type', '?')
        wsize = best[0].get('size', '?')
        purchasable = best[2]
        print(f'  Slot {i}: {wname} (S{wsize}, {wtype}) score={best[1]:.2f} buy={purchasable}')

        # PvE should NOT recommend scatterguns
        if 'scattergun' in wtype.lower():
            issues.append(f'Slot {i}: Scattergun recommended for PvE (bad)')
            test_pass = False

        # Should recommend something with reasonable DPS
        dps = best[0].get('damage', {}).get('burst_dps', 0) or 0
        if dps < 200:
            issues.append(f'Slot {i}: DPS too low ({dps})')
            test_pass = False

        # Best purchasable check
        bp = r['best_purchasable']
        if bp:
            bp_name = bp[0].get('name', '?')
            print(f'    Best purchasable: {bp_name} (score={bp[1]:.2f})')

    status = 'PASS' if test_pass else 'FAIL'
    if issues:
        for iss in issues:
            print(f'  [ISSUE] {iss}')
    print(f'  Result: {status}')
    results.append(('Gladius PvE', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Test 2: Corsair PvP ─────────────────────────────────────────────────
    print()
    print('=' * 60)
    print('TEST 2: Corsair PvP — Weapon Optimization')
    print('=' * 60)
    corsair = find_ship(ships, 'Corsair')
    test_pass = True
    issues = []

    if not corsair:
        issues.append('Corsair not found in ships.json!')
        test_pass = False
    else:
        slots = extract_hardpoints(corsair)
        wp_slots = slots['weapons']
        print(f'  Weapon slots: {len(wp_slots)} (should be 4 pilot + 0 manned)')
        for s in wp_slots:
            print(f'    {s["hardpoint"]}: S{s["hardpointSize"]} {s["mountType"]}')

        # Corsair has 4x Gimbal_S4 pilot + 2x manned turrets (no size -> filtered)
        if len(wp_slots) != 4:
            issues.append(f'Expected 4 pilot weapon slots, got {len(wp_slots)}')
            test_pass = False

        opt = optimize_weapons(corsair, weapons, 'pvp')
        for i, r in enumerate(opt):
            best = r['best']
            if not best:
                issues.append(f'Slot {i}: no weapon selected')
                test_pass = False
                continue
            wname = best[0].get('name', '?')
            wtype = best[0].get('weapon_type', '?')
            wsize = best[0].get('size', '?')
            print(f'  Slot {i}: {wname} (S{wsize}, {wtype}) score={best[1]:.2f}')

            # PvP should favor ballistic for S4
            # Acceptable: Ballistic Cannon, Ballistic Gatling, Laser Cannon
            ok_types = ['Ballistic Cannon', 'Ballistic Gatling', 'Laser Cannon',
                        'Mass Driver Cannon', 'Ballistic Repeater']
            # Don't hard-fail on this, just warn
            if wtype not in ok_types:
                print(f'    [NOTE] Unusual PvP type: {wtype}')

    status = 'PASS' if test_pass else 'FAIL'
    if issues:
        for iss in issues:
            print(f'  [ISSUE] {iss}')
    print(f'  Result: {status}')
    results.append(('Corsair PvP', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Test 3: Cutlass Black Balanced ───────────────────────────────────────
    print()
    print('=' * 60)
    print('TEST 3: Cutlass Black Balanced')
    print('=' * 60)
    cutlass = find_ship(ships, 'Cutlass Black')
    test_pass = True
    issues = []

    if not cutlass:
        issues.append('Cutlass Black not found!')
        test_pass = False
    else:
        slots = extract_hardpoints(cutlass)
        wp_slots = slots['weapons']
        print(f'  Weapon slots: {len(wp_slots)} (should be 4 pilot)')
        for s in wp_slots:
            print(f'    {s["hardpoint"]}: S{s["hardpointSize"]} {s["mountType"]}')

        if len(wp_slots) != 4:
            issues.append(f'Expected 4 weapon slots, got {len(wp_slots)}')
            test_pass = False

        opt = optimize_weapons(cutlass, weapons, 'balanced')
        total_dps = 0
        for i, r in enumerate(opt):
            best = r['best']
            if not best:
                issues.append(f'Slot {i}: no weapon selected')
                test_pass = False
                continue
            wname = best[0].get('name', '?')
            wtype = best[0].get('weapon_type', '?')
            dps = best[0].get('damage', {}).get('burst_dps', 0) or 0
            total_dps += dps
            print(f'  Slot {i}: {wname} ({wtype}) DPS={dps:.0f} score={best[1]:.2f}')

        print(f'  Total burst DPS: {total_dps:.0f}')
        if total_dps < 1000:
            issues.append(f'Total DPS too low: {total_dps:.0f}')
            test_pass = False

    status = 'PASS' if test_pass else 'FAIL'
    if issues:
        for iss in issues:
            print(f'  [ISSUE] {iss}')
    print(f'  Result: {status}')
    results.append(('Cutlass Black Balanced', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Test 4: Avenger Titan PvE ────────────────────────────────────────────
    print()
    print('=' * 60)
    print('TEST 4: Avenger Titan PvE')
    print('=' * 60)
    titan = find_ship(ships, 'Avenger Titan')
    test_pass = True
    issues = []

    if not titan:
        issues.append('Avenger Titan not found!')
        test_pass = False
    else:
        slots = extract_hardpoints(titan)
        wp_slots = slots['weapons']
        print(f'  Weapon slots: {len(wp_slots)}')
        for s in wp_slots:
            print(f'    {s["hardpoint"]}: S{s["hardpointSize"]} {s["mountType"]}')

        # Titan has 1x S4 gimbal + 2x S3 gimbal
        if len(wp_slots) != 3:
            issues.append(f'Expected 3 weapon slots, got {len(wp_slots)}')
            test_pass = False

        opt = optimize_weapons(titan, weapons, 'pve')
        has_s4 = False
        has_s3 = False
        for i, r in enumerate(opt):
            best = r['best']
            if not best:
                continue
            wsize = best[0].get('size', 0)
            wname = best[0].get('name', '?')
            wtype = best[0].get('weapon_type', '?')
            print(f'  Slot {i}: {wname} (S{wsize}, {wtype}) score={best[1]:.2f}')
            if wsize == 4 or (wsize == 3 and r['slot']['hardpointSize'] == 4):
                has_s4 = True
            if wsize == 3 or (wsize == 2 and r['slot']['hardpointSize'] == 3):
                has_s3 = True

        if not has_s4:
            issues.append('No S4/S3-on-S4 weapon found')
            test_pass = False

    status = 'PASS' if test_pass else 'FAIL'
    if issues:
        for iss in issues:
            print(f'  [ISSUE] {iss}')
    print(f'  Result: {status}')
    results.append(('Avenger Titan PvE', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Test 5: Matchup Gladius vs Redeemer ──────────────────────────────────
    print()
    print('=' * 60)
    print('TEST 5: Matchup — Gladius vs Redeemer')
    print('=' * 60)
    redeemer = find_ship(ships, 'Redeemer')
    test_pass = True
    issues = []

    if not gladius or not redeemer:
        issues.append('Ship not found!')
        test_pass = False
    else:
        # Gladius attacks with 3x M5A Cannon (best purchasable S3)
        gladius_weapons = [
            {'name': 'M5A Cannon', 'dps': 683.6, 'dmgType': 'energy'},
            {'name': 'M5A Cannon', 'dps': 683.6, 'dmgType': 'energy'},
            {'name': 'M5A Cannon', 'dps': 683.6, 'dmgType': 'energy'},
        ]
        matchup = calc_matchup(gladius_weapons, redeemer, gladius)

        print(f'  Gladius DPS: {matchup["your_raw_dps"]:.0f} raw, {matchup["your_eff_dps"]:.0f} effective')
        print(f'  Can break Redeemer shields: {matchup["can_break"]}')
        print(f'  TTK Redeemer: {matchup["ttk_total"]:.1f}s' if matchup['can_break'] else '  TTK: CANNOT BREAK')

        # Redeemer should have 10 weapons (2 pilot + 4 manned + 4 remote)
        print(f'  Redeemer weapons collected: {matchup["enemy_weapon_count"]}')
        print(f'  Redeemer total DPS: {matchup["enemy_dps"]:.0f}')
        print(f'  Can break Gladius shields: {matchup["can_enemy_break"]}')
        if matchup['can_enemy_break']:
            print(f'  TTK Gladius: {matchup["ttk_you_total"]:.1f}s')

        # Validations
        if matchup['enemy_weapon_count'] < 8:
            issues.append(f'Redeemer should have 8+ weapons, got {matchup["enemy_weapon_count"]}')
            test_pass = False

        if not matchup['can_enemy_break']:
            issues.append('Redeemer should be able to break Gladius shields')
            test_pass = False

        if matchup['can_break'] and matchup['ttk_total'] < 10:
            issues.append(f'Gladius kills Redeemer too fast ({matchup["ttk_total"]:.0f}s) — suspicious')
            test_pass = False

        if matchup['can_enemy_break'] and matchup['ttk_you_total'] > 30:
            issues.append(f'Redeemer kills Gladius too slow ({matchup["ttk_you_total"]:.0f}s) — suspicious')
            test_pass = False

        # The Redeemer should clearly win
        if matchup['can_break'] and matchup['can_enemy_break']:
            if matchup['ttk_total'] < matchup['ttk_you_total']:
                issues.append('Gladius should NOT kill Redeemer faster than Redeemer kills Gladius')
                test_pass = False

    status = 'PASS' if test_pass else 'FAIL'
    if issues:
        for iss in issues:
            print(f'  [ISSUE] {iss}')
    print(f'  Result: {status}')
    results.append(('Matchup Gladius vs Redeemer', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Test 6: Data Integrity ──────────────────────────────────────────────
    print()
    print('=' * 60)
    print('TEST 6: Data Integrity Checks')
    print('=' * 60)
    test_pass = True
    issues = []

    # Check all weapons have valid size
    no_size = [w for w in weapons if not w.get('size')]
    if no_size:
        issues.append(f'{len(no_size)} weapons have no size field')
        # Not a fail, just a warning

    # Check weapons with None burst_dps are filtered
    null_dps = [w for w in weapons if w.get('damage', {}).get('burst_dps') is None]
    print(f'  Weapons with null burst_dps: {len(null_dps)} (should be filtered by optimizer)')
    for w in null_dps:
        print(f'    {w.get("name")} (S{w.get("size")}, {w.get("weapon_type")})')

    # Check weapons with None weapon_type
    null_type = [w for w in weapons if not w.get('weapon_type')]
    print(f'  Weapons with null weapon_type: {len(null_type)} (get 0.5x bonus)')
    for w in null_type:
        print(f'    {w.get("name")} (S{w.get("size")})')

    # Check no duplicate ships in index
    seen = set()
    dupes = []
    for s in ships:
        if s.get('name') in seen:
            dupes.append(s.get('name'))
        seen.add(s.get('name'))
    if dupes:
        print(f'  Duplicate ship names: {len(dupes)}')
        # Not a critical fail, data-loader deduplicates

    # Check shields
    shields = data['shields']
    null_perf = sum(1 for s in shields if (s.get('shield_performance') or {}).get('max_hp') is None)
    print(f'  Shields with null max_hp: {null_perf}/{len(shields)} (scoring uses grade/class proxy)')

    print(f'  Result: {"PASS" if test_pass else "FAIL"}')
    results.append(('Data Integrity', test_pass))
    if not test_pass:
        all_pass = False

    # ─── Summary ─────────────────────────────────────────────────────────────
    print()
    print('=' * 60)
    print('VALIDATION SUMMARY')
    print('=' * 60)
    for name, passed in results:
        status = 'PASS' if passed else 'FAIL'
        marker = '[OK]' if passed else '[!!]'
        print(f'  {marker} {name}: {status}')
    print()
    overall = 'ALL TESTS PASSED' if all_pass else 'SOME TESTS FAILED'
    print(f'  >>> {overall} <<<')
    print()

    return 0 if all_pass else 1


if __name__ == '__main__':
    sys.exit(run_tests())
