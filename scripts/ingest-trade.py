#!/usr/bin/env python3
"""
Build trade data for NEMESIS Command Deck from the public UEX Corp API
(uexcorp.space, no token required). Produces TWO static snapshots:

  data/trade-routes.json   — best buy→sell route per commodity (profit/SCU, terminals,
                             systems), for the Trade Routes board.
  data/commodity-buy.json  — commodity name → cheapest buy terminals, for the Crafting
                             supply-chain planner (maps blueprint ingredients to where
                             to buy them).

Routes are COMPUTED here (cheapest buyable terminal → most expensive sellable terminal),
because /commodities_routes needs per-query inputs. Prices are a SNAPSHOT — UEX prices
drift over trade cycles, so the UI stamps the snapshot time and shows a staleness note.

Designed to run in CI on a schedule (every ~8h) and commit. No auth needed.

Usage:  python scripts/ingest-trade.py
"""
import json
import os
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

API = "https://api.uexcorp.space/2.0"
DATA = Path(__file__).resolve().parent.parent / "data"
SNAP = os.environ.get("RUN_DATE", "")


def get(ep):
    req = urllib.request.Request(f"{API}/{ep}", headers={"User-Agent": "nemesis-command-deck", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8")).get("data", [])


def main():
    commodities = get("commodities")
    prices = get("commodities_prices_all")
    terminals = get("terminals")
    print(f"fetched: {len(commodities)} commodities, {len(prices)} prices, {len(terminals)} terminals", file=sys.stderr)

    tloc = {}
    for t in terminals:
        tloc[t["id"]] = {
            "name": t.get("nickname") or t.get("name") or "?",
            "system": t.get("star_system_name") or "",
            "at": t.get("planet_name") or t.get("space_station_name") or t.get("moon_name") or t.get("city_name") or t.get("outpost_name") or "",
        }
    cmeta = {c["id"]: {"name": c.get("name"), "kind": c.get("kind") or "Other", "illegal": bool(c.get("is_illegal"))} for c in commodities}

    buys, sells = defaultdict(list), defaultdict(list)
    for p in prices:
        cid = p.get("id_commodity")
        if (p.get("price_buy") or 0) > 0 and p.get("status_buy"):
            buys[cid].append(p)
        if (p.get("price_sell") or 0) > 0 and p.get("status_sell"):
            sells[cid].append(p)

    routes = []
    for cid, blist in buys.items():
        if cid not in sells:
            continue
        cm = cmeta.get(cid, {})
        bb = min(blist, key=lambda x: x["price_buy"])
        bs = max(sells[cid], key=lambda x: x["price_sell"])
        profit = round(bs["price_sell"] - bb["price_buy"], 2)
        if profit <= 0:
            continue
        bt, st = tloc.get(bb["id_terminal"], {}), tloc.get(bs["id_terminal"], {})
        routes.append({
            "commodity": cm.get("name"), "kind": cm.get("kind"), "illegal": cm.get("illegal"),
            "buyPrice": round(bb["price_buy"], 2), "buyTerminal": bt.get("name"), "buySystem": bt.get("system"), "buyAt": bt.get("at"),
            "sellPrice": round(bs["price_sell"], 2), "sellTerminal": st.get("name"), "sellSystem": st.get("system"), "sellAt": st.get("at"),
            "profit": profit, "marginPct": round(profit / bb["price_buy"] * 100) if bb["price_buy"] else 0,
            "sameSystem": bool(bt.get("system") and bt.get("system") == st.get("system")),
        })
    routes.sort(key=lambda r: -r["profit"])

    buy_index = {}
    for cid, blist in buys.items():
        cm = cmeta.get(cid, {})
        nm = (cm.get("name") or "").lower()
        if not nm:
            continue
        top = sorted(blist, key=lambda x: x["price_buy"])[:3]
        buy_index[nm] = [{"price": round(b["price_buy"], 2), "terminal": tloc.get(b["id_terminal"], {}).get("name"), "system": tloc.get(b["id_terminal"], {}).get("system")} for b in top]

    (DATA / "trade-routes.json").write_text(json.dumps({"snapshot": SNAP, "count": len(routes), "routes": routes}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (DATA / "commodity-buy.json").write_text(json.dumps({"snapshot": SNAP, "commodities": buy_index}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(routes)} routes, {len(buy_index)} buy-indexed commodities", file=sys.stderr)


if __name__ == "__main__":
    main()
