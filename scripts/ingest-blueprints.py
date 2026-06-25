#!/usr/bin/env python3
"""
Fetch all Star Citizen crafting blueprints from api.star-citizen.wiki (v2) and
flatten them into data/crafting-recipes.json — a static snapshot consumed by the
Crafting Workbench tab. Re-run once per patch and commit the result.

Two passes:
  1. List pass  — base recipe (output, ingredients+quantities, craft time, dismantle, gating).
  2. Detail pass — per-blueprint /blueprints/{uuid} for unlocking MISSIONS (names) and
                   QUALITY-scaling modifiers (how material quality 0–1000 moves output stats).
                   The list endpoint does NOT carry these, so a detail call per blueprint is
                   required; done concurrently with a small worker pool.

Recipe + quantity data is datamined and patch-accurate. SC has no player marketplace,
so this script intentionally stores NO resale/aUEC value.

Usage:  python scripts/ingest-blueprints.py
"""
import json
import sys
import time
import urllib.request
import concurrent.futures as cf
from pathlib import Path

BASE = "https://api.star-citizen.wiki/api/v2/blueprints"
OUT = Path(__file__).resolve().parent.parent / "data" / "crafting-recipes.json"


def get(url):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "sc-optimizer-ingest"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(1.5)


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


def detail(uuid):
    """Per-blueprint: unlocking missions + quality-scaling modifiers."""
    try:
        r = get(f"{BASE}/{uuid}")
        r = r.get("data", r)
        missions = [{"title": m.get("title"), "chance": m.get("chance", 1)} for m in (r.get("unlocking_missions") or []) if m.get("title")]
        qmods, seen = [], set()
        for g in (r.get("requirement_groups") or []):
            for m in (g.get("modifiers") or []):
                lbl = m.get("label")
                if not lbl or lbl in seen:
                    continue
                seen.add(lbl)
                mr = m.get("modifier_range") or {}
                qmods.append({"stat": lbl, "betterWhen": m.get("better_when"), "atMin": mr.get("at_min_quality"), "atMax": mr.get("at_max_quality")})
        return uuid, missions, qmods
    except Exception:
        return uuid, [], []


def main():
    recipes, by_uuid, game_version, page = [], {}, None, 1
    while True:
        data = get(f"{BASE}?limit=100&page={page}")
        rows = data.get("data", [])
        if not rows:
            break
        last = data.get("meta", {}).get("last_page", page)
        for b in rows:
            o = b.get("output") or {}
            game_version = game_version or b.get("game_version")
            rec = {
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
                "missions": [],
                "quality": [],
            }
            recipes.append(rec)
            by_uuid[rec["uuid"]] = rec
        print(f"list page {page}/{last} — {len(recipes)}", file=sys.stderr)
        if page >= last:
            break
        page += 1

    uuids = [r["uuid"] for r in recipes]
    done = 0
    with cf.ThreadPoolExecutor(max_workers=6) as ex:
        for uuid, missions, qmods in ex.map(detail, uuids):
            r = by_uuid.get(uuid)
            if r:
                r["missions"] = missions
                r["quality"] = qmods
            done += 1
            if done % 200 == 0:
                print(f"detail {done}/{len(uuids)}", file=sys.stderr)

    out = {"game_version": game_version, "count": len(recipes), "recipes": recipes}
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(recipes)} recipes ({game_version}) with mission+quality detail")


if __name__ == "__main__":
    main()
