import { formatNumber } from './stats-calculator.js';

export function calculateMatchup(attackerShip, loadout, targetShip) {
    const targetArmor = targetShip.armor?.damage_multipliers || {};
    const targetShield = targetShip.shield || {};
    const targetHull = targetShip.hull_health || 0;
    const targetArmorHp = targetShip.armor?.armor_health || 0;
    const shieldHp = targetShield.shield_hp || 0;
    const shieldRegen = targetShield.details?.regeneration || 0;
    const shieldAbsorption = targetShield.details?.absorption || {};
    const shieldFaceType = targetShield.face_type || 'Bubble';

    const effectiveShieldHp = shieldFaceType === 'Quadrant' ? shieldHp / 4 : shieldHp;

    const weaponMatchups = [];
    let totalRawDps = 0;
    let totalEffDps = 0;
    let totalDpsToShield = 0;
    let totalBleedthrough = 0;

    for (const wr of loadout.weapons) {
        const w = wr.selected;
        if (!w) continue;

        const rawDps = w.damage?.burst_dps || 0;
        const alpha = w.damage?.alpha_total || 0;
        const pen = w.projectile?.penetration?.base_distance || 0;
        const dmgType = getDmgType(w);
        const mult = getArmorMultiplier(dmgType, targetArmor);
        const effDps = rawDps * mult;
        const effAlpha = alpha * mult;

        const absKey = dmgType === 'physical' ? 'physical' : dmgType === 'distortion' ? 'distortion' : 'energy';
        const absMax = shieldAbsorption?.[absKey]?.maximum ?? 1.0;
        const dpsAbsorbedByShield = rawDps * absMax;
        const dpsBleedthrough = rawDps * (1 - absMax);

        totalRawDps += rawDps;
        totalEffDps += effDps;
        totalDpsToShield += dpsAbsorbedByShield;
        totalBleedthrough += dpsBleedthrough * mult;

        weaponMatchups.push({
            name: w.name, size: w.size, type: w.weapon_type, dmgType,
            rawDps, armorMult: mult, effDps, alpha, effAlpha, penetration: pen,
            range: w.projectile?.range || 0, projSpeed: w.projectile?.speed || 0,
            dpsReduction: rawDps - effDps, reductionPct: ((1 - mult) * 100),
            shieldAbsorption: absMax, bleedthrough: dpsBleedthrough
        });
    }

    const netDpsVsShield = totalDpsToShield - shieldRegen;
    const canBreakShield = netDpsVsShield > 0;
    const ttk_shield = canBreakShield ? effectiveShieldHp / netDpsVsShield : Infinity;
    const bleedDmgDuringShield = canBreakShield ? totalBleedthrough * ttk_shield : 0;
    const remainingHullAfterBleed = Math.max(0, (targetArmorHp + targetHull) - bleedDmgDuringShield);
    const ttk_armor_hull = totalEffDps > 0 ? remainingHullAfterBleed / totalEffDps : Infinity;
    const ttk_total = ttk_shield + ttk_armor_hull;

    const attackerShield = attackerShip.shield?.shield_hp || 0;
    const attackerHull = attackerShip.hull_health || 0;
    const attackerArmorHp = attackerShip.armor?.armor_health || 0;
    const attackerFaceType = attackerShip.shield?.face_type || 'Bubble';
    const effectiveAttackerShield = attackerFaceType === 'Quadrant' ? attackerShield / 4 : attackerShield;

    const allTargetWeapons = collectAllWeapons(targetShip);
    const targetDps = allTargetWeapons.totalDps;
    const targetSustained = targetShip.weaponry?.pilot_sustained_dps || 0;

    let targetEffDpsVsAttacker = 0;
    let targetDpsVsAttackerShield = 0;
    for (const tw of allTargetWeapons.weapons) {
        const twMult = getArmorMultiplier(tw.dmgType, attackerShip.armor?.damage_multipliers || {});
        targetEffDpsVsAttacker += tw.dps * twMult;
        targetDpsVsAttackerShield += tw.dps;
    }
    if (targetEffDpsVsAttacker === 0 && targetDps > 0) {
        const avgMult = ((attackerShip.armor?.damage_multipliers?.physical || 1) + (attackerShip.armor?.damage_multipliers?.energy || 1)) / 2;
        targetEffDpsVsAttacker = targetDps * avgMult;
        targetDpsVsAttackerShield = targetDps;
    }

    const attackerShieldRegen = attackerShip.shield?.details?.regeneration || 0;
    const netEnemyDps = targetDpsVsAttackerShield - attackerShieldRegen;
    const canEnemyBreakShield = netEnemyDps > 0;
    const ttk_you_shield = canEnemyBreakShield ? effectiveAttackerShield / netEnemyDps : Infinity;
    const ttk_you_armorhull = targetEffDpsVsAttacker > 0 ? (attackerArmorHp + attackerHull) / targetEffDpsVsAttacker : Infinity;
    const ttk_you_total = ttk_you_shield + ttk_you_armorhull;

    return {
        weapons: weaponMatchups,
        totals: {
            rawDps: totalRawDps,
            effDps: totalEffDps,
            dpsToShield: totalDpsToShield,
            bleedthrough: totalBleedthrough,
            dpsLostToArmor: totalRawDps - totalEffDps
        },
        target: {
            name: targetShip.name,
            shieldHp,
            effectiveShieldHp,
            shieldFaceType,
            shieldRegen,
            armorHp: targetArmorHp,
            hullHp: targetHull,
            totalEhp: effectiveShieldHp + targetArmorHp + targetHull,
            armorPhys: targetArmor.physical ?? 1,
            armorEnergy: targetArmor.energy ?? 1,
            pilotDps: targetDps,
            sustainedDps: targetSustained,
            bleedthroughDmg: bleedDmgDuringShield
        },
        ttk: {
            shields: ttk_shield,
            armorHull: ttk_armor_hull,
            total: ttk_total,
            canBreakShield
        },
        reverse: {
            enemyDps: targetDps,
            enemyEffDps: targetEffDpsVsAttacker,
            ttk_you_shield,
            ttk_you_armorhull,
            ttk_you_total,
            canBreakYourShield: canEnemyBreakShield
        },
        verdict: getVerdict(ttk_total, ttk_you_total, canBreakShield, canEnemyBreakShield)
    };
}

function getVerdict(ttkTarget, ttkYou, canBreakTarget, canBreakYou) {
    if (!canBreakTarget && canBreakYou) return { text: 'CANNOT BREAK TARGET SHIELDS', class: 'crit', icon: '!!' };
    if (!canBreakTarget && !canBreakYou) return { text: 'STALEMATE — NEITHER CAN BREAK SHIELDS', class: 'warn', icon: '=' };
    if (canBreakTarget && !canBreakYou) return { text: 'DOMINANT — ENEMY CANNOT BREAK YOUR SHIELDS', class: 'ok', icon: '>>' };

    const ratio = ttkTarget / ttkYou;
    if (ratio < 0.6) return { text: 'STRONG ADVANTAGE — YOU KILL MUCH FASTER', class: 'ok', icon: '>>' };
    if (ratio < 0.85) return { text: 'SLIGHT ADVANTAGE', class: 'ok', icon: '>' };
    if (ratio < 1.15) return { text: 'EVEN MATCHUP', class: 'warn', icon: '=' };
    if (ratio < 1.5) return { text: 'SLIGHT DISADVANTAGE', class: 'warn', icon: '<' };
    return { text: 'STRONG DISADVANTAGE — ENEMY KILLS FASTER', class: 'crit', icon: '<<' };
}

function collectAllWeapons(ship) {
    const weapons = [];
    let totalDps = 0;

    const fixed = ship.weaponry?.fixed_weapons?.weapons || [];
    for (const w of fixed) {
        const dmgType = guessDmgTypeFromName(w.name);
        weapons.push({ name: w.name, dps: w.dps || 0, alpha: w.alpha || 0, dmgType, source: 'pilot' });
        totalDps += w.dps || 0;
    }

    const turretTypes = ['manned', 'remote', 'pdc'];
    const turrets = ship.turrets || {};
    for (const ttype of turretTypes) {
        for (const turret of turrets[ttype] || []) {
            for (const w of turret.weapons || []) {
                const dmgType = guessDmgTypeFromName(w.name);
                weapons.push({ name: w.name, dps: w.dps || 0, alpha: w.alpha || 0, dmgType, source: ttype });
                totalDps += w.dps || 0;
            }
        }
    }

    if (weapons.length === 0 && ship.weaponry?.pilot_dps > 0) {
        totalDps = ship.weaponry.pilot_dps;
        weapons.push({ name: 'Combined Weapons', dps: totalDps, alpha: ship.weaponry.pilot_alpha || 0, dmgType: 'energy', source: 'pilot' });
    }

    return { weapons, totalDps };
}

function getDmgType(weapon) {
    const dmg = weapon.damage?.alpha || {};
    if ((dmg.physical || 0) > 0) return 'physical';
    if ((dmg.distortion || 0) > 0) return 'distortion';
    return 'energy';
}

function guessDmgTypeFromName(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('distortion') || n.includes('suckerpunch')) return 'distortion';
    if (n.includes('gatling') || n.includes('gt-') || n.includes('ad4b') || n.includes('ad5b') || n.includes('ad6b')
        || n.includes('revenant') || n.includes('tigerstrike') || n.includes('yellowjacket') || n.includes('scorpion gt')
        || n.includes('mantis gt') || n.includes('nv57') || n.includes('sf7b')) return 'physical';
    if (n.includes('c-788') || n.includes('combine') || n.includes('sledge') || n.includes('tarantula')
        || n.includes('greatsword') || n.includes('longsword') || n.includes('broadsword')
        || n.includes('9-series') || n.includes('10-series') || n.includes('11-series')
        || n.includes('buzzsaw') || n.includes('sawbuck') || n.includes('shredder')
        || n.includes('predator') || n.includes('dominance') || n.includes('strife')
        || n.includes('deadbolt') || n.includes('leonids') || n.includes('maris')) return 'physical';
    return 'energy';
}

function getArmorMultiplier(dmgType, armorMults) {
    switch (dmgType) {
        case 'physical': return armorMults.physical ?? 1;
        case 'energy': return armorMults.energy ?? 1;
        case 'distortion': return armorMults.distortion ?? 1;
        default: return 1;
    }
}

export function renderMatchup(matchup, container) {
    const v = matchup.verdict;
    const t = matchup.target;
    const ttk = matchup.ttk;
    const rev = matchup.reverse;

    let html = `
    <div class="matchup-verdict badge-${v.class}" style="text-align:center;padding:12px;margin-bottom:16px;
        background:${v.class === 'ok' ? 'rgba(45,255,110,0.06)' : v.class === 'crit' ? 'rgba(255,61,61,0.06)' : 'rgba(255,184,48,0.06)'};
        border:1px solid ${v.class === 'ok' ? 'rgba(45,255,110,0.2)' : v.class === 'crit' ? 'rgba(255,61,61,0.2)' : 'rgba(255,184,48,0.2)'};">
        <span style="font-family:var(--font-heading);font-size:1.1rem;letter-spacing:0.15em;
            color:${v.class === 'ok' ? 'var(--status-ok)' : v.class === 'crit' ? 'var(--status-crit)' : 'var(--status-warn)'}">
            ${v.icon} ${v.text} ${v.icon}
        </span>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
        <div>
            <div style="font-family:var(--font-heading);color:var(--sc-teal);letter-spacing:0.12em;font-size:0.8rem;margin-bottom:6px;">YOU → TARGET</div>
            <div class="stat-row"><span class="stat-label">Raw DPS</span><span class="stat-value">${formatNumber(matchup.totals.rawDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Eff. DPS (after armor)</span><span class="stat-value dps-number">${formatNumber(matchup.totals.effDps)}</span></div>
            <div class="stat-row"><span class="stat-label">DPS lost to armor</span><span class="stat-value" style="color:var(--status-crit)">${formatNumber(matchup.totals.dpsLostToArmor)}</span></div>
            <div class="stat-row"><span class="stat-label">TTK Shields</span><span class="stat-value">${ttk.canBreakShield ? formatTime(ttk.shields) : '<span style=color:var(--status-crit)>CANNOT BREAK</span>'}</span></div>
            <div class="stat-row"><span class="stat-label">TTK Armor+Hull</span><span class="stat-value">${formatTime(ttk.armorHull)}</span></div>
            <div class="stat-row" style="border-top:1px solid var(--border-active);padding-top:6px;">
                <span class="stat-label" style="font-weight:bold;">TTK TOTAL</span>
                <span class="stat-value dps-number" style="font-size:1rem;">${ttk.canBreakShield ? formatTime(ttk.total) : 'N/A'}</span>
            </div>
        </div>
        <div>
            <div style="font-family:var(--font-heading);color:var(--sc-amber);letter-spacing:0.12em;font-size:0.8rem;margin-bottom:6px;">TARGET → YOU</div>
            <div class="stat-row"><span class="stat-label">Enemy Raw DPS</span><span class="stat-value">${formatNumber(rev.enemyDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Eff. DPS vs you</span><span class="stat-value dps-number">${formatNumber(rev.enemyEffDps)}</span></div>
            <div class="stat-row"><span class="stat-label">DPS lost to your armor</span><span class="stat-value" style="color:var(--status-ok)">${formatNumber(rev.enemyDps - rev.enemyEffDps)}</span></div>
            <div class="stat-row"><span class="stat-label">TTK Your Shields</span><span class="stat-value">${rev.canBreakYourShield ? formatTime(rev.ttk_you_shield) : '<span style=color:var(--status-ok)>CANNOT BREAK</span>'}</span></div>
            <div class="stat-row"><span class="stat-label">TTK Your Armor+Hull</span><span class="stat-value">${formatTime(rev.ttk_you_armorhull)}</span></div>
            <div class="stat-row" style="border-top:1px solid var(--border-active);padding-top:6px;">
                <span class="stat-label" style="font-weight:bold;">TTK YOU</span>
                <span class="stat-value dps-number" style="font-size:1rem;">${rev.canBreakYourShield ? formatTime(rev.ttk_you_total) : 'N/A'}</span>
            </div>
        </div>
    </div>

    <div style="margin-bottom:8px;font-family:var(--font-heading);color:var(--text-dim);letter-spacing:0.12em;font-size:0.7rem;">PER-WEAPON BREAKDOWN VS ${t.name.toUpperCase()}</div>
    <table class="loadout-table">
        <thead><tr>
            <th>Weapon</th><th>Type</th><th>Raw DPS</th><th>Armor Mult</th><th>Eff. DPS</th><th>DPS Lost</th><th>Alpha</th><th>Penetration</th>
        </tr></thead>
        <tbody>`;

    for (const wm of matchup.weapons) {
        const multColor = wm.armorMult >= 0.9 ? 'var(--status-ok)' : wm.armorMult >= 0.7 ? 'var(--status-warn)' : 'var(--status-crit)';
        html += `<tr>
            <td>${wm.name}</td>
            <td><span class="badge badge-${wm.dmgType === 'physical' ? 'ballistic' : wm.dmgType === 'distortion' ? 'distortion' : 'energy'}">${wm.dmgType}</span></td>
            <td class="col-dps">${formatNumber(wm.rawDps)}</td>
            <td class="col-dps" style="color:${multColor}">${wm.armorMult}x</td>
            <td class="col-dps" style="color:var(--sc-teal)">${formatNumber(wm.effDps)}</td>
            <td class="col-dps" style="color:var(--status-crit)">-${formatNumber(wm.dpsReduction)} (${wm.reductionPct.toFixed(0)}%)</td>
            <td class="col-alpha">${formatNumber(wm.effAlpha)}</td>
            <td class="col-pen">${formatNumber(wm.penetration)}m</td>
        </tr>`;
    }

    html += `</tbody></table>

    <div style="margin-top:16px;display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div>
            <div style="font-family:var(--font-heading);color:var(--text-dim);letter-spacing:0.1em;font-size:0.7rem;margin-bottom:6px;">TARGET DEFENSES</div>
            <div class="stat-row"><span class="stat-label">Shield HP</span><span class="stat-value">${formatNumber(t.shieldHp)}</span></div>
            <div class="stat-row"><span class="stat-label">Shield Regen</span><span class="stat-value">${formatNumber(t.shieldRegen)}/s</span></div>
            <div class="stat-row"><span class="stat-label">Armor HP</span><span class="stat-value">${formatNumber(t.armorHp)}</span></div>
            <div class="stat-row"><span class="stat-label">Hull HP</span><span class="stat-value">${formatNumber(t.hullHp)}</span></div>
            <div class="stat-row"><span class="stat-label">Total EHP</span><span class="stat-value dps-number">${formatNumber(t.totalEhp)}</span></div>
        </div>
        <div>
            <div style="font-family:var(--font-heading);color:var(--text-dim);letter-spacing:0.1em;font-size:0.7rem;margin-bottom:6px;">TARGET ARMOR</div>
            <div class="stat-row"><span class="stat-label">Physical</span><span class="stat-value">${t.armorPhys}x</span></div>
            <div class="stat-row"><span class="stat-label">Energy</span><span class="stat-value">${t.armorEnergy}x</span></div>
            <div class="stat-row"><span class="stat-label">Target Pilot DPS</span><span class="stat-value">${formatNumber(t.pilotDps)}</span></div>
            <div class="stat-row"><span class="stat-label">Target Sustained</span><span class="stat-value">${formatNumber(t.sustainedDps)}</span></div>
        </div>
    </div>`;

    container.innerHTML = html;
}

function formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return 'N/A';
    if (seconds < 60) return seconds.toFixed(1) + 's';
    const min = Math.floor(seconds / 60);
    const sec = (seconds % 60).toFixed(0);
    return `${min}m ${sec}s`;
}
