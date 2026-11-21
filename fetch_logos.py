#!/usr/bin/env python3
"""Download real company favicons into alphalens/logos/ for offline use.

Source: https://favicon.im/{domain} — reachable through the local Clash proxy
(127.0.0.1:7890). Direct connections failed in testing, so the proxy is the
default; override with --no-proxy if your network differs.

Each icon is retried up to 3 times. Failures are recorded in logo_failed.json
and the UI falls back to a generated initial badge. The page never depends on
an external image host at runtime — all icons are local files.

    ./.venv/bin/python fetch_logos.py
    ./.venv/bin/python fetch_logos.py --no-proxy
"""

import argparse
import json
import os
import subprocess
import time
from pathlib import Path

BASE = Path(__file__).resolve().parent
LOGO_DIR = BASE / "logos"
PROXY = "http://127.0.0.1:7890"
RETRIES = 3


def fetch_one(domain, dest, use_proxy):
    url = "https://favicon.im/" + domain
    env = dict(os.environ)
    if use_proxy:
        env["HTTPS_PROXY"] = PROXY
        env["HTTP_PROXY"] = PROXY
    else:
        env.pop("HTTPS_PROXY", None)
        env.pop("HTTP_PROXY", None)
    cmd = ["curl", "-sSL", "--max-time", "15",
           "-H", "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
           "-o", str(dest), "-w", "%{http_code} %{size_download} %{content_type}", url]
    for attempt in range(1, RETRIES + 1):
        proc = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=20)
        parts = proc.stdout.strip().split()
        if len(parts) >= 3 and parts[0] == "200" and int(parts[1]) > 100:
            return "OK %s (%sB)" % (parts[2], parts[1])
        time.sleep(0.6 * attempt)
    return "FAIL " + (proc.stdout.strip()[:40] or proc.stderr.strip()[:40] or "no response")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-proxy", action="store_true")
    args = ap.parse_args()
    if not LOGO_DIR.is_dir():
        LOGO_DIR.mkdir(parents=True)

    from logo_domains import DOMAINS
    ok, failed = [], []
    for code, domain in DOMAINS.items():
        dest = LOGO_DIR / (code + ".png")
        result = fetch_one(domain, dest, not args.no_proxy)
        if result.startswith("OK"):
            ok.append(code)
            print("%-8s %-24s %s" % (code, domain, result))
        else:
            if dest.exists():
                dest.unlink()
            failed.append({"code": code, "domain": domain, "reason": result})
            print("%-8s %-24s %s" % (code, domain, result))

    (BASE / "logo_failed.json").write_text(
        json.dumps(failed, ensure_ascii=False, indent=1), encoding="utf-8")
    print("-" * 60)
    print("downloaded %d/%d real logos into %s" % (len(ok), len(DOMAINS), LOGO_DIR))


if __name__ == "__main__":
    main()
