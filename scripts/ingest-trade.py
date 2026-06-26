#!/usr/bin/env python3
"""
Build trade data for NEMESIS Command Deck from the public UEX Corp API
(uexcorp.space, no token required). Produces TWO static snapshots:

  data/trade-routes.json   — best buy→sell route per commodity, now STOCK-AWARE:
                             available SCU + inventory status + data-age at both ends,
                             so the board can rank by realisable profit, not raw margin.
  data/commodity-buy.json  — commodity name → cheapest buy terminals (+ stock), for the
                             Crafting supply-chain planner.

Routes are COMPUTED here. Per commodity we pick the cheapest *stocked* buy terminal and the
dearest *non-saturated* sell terminal (falling back to plain cheapest/dearest when stock
data is missing). For every terminal we carry the UEX inventory status code (0..7), the
available SCU, and the report age (from date_modified) so the UI can show how full a
terminal is and how stale the reading is. Prices/stock are a community SNAPSHOT — not live.

UEX status codes (see api.uexcorp.space/2.0/commodities_status):
  0 = no data · 1 Out of Stock (0-14%) · 2 Very Low · 3 Low · 4 Medium · 5 High ·
  6 Very High · 7 Maximum (86-100%). BUY: higher = more to buy. SELL: INVERTED — a low
  fill means empty demand bins = good to sell into; 6/7 = saturated = bad.

There is NO restock timer/rate in the source — only date_modified. We never fabricate one.

Designed to run in CI on a schedule (every ~8h) and commit. No auth needed.

Usage:  python scripts/ingest-trade.py
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
STALE_DAYS = 7


def get(ep):
    req = urllib.request.Request(f"{API}/{ep}", headers={"User-Agent": "nemesis-command-deck", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8")).get("data", [])


def age_days(dm):
    if not dm:
        return None
    return max(0, int((SNAP_UNIX - dm) // 86400))


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
        if (p.get("price_buy") or 0) > 0:
            buys[cid].append(p)
        if (p.get("price_sell") or 0) > 0:
            sells[cid].append(p)

    routes = []
    for cid, blist in buys.items():
        if cid not in sells:
            continue
        cm = cmeta.get(cid, {})

        # BUY: prefer the cheapest terminal that actually has stock (status Low+ and scu>0)
        stocked = [b for b in blist if (b.get("status_buy") or 0) >= 3 and (b.get("scu_buy") or 0) > 0]
        bb = min(stocked or blist, key=lambda x: x["price_buy"])

        # SELL: drop saturated terminals (status 6/7 = no demand), then prefer the dearest
        # terminal that actually has demand (reported demand SCU, or an empty/low-fill demand
        # bin = a hungry buyer) so the #1 route is one that will truly absorb the cargo.
        slist = sells[cid]
        non_sat = [s for s in slist if (s.get("status_sell") or 0) not in (6, 7)]
        with_demand = [s for s in non_sat if (s.get("scu_sell") or 0) > 0 or (s.get("status_sell") or 0) in (1, 2, 3, 4, 5)]
        bs = max(with_demand or non_sat or slist, key=lambda x: x["price_sell"])

        profit = round(bs["price_sell"] - bb["price_buy"], 2)
        if profit <= 0:
            continue
        bt, st = tloc.get(bb["id_terminal"], {}), tloc.get(bs["id_terminal"], {})
        b_age, s_age = age_days(bb.get("date_modified")), age_days(bs.get("date_modified"))
        routes.append({
            "commodity": cm.get("name"), "kind": cm.get("kind"), "illegal": cm.get("illegal"),
            # buy side
            "buyPrice": round(bb["price_buy"], 2), "buyPriceAvg": round(bb.get("price_buy_avg") or bb["price_buy"], 2),
            "buyTerminal": bt.get("name"), "buySystem": bt.get("system"), "buyAt": bt.get("at"),
            "buyScu": round(bb.get("scu_buy") or 0), "buyScuAvg": round(bb.get("scu_buy_avg") or 0),
            "buyStatus": bb.get("status_buy") or 0, "buyAgeDays": b_age, "buyStale": (b_age is None or b_age > STALE_DAYS),
            # sell side
            "sellPrice": round(bs["price_sell"], 2), "sellPriceAvg": round(bs.get("price_sell_avg") or bs["price_sell"], 2),
            "sellTerminal": st.get("name"), "sellSystem": st.get("system"), "sellAt": st.get("at"),
            "sellDemandScu": round(bs.get("scu_sell") or 0), "sellDemandScuAvg": round(bs.get("scu_sell_avg") or 0),
            "sellStockScu": round(bs.get("scu_sell_stock") or 0),
            "sellStatus": bs.get("status_sell") or 0, "sellAgeDays": s_age, "sellStale": (s_age is None or s_age > STALE_DAYS),
            # shared
            "profit": profit,
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
        buy_index[nm] = [{
            "price": round(b["price_buy"], 2),
            "terminal": tloc.get(b["id_terminal"], {}).get("name"),
            "system": tloc.get(b["id_terminal"], {}).get("system"),
            "scu": round(b.get("scu_buy") or 0),
            "status": b.get("status_buy") or 0,
            "ageDays": age_days(b.get("date_modified")),
        } for b in top]

    meta = {"snapshot": SNAP, "snapshotUnix": SNAP_UNIX, "staleDays": STALE_DAYS, "count": len(routes)}
    (DATA / "trade-routes.json").write_text(json.dumps({**meta, "routes": routes}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (DATA / "commodity-buy.json").write_text(json.dumps({"snapshot": SNAP, "snapshotUnix": SNAP_UNIX, "commodities": buy_index}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"wrote {len(routes)} routes, {len(buy_index)} buy-indexed commodities", file=sys.stderr)


if __name__ == "__main__":
    main()
