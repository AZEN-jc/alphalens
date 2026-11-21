# AlphaLens — A股/指数/ETF/期货 数据门户

毕业设计交付项目。零后端、单文件 `file://` 双击可运行；数据来自 AKShare 收盘快照 + 腾讯财经实时行情 + 富途 MCP 校准快照。

---

## 1. 主入口（答辩只看这个）

| 文件 | 角色 |
|---|---|
| **`index_fiapp_live.html`** | **当前交付主界面**（总览 + A股/指数/ETF/期货专页 + 四榜单 + 个股下钻） |
| `index_okx_live.html` | 并行交付物：OKX 式交易终端（三栏 + 五档周期），保留不动 |
| `index_live.html` | 冻结答辩原版的可运行页（工业粗野四面板 + 回放） |
| `index.html` / `core.js` / `verify.js` | **冻结基线**，sha 不可变（`0d166fe7…` / `cf60cc74…` / `a593329b…`） |

打开方式：双击 `index_fiapp_live.html`（`file://` 原生可用），或起本地服务：
```bash
cd alphalens && python3 -m http.server 8931 --bind 127.0.0.1
# http://127.0.0.1:8931/index_fiapp_live.html
```

---

## 2. 数据口径（答辩防追问）

页面顶栏 `[ DATA PROVENANCE / 数据口径 ]` 披露条永久保留。`snapshot.json` 的 `meta.proxies` 声明哪些字段是代理/估算（量价代理资金、已实现波动率代替隐波、期权权利金比、炸板数估算等）。

| 状态徽标 | 含义 |
|---|---|
| `LIVE` | 腾讯财经 `qt.gtimg.cn` JSONP 实时行情（5 秒轮询，无 Referer 也能用） |
| `FUTU_CALIBRATED` | 富途 MCP 快照校准的真值（36 标的：现价/涨跌/PE/PB/市值），存于 `futu_enrichment.json` |
| `SNAPSHOT_BASE` | 期货快照基准：来自 `snapshot.deriv` 的真基差/涨跌（富途 MCP 无 A股期货权限） |
| `NO_FUTU_FEED` | 该标的无真值源（如 IH），显示 `--`，**绝不编造** |
| `SNAPSHOT` | 断网降级：6 秒内未连上即落定，顶栏明示"实时连接失败" |

**数据深度（45 只全部可点进详情）**：
- `depth.json`：36 只有真实日线（20 A股 + 8 指数 + 8 ETF，各 40 根 OHLCV，来源 AKShare 新浪接口）+ 富途估值（PE/PB/市值）；9 个期货无 K 线源，标 `DERIV_SNAPSHOT`，显示真基差/涨跌快照，**不编造历史**。
- 3 只深度标的（600519/300750/002027）额外有四档资金流与财报评分；其余标的详情里明确说明"暂无资金/财报深度数据"。
- 点击榜单行、热力图格子（板块→代表股）、事件条、全部标的表行，都会进入该标的详情。

**动效与视觉（Vibe Design Tips 五大类）**：
- 交互：拟物按压反馈（active 下沉 1px + 内阴影）
- 动效：缓动 token 按角色分类 + FLIP 重排 + stagger 淡入
- 组件：Status Toast（顶部居中、`role=status`、500ms 入场带模糊、悬停暂停计时）
- 排版布局：`text-wrap: balance/pretty`、中文 `text-autospace`、数字 `tabular-nums`
- 视觉效果：浅色液态玻璃（session 条/披露条 `backdrop-filter` + 内边框高光）

**超现实风格（双平面策略）**：氛围层大胆（hero 超大衬线错位标题「市场是一片天气」+ 太阳/圆环/波浪/眼睛 SVG + mesh 渐变 + 噪点 + 漂浮轨道符号），**数据层钢铁可读**（所有数字等宽右对齐、红涨绿跌、不被艺术效果干扰）。顶部「今日速览」用真数据生成一句话回答"今天怎么样"。

**诚实性口径**：事件只在同源连续两轮 LIVE 间比对（数据源切换不算异动）；时间戳 `HH:MM:SS`；顶栏单一「深度指标截至」时间；披露条默认一行摘要，点开才见技术细节；「今日涨跌」而非 24H。

**铁律**：断网自动降级、涨跌色红涨绿跌、全站浅色、不造假值。

---

## 3. 构建链（顺序固定，不可乱）

```
fetch_snapshot.py → fetch_timeline.py → fetch_decade.py → [富途 MCP 预抓取] → fetch_depth.py → build_fiapp.py
```
`fetch_snapshot.py` 重建会覆盖 `timelines`，所以时间线必须在它之后跑。

一键重建 + 验收（推荐）：
```bash
cd ..
python3 alphalens/scripts/rebuild.py        # 只重建 live 页（用现有 snapshot）
python3 alphalens/scripts/rebuild.py --check # 重建 + 字段契约闸门 + verify.js + UI 9项验收
```

手动分步：
```bash
cd alphalens
.venv/bin/python fetch_snapshot.py --offline   # 断网从 cache 重建主快照
.venv/bin/python fetch_timeline.py --offline   # 恢复 1m/5m/15m/周线
.venv/bin/python fetch_decade.py               # 5 指数 × 120 月线（需联网）
.venv/bin/python fetch_depth.py                # 45 只真日线（新浪源，36 只有 K 线 + 9 期货基准）
.venv/bin/python build_fiapp.py                # 三锚点注入 → index_fiapp_live.html
```

`build_fiapp.py` 用唯一锚点注入（`/*__ALPHALENS_SNAPSHOT_PAYLOAD__*/` 等），锚点出现次数 ≠ 1 即非零退出；构建后自动 `node --check` 校验内联 JS。

---

## 4. 验收

```bash
cd ..                                   # 项目根
node alphalens/verify.js                # 数据契约 59 断言，期望 59/0
node alphalens/verify_ui_fiapp.mjs      # UI 硬核验收 9 项（零依赖，需本机 Chrome）
node alphalens/verify_ui_fiapp.mjs --shots  # 额外生成桌面1440/移动390截图
pstack verify all                       # pstack 四门禁
```

`verify_ui_fiapp.mjs` 11 项包括：冻结 sha、verify 59/0、零 JS 异常/零 CDN、45/45 唯一标的徽章 + 富途涨跌真值、四榜单各 20 行 + 分段切换、状态引擎自动重排（注入榜尾→首行真变化）、期货真点位、多图十字光标、**stub live.js 实测断网 7 秒降级 SNAPSHOT**、榜单/热力/事件/标的均可点进详情、非深度标的有真日线 + 动效 token 生效。

设计背景与决策记录见 `.agents/decision.tsv`、` .agents/handoffs/verifier-refactor-v2.md`（独立验证器 REJECT→PASS 全程）。

---

## 5. 依赖与环境

- Python 3.13 + `requirements.txt`（AKShare 等）；已备 `.venv`。
- 抓取脚本在 `HTTPS_PROXY` 未设置时默认走 `http://127.0.0.1:7890`（Clash Verge 混合端口）。换环境时 export 自己的代理，或用 `--offline` 从 `cache/` 重建。
- 前端零 npm 依赖；验收脚本只用 Node 内置模块 + 本机 Chrome headless（`CHROME_BIN` 可覆盖路径）。

---

## 6. 常见坑（踩过，别再踩）

1. **`num(undefined)=0` 会把字段缺失变成假 0**——取富途/期货字段前必须先确认字段存在，缺失就显式 `--` 或 null，不要默认 0。
2. **测试钩子不能当验收**——生产代码里的 `window.AlphaLens.__injectQuote` 会人为设 LIVE，验收必须用 stub 掉 live.js 走真实断网路径。
3. **大改 JS 一律整段重写 + `node --check`**——用脚本逐块 `replace` 曾误删 6 个渲染函数，导致"功能全没了"。
4. **`fetch_snapshot.py` 会覆盖 `timelines`**——重建后必须再跑 `fetch_timeline.py`，否则 OKX 版失去多周期。
5. **指数 `000001` 与平安银行 `000001` 同码**——前端内部统一用交易所前缀主键 `SH.000001` / `SZ.000001`，展示层才显示 6 位码。

---

## GitHub 仓库说明

本仓库是 **2026-11-21 的干净交付版**：只含源码、构建脚本、数据 JSON、本地字体、文档与验收脚本。
不含 Python 虚拟环境（`.venv`）、缓存副本、备份文件与临时探针。

### 快速运行
```bash
# 方式一：直接双击（file:// 可用，零依赖）
open index_fiapp_live.html

# 方式二：本地服务
python3 -m http.server 8931
# 打开 http://127.0.0.1:8931/index_fiapp_live.html
```

### 验证
```bash
pip install -r requirements.txt        # 如需重新抓数据
python3 build_fiapp.py                 # 锚点注入重建
node verify_ui_fiapp.mjs               # 13 项 UI 硬核验收
```

### 冻结基线（不可改动）
`core.js` / `verify.js` / `index.html` 的 SHA256 前 16 位：
`cf60cc74ab901271` / `a593329b2ef3c216` / `0d166fe7db0b5cec`

### 最近变更（2026-11-21）
- 移除侧栏顶部 AlphaLens 图标与底部色温图（cover），保留 10 个编号导航入口
- 全面排查并修复 4 个 bug：主题切换在部分浏览器不生效、深色热力图硬编码黑墨不可见、`&nbsp;` 二次转义、雷达图/Toast 硬编码色
- 按 `executor_spec.md` 复刻 vibedesign.tips 五大类：物理按键墨键、Odometer、Focus 聚焦、图表斜纹生长、单色排版、深浅主题
- 实测：13/13 UI 验收、verify.js 59/0、pstack 四门禁、零 JS 错误、零 CDN
