#!/usr/bin/env python3
"""Build AlphaLens v3.1 true single-file HTML from template + analytics.js + live.js + analysis_data.json.

Inlines:
  * <script src="analytics.js"></script> -> inline <script data-inline="analytics.js">
  * <script src="live.js"></script>      -> inline <script data-inline="live.js">
  * /*__ALPHALENS_DATA__*/               -> JSON payload

Fails hard on missing/duplicate tags or anchors, verifies zero external <script src=...>
remain, and runs `node --check` on every inline <script> block.
Output opens via file:// double-click even when copied alone to an isolated temp directory.
"""
import json
import re
import subprocess
from pathlib import Path

BASE = Path(__file__).resolve().parent
SRC = BASE / "index_alphalens_v3.html"
OUT = BASE / "index_alphalens_v3_live.html"
ROOT_INDEX = BASE / "index.html"
DATA = BASE / "analysis_data.json"
ANCHOR = "/*__ALPHALENS_DATA__*/"
INLINE_SCRIPTS = [
    ('<script src="analytics.js"></script>', "analytics.js"),
    ('<script src="live.js"></script>', "live.js"),
]


def safe_inline_js(code: str) -> str:
    return code.replace("</script>", "<\\/script>").replace("</SCRIPT>", "<\\/SCRIPT>")


def main():
    payload = json.loads(DATA.read_text(encoding="utf-8"))
    blob = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = SRC.read_text(encoding="utf-8")

    # 1. Inline analytics.js and live.js for true single-file delivery
    for tag, filename in INLINE_SCRIPTS:
        count = html.count(tag)
        if count != 1:
            raise SystemExit(f"FATAL: {tag!r} appears {count} times in {SRC.name}, expected 1")
        js_path = BASE / filename
        if not js_path.exists():
            raise SystemExit(f"FATAL: missing {js_path}")
        js_code = safe_inline_js(js_path.read_text(encoding="utf-8"))
        replacement = f'<script data-inline="{filename}">\n{js_code}\n</script>'
        html = html.replace(tag, replacement, 1)

    # 2. Inject embedded dataset JSON at the unique anchor
    count = html.count(ANCHOR)
    if count != 1:
        raise SystemExit(f"FATAL: anchor {ANCHOR!r} appears {count} times, expected 1")
    html = html.replace(ANCHOR, blob, 1)

    # 3. Hard check: zero external <script src=...> allowed in built single-file output
    ext_scripts = re.findall(r"<script\b[^>]*\bsrc\s*=", html, flags=re.IGNORECASE)
    if ext_scripts:
        raise SystemExit(f"FATAL: external script tags remain after inline build: {ext_scripts}")

    # 4. Syntax-check every inline <script> block with `node --check`
    scripts = re.findall(r"<script\b[^>]*>([\s\S]*?)</script>", html)
    if len(scripts) < 3:
        raise SystemExit(f"FATAL: expected >=3 inline scripts, found {len(scripts)}")
    chk = BASE / "__v3_syntax_check.js"
    try:
        for idx, code in enumerate(scripts, 1):
            chk.write_text(code, encoding="utf-8")
            r = subprocess.run(["node", "--check", str(chk)], capture_output=True, text=True)
            if r.returncode != 0:
                raise SystemExit(f"FATAL inline JS syntax (block #{idx}):\n{r.stderr[:1000]}")
    finally:
        chk.unlink(missing_ok=True)

    # 5. Emit identical single-file outputs
    OUT.write_text(html, encoding="utf-8")
    ROOT_INDEX.write_text(html, encoding="utf-8")
    print(f"wrote {OUT.name} ({OUT.stat().st_size} bytes)")
    print(f"wrote {ROOT_INDEX.name} (main entry, {ROOT_INDEX.stat().st_size} bytes)")
    print(
        f"  assets={len(payload.get('assets', {}))} "
        f"dividends={len(payload.get('dividends', {}))} "
        f"presets={len(payload.get('presets', []))} "
        f"payload={len(blob)}B inlineScripts={len(scripts)}"
    )


if __name__ == "__main__":
    main()
