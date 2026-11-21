#!/usr/bin/env python3
"""Rebuild index_okx_live.html from index_okx.html + the current snapshot.json.

The OKX UI is a parallel deliverable: index.html is frozen and index_live.html
is the original defense build. This script never touches either of them.
Run it after fetch_snapshot.py or fetch_timeline.py rewrites snapshot.json.

    ./.venv/bin/python build_okx.py
"""

import json
import re
from pathlib import Path

BASE = Path(__file__).resolve().parent
DISCLOSE = ("snapshot.json 的 meta.proxies 列出全部代理字段："
            "量价代理资金、期权权利金比、20 日已实现波动率、炸板数与昨日成交额估算、研发费用率占位。"
            "分钟线为新浪真实分时，1m 档以 5 分钟数据展示；周线由真实日线聚合。完整清单见 snapshot.json。")


def main():
    snap = json.loads((BASE / "snapshot.json").read_text(encoding="utf-8"))
    payload = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
    disclose = json.dumps(DISCLOSE, ensure_ascii=False)
    inject = (
        "<script>\n(function(){\n"
        "var s=" + payload + ", note=" + disclose + ";\n"
        "if(window.AlphaLensCore && s.labels) window.AlphaLensCore.LABELS=s.labels;\n"
        "var n=window.AlphaLens.load(s);\n"
        "var Q=new URLSearchParams(location.search), st=window.AlphaLens.state;\n"
        "if(s.primary) st.code=s.primary;\n"
        "if(Q.get('code') && s.stocks[Q.get('code')]) st.code=Q.get('code');\n"
        "if(Q.get('frame')){st.frame=Math.max(0,Math.min(47,parseInt(Q.get('frame'),10)||0));st.mode='REPLAY';}\n"
        "if(Q.get('period')&&s.timelines&&s.timelines[st.code]&&s.timelines[st.code][Q.get('period')]){"
        "st.period=Q.get('period');st.frame=s.timelines[st.code][st.period].bars.length-1;st.mode='REPLAY';}\n"
        "var css=document.createElement('style');\n"
        "css.textContent='#al-provenance{border-left:3px solid var(--up);background:rgba(246,70,93,.06);"
        "color:var(--dim);font:10px/1.5 monospace;padding:6px 12px;margin-bottom:10px}';\n"
        "document.head.appendChild(css);\n"
        "function textFix(root){\n"
        "  if(!root) return;\n"
        "  function walk(x){\n"
        "    if(x.nodeType===3){\n"
        "      x.nodeValue=x.nodeValue"
        ".replace(/SIM DATA/g,'AKSHARE CLOSE SNAPSHOT')"
        ".replace(/NO LIVE MARKET FEED/g,'NO REALTIME FEED')"
        ".replace(/本报告基于仿真快照/g,'本报告基于真实收盘快照')"
        ".replace(/PUT-CALL RATIO/g,'PREMIUM RATIO PROXY')"
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
        "console.log('[AlphaLens OKX] '+s.meta.session+' | instruments='+n+' | trade='+s.meta.tradeDate);\n"
        "if(s.meta.proxies.length) console.warn('[AlphaLens OKX] proxy fields:',s.meta.proxies.join(' / '));\n"
        "})();\n</script>\n"
    )
    html = (BASE / "index_okx.html").read_text(encoding="utf-8")
    if "</body>" not in html:
        raise ValueError("index_okx.html has no </body> anchor")
    (BASE / "index_okx_live.html").write_text(html.replace("</body>", inject + "</body>"), encoding="utf-8")
    print("wrote index_okx_live.html (%d bytes, %d universe, %d timelines)" %
          ((BASE / "index_okx_live.html").stat().st_size,
           len(snap.get("universe", [])), len(snap.get("timelines", {}))))


if __name__ == "__main__":
    main()
