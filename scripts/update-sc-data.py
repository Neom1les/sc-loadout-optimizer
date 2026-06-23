#!/usr/bin/env python3
"""
Auto-update the SC Optimizer's Earnings Finder + Patch Hub data.

Uses Claude (Opus 4.8) with the web_search server tool to find the CURRENT
Star Citizen patch and the latest money / reputation methods + new patch
features, then merges the findings into:
    data/activities.json
    data/guides.json
    data/patch-info.json

Designed to run in CI (GitHub Actions, weekly). Requires ANTHROPIC_API_KEY.

Conservative by design: it ADDS new activities/guides and REVISES money values
for known ones, marks dropped activities as low-confidence rather than deleting
them, and bumps the patch stamp. A human reviews the resulting commit/PR.
"""

import json
import os
import re
import sys
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MODEL = "claude-opus-4-8"          # default per project policy
NOW = os.environ.get("RUN_DATE", "")  # injected by CI; empty locally


# ----------------------------------------------------------------------------- io helpers
def load(name):
    p = DATA / name
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return {"data": []}


def write(name, obj):
    (DATA / name).write_text(
        json.dumps(obj, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-") or "item"


def extract_json(text):
    """Pull the first balanced {...} object out of a model response."""
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    start = text.find("{")
    if start < 0:
        raise ValueError("no JSON object found in model response")
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                return json.loads(text[start : i + 1])
    raise ValueError("unbalanced JSON in model response")


# ----------------------------------------------------------------------------- research
def build_prompt(known_patch, known_acts, known_guides):
    return f"""You maintain the data powering a Star Citizen money / reputation / patch-guide web tool.

Use web search to do the following, then return a single JSON object (no prose):

1. Determine the CURRENT live Star Citizen patch version (e.g. "4.8.1-LIVE") and its release date.
2. Research the CURRENT best money-making and reputation activities and any NEW gameplay features that warrant a step-by-step guide. Prefer recent, reputable community sources (Star Citizen Wiki, RSI, ggwtb, mmopixel, Reddit, YouTube guide notes).

The tool already contains these activities (do NOT duplicate them):
{json.dumps(known_acts, ensure_ascii=False)}

And these guides (do NOT duplicate them):
{json.dumps(known_guides, ensure_ascii=False)}

The tool's current data patch is "{known_patch}".

Return JSON with EXACTLY these keys:
{{
  "currentPatch": "string (e.g. 4.8.1-LIVE)",
  "patchReleaseDate": "YYYY-MM-DD or ''",
  "isNewer": true/false,            // is currentPatch newer than the tool's "{known_patch}"?
  "newActivities": [ {{
     "name": "...", "category": "salvage|mining|hauling|trading|combat|bounty|mercenary|medical|exploration|event|other",
     "lawful": true, "auecPerHourMin": 0, "auecPerHourMax": 0, "confidence": "verified|estimated|rough",
     "repFaction": "", "repNote": "", "repGate": "", "risk": 1, "solo": true, "crew": false,
     "setupMinutes": 0, "requirements": "", "tags": [], "summary": "", "sources": []
  }} ],
  "moneyRevisions": [ {{ "name": "<existing activity name>", "auecPerHourMin": 0, "auecPerHourMax": 0, "confidence": "verified|estimated|rough", "note": "" }} ],
  "newGuides": [ {{
     "name": "...", "category": "...", "status": "new|changed", "difficulty": 1, "timeMinutes": 0,
     "requirements": "", "rewards": "", "locations": [],
     "steps": [ {{ "title": "", "detail": "" }} ], "tips": [], "links": [], "sources": []
  }} ],
  "staleActivities": [ "<existing activity name that is no longer viable / was removed>" ]
}}

Be accurate. Mark uncertain aUEC/h as confidence "rough". If the patch has not changed and nothing material is new, return empty arrays. Output ONLY the JSON object."""


def run_research(client, prompt):
    messages = [{"role": "user", "content": prompt}]
    tools = [{"type": "web_search_20260209", "name": "web_search"}]
    for _ in range(12):  # cap server-tool continuations
        resp = client.messages.create(
            model=MODEL,
            max_tokens=16000,
            tools=tools,
            thinking={"type": "adaptive"},
            messages=messages,
        )
        if resp.stop_reason == "pause_turn":
            messages.append({"role": "assistant", "content": resp.content})
            continue
        return "".join(b.text for b in resp.content if b.type == "text")
    raise RuntimeError("research loop did not converge")


# ----------------------------------------------------------------------------- merge
def norm_activity(a):
    return {
        "id": slug(a.get("name")),
        "name": a.get("name", ""),
        "category": a.get("category", "other"),
        "lawful": bool(a.get("lawful", True)),
        "money": {
            "min": int(a.get("auecPerHourMin", 0) or 0),
            "max": int(a.get("auecPerHourMax", 0) or 0),
            "confidence": a.get("confidence", "rough"),
        },
        "rep": {"faction": a.get("repFaction", ""), "note": a.get("repNote", ""), "gate": a.get("repGate", "")},
        "risk": int(a.get("risk", 2) or 2),
        "group": {"solo": bool(a.get("solo", True)), "crew": bool(a.get("crew", False))},
        "setupMinutes": int(a.get("setupMinutes", 0) or 0),
        "requirements": a.get("requirements", ""),
        "tags": a.get("tags", []),
        "summary": a.get("summary", ""),
        "guideId": None,
        "sources": a.get("sources", []),
    }


def norm_guide(g, patch):
    return {
        "id": slug(g.get("name")),
        "name": g.get("name", ""),
        "category": g.get("category", "feature"),
        "patch": patch,
        "status": g.get("status", "new"),
        "difficulty": int(g.get("difficulty", 2) or 2),
        "timeMinutes": int(g.get("timeMinutes", 0) or 0),
        "requirements": g.get("requirements", ""),
        "rewards": g.get("rewards", ""),
        "locations": g.get("locations", []),
        "steps": [{"title": s.get("title", ""), "detail": s.get("detail", "")} for s in g.get("steps", [])],
        "tips": g.get("tips", []),
        "links": g.get("links", []),
        "sources": g.get("sources", []),
    }


def main():
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: ANTHROPIC_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    client = anthropic.Anthropic()
    activities = load("activities.json")
    guides = load("guides.json")
    patch_info = load("patch-info.json")

    acts = activities.setdefault("data", [])
    glist = guides.setdefault("data", [])
    known_patch = patch_info.get("patch_version", "unknown")
    by_name = {a.get("name", "").lower(): a for a in acts}
    guide_names = {g.get("name", "").lower() for g in glist}

    prompt = build_prompt(known_patch, [a.get("name") for a in acts], [g.get("name") for g in glist])
    print(f"Researching current SC patch (tool is on {known_patch})…")
    update = extract_json(run_research(client, prompt))

    cur_patch = update.get("currentPatch") or known_patch
    added_a = added_g = revised = staled = 0

    # new activities
    for a in update.get("newActivities", []):
        if a.get("name", "").lower() in by_name:
            continue
        acts.append(norm_activity(a))
        by_name[a["name"].lower()] = acts[-1]
        added_a += 1

    # money revisions on known activities
    for r in update.get("moneyRevisions", []):
        tgt = by_name.get(r.get("name", "").lower())
        if not tgt:
            continue
        tgt.setdefault("money", {})
        if r.get("auecPerHourMax"):
            tgt["money"]["min"] = int(r.get("auecPerHourMin", 0) or 0)
            tgt["money"]["max"] = int(r.get("auecPerHourMax", 0) or 0)
        tgt["money"]["confidence"] = r.get("confidence", tgt["money"].get("confidence", "rough"))
        revised += 1

    # new guides
    for g in update.get("newGuides", []):
        if g.get("name", "").lower() in guide_names:
            continue
        glist.append(norm_guide(g, cur_patch))
        guide_names.add(g["name"].lower())
        added_g += 1

    # stale activities → demote confidence, tag, don't delete (human reviews)
    for name in update.get("staleActivities", []):
        tgt = by_name.get(name.lower())
        if not tgt:
            continue
        tgt.setdefault("money", {})["confidence"] = "stale"
        if "stale" not in tgt.setdefault("tags", []):
            tgt["tags"].append("stale")
        staled += 1

    # link any newly-added activity to a matching guide
    gids = {g["id"] for g in glist}
    for a in acts:
        if not a.get("guideId") and slug(a.get("name")) in gids:
            a["guideId"] = slug(a["name"])

    # stamp patch info
    activities["patch"] = cur_patch
    guides["patch"] = cur_patch
    patch_info["patch_version"] = cur_patch
    if update.get("patchReleaseDate"):
        patch_info["release_date"] = update["patchReleaseDate"]
    if NOW:
        patch_info["data_collection_date"] = NOW
        patch_info["auto_updated"] = NOW

    write("activities.json", activities)
    write("guides.json", guides)
    write("patch-info.json", patch_info)

    print(f"Patch: {known_patch} -> {cur_patch} (newer={update.get('isNewer')})")
    print(f"+{added_a} activities, +{added_g} guides, {revised} revised, {staled} marked stale")


if __name__ == "__main__":
    main()
