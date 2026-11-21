"""AlphaLens instrument directory for search.

Static catalog only: code, name, pinyin initials, category. No market data.
A hit here means "searchable", not "cached". The UI checks snapshot.cache_keys
before letting a user switch; uncached hits show an explicit network-required hint.
"""

STOCKS = [
    ("600519", "贵州茅台", "gzmt", "A股"),
    ("300750", "宁德时代", "ndsd", "A股"),
    ("002027", "分众传媒", "fzcm", "A股"),
    ("000858", "五粮液", "wly", "A股"),
    ("601318", "中国平安", "zgpa", "A股"),
    ("600036", "招商银行", "zsyh", "A股"),
    ("000333", "美的集团", "mdjt", "A股"),
    ("601899", "紫金矿业", "zjky", "A股"),
    ("002594", "比亚迪", "byd", "A股"),
    ("600900", "长江电力", "cjdl", "A股"),
    ("688981", "中芯国际", "zxgj", "A股"),
    ("002415", "海康威视", "hkws", "A股"),
    ("600276", "恒瑞医药", "hryy", "A股"),
    ("601012", "隆基绿能", "ljln", "A股"),
    ("000001", "平安银行", "payh", "A股"),
    ("600887", "伊利股份", "ylgf", "A股"),
    ("603259", "药明康德", "ymkd", "A股"),
    ("002475", "立讯精密", "lxjm", "A股"),
    ("600030", "中信证券", "zxzq", "A股"),
    ("601888", "中国中免", "zgzm", "A股"),
]

INDICES = [
    ("000001", "上证指数", "szzs", "指数"),
    ("399001", "深证成指", "szcz", "指数"),
    ("399006", "创业板指", "cybz", "指数"),
    ("000688", "科创50", "kc50", "指数"),
    ("000300", "沪深300", "hs300", "指数"),
    ("000905", "中证500", "zz500", "指数"),
    ("000852", "中证1000", "zz1000", "指数"),
    ("000016", "上证50", "sz50", "指数"),
]

ETFS = [
    ("510300", "沪深300ETF", "hs300etf", "ETF"),
    ("510050", "上证50ETF", "sz50etf", "ETF"),
    ("510500", "中证500ETF", "zz500etf", "ETF"),
    ("159915", "创业板ETF", "cybetf", "ETF"),
    ("588000", "科创50ETF", "kc50etf", "ETF"),
    ("512480", "半导体ETF", "bdtetf", "ETF"),
    ("515790", "光伏ETF", "gfetf", "ETF"),
    ("512690", "酒ETF", "jiuetf", "ETF"),
]

FUTURES = [
    ("IF", "沪深300期指", "hs300qz", "期货"),
    ("IC", "中证500期指", "zz500qz", "期货"),
    ("IM", "中证1000期指", "zz1000qz", "期货"),
    ("IH", "上证50期指", "sz50qz", "期货"),
    ("AU0", "沪金主力", "hjzl", "期货"),
    ("CU0", "沪铜主力", "htzl", "期货"),
    ("SC0", "原油主力", "yyzl", "期货"),
    ("RB0", "螺纹钢主力", "lwgzl", "期货"),
    ("LC0", "碳酸锂主力", "tslzl", "期货"),
]


def build():
    rows = []
    for group in (STOCKS, INDICES, ETFS, FUTURES):
        for code, name, py, kind in group:
            rows.append({"code": code, "name": name, "py": py, "kind": kind})
    return rows


if __name__ == "__main__":
    import json
    print(json.dumps(build(), ensure_ascii=False, indent=1))
