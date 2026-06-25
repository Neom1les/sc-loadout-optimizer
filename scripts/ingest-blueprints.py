#!/usr/bin/env python3
"""
Fetch all Star Citizen crafting blueprints from api.star-citizen.wiki (v2) and
flatten them into data/crafting-recipes.json — a static snapshot consumed by the
Crafting Workbench tab. Re-run once per patch and commit the result.

Recipe data (inputs, quantities, outputs, craft time, dismantle returns) is
datamined and game-accurate. It carries NO marketplace value — SC has no player
economy — so this script does not fabricate prices.

Usage:  python scripts/ingest-blueprints.py
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://api.star-citizen.wiki/api/v2/blueprints"
OUT = Path(__file__).resolve().parent.parent / "data" / "crafting-recipes.json"


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "sc-optimizer-ingest"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if attempt == 3:
                raise
            print(f"  retry {attempt + 1} ({e})", file=sys.stderr)
            time.sleep(2)


def ingredient(i):
    scu = i.get("quantity_scu")
    if scu is not None:
        return {"name": i.get("name"), "kind": i.get("kind", "resource"), "qty": scu, "unit": "SCU"}
    return {"name": i.get("name"), "kind": i.get("kind", "item"), "qty": i.get("quantity") or 0, "unit": "x"}


def dismantle(d):
    scu = d.get("quantity_scu")
    if scu is not None:
        return {"name": d.get("name"), "qty": scu, "unit": "SCU"}
    return {"name": d.get("name"), "qty": d.get("quantity") or 0, "unit": "x"}


def main():
    recipes = []
    game_version = None
    page = 1
    while True:
        data = get(f"{BASE}?limit=100&page={page}")
        rows = data.get("data", [])
        if not rows:
            break
        last = data.get("meta", {}).get("last_page", page)
        for b in rows:
            o = b.get("output") or {}
            game_version = game_version or b.get("game_version")
            recipes.append({
                "uuid": b.get("uuid"),
                "name": b.get("output_name") or o.get("name"),
                "class": b.get("output_class"),
                "type": o.get("type"),
                "typeLabel": o.get("type_label") or o.get("type") or "Other",
                "subType": o.get("sub_type") or o.get("subtype"),
                "grade": o.get("grade"),
                "craftSeconds": b.get("craft_time_seconds") or 0,
                "craftLabel": b.get("craft_time_label") or "",
                "default": bool(b.get("is_available_by_default")),
                "unlockMissions": b.get("unlocking_missions_count") or 0,
                "ingredients": [ingredient(i) for i in (b.get("ingredients") or [])],
                "dismantle": [dismantle(d) for d in (b.get("dismantle_returns") or [])],
            })
        print(f"page {page}/{last} — {len(recipes)} recipes", file=sys.stderr)
        if page >= last:
            break
        page += 1

    out = {"game_version": game_version, "count": len(recipes), "recipes": recipes}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(recipes)} recipes ({game_version}) to {OUT}")


if __name__ == "__main__":
    main()
