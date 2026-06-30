#!/usr/bin/env python3
"""
Build the Crew Ops ship picker catalog + tag activities with ship archetypes.

  data/crew-ships.json : every flyable ship/vehicle -> archetype tags + thumb,
                         so the user can pick "I want to fly the Polaris" and
                         get activities that ship actually suits.
  data/crew-ops.json   : each activity gets shipRoles[] (welcomed archetypes).

Archetypes are derived deterministically from ships.json role/career (+ a few
curated overrides for iconic versatile ships). A consistency cross-check maps
the ships each activity already names in free text to archetypes and warns if
the authored shipRoles miss them. Re-run per patch. No secrets.
"""
import json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "..", "data")

ARCH_LABEL = {
    "fighter": "Fighter", "gunship": "Gunship", "capital": "Capital", "cargo": "Cargo",
    "mining": "Mining", "salvage": "Salvage", "medical": "Medical", "exploration": "Exploration",
    "refuel": "Refuel", "racing": "Racing", "ground": "Ground", "interdiction": "Interdiction",
    "luxury": "Touring", "dropship": "Dropship", "multirole": "Multi-role", "starter": "Starter",
}

# role-token -> archetypes (token = a '/'-split piece of the role string, lowercased)
def tokens_to_arch(role):
    role = (role or "").lower()
    parts = re.split(r"[/,]", role)
    out = []
    def add(*a):
        for x in a:
            if x not in out: out.append(x)
    for p in parts:
        p = p.strip()
        if not p: continue
        if "heavy gunship" in p: add("gunship", "capital")
        elif "gunship" in p or "gun ship" in p: add("gunship")
        elif "corvette" in p: add("capital", "gunship")
        elif "frigate" in p or "destroyer" in p or "capital" in p: add("capital")
        elif "bomber" in p: add("gunship")
        elif "anti-air" in p: add("gunship")
        elif "heavy fighter" in p: add("fighter", "gunship")
        elif "fighter" in p or "interceptor" in p or "snub" in p: add("fighter")
        elif "mining" in p: add("mining")
        elif "salvage" in p: add("salvage")
        elif "medical" in p: add("medical")
        elif "refuel" in p: add("refuel")
        elif "expedition" in p or "pathfinder" in p: add("exploration")
        elif "luxury" in p or "touring" in p or "passenger" in p: add("luxury")
        elif "racing" in p: add("racing")
        elif "interdiction" in p: add("interdiction")
        elif "dropship" in p: add("dropship")
        elif "tank" in p: add("ground")
        elif "freight" in p or "cargo" in p: add("cargo")
        elif "modular" in p: add("multirole")
    return out

def career_arch(career):
    c = (career or "").lower()
    if c == "competition": return ["racing"]
    if c == "ground": return ["ground"]
    if c == "multi-role": return ["multirole"]
    if c == "starter": return ["starter"]
    if c == "gunship": return ["gunship"]
    if c == "destroyer": return ["capital"]
    return []

# curated extra archetypes for iconic / versatile ships (additive, by exact name)
OVERRIDES = {
    "Cutlass Black": ["dropship", "multirole"],
    "Cutlass Red": ["medical"],
    "Cutlass Blue": ["fighter"],
    "Caterpillar": ["cargo", "dropship"],
    "Carrack": ["exploration", "medical"],
    "Constellation Andromeda": ["gunship", "exploration"],
    "Constellation Phoenix": ["luxury", "exploration"],
    "Constellation Aquila": ["exploration"],
    "Valkyrie": ["dropship", "gunship"],
    "C8R Pisces": ["medical", "dropship"],
    "Pisces": ["dropship"],
    "Corsair": ["gunship", "exploration"],
    "Polaris": ["capital", "gunship"],
    "890 Jump": ["luxury", "capital"],
    "600i Touring": ["luxury", "exploration"],
    "Freelancer MAX": ["cargo"],
    "Freelancer": ["cargo", "multirole"],
    "Nomad": ["cargo", "multirole"],
    "Starfarer Gemini": ["refuel", "gunship"],
    "Hammerhead": ["gunship", "capital"],
    "Redeemer": ["gunship", "dropship"],
    "Ursa": ["ground"], "Ursa Medivac": ["ground", "medical"],
    "Cyclone": ["ground"], "ROC": ["mining", "ground"], "ROC-DS": ["mining", "ground"],
    "Vanguard Warden": ["fighter", "gunship"],
    "Vanguard Harbinger": ["gunship"], "Vanguard Sentinel": ["fighter", "gunship"],
    "Reclaimer": ["salvage"], "Vulture": ["salvage"], "MOLE": ["mining"],
}

def build_ships():
    raw = json.load(open(os.path.join(DATA, "ships.json"), encoding="utf-8"))
    data = raw.get("data", raw)
    seen = {}
    for x in data:
        n = x.get("name")
        if not n or n in seen: continue
        if not (x.get("is_spaceship") or x.get("is_vehicle")): continue
        seen[n] = x
    ships = []
    for n, x in seen.items():
        arch = tokens_to_arch(x.get("role")) + career_arch(x.get("career"))
        for extra in OVERRIDES.get(n, []):
            if extra not in arch: arch.append(extra)
        if not arch: arch = ["multirole"]
        ships.append({
            "name": n,
            "mfr": (x.get("manufacturer") or {}).get("code") or (x.get("manufacturer") or {}).get("name") or "",
            "role": x.get("role") or "",
            "arch": arch,
            "crewMax": (x.get("crew") or {}).get("max"),
            "size": (x.get("size") or {}).get("en_EN") if isinstance(x.get("size"), dict) else x.get("size"),
            "thumb": (x.get("images") or [{}])[0].get("thumbnail_url"),
        })
    ships.sort(key=lambda s: s["name"])
    return ships, {s["name"]: s["arch"] for s in ships}

# ── authored activity -> welcomed ship archetypes ────────────────────────────
ACTIVITY_ROLES = {
    "return-of-xenothreat": ["fighter", "gunship", "capital", "cargo", "medical"],
    "tactical-strike-group-intersec-nyx": ["capital", "gunship", "fighter", "dropship"],
    "pyro-contested-zone-raid": ["dropship", "fighter", "cargo"],
    "onyx-facility-co-op-clear": ["dropship", "medical", "fighter", "mining"],
    "security-bunker-assault": ["dropship", "fighter", "ground"],
    "distribution-center-loot-run": ["dropship", "cargo", "fighter", "medical"],
    "group-bounty-hunting": ["gunship", "capital", "fighter"],
    "multi-crew-dogfight-wing": ["gunship", "capital", "fighter"],
    "group-ship-mining-mole-three-turrets": ["mining", "fighter", "cargo"],
    "combined-ship-roc-ground-mining-expedition": ["mining", "ground", "cargo", "dropship"],
    "reclaimer-heavy-salvage-operation": ["salvage", "fighter", "cargo"],
    "vulture-moth-salvage-convoy": ["salvage", "fighter", "cargo"],
    "multicrew-cargo-hauling-convoy": ["cargo", "fighter"],
    "risky-cargo-smuggling-contested-space": ["cargo", "gunship", "fighter"],
    "refuelling-support-runs-starfarer": ["refuel", "fighter"],
    "armed-escort-convoy-protection": ["fighter", "gunship", "cargo", "refuel"],
    "medical-rescue-response": ["medical", "fighter", "ground"],
    "combat-search-and-rescue-under-fire": ["medical", "fighter", "gunship", "ground"],
    "derelict-outpost-exploration": ["exploration", "cargo", "dropship", "ground"],
    "cave-system-expedition-hand-roc-mining": ["ground", "mining", "dropship"],
    "racing-night-snake-pit-clio": ["racing"],
    "planetary-road-trip-rover-convoy": ["ground", "cargo"],
    "sightseeing-scenic-tour-flights": ["luxury", "exploration", "multirole"],
    "piracy-interdiction-and-boarding": ["interdiction", "fighter", "cargo", "gunship", "dropship"],
    "pyro-contested-zone-territory-fights": ["dropship", "medical", "fighter", "gunship"],
    "fleet-week-free-fly-events": ["luxury", "exploration", "capital", "multirole", "starter"],
}

def cross_check(ships_arch):
    """For each activity, map ships named in free text -> archetypes; warn if
    the authored shipRoles miss an archetype that a named ship clearly brings."""
    co = json.load(open(os.path.join(DATA, "crew-ops.json"), encoding="utf-8"))
    names_by_len = sorted(ships_arch.keys(), key=len, reverse=True)
    warnings = []
    for a in co["activities"]:
        roles = set(ACTIVITY_ROLES.get(a["id"], []))
        text = " ".join(a.get("ships") or [])
        named_arch = set()
        for nm in names_by_len:
            if len(nm) >= 4 and re.search(r"\b" + re.escape(nm) + r"\b", text):
                named_arch.update(ships_arch[nm])
        # escort/fighter is implicit-ok; only warn on substantive misses
        missing = named_arch - roles - {"multirole", "starter"}
        if missing:
            warnings.append(f"  {a['id']}: named ships imply {sorted(missing)} not in shipRoles {sorted(roles)}")
    return co, warnings

def main():
    ships, ships_arch = build_ships()
    co, warnings = cross_check(ships_arch)
    print(f"ships: {len(ships)}")
    print(f"activities tagged: {sum(1 for a in co['activities'] if a['id'] in ACTIVITY_ROLES)}/{len(co['activities'])}")
    print("CROSS-CHECK WARNINGS:" if warnings else "CROSS-CHECK: clean")
    for w in warnings: print(w)

    out_ships = {"updated_from": "ships.json", "archLabels": ARCH_LABEL, "ships": ships}
    json.dump(out_ships, open(os.path.join(DATA, "crew-ships.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    for a in co["activities"]:
        a["shipRoles"] = ACTIVITY_ROLES.get(a["id"], [])
    json.dump(co, open(os.path.join(DATA, "crew-ops.json"), "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"\nWrote data/crew-ships.json ({len(ships)} ships) + updated data/crew-ops.json with shipRoles")


if __name__ == "__main__":
    main()
