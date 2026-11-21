#!/usr/bin/env python3
"""Fetch 10-year index history and aggregate to monthly bars.

AKShare's stock_zh_index_daily (Sina) returns full daily history in one call.
Monthly bars are derived locally from those real daily bars — no invented data.
Cached per index; a failed fetch keeps the previous cache.

    ./.venv/bin/python fetch_decade.py
    ./.venv/bin/python fetch_decade.py --offline
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
CACHE = BASE / "cache"

if not os.environ.get("HTTPS_PROXY"):
    os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")
    os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7890")

try:
    import akshare as ak
except ImportError:
    ak = None

INDEXES = [
    ("sh000001", "上证指数"),
    ("sz399001", "深证成指"),
    ("sz399006", "创业板指"),
    ("sh000300", "沪深300"),
    ("sh000905", "中证500"),
]
YEARS = 10
STATUS = {}


def to_monthly(rows):
    buckets = {}
    for r in rows:
        d = str(r["date"])[:7]
        o, h, l, c = float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"])
        if d not in buckets:
            buckets[d] = {"t": d, "o": o, "h": h, "l": l, "c": c, "vol": float(r.get("volume", 0))}
        else:
            b = buckets[d]
            b["h"] = max(b["h"], h); b["l"] = min(b["l"], l)
            b["c"] = c; b["vol"] += float(r.get("volume", 0))
    out = []
    for d in sorted(buckets)[-YEARS * 12:]:
        b = buckets[d]
        out.append({"t": b["t"], "o": round(b["o"], 2), "h": round(b["h"], 2),
                    "l": round(b["l"], 2), "c": round(b["c"], 2),
                    "vol": round(b["vol"], 0)})
    return out


def fetch_one(sym):
    if ak is None:
        raise RuntimeError("akshare missing")
    df = ak.stock_zh_index_daily(symbol=sym)
    rows = df.tail(YEARS * 260).to_dict("records")
    return {"bars": to_monthly(rows), "source": "AKSHARE_SINA_DAILY_AGGREGATED", "symbol": sym}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true")
    args = ap.parse_args()
    if not CACHE.is_dir():
        CACHE.mkdir(parents=True)
    snap_path = BASE / "snapshot.json"
    snap = json.loads(snap_path.read_text(encoding="utf-8")) if snap_path.exists() else {}
    decade = snap.get("decade") or {}
    for sym, name in INDEXES:
        key = "decade_" + sym
        path = CACHE / (key + ".json")
        data = None
        if not args.offline:
            try:
                data = fetch_one(sym)
                path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
                STATUS[key] = "LIVE %d months" % len(data["bars"])
            except Exception as exc:
                STATUS[key] = "%s: %s" % (type(exc).__name__, str(exc)[:70])
        else:
            STATUS[key] = "OFFLINE"
        if data is None and path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            STATUS[key] += " -> CACHE"
        if data:
            data["name"] = name
            decade[sym] = data
    snap["decade"] = decade
    snap.setdefault("meta", {}).setdefault("sections", {}).update(STATUS)
    note = "decade.*: monthly bars aggregated from real AKShare Sina daily history"
    if note not in snap["meta"].setdefault("proxies", []):
        snap["meta"]["proxies"].append(note)
    snap["meta"]["proxies"] = sorted(set(snap["meta"]["proxies"]))
    snap_path.write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")
    print("%-22s %s" % ("SECTION", "STATUS"))
    for k, v in STATUS.items():
        print("%-22s %s" % (k, v))
    print("wrote decade into snapshot.json")


if __name__ == "__main__":
    main()
