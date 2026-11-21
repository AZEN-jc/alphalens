"""Official domains for real company favicons.

Used by fetch_logos.py to download brand icons into alphalens/logos/.
A miss (no domain / failed fetch) falls back to a generated initial badge in the UI.
This is a static mapping, not market data.
"""

DOMAINS = {
    # A-shares (20)
    "600519": "moutai.com",
    "300750": "catl.com",
    "002027": "focusmedia.cn",
    "000858": "wuliangye.com.cn",
    "601318": "pingan.com",
    "600036": "cmbchina.com",
    "000333": "midea.com",
    "601899": "zijinmining.com",
    "002594": "byd.com",
    "600900": "cypc.com.cn",
    "688981": "smics.com",
    "002415": "hikvision.com",
    "600276": "hrs.com.cn",
    "601012": "longi.com",
    "000001": "bank.pingan.com",
    "600887": "yili.com",
    "603259": "wuxiapptec.com",
    "002475": "luxshare-ict.com",
    "600030": "citics.com",
    "601888": "chinadutyfree.com",
    # ETFs (8) — use issuer domains
    "510300": "chinaamc.com",
    "510050": "chinaamc.com",
    "510500": "chinaamc.com",
    "159915": "efunds.com.cn",
    "588000": "chinaamc.com",
    "512480": "guotaijunan.com",
    "515790": "chinaamc.com",
    "512690": "chinaamc.com",
}


def build():
    return [{"code": code, "domain": domain} for code, domain in DOMAINS.items()]


if __name__ == "__main__":
    import json
    print(json.dumps(build(), ensure_ascii=False, indent=1))
