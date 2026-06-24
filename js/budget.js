/* ============================================================
   SC Optimizer — Budget build mode
   Re-picks each component slot for best performance-per-credit
   (score ÷ cheapest purchase price) instead of raw performance,
   so credit-limited pilots get the best viable build. Runs AFTER
   optimizeLoadout() on the existing slot candidates — no change to
   the core optimizer.
   ============================================================ */
import { getShopInfo } from './shop-finder.js';

const SLOT_GROUPS = ['weapons', 'shields', 'powerplants', 'coolers', 'turretWeapons'];

export function applyBudgetMode(loadout) {
  const slots = [];
  for (const g of SLOT_GROUPS) for (const s of (loadout[g] || [])) if (s) slots.push(s);
  if (loadout.quantumDrive) slots.push(loadout.quantumDrive);

  let cost = 0, picked = 0;
  for (const slot of slots) {
    if (!slot.allCandidates || !slot.allCandidates.length) continue;
    let best = null, bestRatio = -Infinity, bestShop = null, bestPrice = 0;
    for (const c of slot.allCandidates) {
      if (!c.purchasable) continue;
      const shop = c.shop || getShopInfo(c.item);
      const price = shop?.price || 0;
      if (price <= 0 || c.score <= 0) continue;
      const ratio = c.score / price;
      if (ratio > bestRatio) { bestRatio = ratio; best = c.item; bestShop = shop; bestPrice = price; }
    }
    if (best) {
      slot.selected = best;
      slot.shop = bestShop;
      slot.selectedIsPurchasable = true;
      cost += bestPrice;
      picked++;
    }
  }
  return { cost, picked };
}
