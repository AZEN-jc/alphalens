#!/usr/bin/env python3
"""Generate an AlphaLens snapshot from AKShare and inject it into a self-contained page.

Run once while online, then open index_live.html. The original index.html is never modified.

    ./.venv/bin/python fetch_snapshot.py
    ./.venv/bin/python fetch_snapshot.py --offline
    ./.venv/bin/python fetch_snapshot.py --codes 600519,000001

Network note: terminal processes do not inherit the macOS system proxy. If HTTPS_PROXY is
unset this script defaults to 127.0.0.1:7890 (Clash Verge mixed port). Override by exporting
HTTPS_PROXY / HTTP_PROXY before running.

Every section is fetched independently. A live failure falls back to the last successful
cache entry, then to a clearly labelled zero baseline. Check meta.sections and meta.proxies
in snapshot.json before presenting the result as live market data.

DISPLAY_NAMES is a static alias map for the default demo codes, not a market data field.
"""

import argparse
import json
import math
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

try:
    import akshare as ak
except ImportError as exc:
    sys.exit("Missing dependency: %s\nInstall with: pip install akshare" % exc)

STATUS = {}
PROXIES = [
    "breadth.brokenBoard: proxy = 涨停 - 真实涨停",
    "breadth.turnoverPrev: prior turnover estimated from index volume ratio",
    "options.iv / ivPrev: 20-day realized volatility proxy, not implied volatility",
    "options.pcr: option_finance_board has no volume, proxy = put/call premium sum",
    "report.rdRate: financial abstract has no R&D ratio, set to 0"
]


def num(value, default=0.0):
    try:
        out = float(value)
        return out if math.isfinite(out) else default
    except (TypeError, ValueError):
        return default


def finite_raw(value):
    try:
        return math.isfinite(float(value))
    except (TypeError, ValueError):
        return False


# ponytail: eastmoney rejects urllib3/curl_cffi TLS fingerprints but answers curl, so shell out
def http_json(url, params):
    full = url + "?" + urlencode(params)
    ua = "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/81.0 Safari/537.36"
    for extra in ([], ["--noproxy", "*"]):
        proc = subprocess.run(["curl", "-s", "--max-time", "20", "-H", ua, *extra, full],
                              capture_output=True, text=True, timeout=25)
        if proc.returncode == 0 and proc.stdout.lstrip().startswith("{"):
            return json.loads(proc.stdout)
    raise ValueError("curl could not fetch " + url)


ZERO_FUND = {"superLarge": 0.0, "large": 0.0, "medium": 0.0, "small": 0.0}


def section(name, live_fn, baseline, offline, fallback_note=None):
    path = CACHE / (name + ".json")
    if not offline:
        started = time.time()
        try:
            data = live_fn()
            path.write_text(json.dumps(data, ensure_ascii=False, default=str), encoding="utf-8")
            STATUS[name] = "LIVE %.1fs" % (time.time() - started)
            return data
        except Exception as exc:
            STATUS[name] = "%s: %s" % (type(exc).__name__, str(exc)[:90])
    else:
        STATUS[name] = "OFFLINE"
    if path.exists():
        STATUS[name] += " -> CACHE"
        return json.loads(path.read_text(encoding="utf-8"))
    STATUS[name] += " -> FALLBACK"
    PROXIES.append(fallback_note or (name + ": zero baseline, no market data"))
    return baseline


INDEX_MAP = [
    ("sh000001", "000001", "上证指数"),
    ("sz399001", "399001", "深证成指"),
    ("sz399006", "399006", "创业板指"),
    ("sh000688", "000688", "科创50"),
    ("sh000300", "000300", "沪深300"),
]

DISPLAY_NAMES = {"600519": "贵州茅台", "300750": "宁德时代", "002027": "分众传媒"}

COMMODITIES = [
    ("AU0", "沪金主力", "黄金概念"),
    ("CU0", "沪铜主力", "有色金属"),
    ("SC0", "原油主力", "石油石化"),
    ("RB0", "螺纹钢主力", "钢铁建材"),
    ("LC0", "碳酸锂主力", "锂电新能源"),
]

OPTION_BOARDS = [
    ("华夏上证50ETF期权", "50ETF", "sh000016"),
    ("华泰柏瑞沪深300ETF期权", "300ETF", "sh000300"),
    ("南方中证500ETF期权", "500ETF", "sh000905"),
]


def fetch_market():
    spot = ak.stock_zh_index_spot_sina()
    indices = []
    for sym, code, label in INDEX_MAP:
        row = spot[spot["代码"] == sym]
        if row.empty:
            raise ValueError("index %s missing" % sym)
        item = row.iloc[0]
        indices.append({
            "code": code, "name": str(item["名称"]), "last": round(num(item["最新价"]), 2),
            "chgPct": round(num(item["涨跌幅"]), 2), "vol": round(num(item["成交额"]) / 1e8, 1)
        })
    activity = ak.stock_market_activity_legu()
    info = dict(zip(activity["item"].astype(str), activity["value"]))
    adv = int(num(info.get("上涨")))
    dec = int(num(info.get("下跌")))
    flat = int(num(info.get("平盘")))
    limit_up = int(num(info.get("涨停")))
    limit_down = int(num(info.get("跌停")))
    real_up = int(num(info.get("真实涨停"), limit_up))
    broken = max(0, limit_up - real_up)
    if limit_up and real_up < limit_up:
        PROXIES.append("breadth.brokenBoard: proxy = 涨停 - 真实涨停")
    turnover = sum(num(spot[spot["代码"] == s].iloc[0]["成交额"]) for s in ("sh000001", "sz399001")) / 1e8
    hist = ak.stock_zh_index_daily(symbol="sh000001")
    ratio = num(hist.iloc[-2]["volume"]) / max(1.0, num(hist.iloc[-1]["volume"]))
    PROXIES.append("breadth.turnoverPrev: prior turnover estimated from index volume ratio")
    return {
        "indices": indices,
        "breadth": {
            "adv": adv, "dec": dec, "flat": flat, "total": adv + dec + flat,
            "limitUp": limit_up, "limitDown": limit_down, "brokenBoard": broken,
            "turnover": round(turnover, 1), "turnoverPrev": round(turnover * ratio, 1)
        },
        "tradeDate": str(info.get("统计日期", ""))
    }


def fetch_sectors():
    try:
        df = ak.stock_fund_flow_industry(symbol="即时")
        rows = []
        for _, r in df.iterrows():
            rows.append({
                "name": str(r["行业"]), "flow": round(num(r["净额"]), 2),
                "chgPct": round(num(r["行业-涨跌幅"]), 2),
                "turnover": round(num(r["流入资金"]) + num(r["流出资金"]), 1)
            })
        return sorted(rows, key=lambda x: -abs(x["flow"]))[:16]
    except Exception as exc:
        PROXIES.append("sectors: 10jqka unavailable (%s), using sina turnover proxy" % type(exc).__name__)
    df = ak.stock_sector_spot(indicator="新浪行业")
    rows = []
    for _, r in df.iterrows():
        amount = num(r["总成交额"]) / 1e8
        chg = num(r["涨跌幅"])
        rows.append({"name": str(r["板块"]), "turnover": round(amount, 1),
                     "chgPct": round(chg, 2), "flow": round(amount * chg / 100, 2)})
    return sorted(rows, key=lambda x: -abs(x["flow"]))[:16]


def realized_vol(symbol, offset=0):
    hist = ak.stock_zh_index_daily(symbol=symbol)
    closes = [num(v) for v in hist["close"].tolist()]
    window = closes[-20 - offset: len(closes) - offset] if offset else closes[-20:]
    if len(window) < 5:
        return 20.0
    rets = [math.log(window[i] / window[i - 1]) for i in range(1, len(window)) if window[i - 1] > 0]
    if not rets:
        return 20.0
    mean = sum(rets) / len(rets)
    var = sum((r - mean) ** 2 for r in rets) / len(rets)
    return round(math.sqrt(var) * math.sqrt(252) * 100, 2)


def fetch_deriv():
    spot_map = {"IF": ("sh000300", "沪深300"), "IC": ("sh000905", "中证500"), "IM": ("sh000852", "中证1000")}
    basis = []
    for sym, (index_sym, label) in spot_map.items():
        fut = ak.futures_main_sina(symbol=sym + "0")
        spot = ak.stock_zh_index_daily(symbol=index_sym)
        fut_now, fut_prev = num(fut.iloc[-1]["收盘价"]), num(fut.iloc[-2]["收盘价"])
        spot_now, spot_prev = num(spot.iloc[-1]["close"]), num(spot.iloc[-2]["close"])
        basis.append({
            "sym": sym, "name": label, "fut": round(fut_now, 2), "spot": round(spot_now, 2),
            "prevBasis": round(fut_prev - spot_prev, 2)
        })
    commodity = []
    for sym, label, mapped in COMMODITIES:
        fut = ak.futures_main_sina(symbol=sym)
        last, prev = num(fut.iloc[-1]["收盘价"]), num(fut.iloc[-2]["收盘价"])
        commodity.append({
            "sym": sym[:-1], "name": label, "chgPct": round((last / max(prev, 1e-9) - 1) * 100, 2),
            "mapped": mapped
        })
    options = []
    month = datetime.now().strftime("%y%m")
    PROXIES.append("options.pcr: option_finance_board has no volume, proxy = put/call premium sum")
    PROXIES.append("options.iv: 20-day realized volatility proxy, not implied volatility")
    for board_name, label, index_sym in OPTION_BOARDS:
        try:
            board = ak.option_finance_board(symbol=board_name, end_month=month)
        except Exception:
            PROXIES.append("options.%s: board unavailable, neutral placeholder" % label)
            options.append({"underlying": label, "putVol": 1.0, "callVol": 1.0, "iv": 20.0, "ivPrev": 20.0})
            continue
        call = put = 0.0
        for _, r in board.iterrows():
            code = str(r["合约交易代码"])
            price = num(r["当前价"])
            if "C" in code[6:8]:
                call += price
            elif "P" in code[6:8]:
                put += price
        options.append({
            "underlying": label, "putVol": round(put, 4), "callVol": round(max(call, 0.01), 4),
            "iv": realized_vol(index_sym, 0), "ivPrev": realized_vol(index_sym, 5)
        })
    return {"basis": basis, "commodity": commodity, "options": options}


def fetch_report(code):
    fa = ak.stock_financial_abstract(symbol=code)
    periods = [c for c in fa.columns if c not in ("选项", "指标")]
    now, prev = periods[0], periods[1]

    def val(indicator, period=None, default=0.0):
        row = fa[fa["指标"] == indicator]
        if row.empty:
            return default
        return num(row.iloc[0][period or now], default)

    annual = [p for p in periods if str(p).endswith("1231")][:3]
    roe3y = [round(val("净资产收益率(ROE)", p), 2) for p in annual]
    while len(roe3y) < 3:
        roe3y.append(roe3y[-1] if roe3y else 0.0)
    year_ago = str(int(str(now)[:4]) - 1) + str(now)[4:]
    deduct_now = val("扣非净利润")
    deduct_prev = val("扣非净利润", year_ago if year_ago in periods else periods[4])
    deduct_yoy = (deduct_now / deduct_prev - 1) * 100 if deduct_prev else val("归属母公司净利润增长率")

    try:
        balance = ak.stock_balance_sheet_by_report_em(symbol=("SH" if code.startswith(("6", "5")) else "SZ") + code)
        balance = balance.sort_values("REPORT_DATE", ascending=False)
    except Exception as exc:
        balance = None
        PROXIES.append("report.%s.shortLoan/cash: balance sheet unavailable (%s), set to 0" % (code, type(exc).__name__))

    def bval(col, idx, default=0.0):
        if balance is None or col not in balance.columns or len(balance) <= idx:
            return default
        return num(balance.iloc[idx][col], default) / 1e8

    PROXIES.append("report.rdRate: financial abstract has no R&D ratio, set to 0")
    return {
        "period": str(now)[:4] + "Q" + str((int(str(now)[4:6]) - 1) // 3 + 1),
        "roe3y": roe3y,
        "grossMargin": round(val("毛利率"), 2),
        "netMargin": round(val("销售净利率"), 2),
        "revYoY": round(val("营业总收入增长率"), 2),
        "deductYoY": round(deduct_yoy, 2),
        "ocf": round(val("经营现金流量净额") / 1e8, 2),
        "netProfit": round(val("归母净利润") / 1e8, 2),
        "debtRatio": round(val("资产负债率"), 2),
        "currentRatio": round(val("流动比率"), 2),
        "goodwill": round(val("商誉") / 1e8, 2),
        "equity": round(val("股东权益合计(净资产)") / 1e8, 2),
        "inventoryTurn": round(val("存货周转率"), 2),
        "inventoryTurnPrev": round(val("存货周转率", prev), 2),
        "arDays": round(val("应收账款周转天数"), 2),
        "adminRate": round(val("期间费用率"), 2),
        "adminRatePrev": round(val("期间费用率", prev), 2),
        "rdRate": 0.0,
        "shortLoan": round(bval("SHORT_LOAN", 0), 2),
        "shortLoanPrev": round(bval("SHORT_LOAN", 4), 2),
        "cash": round(bval("MONETARYFUNDS", 0), 2)
    }


def fetch_bars(code, mkt):
    daily = ak.stock_zh_a_daily(symbol=mkt + code, adjust="qfq").tail(48).copy()
    daily["t"] = daily["date"].astype(str).str[:10]
    bars = []
    for _, r in daily.iterrows():
        o, h, l, c = num(r["open"]), num(r["high"]), num(r["low"]), num(r["close"])
        bars.append({
            "t": r["t"], "o": round(o, 2), "h": round(max(h, o, c), 2),
            "l": round(max(0.01, min(l, o, c)), 2), "c": round(c, 2),
            "vol": max(1.0, num(r["volume"], 1)), "amount": max(1.0, num(r["amount"], 1))
        })
    if len(bars) < 12:
        raise ValueError("only %d bars" % len(bars))
    return {"bars": bars, "floatShares": num(daily.iloc[-1]["outstanding_share"], 1e8)}


def fund_proxy(bars):
    out = []
    for b in bars:
        chg = (b["c"] - b["o"]) / max(b["o"], 1e-9)
        main = chg * b["amount"] / 1e4 * 0.35
        f = {"superLarge": main * .63, "large": main * .37,
             "medium": -main * .34, "small": -main * .66}
        f["small"] -= sum(f.values())
        out.append(dict(t=b["t"], **{k: round(v, 4) for k, v in f.items()}))
    return out


def fetch_fund(code, mkt, bars):
    payload = http_json("https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get", {
        "lmt": "0", "klt": "101", "secid": ("1" if mkt == "sh" else "0") + "." + code,
        "fields1": "f1,f2,f3,f7",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65",
        "ut": "b2884a393a59ad64002292a3e90d46a5", "_": int(time.time() * 1000)
    })
    klines = (payload.get("data") or {}).get("klines") or []
    if not klines:
        raise ValueError("empty fund flow klines")
    by_date = {}
    for line in klines:
        p = line.split(",")
        by_date[p[0]] = {
            "superLarge": num(p[5]) / 1e4, "large": num(p[4]) / 1e4,
            "medium": num(p[3]) / 1e4, "small": num(p[2]) / 1e4
        }
    out = []
    for b in bars:
        f = dict(by_date.get(b["t"], ZERO_FUND))
        # ponytail: force exact zero-sum; raw feed has a few yuan of rounding drift
        f["small"] -= sum(f.values())
        out.append(dict(t=b["t"], **{k: round(v, 4) for k, v in f.items()}))
    return out


def baseline_bars():
    bars = [{"t": "D%02d" % i, "o": 10 + i * .01, "h": 10.1 + i * .01,
             "l": 9.9 + i * .01, "c": 10 + i * .01, "vol": 100000.0 + i * 100,
             "amount": 1e8} for i in range(48)]
    return {"bars": bars, "floatShares": 1e8}


BASELINE_REPORT = {"period": "BASELINE", "roe3y": [0, 0, 0], "grossMargin": 0, "netMargin": 0,
                   "revYoY": 0, "deductYoY": 0, "ocf": 1, "netProfit": 1, "debtRatio": 50,
                   "currentRatio": 1, "goodwill": 0, "equity": 10, "inventoryTurn": 1,
                   "inventoryTurnPrev": 1, "arDays": 60, "adminRate": 5, "adminRatePrev": 5,
                   "rdRate": 0, "shortLoan": 0, "shortLoanPrev": 0, "cash": 1}


BASELINE_MARKET = {
    "indices": [{"code": c, "name": n, "last": 0.0, "chgPct": 0.0, "vol": 0.0} for _, c, n in INDEX_MAP],
    "breadth": {"adv": 1, "dec": 1, "flat": 1, "total": 3, "limitUp": 1, "limitDown": 1,
                "brokenBoard": 0, "turnover": 10000.0, "turnoverPrev": 10000.0},
    "tradeDate": ""
}
BASELINE_SECTORS = [{"name": "行业%02d" % i, "turnover": 100.0, "flow": 0.0, "chgPct": 0.0} for i in range(12)]
BASELINE_DERIV = {
    "basis": [{"sym": s, "name": n, "fut": 1000.0, "spot": 1000.0, "prevBasis": 0.0}
              for s, n in (("IF", "沪深300"), ("IC", "中证500"), ("IM", "中证1000"))],
    "commodity": [{"sym": s[:-1], "name": n, "chgPct": 0.0, "mapped": m} for s, n, m in COMMODITIES],
    "options": [{"underlying": n, "putVol": 1.0, "callVol": 1.0, "iv": 20.0, "ivPrev": 20.0}
                for _, n, _ in OPTION_BOARDS]
}


def validate(snap):
    stocks = snap["stocks"]
    if not stocks:
        raise ValueError("no stocks")
    for code, st in stocks.items():
        if len(st["bars"]) != len(st["fund"]) or len(st["bars"]) < 12:
            raise ValueError("%s: bars/fund mismatch" % code)
        for i, (b, f) in enumerate(zip(st["bars"], st["fund"])):
            for key in ("o", "h", "l", "c", "vol"):
                if not finite_raw(b[key]):
                    raise ValueError("%s: non-finite bar at %d" % (code, i))
            for key in ("superLarge", "large", "medium", "small"):
                if not finite_raw(f[key]):
                    raise ValueError("%s: non-finite fund at %d" % (code, i))
            if not (b["h"] >= max(b["o"], b["c"]) and 0 < b["l"] <= min(b["o"], b["c"]) and b["vol"] > 0):
                raise ValueError("%s: bad bar %d" % (code, i))
            if b["t"] != f["t"]:
                raise ValueError("%s: timestamp drift %d" % (code, i))
            if abs(sum(f[k] for k in ("superLarge", "large", "medium", "small"))) > 1e-3:
                raise ValueError("%s: fund not zero-sum at %d" % (code, i))
        if not (finite_raw(st["floatShares"]) and finite_raw(st["report"]["netProfit"])):
            raise ValueError("%s: non-finite denominator" % code)
        if not (st["floatShares"] > 0 and st["report"]["netProfit"] != 0):
            raise ValueError("%s: bad denominator" % code)
    bd = snap["market"]["breadth"]
    if bd["adv"] + bd["dec"] + bd["flat"] != bd["total"]:
        raise ValueError("breadth does not sum")
    for o in snap["deriv"]["options"]:
        if not (o["callVol"] > 0 and o["putVol"] >= 0 and o["iv"] > 0):
            raise ValueError("bad option board")
    for b in snap["deriv"]["basis"]:
        if not (b["spot"] > 0 and b["fut"] > 0):
            raise ValueError("bad basis")


def write_outputs(snap):
    (BASE / "snapshot.json").write_text(json.dumps(snap, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    payload = json.dumps(snap, ensure_ascii=False, separators=(",", ":"), default=str).replace("</", "<\\/")
    proxy_funds = [p.split(":")[0].replace("fund.", "") for p in snap["meta"]["proxies"] if "four-tier proxy" in p]
    fund_note = ("、".join(proxy_funds) + " 四档资金为量价估算" if proxy_funds else "四档资金均为真实分档")
    disclosure = (
        "真实数据 " + str(snap["meta"]["tradeDate"])[:10] + " 收盘 | " + fund_note +
        " | 期权权利金比栏为代理值，波动率栏为 20 日已实现波动率，均非真实成交量认沽认购比与隐含波动率" +
        " | 炸板数、昨日成交额、研发费用率为估算或占位 | 完整字段清单见 snapshot.json 的 meta.proxies"
    )
    note = json.dumps(disclosure, ensure_ascii=False)
    inject = (
        "<script>\n(function(){\n"
        "var s=" + payload + ", note=" + note + ";\n"
        "if(window.AlphaLensCore && s.labels) window.AlphaLensCore.LABELS=s.labels;\n"
        "var n=window.AlphaLens.load(s);\n"
        "var Q=new URLSearchParams(location.search), st=window.AlphaLens.state;\n"
        "if(s.primary) st.code=s.primary;\n"
        "if(Q.get('code') && s.stocks[Q.get('code')]) st.code=Q.get('code');\n"
        "if(Q.get('frame')){st.frame=Math.max(0,Math.min(47,parseInt(Q.get('frame'),10)||0));st.mode='REPLAY';}\n"
        "var css=document.createElement('style');\n"
        "css.textContent='#al-provenance{border-left:3px solid #FF2A2A;background:#1A1010;color:#EAEAEA;"
        "font:10px/1.6 monospace;letter-spacing:.03em;padding:7px 10px;margin-bottom:1px}';\n"
        "document.head.appendChild(css);\n"
        "function textFix(root){\n"
        "  if(!root) return;\n"
        "  function walk(x){\n"
        "    if(x.nodeType===3){\n"
        "      x.nodeValue=x.nodeValue"
        ".replace(/SIM DATA/g,'AKSHARE CLOSE SNAPSHOT')"
        ".replace(/仿真快照 · 接 AKShare 后切换实盘/g,'真实收盘快照 · 非实时行情')"
        ".replace(/NO LIVE MARKET FEED/g,'NO REALTIME FEED')"
        ".replace(/本报告基于仿真快照/g,'本报告基于真实收盘快照')"
        ".replace(/ETF 期权 PCR \\/ 恐慌贪婪/g,'ETF 期权代理指标 / 情绪参考')"
        ".replace(/PUT-CALL RATIO/g,'PREMIUM RATIO PROXY')"
        ".replace(/ETF 期权 PCR 与隐波用于识别极度恐慌或贪婪/g,'期权代理指标仅用于演示规则引擎，不作投资依据')"
        ".replace(/隐波/g,'已实现波动率')"
        ".replace(/PCR/g,'权利金比*')"
        ".replace(/万手/g,'万股');\n"
        "    }else if(x.nodeType===1 && x.tagName!=='SCRIPT' && x.tagName!=='STYLE'){\n"
        "      for(var c=x.firstChild;c;c=c.nextSibling) walk(c);\n"
        "    }\n"
        "  }\n"
        "  walk(root);\n"
        "}\n"
        "function fixStage(){\n"
        "  var stage=document.getElementById('stage');\n"
        "  textFix(stage);\n"
        "  if(!document.getElementById('al-provenance')){\n"
        "    var bar=document.createElement('div'); bar.id='al-provenance';\n"
        "    bar.textContent='[ DATA PROVENANCE / 数据口径 ] '+note;\n"
        "    stage.insertBefore(bar,stage.firstChild);\n"
        "  }\n"
        "}\n"
        "['mast','navfoot','print-sheet'].forEach(function(id){textFix(document.getElementById(id));});\n"
        "fixStage();\n"
        "new MutationObserver(fixStage).observe(document.getElementById('stage'),{childList:true});\n"
        "window.AlphaLens.render();\n"
        "console.log('[AlphaLens] '+s.meta.session+' | instruments='+n+' | trade='+s.meta.tradeDate);\n"
        "if(s.meta.proxies.length) console.warn('[AlphaLens] proxy fields:',s.meta.proxies.join(' / '));\n"
        "})();\n</script>\n"
    )
    html = (BASE / "index.html").read_text(encoding="utf-8")
    if "</body>" not in html:
        raise ValueError("index.html has no </body> anchor")
    (BASE / "index_live.html").write_text(html.replace("</body>", inject + "</body>"), encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Build an AlphaLens snapshot from AKShare")
    ap.add_argument("--codes", default="600519,300750,002027", help="comma separated A-share codes")
    ap.add_argument("--offline", action="store_true", help="rebuild from cache only, no network")
    args = ap.parse_args()
    if not CACHE.is_dir():
        CACHE.mkdir(parents=True)
    if args.offline:
        prior = BASE / "snapshot.json"
        if prior.exists():
            legacy = json.loads(prior.read_text(encoding="utf-8")).get("meta", {}).get("proxies", [])
            PROXIES.extend([p for p in legacy if not p.startswith("options.iv:")])
    codes = [c.strip() for c in args.codes.split(",") if c.strip()]

    market = section("market", fetch_market, BASELINE_MARKET, args.offline)
    sectors = section("sectors", fetch_sectors, BASELINE_SECTORS, args.offline)
    deriv = section("deriv", fetch_deriv, BASELINE_DERIV, args.offline)
    stocks = {}
    # ponytail: one rate-limit response means stop hitting push2 for the remaining codes
    fund_limited = False
    for code in codes:
        mkt = "sh" if code.startswith(("6", "5", "9")) else "sz"
        bd = section("bars_" + code, lambda c=code, m=mkt: fetch_bars(c, m),
                     baseline_bars(), args.offline)
        report = section("report_" + code, lambda c=code: fetch_report(c),
                         BASELINE_REPORT, args.offline)
        proxy = fund_proxy(bd["bars"])
        fund_key = "fund_" + code
        funds = section(fund_key,
                        lambda c=code, m=mkt, b=bd: fetch_fund(c, m, b["bars"]),
                        proxy, args.offline or fund_limited,
                        fallback_note="fund.%s: four-tier proxy from signed turnover, not real order-size buckets" % code)
        if "RateLimit" in STATUS.get(fund_key, ""):
            fund_limited = True
        stocks[code] = {
            "code": code, "name": DISPLAY_NAMES.get(code, code), "shape": "live",
            "floatShares": bd["floatShares"], "bars": bd["bars"],
            "fund": funds, "report": report
        }
    first = next(iter(stocks.values()))
    try:
        from universe import build as build_universe
        universe = build_universe()
    except ImportError:
        universe = []
    snap = {
        "stocks": stocks, "market": market, "sectors": sectors, "deriv": deriv,
        "universe": universe, "primary": codes[0],
        "labels": [b["t"] for b in first["bars"]],
        "meta": {
            "generated": datetime.now().isoformat(timespec="seconds"),
            "session": "OFFLINE_CACHE" if args.offline else "AKSHARE_LIVE",
            "akshare": ak.__version__,
            "tradeDate": str(market.get("tradeDate") or first["bars"][-1]["t"]),
            "sections": dict(STATUS),
            "proxies": sorted(set(PROXIES))
        }
    }
    validate(snap)
    write_outputs(snap)

    print("\n%-22s %s" % ("SECTION", "STATUS"))
    print("-" * 78)
    for key, value in STATUS.items():
        print("%-22s %s" % (key, value))
    print("-" * 78)
    print("trade date   :", snap["meta"]["tradeDate"])
    print("instruments  :", ", ".join(stocks))
    print("frames       :", len(first["bars"]))
    print("labels       :", snap["labels"][0], "->", snap["labels"][-1])
    if snap["meta"]["proxies"]:
        print("\nPROXY / NON-LIVE FIELDS (read before presenting as market data):")
        for item in snap["meta"]["proxies"]:
            print("  -", item)
    print("\nwrote snapshot.json and index_live.html in", BASE)


if __name__ == "__main__":
    main()
