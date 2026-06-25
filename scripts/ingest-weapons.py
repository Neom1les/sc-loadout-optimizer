#!/usr/bin/env python3
"""
Build an FPS / personal-weapon reference for NEMESIS Command Deck from the
public Star Citizen Wiki API (api.star-citizen.wiki, no token required).

The list endpoint is full of cosmetic skins (e.g. eight "A03" sniper variants
that share identical stats), so we dedupe by base name (stripping the quoted
skin), keeping the canonical entry and counting how many skins exist. We then
fetch each unique gun's detail for combat stats — the API already computes
dps_total / alpha_total and damage type, so we surface those rather than
re-deriving them.

Output:  data/fps-weapons.json
Usage:   python scripts/ingest-weapons.py
"""
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from pathlib import Path

SENTINEL = 99999  # the wiki uses 99999 as an "unconfigured" placeholder on some base entries
WEAPON_CLASSES = {"Small Weapon", "Medium Weapon", "Large Weapon"}

API = "https://api.star-citizen.wiki/api/v2"
DATA = Path(__file__).resolve().parent.parent / "data"


def get(url):
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "nemesis-command-deck"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def base_name(n):
    # strip the quoted skin name, e.g. A03 "Canuto" Sniper Rifle -> A03 Sniper Rifle
    n = re.sub(r'\s*"[^"]*"\s*', " ", n or "")
    return re.sub(r"\s+", " ", n).strip()


def dominant_type(dps_map):
    if not isinstance(dps_map, dict):
        return None
    items = [(k, v) for k, v in dps_map.items() if isinstance(v, (int, float)) and v > 0]
    if not items:
        return None
    return max(items, key=lambda kv: kv[1])[0]


def fire_modes(modes):
    out = []
    for m in modes or []:
        lab = (m.get("localised") or m.get("mode") or "").strip().strip("[]")
        if lab and lab not in out:
            out.append(lab)
    return out


def valid_stats(d):
    # A ranged weapon should have a real magazine + per-shot damage. Some base
    # (skin-less) entries ship with a 99999 placeholder magazine and garbage
    # damage — when that happens, a real skin variant carries the true stats.
    if (d.get("classification_label") or "") not in WEAPON_CLASSES:
        return True  # knives / grenades / gadgets legitimately have null ranged stats
    pw = d.get("personal_weapon") or {}
    if pw.get("magazine_size") == SENTINEL:
        return False
    return pw.get("damage_per_shot") is not None


def sane(v):
    return None if v == SENTINEL else v


def main():
    raw = []
    for p in (1, 2):
        raw += get(f"{API}/weapons?limit=200&page={p}").get("data", [])
    print(f"fetched {len(raw)} weapon entries", file=sys.stderr)

    # group all skins by base name; we keep the canonical name but must find a
    # variant whose detail carries valid stats (the base entry is sometimes broken)
    groups = defaultdict(list)
    for w in raw:
        groups[base_name(w["name"])].append(w)
    print(f"{len(groups)} unique guns after skin-dedup", file=sys.stderr)

    weapons = []
    gv = ""
    fixed = 0
    for i, (k, variants) in enumerate(sorted(groups.items())):
        # try the skin-less canonical first, then other variants, until stats are valid
        variants.sort(key=lambda w: ('"' in (w.get("name") or ""), w.get("name") or ""))
        d = None
        for attempt, w in enumerate(variants[:5]):
            try:
                dd = get(f"{API}/weapons/{w['uuid']}").get("data", {})
            except Exception as e:
                print(f"  skip variant of {k}: {e}", file=sys.stderr)
                continue
            time.sleep(0.05)  # be polite to the wiki API
            if d is None:
                d = dd  # fallback to first fetched
            if valid_stats(dd):
                if attempt > 0:
                    fixed += 1
                d = dd
                break
        if d is None:
            continue
        gv = gv or (d.get("version") or "")
        pw = d.get("personal_weapon") or {}
        dmg = pw.get("damage") or {}
        am = d.get("ammunition") or {}
        bp = d.get("blueprint") or []
        imgs = d.get("images") or []
        weapons.append({
            "name": base_name(d.get("name") or k),
            "class": d.get("classification_label"),
            "subType": d.get("sub_type_label"),
            "size": d.get("size"),
            "rarity": d.get("rarity"),
            "manufacturer": (d.get("manufacturer") or {}).get("name"),
            "craftable": bool(d.get("is_craftable")),
            "lootable": bool(d.get("is_lootable")),
            "blueprint": (bp[0].get("name") if bp else None),
            "skins": len(variants),
            "img": (imgs[0].get("thumbnail_url") or imgs[0].get("original_url")) if imgs else None,
            "magSize": sane(pw.get("magazine_size")),
            "effRange": sane(pw.get("effective_range") or pw.get("range")),
            "dmgPerShot": sane(pw.get("damage_per_shot")),
            "pellets": pw.get("pellets_per_shot"),
            "rpm": sane(pw.get("rpm") or pw.get("rof")),
            "fireModes": fire_modes(pw.get("modes")),
            "dps": dmg.get("dps_total"),
            "alpha": dmg.get("alpha_total"),
            "dmgType": dominant_type(dmg.get("dps")) or (dmg.get("dps") and None),
            "ammoSpeed": am.get("speed"),
        })
        if i % 20 == 0:
            print(f"  {i}/{len(groups)} ...", file=sys.stderr)

    weapons.sort(key=lambda x: (x["class"] or "zzz", -(x["dps"] or 0), x["name"] or ""))
    payload = {"game_version": gv, "count": len(weapons), "weapons": weapons}
    (DATA / "fps-weapons.json").write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(weapons)} weapons (game {gv}); {fixed} repaired from skin variants", file=sys.stderr)


if __name__ == "__main__":
    main()
