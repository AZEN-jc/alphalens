#!/usr/bin/env python3
"""AlphaLens v3.1 — fetch ETF top-10 holdings (with US/HK alias normalization),
unified 3-year forward-adjusted (qfq) daily closes, and real cash dividends with
strict unadjusted (raw) ex-rights fill verification.

Outputs analysis_data.json matching the window.ALPHALENS_DATA contract:
  {meta, presets, assets:{code:{...,holdings,closes,fee}}, dividends:{code:{...}}}

Honesty rules (hard):
  * All backtest / correlation daily closes use unified 3-year forward-adjusted (qfq) prices.
  * Dividend fill verification strictly uses 10-year UNADJUSTED daily prices (adjust="") —
    never mixed with qfq backtest closes.
  * ETF with no equity holdings (e.g. gold 518880) -> holdingsStatus NO_EQUITY_HOLDINGS, [].
  * Fee fetch failure -> fee:null (never estimated).
  * Single-instrument failure -> status FETCH_ERROR, batch continues.
"""
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import akshare as ak

BASE = Path(__file__).resolve().parent
from universe import ETFS, DIVIDEND_STOCKS, PRESET_PORTFOLIOS, build

OUT = BASE / "analysis_data.json"
BACKTEST_YEARS = 3
_TZ_CN = timezone(timedelta(hours=8))
_NOW_DT = datetime.now(_TZ_CN)
try:
    _START_DT = _NOW_DT.replace(year=_NOW_DT.year - BACKTEST_YEARS)
except ValueError:
    _START_DT = _NOW_DT.replace(year=_NOW_DT.year - BACKTEST_YEARS, day=28)

START = _START_DT.strftime("%Y%m%d")
END = _NOW_DT.strftime("%Y%m%d")
START_ISO = _START_DT.strftime("%Y-%m-%d")
END_ISO = _NOW_DT.strftime("%Y-%m-%d")
NOW = _NOW_DT.isoformat(timespec="seconds")

# Circuit breaker for Eastmoney push2 rate limiting so we do not hammer a throttled IP.
_EM_RATE_LIMITED = False

HOLDING_ALIAS_MAP = {
    # 美股科技核心龙头
    "AAPL": ("US:AAPL", "苹果 (AAPL)"), "APPLE": ("US:AAPL", "苹果 (AAPL)"), "苹果": ("US:AAPL", "苹果 (AAPL)"), "苹果公司": ("US:AAPL", "苹果 (AAPL)"),
    "NVDA": ("US:NVDA", "英伟达 (NVDA)"), "NVIDIA": ("US:NVDA", "英伟达 (NVDA)"), "英伟达": ("US:NVDA", "英伟达 (NVDA)"),
    "MSFT": ("US:MSFT", "微软 (MSFT)"), "MICROSOFT": ("US:MSFT", "微软 (MSFT)"), "微软": ("US:MSFT", "微软 (MSFT)"), "微软公司": ("US:MSFT", "微软 (MSFT)"),
    "AMZN": ("US:AMZN", "亚马逊 (AMZN)"), "AMAZON": ("US:AMZN", "亚马逊 (AMZN)"), "亚马逊": ("US:AMZN", "亚马逊 (AMZN)"),
    "GOOGL": ("US:GOOGL", "谷歌 (GOOGL)"), "GOOG": ("US:GOOGL", "谷歌 (GOOGL)"), "ALPHABET": ("US:GOOGL", "谷歌 (GOOGL)"), "谷歌": ("US:GOOGL", "谷歌 (GOOGL)"),
    "META": ("US:META", "Meta (META)"), "META PLATFORMS": ("US:META", "Meta (META)"),
    "TSLA": ("US:TSLA", "特斯拉 (TSLA)"), "TESLA": ("US:TSLA", "特斯拉 (TSLA)"), "特斯拉": ("US:TSLA", "特斯拉 (TSLA)"),
    "AVGO": ("US:AVGO", "博通 (AVGO)"), "BROADCOM": ("US:AVGO", "博通 (AVGO)"), "博通": ("US:AVGO", "博通 (AVGO)"),
    "NFLX": ("US:NFLX", "奈飞 (NFLX)"), "NETFLIX": ("US:NFLX", "奈飞 (NFLX)"), "奈飞": ("US:NFLX", "奈飞 (NFLX)"),
    "COST": ("US:COST", "开市客 (COST)"), "COSTCO": ("US:COST", "开市客 (COST)"),
    "AMD": ("US:AMD", "AMD (AMD)"), "超威半导体": ("US:AMD", "AMD (AMD)"),
    "PLTR": ("US:PLTR", "Palantir (PLTR)"),
    "TSM": ("US:TSM", "台积电 (TSM)"), "台积电": ("US:TSM", "台积电 (TSM)"),
    "MU": ("US:MU", "美光科技 (MU)"), "美光科技": ("US:MU", "美光科技 (MU)"),
    "INTC": ("US:INTC", "英特尔 (INTC)"), "INTEL": ("US:INTC", "英特尔 (INTC)"), "英特尔": ("US:INTC", "英特尔 (INTC)"),
    # 港股科技核心龙头
    "00700": ("HK:00700", "腾讯控股 (00700)"), "0700": ("HK:00700", "腾讯控股 (00700)"), "腾讯控股": ("HK:00700", "腾讯控股 (00700)"),
    "09988": ("HK:09988", "阿里巴巴 (09988)"), "9988": ("HK:09988", "阿里巴巴 (09988)"), "阿里巴巴-W": ("HK:09988", "阿里巴巴 (09988)"), "阿里巴巴-SW": ("HK:09988", "阿里巴巴 (09988)"),
    "03690": ("HK:03690", "美团 (03690)"), "3690": ("HK:03690", "美团 (03690)"), "美团-W": ("HK:03690", "美团 (03690)"),
    "01810": ("HK:01810", "小米集团 (01810)"), "1810": ("HK:01810", "小米集团 (01810)"), "小米集团-W": ("HK:01810", "小米集团 (01810)"),
    "09618": ("HK:09618", "京东集团 (09618)"), "9618": ("HK:09618", "京东集团 (09618)"), "京东集团-SW": ("HK:09618", "京东集团 (09618)"),
    "09888": ("HK:09888", "百度集团 (09888)"), "百度集团-W": ("HK:09888", "百度集团 (09888)"), "百度集团-SW": ("HK:09888", "百度集团 (09888)"),
    "01024": ("HK:01024", "快手 (01024)"), "00981": ("HK:00981", "中芯国际 (00981)"),
    "09999": ("HK:09999", "网易 (09999)"), "00992": ("HK:00992", "联想集团 (00992)"), "01211": ("HK:01211", "比亚迪股份 (01211)"),
}


def normalize_holding(raw_code: str, raw_name: str):
    """Normalize US/HK holding aliases across QDII reports; keep 6-digit A-shares unchanged."""
    code_key = (
        str(raw_code or "").strip().upper()
        .replace(".OQ", "").replace(".O", "").replace(".N", "").replace(".HK", "")
    )
    name_clean = str(raw_name or code_key).strip()
    name_key = name_clean.upper()
    if code_key.isdigit() and len(code_key) == 6:
        return (code_key, name_clean)
    for key in (code_key, name_key):
        if key in HOLDING_ALIAS_MAP:
            return HOLDING_ALIAS_MAP[key]
    for alias, target in HOLDING_ALIAS_MAP.items():
        if len(alias) >= 4 and alias in name_key:
            return target
    return (code_key, name_clean)


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
    """Latest quarter top-10 holdings for an ETF (US/HK aliases normalized & merged)."""
    year = _NOW_DT.year
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
            merged = {}
            for _, r in sub.iterrows():
                raw_c = str(r.get("股票代码", "")).strip()
                raw_n = str(r.get("股票名称", "")).strip()
                if not raw_c:
                    continue
                w = num(r.get("占净值比例"))
                if w <= 0:
                    continue
                norm_c, norm_n = normalize_holding(raw_c, raw_n)
                if norm_c in merged:
                    merged[norm_c]["weight"] = round(merged[norm_c]["weight"] + w, 2)
                else:
                    merged[norm_c] = {"code": norm_c, "name": norm_n, "weight": round(w, 2)}
            rows = sorted(merged.values(), key=lambda x: x["weight"], reverse=True)
            if rows:
                return "OK", rows, latest
            # 有成功的接口响应但无股票持仓行（商品 ETF，如黄金 518880）——这是正常结果
            return "NO_EQUITY_HOLDINGS", [], latest
        except Exception:
            continue
    return "FETCH_ERROR", [], None


def fetch_fee(code):
    """Read annual management + custodian fee from Eastmoney fund overview. Returns pct or None."""
    try:
        df = ak.fund_overview_em(symbol=code)
        if df is None or df.empty or "管理费率" not in df.columns:
            return None
        r = df.iloc[0]

        def pct(s):
            m = re.search(r"([\d.]+)%", str(s))
            return float(m.group(1)) if m else None

        mgmt = pct(r.get("管理费率"))
        cust = pct(r.get("托管费率"))
        if mgmt is None and cust is None:
            return None
        return round((mgmt or 0.0) + (cust or 0.0), 2)
    except Exception:
        return None


def _df_to_closes(df, start_iso=START_ISO, end_iso=END_ISO):
    if df is None or df.empty:
        return []
    col_t = "date" if "date" in df.columns else "日期"
    col_c = "close" if "close" in df.columns else "收盘"
    if col_t not in df.columns or col_c not in df.columns:
        return []
    seen = {}
    for _, r in df.iterrows():
        t = str(r[col_t])[:10]
        if t < start_iso or t > end_iso:
            continue
        c = num(r[col_c])
        if c > 0:
            seen[t] = round(c, 4)
    return [{"t": t, "c": seen[t]} for t in sorted(seen)]


def fetch_closes(item, start=START, end=END):
    """Unified 3-year forward-adjusted (qfq) daily closes for both ETFs and stocks.

    ETFs call ak.fund_etf_hist_em(..., adjust="qfq") first, falling back to Tencent
    ak.stock_zh_a_hist_tx(..., adjust="qfq") if Eastmoney push2 is rate-limited.
    Stocks call ak.stock_zh_a_daily(..., adjust="qfq") with the same Tencent fallback.
    """
    global _EM_RATE_LIMITED
    code = item["code"]
    sym = sina_sym(item)
    start_iso = f"{start[:4]}-{start[4:6]}-{start[6:8]}"
    end_iso = f"{end[:4]}-{end[4:6]}-{end[6:8]}"

    if item.get("type") == "ETF":
        if not _EM_RATE_LIMITED:
            try:
                df = ak.fund_etf_hist_em(
                    symbol=code, period="daily",
                    start_date=start, end_date=end, adjust="qfq",
                )
                out = _df_to_closes(df, start_iso, end_iso)
                if out:
                    return out
            except Exception as e:
                if "Push2RateLimit" in type(e).__name__ or "限流" in str(e):
                    _EM_RATE_LIMITED = True
                    print("  [warn] Eastmoney push2 rate-limited; switching remaining ETFs to Tencent qfq fallback.")
        try:
            df = ak.stock_zh_a_hist_tx(symbol=sym, start_date=start, end_date=end, adjust="qfq")
            return _df_to_closes(df, start_iso, end_iso)
        except Exception:
            return []

    # High-dividend A-shares: unified start~end forward-adjusted daily closes
    try:
        df = ak.stock_zh_a_daily(symbol=sym, start_date=start, end_date=end, adjust="qfq")
        out = _df_to_closes(df, start_iso, end_iso)
        if out:
            return out
    except Exception:
        pass
    try:
        df = ak.stock_zh_a_hist_tx(symbol=sym, start_date=start, end_date=end, adjust="qfq")
        return _df_to_closes(df, start_iso, end_iso)
    except Exception:
        return []


def fetch_unadjusted(symbol, start="20150101", end=END):
    """10-year UNADJUSTED daily bars (adjust="") strictly for ex-rights fill verification."""
    try:
        df = ak.stock_zh_a_daily(symbol=symbol, start_date=start, end_date=end, adjust="")
        if df is not None and not df.empty:
            return [
                {"t": str(r["date"])[:10], "o": num(r["open"]), "h": num(r["high"]),
                 "l": num(r["low"]), "c": num(r["close"])}
                for _, r in df.iterrows()
            ]
    except Exception:
        pass
    try:
        df = ak.stock_zh_a_hist_tx(symbol=symbol, start_date=start, end_date=end, adjust="")
        if df is not None and not df.empty:
            return [
                {"t": str(r["date"])[:10], "o": num(r["open"]), "h": num(r["high"]),
                 "l": num(r["low"]), "c": num(r["close"])}
                for _, r in df.iterrows()
            ]
    except Exception:
        pass
    return []


def consecutive_years(years):
    if not years:
        return 0
    ys = sorted(set(years), reverse=True)
    count = 0
    expected = ys[0]
    for y in ys:
        if y == expected:
            count += 1
            expected -= 1
        elif y < expected:
            break
    return count


def fetch_dividends(item):
    """10-year cash dividend history (keyed by exDate year) + strict unadjusted fill analysis."""
    code = item["code"]
    sym = sina_sym(item)
    base = {
        "code": code, "name": item["name"], "status": "OK",
        "consecutiveYears": 0, "ttmYieldPct": None,
        "avgFillDays": None, "fillWinRatePct": None,
        "filledCount": 0, "unfilledCount": 0, "totalEvents": 0,
        "history": [],
    }
    try:
        df = ak.stock_history_dividend_detail(symbol=code, indicator="分红")
        if df is None or df.empty:
            base["status"] = "NO_DIVIDEND"
            return base
        rows = []
        min_year = _NOW_DT.year - 10
        for _, r in df.iterrows():
            if str(r.get("进度", "")).strip() != "实施":
                continue
            cash = num(r.get("派息"))
            ex = r.get("除权除息日")
            if cash <= 0 or ex is None or str(ex) == "NaT":
                continue
            ex_date = str(ex)[:10]
            if len(ex_date) < 10 or not ex_date[:4].isdigit():
                continue
            ex_year = int(ex_date[:4])
            if ex_year < min_year or ex_date > END_ISO:
                continue
            rows.append({
                "year": ex_year,
                "exDate": ex_date,
                "cashPer10": round(cash, 3),
            })
        if not rows:
            base["status"] = "NO_DIVIDEND"
            return base
        # Chronological ascending order so history[-10:] keeps the 10 most recent events
        rows.sort(key=lambda x: x["exDate"])
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
        unfilled = [r for r in valid if not r["filled"]]
        base["consecutiveYears"] = consecutive_years([r["year"] for r in rows])
        base["filledCount"] = len(filled)
        base["unfilledCount"] = len(unfilled)
        base["totalEvents"] = len(valid)
        base["fillWinRatePct"] = round(len(filled) / len(valid) * 100, 1) if valid else None
        base["avgFillDays"] = round(sum(r["fillDays"] for r in filled) / len(filled), 1) if filled else None
        # TTM cash yield: latest 12m cash per share / latest unadjusted close
        ttm_cutoff = (_NOW_DT - timedelta(days=365)).strftime("%Y-%m-%d")
        latest_cash = sum(r["cashPer10"] for r in rows if r["exDate"] >= ttm_cutoff) / 10
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
    print(f"=== Unified qfq window: {START_ISO} ~ {END_ISO} ({BACKTEST_YEARS}y) ===")
    print(f"=== ETF holdings & qfq closes ({len(ETFS)}) ===")
    for i, raw in enumerate(ETFS, 1):
        item = dict(raw)
        item["type"] = "ETF"
        status, holdings, quarter = fetch_holdings(item["code"])
        nap()
        fee = fetch_fee(item["code"])
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
        print(f"  [{i:02d}] {item['code']} {item['name'][:8]:8s} {status:18s} h={len(holdings):2d} closes={len(closes):3d} fee={fee}")

    print(f"=== Dividend stocks & qfq closes ({len(DIVIDEND_STOCKS)}) ===")
    dividends = {}
    for i, raw in enumerate(DIVIDEND_STOCKS, 1):
        item = dict(raw)
        item["type"] = "STOCK"
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
        print(
            f"  [{i:02d}] {item['code']} {item['name'][:6]:6s} {d['status']:10s} "
            f"y={d['consecutiveYears']:2d} fill={d['filledCount']}/{d['totalEvents']} "
            f"avg={d['avgFillDays']} ttm={d['ttmYieldPct']} closes={len(closes):3d}"
        )

    out = {
        "meta": {
            "version": "3.1",
            "generatedAt": NOW,
            "defaultBenchmarkPct": 2.0,
            "priceAdjustMode": "qfq",
            "fillCheckAdjustMode": "raw",
            "backtestYears": BACKTEST_YEARS,
            "backtestStartDate": START_ISO,
            "backtestEndDate": END_ISO,
            "dataSources": {
                "etfHoldings": "AKShare fund_portfolio_hold_em (latest quarter top-10, US/HK aliases normalized)",
                "dividends": "AKShare stock_history_dividend_detail (10y by exDate) + unadjusted daily (adjust='') for fill",
                "dailyPrices": "AKShare fund_etf_hist_em / stock_zh_a_daily / stock_zh_a_hist_tx (unified 3y qfq) + Tencent live",
                "fillCriterion": "close >= pre-ex-date close (strict, unadjusted)",
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
