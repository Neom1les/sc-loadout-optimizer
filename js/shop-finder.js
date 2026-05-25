export function getShopInfo(item) {
    const purchases = item?.uex_prices?.purchase || item?.shops || [];
    if (!purchases.length) return null;

    const sorted = [...purchases].sort((a, b) => (a.price_buy || Infinity) - (b.price_buy || Infinity));
    const cheapest = sorted[0];

    return {
        price: cheapest.price_buy,
        terminal: cheapest.terminal_name || cheapest.name || 'Unknown',
        location: cheapest.starmap_location?.name || '',
        system: cheapest.starmap_location?.star_system_name || 'Stanton',
        allShops: sorted.map(s => ({
            price: s.price_buy,
            terminal: s.terminal_name || s.name || 'Unknown',
            location: s.starmap_location?.name || '',
        }))
    };
}

export function isPurchasable(item) {
    const purchases = item?.uex_prices?.purchase || item?.shops || [];
    return purchases.length > 0;
}

export function findPurchasableAlternative(item, allItems) {
    if (!item || !allItems) return null;
    const size = item.size;
    const type = item.weapon_type || item.type;

    const candidates = allItems
        .filter(i => i.size === size && i.uuid !== item.uuid && isPurchasable(i))
        .sort((a, b) => {
            const aDps = a.damage?.burst_dps || a.damage?.dps?.value || 0;
            const bDps = b.damage?.burst_dps || b.damage?.dps?.value || 0;
            return bDps - aDps;
        });

    return candidates[0] || null;
}

export function formatPrice(price) {
    if (!price && price !== 0) return 'N/A';
    return price.toLocaleString('en-US') + ' aUEC';
}

export function formatShopShort(shopInfo) {
    if (!shopInfo) return 'NOT AVAILABLE';
    const loc = shopInfo.location ? `, ${shopInfo.location}` : '';
    return `${shopInfo.terminal}${loc}`;
}
