#!/usr/bin/env python3
"""Fetch real daily history for all 45 instruments -> alphalens/depth.json.

Source: AKShare stock_zh_a_daily (Sina backend, NOT eastmoney push2 — no rate limit).
Fields per bar: t/o/h/l/c/vol/amount/turnover. Valuation (pe/pb/mktCap) comes from
futu_enrichment.json where available; futures use snapshot.deriv baseline and are
honestly marked NO_KLINE_FEED — never fabricated.

Offline: if a cached depth.json exists and --offline is passed, no network at all.
"""
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
SNAP = json.loads((BASE / "snapshot.json").read_text(encoding="utf-8"))
FUTU = json.loads((BASE / "futu_enrichment.json").read_text(encoding="utf-8"))
OUT = BASE / "depth.json"
START = (datetime.now() - timedelta(days=200)).strftime("%Y%m%d")
END = datetime.now().strftime("%Y%m%d")
OFFLINE = "--offline" in sys.argv


def sina_symbol(x):
    """stock_zh_a_daily uses sh600519 / sz000001 / sh000001 style."""
    code = x["code"]
    if x["kind"] == "期货":
        return None
    if x["kind"] == "指数":
        mkt = {"000001": "sh", "000300": "sh", "000905": "sh", "000852": "sh",
               "000016": "sh", "000688": "sh", "399001": "sz", "399006": "sz"}.get(code, "sh")
        return mkt + code
    if code.startswith(("6", "5", "9", "68")):
        return "sh" + code
    if code.startswith(("0", "3", "15", "16")):
        return "sz" + code
    return "sh" + code


def sid_of(x):
    code = x["code"]
    if x["kind"] == "指数":
        mkt = {"000001": "SH", "000300": "SH", "000905": "SH", "000852": "SH",
               "000016": "SH", "000688": "SH", "399001": "SZ", "399006": "SZ"}.get(code, "SH")
        return mkt + "." + code
    if code.startswith(("6", "5", "9", "68")):
        return "SH." + code
    if code.startswith(("0", "3", "15", "16")):
        return "SZ." + code
    return "BJ." + code


def main():
    if OFFLINE and OUT.exists():
        d = json.loads(OUT.read_text(encoding="utf-8"))
        print("offline depth.json kept: %d symbols" % len(d.get("series", {})))
        return

    import akshare as ak
    series = {}
    failed = []
    uni = SNAP.get("universe", [])
    for i, x in enumerate(uni, 1):
        code, kind = x["code"], x["kind"]
        sid = sid_of(x)
        sym = sina_symbol(x)
        if not sym:
            continue
        try:
            # 指数/ETF 在新浪有专用接口；stock_zh_a_daily 对它们返回空
            if kind == "指数":
                df = ak.stock_zh_index_daily(symbol=sym)
            elif kind == "ETF":
                df = ak.fund_etf_hist_sina(symbol=sym)
            else:
                df = ak.stock_zh_a_daily(symbol=sym, start_date=START, end_date=END, adjust="qfq")
            if df is None or df.empty:
                failed.append((code, "empty"))
                continue
            # 统一按日期窗口裁剪（保留最近 120 根即可）
            cutoff = START[:4] + "-" + START[4:6] + "-" + START[6:]
            df = df[df["date"].astype(str).str[:10] >= cutoff]
            bars = []
            for _, r in df.iterrows():
                o, h, l, c = (float(r[k]) for k in ("open", "high", "low", "close"))
                if not (h >= max(o, c) and 0 < l <= min(o, c)):
                    continue
                bars.append({
                    "t": str(r["date"])[:10],
                    "o": round(o, 3), "h": round(h, 3), "l": round(l, 3), "c": round(c, 3),
                    "vol": float(r.get("volume") or 0),
                    "amount": float(r.get("amount") or 0),
                    "turn": float(r.get("turnover") or 0) if "turnover" in df.columns else 0,
                })
            if len(bars) < 20:
                failed.append((code, "only %d bars" % len(bars)))
                continue
            q = FUTU.get("quotes", {}).get(sid, {})
            series[sid] = {
                "code": code, "name": x["name"], "kind": kind, "sid": sid,
                "bars": bars[-120:],
                "pe": q.get("pe_ratio"), "pb": q.get("pb_ratio"),
                "mktCap": q.get("total_market_val"),
                "valSource": "FUTU_MCP" if q else "NO_VALUATION",
            }
            print("  [%02d/%d] %-9s %-10s %3d bars" % (i, len(uni), sid, x["name"][:6], len(bars[-120:])))
        except Exception as e:
            failed.append((code, type(e).__name__ + ":" + str(e)[:50]))
            print("  [%02d/%d] %-9s FAIL %s" % (i, len(uni), sid, type(e).__name__))
        time.sleep(0.15)  # be gentle to Sina

    # 期货：无 K 线源，用 deriv 真快照基准，诚实标注
    fut_basis = {b["sym"]: b for b in SNAP.get("deriv", {}).get("basis", [])}
    fut_comm = {c["sym"]: c for c in SNAP.get("deriv", {}).get("commodity", [])}
    for x in uni:
        if x["kind"] != "期货":
            continue
        sid = sid_of(x)
        key = x["code"].rstrip("0") if x["code"].endswith("0") else x["code"]
        b, c = fut_basis.get(key), fut_comm.get(key)
        series[sid] = {
            "code": x["code"], "name": x["name"], "kind": "期货", "sid": sid,
            "bars": [], "basis": b, "commodity": c,
            "valSource": "DERIV_SNAPSHOT",
            "note": "富途无A股期货K线权限；仅基差/涨跌快照基准，非逐日历史",
        }

    out = {
        "fetched_at": datetime.now(timezone(timedelta(hours=8))).isoformat(),
        "source": "AKSHARE_SINA_DAILY + FUTU_MCP_VALUATION + DERIV_SNAPSHOT",
        "count": len(series),
        "failed": failed,
        "series": series,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("\nwrote depth.json %d bytes | %d series (%d failed: %s)" %
          (OUT.stat().st_size, len(series), len(failed), failed[:5]))


if __name__ == "__main__":
    main()
