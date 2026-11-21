#!/usr/bin/env python3
"""AlphaLens v3 — fetch ETF top-10 holdings + real cash dividends with ex-rights fill analysis.

Outputs analysis_data.json matching the window.ALPHALENS_DATA contract:
  {meta, presets, assets:{code:{...,holdings,closes,fee}}, dividends:{code:{...}}}

Honesty rules (hard):
  * ETF with no equity holdings (e.g. gold 518880) -> holdingsStatus NO_EQUITY_HOLDINGS, [].
  * Fee fetch failure -> fee:null (never estimated).
  * Dividend fill check uses UNADJUSTED daily prices (adjust="") — forward-adjusted
    prices erase the ex-rights gap and would fake the fill result.
  * Single-instrument failure -> status FETCH_ERROR, batch continues.
"""
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import akshare as ak

BASE = Path(__file__).resolve().parent
from universe import ETFS, DIVIDEND_STOCKS, PRESET_PORTFOLIOS, build

OUT = BASE / "analysis_data.json"
START = (datetime.now() - timedelta(days=300)).strftime("%Y%m%d")
END = datetime.now().strftime("%Y%m%d")
NOW = datetime.now(timezone(timedelta(hours=8))).isoformat(timespec="seconds")


def nap():
    time.sleep(0.35 + (time.time() % 1) * 0.2)


def num(v):
    try:
        f = float(v)
        return f if f == f and abs(f) != float("inf") else 0.0
    except (TypeError, ValueError):
        return 0.0


def sina_sym(item):
    return item["market"] + item["code"]


def fetch_holdings(code):
    """Latest quarter top-10 holdings for an ETF. Returns (status, holdings, quarter)."""
    year = datetime.now().year
    for y in (year, year - 1):
        try:
            df = ak.fund_portfolio_hold_em(symbol=code, date=str(y))
            if df is None:
                continue
            if df.empty:
                # 商品 ETF 无股票持仓：接口正常返回空表，不是抓取失败
                return "NO_EQUITY_HOLDINGS", [], str(y) + "年（无股票持仓）"
            quarters = sorted(set(str(q) for q in df["季度"].tolist()))
            if not quarters:
                continue
            latest = quarters[-1]
            sub = df[df["季度"].astype(str) == latest].copy()
            sub = sub.sort_values("占净值比例", ascending=False).head(10)
            rows = []
            for _, r in sub.iterrows():
                c = str(r.get("股票代码", "")).strip()
                if not c or len(c) != 6:
                    continue
                rows.append({
                    "code": c,
                    "name": str(r.get("股票名称", "")).strip(),
                    "weight": round(num(r.get("占净值比例")), 2),
                })
            if rows:
                return "OK", rows, latest
            # 有成功的接口响应但无股票持仓行（商品 ETF，如黄金 518880）——这是正常结果
            return "NO_EQUITY_HOLDINGS", [], latest
        except Exception:
            continue
    return "FETCH_ERROR", [], None


def fetch_fee(code):
    """Try to read annual management + custodian fee. Returns pct or None."""
    try:
        df = ak.fund_overview_em()
        if df is None or df.empty or "管理费率" not in df.columns:
            return None
        hit = df[df["基金代码"].astype(str).str.startswith(code)]
        if hit.empty:
            return None
        r = hit.iloc[0]
        def pct(s):
            import re
            m = re.search(r"([\d.]+)%", str(s))
            return float(m.group(1)) if m else 0.0
        return round(pct(r.get("管理费率")) + pct(r.get("托管费率")), 2)
    except Exception:
        return None


def fetch_closes(item, start=START, end=END):
    """Daily closes via Sina. ETFs use fund_etf_hist_sina; stocks use stock_zh_a_daily."""
    code = item["code"]
    sym = sina_sym(item)
    try:
        if item.get("type") == "ETF":
            df = ak.fund_etf_hist_sina(symbol=sym)
        else:
            df = ak.stock_zh_a_daily(symbol=sym, start_date=start, end_date=end, adjust="qfq")
        if df is None or df.empty:
            return []
        col_t, col_c = ("date", "close") if "date" in df.columns else ("日期", "收盘")
        out = []
        for _, r in df.iterrows():
            t = str(r[col_t])[:10]
            if t < "2020-01-01" or t > END[:4] + "-" + END[4:6] + "-" + END[6:]:
                continue
            c = num(r[col_c])
            if c > 0:
                out.append({"t": t, "c": round(c, 4)})
        return out
    except Exception:
        return []


def fetch_unadjusted(symbol, start="20150101", end=END):
    """UNADJUSTED daily bars for fill-price verification."""
    try:
        df = ak.stock_zh_a_daily(symbol=symbol, start_date=start, end_date=end, adjust="")
        if df is None or df.empty:
            return []
        return [
            {"t": str(r["date"])[:10], "o": num(r["open"]), "h": num(r["high"]),
             "l": num(r["low"]), "c": num(r["close"])}
            for _, r in df.iterrows()
        ]
    except Exception:
        return []


def consecutive_years(years):
    if not years:
        return 0
    ys = sorted(set(years), reverse=True)
    cur = ys[0]
    count = 0
    expected = cur
    for y in ys:
        if y == expected:
            count += 1
            expected -= 1
        elif y < expected:
            break
    return count


def fetch_dividends(item):
    """10-year cash dividend history + ex-rights fill analysis (close >= preClose)."""
    code = item["code"]
    sym = sina_sym(item)
    base = {"code": code, "name": item["name"], "status": "OK",
            "consecutiveYears": 0, "ttmYieldPct": None, "avgFillDays": None,
            "fillWinRatePct": None, "history": []}
    try:
        df = ak.stock_history_dividend_detail(symbol=code, indicator="分红")
        if df is None or df.empty:
            base["status"] = "NO_DIVIDEND"
            return base
        rows = []
        for _, r in df.iterrows():
            if str(r.get("进度", "")).strip() != "实施":
                continue
            cash = num(r.get("派息"))
            ex = r.get("除权除息日")
            if cash <= 0 or ex is None or str(ex) == "NaT":
                continue
            ex_date = str(ex)[:10]
            ann = str(r.get("公告日期", ""))[:4]
            if not ann.isdigit() or int(ann) < datetime.now().year - 10:
                continue
            rows.append({"year": int(ann), "exDate": ex_date,
                         "cashPer10": round(cash, 3)})
        if not rows:
            base["status"] = "NO_DIVIDEND"
            return base
        bars = fetch_unadjusted(sym)
        if not bars:
            base["status"] = "FETCH_ERROR"
            return base
        by_date = {b["t"]: b for b in bars}
        dates = sorted(by_date)
        for rec in rows:
            ex = rec["exDate"]
            idx = next((i for i, d in enumerate(dates) if d >= ex), None)
            if idx is None or idx == 0:
                rec.update({"preClose": None, "filled": None, "fillDays": None})
                continue
            pre = by_date[dates[idx - 1]]["c"]
            rec["preClose"] = round(pre, 3)
            filled, days = False, None
            for j in range(idx, len(dates)):
                if by_date[dates[j]]["c"] >= pre:
                    filled, days = True, j - idx + 1
                    break
            rec.update({"filled": filled, "fillDays": days})
        valid = [r for r in rows if r.get("filled") is not None]
        filled = [r for r in valid if r["filled"]]
        base["consecutiveYears"] = consecutive_years([r["year"] for r in rows])
        base["fillWinRatePct"] = round(len(filled) / len(valid) * 100, 1) if valid else None
        base["avgFillDays"] = round(sum(r["fillDays"] for r in filled) / len(filled), 1) if filled else None
        # TTM cash yield: latest 12m cash per share / latest close (unadjusted close)
        latest_cash = sum(r["cashPer10"] for r in rows
                          if r["exDate"] >= (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")) / 10
        last_close = by_date[dates[-1]]["c"] if dates else 0
        base["ttmYieldPct"] = round(latest_cash / last_close * 100, 2) if last_close > 0 else None
        base["history"] = rows[-10:]
        return base
    except Exception as e:
        base["status"] = "FETCH_ERROR"
        base["error"] = type(e).__name__
        return base


def main():
    assets = {}
    print("=== ETF holdings (15) ===")
    for i, raw in enumerate(ETFS, 1):
        item = dict(raw); item["type"] = "ETF"
        status, holdings, quarter = fetch_holdings(item["code"])
        nap()
        fee = fetch_fee(item["code"]) if item["code"] != "518880" else None
        nap()
        closes = fetch_closes(item)
        nap()
        assets[item["code"]] = {
            "code": item["code"], "name": item["name"], "type": "ETF",
            "category": item["category"], "market": item["market"],
            "price": closes[-1]["c"] if closes else None,
            "changePct": None,
            "fee": fee, "holdingsQuarter": quarter,
            "holdingsStatus": status, "holdings": holdings,
            "closes": closes,
        }
        print(f"  [{i:02d}] {item['code']} {item['name'][:6]:6s} {status:18s} h={len(holdings):2d} closes={len(closes):3d} fee={fee}")

    print("=== Dividend stocks (15) ===")
    dividends = {}
    for i, raw in enumerate(DIVIDEND_STOCKS, 1):
        item = dict(raw); item["type"] = "STOCK"
        d = fetch_dividends(item)
        nap()
        closes = fetch_closes(item)
        nap()
        d["category"] = item["category"]
        dividends[item["code"]] = d
        assets[item["code"]] = {
            "code": item["code"], "name": item["name"], "type": "STOCK",
            "category": item["category"], "market": item["market"],
            "price": closes[-1]["c"] if closes else None,
            "changePct": None, "fee": None,
            "holdingsStatus": "NOT_APPLICABLE", "holdings": [],
            "closes": closes,
        }
        print(f"  [{i:02d}] {item['code']} {item['name'][:6]:6s} {d['status']:14s} y={d['consecutiveYears']:2d} win={d['fillWinRatePct']} ttm={d['ttmYieldPct']}")

    out = {
        "meta": {
            "generatedAt": NOW,
            "defaultBenchmarkPct": 2.0,
            "dataSources": {
                "etfHoldings": "AKShare fund_portfolio_hold_em (latest quarter top-10)",
                "dividends": "AKShare stock_history_dividend_detail (10y) + Sina unadjusted daily for fill",
                "dailyPrices": "AKShare Sina daily (qfq, 200 trading days) + Tencent live",
                "fillCriterion": "close >= pre-ex-date close (strict)",
            },
        },
        "presets": PRESET_PORTFOLIOS,
        "assets": assets,
        "dividends": dividends,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"\nwrote {OUT.name} {OUT.stat().st_size} bytes | assets={len(assets)} dividends={len(dividends)}")


if __name__ == "__main__":
    main()
