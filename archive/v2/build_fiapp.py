#!/usr/bin/env python3
"""Rebuild index_fiapp_live.html from index_fiapp.html + snapshot.json + futu_enrichment.json.

Anchor-based injection: index_fiapp.html must contain exactly one
/*__ALPHALENS_SNAPSHOT_PAYLOAD__*/ and one /*__ALPHALENS_FUTU_PAYLOAD__*/.
Any other count is a hard error (non-zero exit). Never uses fragile replace
of rendered functions. Frozen files (core.js/verify.js/index.html) untouched.

Build order: fetch_snapshot -> fetch_timeline -> fetch_decade -> [futu MCP] -> build_fiapp.
"""
import json
import subprocess
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "index_fiapp.html"
OUT = BASE / "index_fiapp_live.html"
ANCHOR_SNAP = "/*__ALPHALENS_SNAPSHOT_PAYLOAD__*/"
ANCHOR_FUTU = "/*__ALPHALENS_FUTU_PAYLOAD__*/"
ANCHOR_DEPTH = "/*__ALPHALENS_DEPTH_PAYLOAD__*/"

DISCLOSURE = [
    "snapshot.json 的 meta.proxies 声明仍为代理的字段：量价代理资金、期权权利金比、",
    "20 日已实现波动率、炸板数与昨日成交额估算、研发费用率占位。",
    "36 个 A股/指数/ETF 标的的现价与估值已用富途 MCP 快照校准（FUTU_CALIBRATED）；",
    "9 个期货标的富途无行情权限，标注 NO_FUTU_FEED，不编造价格。",
    "十年月线为 AKShare 真实日线聚合；完整清单见 snapshot.json 与 futu_enrichment.json。",
]


def load_json(path, required=True):
    if not path.exists():
        if required:
            raise FileNotFoundError(path)
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def main():
    snap = load_json(BASE / "snapshot.json")
    futu = load_json(BASE / "futu_enrichment.json", required=False)
    depth = load_json(BASE / "depth.json", required=False)
    # K线图 40 根足够看出走势；精简到 o/h/l/c/vol/t 五个字段，去掉 amount/turn 冗余
    if depth and "series" in depth:
        cut = 0
        for rec in depth["series"].values():
            bars = rec.get("bars") or []
            cut += max(0, len(bars) - 40)
            rec["bars"] = [{k: b[k] for k in ("t", "o", "h", "l", "c", "vol") if k in b}
                           for b in bars[-40:]]
        if cut:
            print("  depth trimmed %d extra bars + slim fields" % cut)

    # fiapp 门户不使用 timelines（barsFor 只读 stocks[code].bars）：剔除省 ~200KB。
    trimmed = dict(snap)
    trimmed.pop("timelines", None)

    snap_payload = json.dumps(trimmed, ensure_ascii=False, separators=(",", ":"))
    futu_payload = json.dumps(futu, ensure_ascii=False, separators=(",", ":"))
    depth_payload = json.dumps(depth, ensure_ascii=False, separators=(",", ":"))
    disclosure_payload = json.dumps("".join(DISCLOSURE), ensure_ascii=False)

    html = SRC.read_text(encoding="utf-8")
    for name, anchor in (("snapshot", ANCHOR_SNAP), ("futu", ANCHOR_FUTU), ("depth", ANCHOR_DEPTH)):
        count = html.count(anchor)
        if count != 1:
            raise SystemExit("FATAL: anchor %s (%s) appears %d times, expected exactly 1" % (anchor, name, count))
    html = html.replace(ANCHOR_SNAP, snap_payload, 1)
    html = html.replace(ANCHOR_FUTU, futu_payload, 1)
    html = html.replace(ANCHOR_DEPTH, depth_payload, 1)
    html = html.replace("/*__ALPHALENS_DISCLOSURE__*/", disclosure_payload, 1)
    OUT.write_text(html, encoding="utf-8")

    # 构建后强制语法校验（内联 JS 用 node --check 无法直接查，抽出主 script 段）
    import re
    scripts = re.findall(r"<script>(.*?)</script>", html, flags=re.S)
    if not scripts:
        raise SystemExit("FATAL: no inline script found after build")
    check = BASE / "__build_syntax_check.js"
    check.write_text(scripts[0], encoding="utf-8")
    try:
        r = subprocess.run(["node", "--check", str(check)], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit("FATAL: inline JS syntax error:\n" + r.stderr)
    finally:
        check.unlink(missing_ok=True)

    print("wrote %s (%d bytes)" % (OUT.name, OUT.stat().st_size))
    print("  snapshot %d B | futu %d B | depth %d B (%d series)" %
          (len(snap_payload), len(futu_payload), len(depth_payload), depth.get("count", 0)))


if __name__ == "__main__":
    main()
