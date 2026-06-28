#!/usr/bin/env python3
"""
Build in-game ship-buying data for NEMESIS Command Deck from the public UEX Corp
API (uexcorp.space, no token). Answers "which ships can I buy in-game, where, and
for how much aUEC" — from the ship dealers / showrooms (New Deal, Astro Armada,
Grey's Market, Buy & Fly, Crusader Showroom, ...).

Output: data/ship-buy.json — per ship: manufacturer, SCU, crew, roles, the dealer
terminals + locations + aUEC prices, and the cheapest price. Ship thumbnails are
matched from the existing data/ships.json (SC Wiki images). Prices are a community
SNAPSHOT and drift between patches; the UI stamps the snapshot time.

Designed to run in CI on a schedule and commit. No auth needed.
Usage:  python scripts/ingest-ships.py
"""
import json
import os
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://api.uexcorp.space/2.0"
DATA = Path(__file__).resolve().parent.parent / "data"
SNAP = os.environ.get("RUN_DATE", "")
SNAP_UNIX = int(os.environ.get("RUN_UNIX") or time.time())

ROLE_FLAGS = [
    ("is_cargo", "Cargo"), ("is_mining", "Mining"), ("is_salvage", "Salvage"),
    ("is_refinery", "Refinery"), ("is_refuel", "Refuel"), ("is_medical", "Medical"),
    ("is_exploration", "Exploration"), ("is_racing", "Racing"), ("is_bomber", "Bomber"),
    ("is_interdiction", "Interdiction"), ("is_military", "Military"), ("is_civilian", "Civilian"),
    ("is_datarunner", "Data"), ("is_carrier", "Carrier"), ("is_construction", "Construction"),
]


def get(ep):
    req = urllib.request.Request(f"{API}/{ep}", headers={"User-Agent": "nemesis-command-deck", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8")).get("data", [])


def main():
    prices = get("vehicles_purchases_prices_all")
    vehicles = get("vehicles")
    terminals = get("terminals")
    try:
        companies = get("companies")
    except Exception:
        companies = []
    print(f"fetched: {len(prices)} ship prices, {len(vehicles)} vehicles, {len(terminals)} terminals, {len(companies)} companies", file=sys.stderr)

    cl = {c["id"]: (c.get("name") or "") for c in companies}
    tl = {}
    for t in terminals:
        tl[t["id"]] = {
            "name": t.get("nickname") or t.get("name") or "?",
            "system": t.get("star_system_name") or "",
            "place": t.get("space_station_name") or t.get("city_name") or t.get("planet_name") or t.get("outpost_name") or t.get("moon_name") or "",
        }
    vl = {v["id"]: v for v in vehicles}

    # ship thumbnails from the existing wiki-sourced ships.json (match on short name)
    imgmap = {}
    try:
        sj = json.loads((DATA / "ships.json").read_text(encoding="utf-8"))
        sjships = sj if isinstance(sj, list) else (sj.get("ships") or sj.get("data") or [])
        for s in sjships:
            nm = (s.get("name") or "").lower().strip()
            imgs = s.get("images") or []
            if nm and imgs:
                imgmap[nm] = imgs[0].get("thumbnail_url") or imgs[0].get("original_url")
    except Exception as e:
        print(f"  ships.json image match skipped: {e}", file=sys.stderr)

    buys = defaultdict(list)
    for p in prices:
        if (p.get("price_buy") or 0) > 0:
            buys[p.get("id_vehicle")].append(p)

    ships = []
    for vid, rows in buys.items():
        v = vl.get(vid, {})
        name = v.get("name") or rows[0].get("vehicle_name") or "?"
        full = v.get("name_full") or name
        manuf = cl.get(v.get("id_company"), "") or (full[:-len(name)].strip() if full.endswith(name) and full != name else "")
        roles = [label for flag, label in ROLE_FLAGS if v.get(flag)]
        locs = []
        for r in rows:
            t = tl.get(r["id_terminal"], {})
            locs.append({"terminal": t.get("name"), "system": t.get("system"), "place": t.get("place"), "price": round(r["price_buy"])})
        locs.sort(key=lambda x: x["price"])
        ships.append({
            "name": name, "fullName": full, "manufacturer": manuf,
            "scu": v.get("scu"), "crew": str(v.get("crew") or "").strip(),
            "roles": roles, "img": imgmap.get(name.lower().strip()),
            "minPrice": locs[0]["price"] if locs else None,
            "locations": locs,
        })
    ships.sort(key=lambda s: s["minPrice"] or 0, reverse=True)

    payload = {"snapshot": SNAP, "snapshotUnix": SNAP_UNIX, "count": len(ships), "ships": ships}
    (DATA / "ship-buy.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    withimg = sum(1 for s in ships if s.get("img"))
    print(f"wrote {len(ships)} buyable ships ({withimg} with image)", file=sys.stderr)


if __name__ == "__main__":
    main()
