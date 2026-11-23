"""AlphaLens v3.1 — curated 36-instrument universe (21 ETF + 15 high-dividend A-shares).

Design goals:
  * Module A (portfolio penetration): A-share & cross-market QDII/tech ETFs with real top-10 holdings.
  * Module B (dividend truth): A-shares with real cash dividend history.
  * 5 preset portfolios for one-click cross-market demonstration.

No market data here — this is a static catalog only.
"""
NEW_TECH_QDII_ETFS = [
    {"code": "513100", "name": "纳指ETF",       "category": "美股QDII", "market": "sh"},
    {"code": "513500", "name": "标普500ETF",    "category": "美股QDII", "market": "sh"},
    {"code": "159509", "name": "纳指科技ETF",   "category": "美股QDII", "market": "sz"},
    {"code": "513180", "name": "恒生科技ETF",   "category": "港股QDII", "market": "sh"},
    {"code": "515000", "name": "科技ETF",       "category": "A股科技",  "market": "sh"},
    {"code": "515070", "name": "人工智能AIETF", "category": "A股科技",  "market": "sh"},
]

ETFS = [
    {"code": "510300", "name": "沪深300ETF", "category": "宽基", "market": "sh"},
    {"code": "510500", "name": "中证500ETF", "category": "宽基", "market": "sh"},
    {"code": "510050", "name": "上证50ETF",  "category": "宽基", "market": "sh"},
    {"code": "159915", "name": "创业板ETF",  "category": "成长", "market": "sz"},
    {"code": "588000", "name": "科创50ETF",  "category": "成长", "market": "sh"},
    {"code": "510880", "name": "红利ETF",    "category": "红利", "market": "sh"},
    {"code": "512890", "name": "红利低波ETF","category": "红利", "market": "sh"},
    {"code": "515180", "name": "中证红利ETF","category": "红利", "market": "sh"},
    {"code": "512800", "name": "银行ETF",    "category": "行业", "market": "sh"},
    {"code": "159928", "name": "消费ETF",    "category": "行业", "market": "sz"},
    {"code": "512010", "name": "医药ETF",    "category": "行业", "market": "sh"},
    {"code": "512480", "name": "半导体ETF",  "category": "行业", "market": "sh"},
    {"code": "516160", "name": "新能源ETF",  "category": "行业", "market": "sh"},
    {"code": "512880", "name": "证券ETF",    "category": "行业", "market": "sh"},
    {"code": "518880", "name": "黄金ETF",    "category": "商品", "market": "sh"},
] + NEW_TECH_QDII_ETFS

DIVIDEND_STOCKS = [
    {"code": "600900", "name": "长江电力", "category": "电力", "market": "sh"},
    {"code": "601088", "name": "中国神华", "category": "煤炭", "market": "sh"},
    {"code": "601398", "name": "工商银行", "category": "银行", "market": "sh"},
    {"code": "601939", "name": "建设银行", "category": "银行", "market": "sh"},
    {"code": "601288", "name": "农业银行", "category": "银行", "market": "sh"},
    {"code": "600036", "name": "招商银行", "category": "银行", "market": "sh"},
    {"code": "600519", "name": "贵州茅台", "category": "消费", "market": "sh"},
    {"code": "000333", "name": "美的集团", "category": "家电", "market": "sz"},
    {"code": "000651", "name": "格力电器", "category": "家电", "market": "sz"},
    {"code": "600941", "name": "中国移动", "category": "通信", "market": "sh"},
    {"code": "601728", "name": "中国电信", "category": "通信", "market": "sh"},
    {"code": "600028", "name": "中国石化", "category": "能源", "market": "sh"},
    {"code": "601857", "name": "中国石油", "category": "能源", "market": "sh"},
    {"code": "601006", "name": "大秦铁路", "category": "交运", "market": "sh"},
    {"code": "600377", "name": "宁沪高速", "category": "交运", "market": "sh"},
]

PRESET_PORTFOLIOS = [
    {
        "id": "fake_diversification",
        "name": "典型“假分散”踩坑组合",
        "desc": "宽基+上证50+银行ETF看似分散，穿透后共持招行/茅台/平安/紫金等，高度重合",
        "positions": [
            {"code": "510300", "amount": 40000},
            {"code": "510050", "amount": 30000},
            {"code": "512800", "amount": 30000},
        ],
    },
    {
        "id": "dividend_income",
        "name": "稳健吃息防回撤组合",
        "desc": "红利ETF与高股息水电煤炭龙头混合配置，侧重低回撤与稳定现金流",
        "positions": [
            {"code": "510880", "amount": 40000},
            {"code": "600900", "amount": 30000},
            {"code": "601088", "amount": 30000},
        ],
    },
    {
        "id": "balanced_contrast",
        "name": "红利+黄金+成长低相关对照",
        "desc": "红利股(周期)+黄金商品(无股票持仓)+创业板成长，底层几乎不重合，用于对比分散效果",
        "positions": [
            {"code": "510880", "amount": 40000},
            {"code": "518880", "amount": 30000},
            {"code": "159915", "amount": 30000},
        ],
    },
    {
        "id": "us_tech_fake_div",
        "name": "美股科技“假分散”组合",
        "desc": "同时买入纳指、标普500与纳指科技，穿透后底层高度重合于美股科技七巨头",
        "positions": [
            {"code": "513100", "amount": 40000},
            {"code": "513500", "amount": 30000},
            {"code": "159509", "amount": 30000},
        ],
    },
    {
        "id": "global_low_corr",
        "name": "跨市场低相关均衡组合",
        "desc": "美股成长(纳指) + A股红利 + 黄金三类低相关资产搭配，检验跨市场回撤平滑效果",
        "positions": [
            {"code": "513100", "amount": 35000},
            {"code": "510880", "amount": 35000},
            {"code": "518880", "amount": 30000},
        ],
    },
]


def build():
    """Return unified catalog rows: {code,name,category,market,type}."""
    rows = []
    for group, typ in ((ETFS, "ETF"), (DIVIDEND_STOCKS, "STOCK")):
        for item in group:
            rows.append({
                "code": item["code"], "name": item["name"],
                "category": item["category"], "market": item["market"], "type": typ,
            })
    return rows


if __name__ == "__main__":
    import json
    print(json.dumps({
        "catalog": build(),
        "presets": PRESET_PORTFOLIOS,
    }, ensure_ascii=False, indent=1))
