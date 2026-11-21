#!/usr/bin/env python3
"""Build AlphaLens v3 single-file HTML from template + analysis_data.json.

Anchor: /*__ALPHALENS_DATA__*/ appears exactly once in index_alphalens_v3.html.
Fails hard on missing/duplicate anchor. Runs node --check on inline JS after build.
No CDN, no backend — output opens via file:// double-click.
"""
import json
import re
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "index_alphalens_v3.html"
OUT = BASE / "index_alphalens_v3_live.html"
DATA = BASE / "analysis_data.json"
ANCHOR = "/*__ALPHALENS_DATA__*/"


def main():
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    html = SRC.read_text(encoding="utf-8")
    count = html.count(ANCHOR)
    if count != 1:
        raise SystemExit("FATAL: anchor appears %d times, expected 1" % count)
    html = html.replace(ANCHOR, blob, 1)
    OUT.write_text(html, encoding="utf-8")

    # syntax check extracted inline script (the last <script> block)
    scripts = re.findall(r"<script>([\s\S]*?)</script>", html)
    if not scripts:
        raise SystemExit("FATAL: no inline script")
    chk = BASE / "__v3_syntax_check.js"
    chk.write_text(scripts[-1], encoding="utf-8")
    try:
        r = subprocess.run(["node", "--check", str(chk)], capture_output=True, text=True)
        if r.returncode != 0:
            raise SystemExit("FATAL inline JS syntax:\n" + r.stderr[:1000])
    finally:
        chk.unlink(missing_ok=True)
    # 主入口：同步复制为根目录 index.html，静态托管/双击即进 v3
    ROOT_INDEX = BASE / "index.html"
    ROOT_INDEX.write_text(html, encoding="utf-8")
    print("wrote %s (%d bytes)" % (OUT.name, OUT.stat().st_size))
    print("wrote index.html (main entry, %d bytes)" % ROOT_INDEX.stat().st_size)
    print("  assets=%d dividends=%d presets=%d payload=%dB" %
          (len(payload.get("assets", {})), len(payload.get("dividends", {})),
           len(payload.get("presets", [])), len(blob)))


if __name__ == "__main__":
    main()
