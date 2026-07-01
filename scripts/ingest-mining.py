#!/usr/bin/env python3
"""
Deterministic mining-gear ingest -> data/mining-gear.json

Sources (both public, no token):
  - UEX Corp API (api.uexcorp.space/2.0): item list + buy prices + shop locations
      cat 29 = Mining Laser Heads, 30 = Mining Modules, 28 = Gadgets
  - SC Wiki API (api.star-citizen.wiki/api/v2): per-item mining specs + image
      heads  -> mining_laser  {laser_power, module_slots, ranges, throughput}
      heads  -> passive modifiers parsed from the templated de_DE description
      module -> mining_module {type Passive/Active, modifiers[], uses, duration}

Output is a stamped community snapshot ("not live"). Attribution: UEX + SC Wiki (CC-BY-SA).
Run per patch (and via the UEX cron). No secrets.
"""
import json, sys, time, re, os, urllib.request, urllib.error

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (sc-loadout-optimizer mining ingest)"
UEX = "https://api.uexcorp.space/2.0"
WIKI = "https://api.star-citizen.wiki/api/v2"
RUN_DATE = os.environ.get("RUN_DATE") or time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime())
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "data", "mining-gear.json")

CATS = {"heads": 29, "modules": 30, "gadgets": 28}

# German modifier labels (CIG templated localisation) -> canonical keys.
# Heads expose their passive modifiers only in the de_DE description text.
DE_MODIFIERS = [
    (r"Laserinstabilität", "instability"),
    (r"Optimale Größe des Aufladebereichs", "optimal_window"),
    (r"Optimaler Aufladebereich", "optimal_window"),
    (r"Anteil wertloser Materialien", "inert_materials"),
    (r"Inertmaterial", "inert_materials"),
    (r"Gesteinswiderstand", "resistance"),
    (r"Widerstand", "resistance"),
    (r"Optimale Laderate", "optimal_charge_rate"),
    (r"Optimale Aufladerate", "optimal_charge_rate"),
    (r"Ladegeschwindigkeit", "charge_rate"),
    (r"Aufladerate", "charge_rate"),
    (r"Extraktionsleistung", "extraction_power"),
    (r"Streuung", "shatter_damage"),
    (r"Modulsteckplätze", "module_slots"),
]
KEY_LABEL = {
    "instability": "Laser instability",
    "optimal_window": "Optimal charge window",
    "inert_materials": "Inert materials",
    "resistance": "Rock resistance",
    "optimal_charge_rate": "Optimal charge rate",
    "charge_rate": "Charge rate",
    "extraction_power": "Extraction power",
    "shatter_damage": "Shatter damage",
    "module_slots": "Module slots",
}


def get(url, tries=4):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            if i == tries - 1:
                print(f"  ! failed {url}: {e}", file=sys.stderr)
                return None
            time.sleep(1.5 * (i + 1))
    return None


def uex_items(cat):
    d = get(f"{UEX}/items?id_category={cat}")
    return (d or {}).get("data", []) if d else []


def uex_prices(item_id):
    """Return cheapest buy price + distinct buy locations (terminal + system)."""
    d = get(f"{UEX}/items_prices?id_item={item_id}")
    rows = [r for r in ((d or {}).get("data", []) or []) if (r.get("price_buy") or 0) > 0]
    if not rows:
        return None, []
    rows.sort(key=lambda r: r["price_buy"])
    cheapest = rows[0]["price_buy"]
    seen, locs = set(), []
    for r in rows:
        name = r.get("terminal_name") or r.get("space_station_name") or r.get("outpost_name") or "?"
        if name in seen:
            continue
        seen.add(name)
        locs.append({
            "terminal": name,
            "system": r.get("star_system_name") or "",
            "place": r.get("city_name") or r.get("space_station_name") or r.get("outpost_name") or r.get("planet_name") or "",
            "price": r.get("price_buy"),
        })
    return cheapest, locs[:8]


def wiki_detail(uuid):
    if not uuid:
        return {}
    d = get(f"{WIKI}/items/{uuid}?include=mining")
    return (d or {}).get("data", {}) if d else {}


def first_image(detail):
    imgs = detail.get("images") or []
    if isinstance(imgs, list) and imgs:
        im = imgs[0]
        return im.get("original_url") or im.get("thumbnail_url")
    return None


def parse_de_head_modifiers(de_text):
    """Pull '<Label>: <signed N>%' modifier lines out of the templated de_DE description."""
    out = []
    if not de_text:
        return out
    for pat, key in DE_MODIFIERS:
        if key == "module_slots":
            continue
        m = re.search(pat + r"[^\n:]*:\s*([+\-]?\d+(?:[.,]\d+)?)\s*%", de_text)
        if m and not any(o["name"] == key for o in out):
            val = m.group(1).replace(",", ".")
            if float(val) == 0:  # skip noise like "+0%"
                continue
            sign = "" if val.startswith(("+", "-")) else "+"
            out.append({"name": key, "label": KEY_LABEL.get(key, key), "value": f"{sign}{val}%"})
    return out


def _is_zero(value):
    m = re.search(r"[+\-]?\d+(?:[.,]\d+)?", str(value or ""))
    return bool(m) and float(m.group(0).replace(",", ".")) == 0


def clean_desc(detail):
    d = (detail.get("description") or {})
    en = d.get("en_EN") or ""
    # Strip the leading "Type (En): ... / Size: ..." spec preamble some entries carry.
    en = re.sub(r"^\s*Type.*?\n\n", "", en, flags=re.S)
    return en.strip()[:600]


def build_head(it):
    detail = wiki_detail(it.get("uuid"))
    ml = detail.get("mining_laser") or {}
    price, locs = uex_prices(it["id"])
    de = (detail.get("description") or {}).get("de_DE") or ""
    lp = ml.get("laser_power") or {}
    return {
        "id": it["id"], "uuid": it.get("uuid"), "name": it["name"],
        "company": it.get("company_name") or (detail.get("manufacturer") or {}).get("name") or "",
        "size": it.get("size"),
        "moduleSlots": ml.get("module_slots"),
        "laserPower": {"min": lp.get("min"), "max": lp.get("max")},
        "optimalRange": ml.get("optimal_range"),
        "maxRange": ml.get("maximum_range"),
        "throughput": ml.get("extraction_throughput"),
        "modifiers": parse_de_head_modifiers(de),
        "price": price, "locations": locs,
        "img": first_image(detail),
        "desc": clean_desc(detail),
        "slug": it.get("slug"),
    }


def build_module(it):
    detail = wiki_detail(it.get("uuid"))
    mm = detail.get("mining_module") or {}
    price, locs = uex_prices(it["id"])
    mtype = (mm.get("type") or "").strip()
    kind = "active" if "Active" in mtype or "Aktiv" in mtype else "passive"
    mods = []
    for m in (mm.get("modifiers") or []):
        if _is_zero(m.get("value")):  # skip noise like "+0%"
            continue
        mods.append({"name": m.get("name"), "label": m.get("display_name") or m.get("name"), "value": m.get("value")})
    return {
        "id": it["id"], "uuid": it.get("uuid"), "name": it["name"],
        "company": it.get("company_name") or "",
        "kind": kind,
        "uses": mm.get("uses"), "duration": mm.get("duration"),
        "modifiers": mods,
        "price": price, "locations": locs,
        "img": first_image(detail),
        "desc": clean_desc(detail),
        "slug": it.get("slug"),
    }


def build_gadget(it):
    detail = wiki_detail(it.get("uuid"))
    price, locs = uex_prices(it["id"])
    return {
        "id": it["id"], "uuid": it.get("uuid"), "name": it["name"],
        "company": it.get("company_name") or "",
        "price": price, "locations": locs,
        "img": first_image(detail),
        "desc": clean_desc(detail),
        "slug": it.get("slug"),
    }


def main():
    heads, modules, gadgets = [], [], []
    print("Fetching UEX item lists...")
    head_items = uex_items(CATS["heads"])
    module_items = uex_items(CATS["modules"])
    gadget_items = uex_items(CATS["gadgets"])
    print(f"  heads={len(head_items)} modules={len(module_items)} gadgets={len(gadget_items)}")

    for i, it in enumerate(head_items):
        print(f"  head {i+1}/{len(head_items)}: {it['name']}")
        heads.append(build_head(it)); time.sleep(0.3)
    for i, it in enumerate(module_items):
        print(f"  module {i+1}/{len(module_items)}: {it['name']}")
        modules.append(build_module(it)); time.sleep(0.3)
    for i, it in enumerate(gadget_items):
        print(f"  gadget {i+1}/{len(gadget_items)}: {it['name']}")
        gadgets.append(build_gadget(it)); time.sleep(0.3)

    # sort heads by size then name; modules passive-first then name
    def szkey(s):
        try:
            return int(s)
        except (TypeError, ValueError):
            return -1
    heads.sort(key=lambda h: (szkey(h["size"]), h["name"]))
    modules.sort(key=lambda m: (0 if m["kind"] == "passive" else 1, m["name"]))
    gadgets.sort(key=lambda g: g["name"])

    out = {
        "patch": "4.8.3-LIVE",
        "updated": RUN_DATE,
        "source": "UEX Corp API (prices/shops) + Star Citizen Wiki API (mining specs/images)",
        "attribution": "Unofficial — not affiliated with Cloud Imperium Games. Prices are a community snapshot, not live. Data: UEX Corp + Star Citizen Wiki (CC-BY-SA).",
        "note": "Mining gear stats from game files via SC Wiki. Head passive modifiers parsed from localised descriptions; prices/locations are the cheaper of recent UEX reports.",
        "heads": heads, "modules": modules, "gadgets": gadgets,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\nWrote {OUT}")
    print(f"  heads={len(heads)} (with price: {sum(1 for h in heads if h['price'])}, with img: {sum(1 for h in heads if h['img'])})")
    print(f"  modules={len(modules)} (with modifiers: {sum(1 for m in modules if m['modifiers'])})")
    print(f"  gadgets={len(gadgets)}")


if __name__ == "__main__":
    main()
