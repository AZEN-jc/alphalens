#!/usr/bin/env python3
"""Fetch multi-period OHLC timelines for cached AlphaLens instruments.

Minute bars come from eastmoney push2his via curl (the Python clients trip its
TLS fingerprint check). Weekly bars are derived from real daily bars, never
invented. Each period is cached independently; a failed period never erases
another period's real data.

    ./.venv/bin/python fetch_timeline.py
    ./.venv/bin/python fetch_timeline.py --offline
"""

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

BASE = Path(__file__).resolve().parent
CACHE = BASE / "cache"

if not os.environ.get("HTTPS_PROXY"):
    os.environ.setdefault("HTTPS_PROXY", "http://127.0.0.1:7890")
    os.environ.setdefault("HTTP_PROXY", "http://127.0.0.1:7890")

PERIOD_KLT = {"1m": 1, "5m": 5, "15m": 15}
PERIOD_LIMIT = {"1m": 240, "5m": 240, "15m": 192}
STATUS = {}
UA = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/81.0 Safari/537.36"


def num(value, default=0.0):
    try:
        out = float(value)
        return out if out == out and abs(out) != float("inf") else default
    except (TypeError, ValueError):
        return default


def curl_json(url, params):
    full = url + "?" + urlencode(params)
    for extra in ([], ["--noproxy", "*"]):
        proc = subprocess.run(["curl", "-s", "--max-time", "20", "-H", UA, *extra, full],
                              capture_output=True, text=True, timeout=25)
        if proc.returncode == 0 and proc.stdout.lstrip().startswith("{"):
            return json.loads(proc.stdout)
    raise ValueError("no response from " + url)


def secid(code):
    market = "1" if code.startswith(("6", "5", "9", "0")) and len(code) == 6 and code[0] in "65" else "0"
    if code.startswith(("000", "399")):
        market = "1" if code.startswith("000") else "0"
    return market + "." + code


def fetch_minutes_sina(code, period):
    symbol = ("sh" if code.startswith(("6", "5", "9")) else "sz") + code
    scale = {"1m": 5, "5m": 5, "15m": 15}[period]
    url = ("https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=/"
           "CN_MarketDataService.getKLineData?symbol=" + symbol +
           "&scale=" + str(scale) + "&ma=no&datalen=" + str(PERIOD_LIMIT[period]))
    proc = subprocess.run(["curl", "-sS", "--max-time", "20", "--noproxy", "*", url],
                          capture_output=True, text=True, timeout=25)
    text = proc.stdout
    start = text.find("([")
    end = text.rfind("])")
    if start < 0 or end < 0:
        raise ValueError("sina minute payload malformed")
    rows = json.loads(text[start + 1:end + 1])
    bars = []
    for r in rows:
        o, h, l, c = num(r.get("open")), num(r.get("high")), num(r.get("low")), num(r.get("close"))
        if not (h >= max(o, c) and 0 < l <= min(o, c)):
            continue
        bars.append({"t": str(r.get("day"))[-11:], "o": round(o, 2), "h": round(h, 2),
                     "l": round(l, 2), "c": round(c, 2),
                     "vol": max(1.0, num(r.get("volume"))), "amount": 0.0})
    if len(bars) < 12:
        raise ValueError("only %d sina %s bars" % (len(bars), period))
    source = "SINA_MINUTE_5M_AS_1M" if period == "1m" else "SINA_MINUTE_REAL"
    return {"bars": bars, "period": period, "source": source}


def fetch_minutes(code, period):
    try:
        return fetch_minutes_sina(code, period)
    except Exception as sina_exc:
        try:
            payload = curl_json("https://push2his.eastmoney.com/api/qt/stock/kline/get", {
                "secid": secid(code), "fields1": "f1,f2,f3,f4,f5,f6",
                "fields2": "f51,f52,f53,f54,f55,f56,f57",
                "klt": PERIOD_KLT[period], "fqt": "1", "lmt": str(PERIOD_LIMIT[period]),
                "end": "20500101", "ut": "fa5fd1943c7b386f172d6893dbfba10b",
                "_": int(time.time() * 1000)
            })
            klines = (payload.get("data") or {}).get("klines") or []
            bars = []
            for line in klines:
                p = line.split(",")
                if len(p) < 6:
                    continue
                o, h, l, c = num(p[1]), num(p[2]), num(p[3]), num(p[4])
                if not (h >= max(o, c) and 0 < l <= min(o, c)):
                    continue
                bars.append({"t": p[0][-11:], "o": round(o, 2), "h": round(h, 2),
                             "l": round(l, 2), "c": round(c, 2),
                             "vol": max(1.0, num(p[5])), "amount": max(1.0, num(p[6]))})
            if len(bars) < 12:
                raise ValueError("only %d bars" % len(bars))
            return {"bars": bars, "period": period, "source": "EASTMONEY_PUSH2HIS_CURL"}
        except Exception:
            raise sina_exc


def weekly_from_daily(daily_bars):
    weeks = []
    cur = None
    for b in daily_bars:
        stamp = datetime.strptime(b["t"], "%Y-%m-%d")
        key = stamp.isocalendar()[:2]
        if cur is None or cur["key"] != key:
            if cur:
                weeks.append(cur["bar"])
            cur = {"key": key, "bar": dict(b)}
        else:
            bar = cur["bar"]
            bar["h"] = max(bar["h"], b["h"])
            bar["l"] = min(bar["l"], b["l"])
            bar["c"] = b["c"]
            bar["vol"] += b["vol"]
            bar["amount"] += b["amount"]
    if cur:
        weeks.append(cur["bar"])
    for bar in weeks:
        for k in ("o", "h", "l", "c", "vol", "amount"):
            bar[k] = round(bar[k], 2)
    if len(weeks) < 10:
        raise ValueError("only %d weekly bars" % len(weeks))
    return {"bars": weeks, "period": "1W", "source": "DERIVED_FROM_REAL_DAILY"}


def section(name, live_fn, offline):
    path = CACHE / (name + ".json")
    if not offline:
        started = time.time()
        try:
            data = live_fn()
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            STATUS[name] = "LIVE %.1fs" % (time.time() - started)
            return data
        except Exception as exc:
            STATUS[name] = "%s: %s" % (type(exc).__name__, str(exc)[:70])
    else:
        STATUS[name] = "OFFLINE"
    if path.exists():
        STATUS[name] += " -> CACHE"
        return json.loads(path.read_text(encoding="utf-8"))
    STATUS[name] += " -> MISSING"
    return None


def main():
    ap = argparse.ArgumentParser(description="Fetch multi-period timelines")
    ap.add_argument("--offline", action="store_true", help="cache only")
    ap.add_argument("--codes", default="", help="override instrument codes")
    args = ap.parse_args()
    if not CACHE.is_dir():
        CACHE.mkdir(parents=True)

    snap = json.loads((BASE / "snapshot.json").read_text(encoding="utf-8"))
    codes = [c.strip() for c in args.codes.split(",") if c.strip()] or list(snap["stocks"])
    timelines = snap.get("timelines") or {}
    for code in codes:
        daily = [b for b in snap["stocks"][code]["bars"]]
        timelines[code] = {}
        for period in ("1m", "5m", "15m"):
            key = "min_%s_%s" % (code, period)
            data = section(key, lambda c=code, p=period: fetch_minutes(c, p), args.offline)
            if data:
                timelines[code][period] = data
        weekly = section("weekly_" + code, lambda d=daily: weekly_from_daily(d), args.offline)
        if weekly:
            timelines[code]["1W"] = weekly
        timelines[code]["1D"] = {"bars": daily, "period": "1D", "source": "SNAPSHOT_DAILY"}

    snap["timelines"] = timelines
    snap.setdefault("meta", {}).setdefault("sections", {}).update(STATUS)
    snap["meta"].setdefault("proxies", [])
    for code, periods in timelines.items():
        for period, data in periods.items():
            label = data.get("source", "")
            if "DERIVED" in label:
                note = "timeline.%s.%s: weekly aggregated from real daily bars, not a separate feed" % (code, period)
                if note not in snap["meta"]["proxies"]:
                    snap["meta"]["proxies"].append(note)
            if "AS_1M" in label:
                note = "timeline.%s.1m: 5-minute bars shown at 1m scale, no true 1-minute feed" % code
                if note not in snap["meta"]["proxies"]:
                    snap["meta"]["proxies"].append(note)
            if period in PERIOD_KLT and not data.get("bars"):
                note = "timeline.%s.%s: no real minute data cached" % (code, period)
                if note not in snap["meta"]["proxies"]:
                    snap["meta"]["proxies"].append(note)
    snap["meta"]["proxies"] = sorted(set(snap["meta"]["proxies"]))
    (BASE / "snapshot.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1), encoding="utf-8")

    print("\n%-22s %s" % ("SECTION", "STATUS"))
    print("-" * 70)
    for key, value in STATUS.items():
        print("%-22s %s" % (key, value))
    print("-" * 70)
    for code in codes:
        print(code, "periods:", ",".join(timelines[code].keys()))
    print("wrote timelines into snapshot.json")


if __name__ == "__main__":
    main()
