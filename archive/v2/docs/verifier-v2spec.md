# pstack 独立验证器 v2spec 裁决（Tab 2，全新技术面，只读复核）

- 验证对象：`alphalens/index_fiapp.html` → `index_fiapp_live.html`
- 规格：`implementation_plan.md`（优先） + `executor_spec.md`
- 手段：静态 grep/sha/锚点 + 隔离目录重建 + 自写 Chrome 探针（`/tmp/alverify/probe.py`、`probe2.py`、`theme_cdp.js`、`mobile_cdp.js`），全程不修改交付文件
- 探针副本放 `/tmp/alverify`，仅复制 `core.js`/`live.js`/`assets` 依赖

---

## ACT_ON（阻断，必须修）

### A1. `.brief` 二次定义重新引入 Georgia 衬线与蓝色渐变，违反 S6/C8
- `index_fiapp.html:361-363` 已按 S6 写成单色 + `var(--font-text)`；但 `index_fiapp.html:365-367` 又定义一次同名规则并**后覆盖前者**：
  - `:367  font:15px/1.5 Georgia,"Songti SC",serif`
  - `:366  background:linear-gradient(90deg,rgba(127,178,255,.13),rgba(255,226,160,.10)); border:1px solid rgba(127,178,255,.25)`
- 实测 computed：`brief_font="Georgia, \"Songti SC\", serif"`、`brief_bg=linear-gradient(...blue/amber...)`、`brief_border=rgba(127,178,255,.25)`、`css_has_georgia=true`。live 文件 `index_fiapp_live.html:367` 同样存在。
- 规格明写 S6「删除 dream 渐变和 Georgia 衬线字体」、C8「其他地方一律用黑白灰」。`verify [13]` 只查 `.dream-hero`/`--dream-*`，查不到这条，属**测试盲区导致的假 PASS**。
- 建议：删除 `365-367` 这段二次定义（保留 `361-363`），或把它改成单色 + Satoshi/Inter。

### A2. 墨键 `transition:none` 内联残留，`.tab-mark` 只会瞬移不会滑动
- `index_fiapp.html:1693` `if(!animate){mark.style.transition='none';}`；初始化 `sync(false)`（`:1695`）把 `transition:none` 写成**内联样式**；首帧后的 `sync(true)`（`:1697`）只调 `sync(true)`，**没有清除内联 `transition`**。
- 实测：`mark_inline_transition="none"`、`mark_computed_transition="none"`（即使 `data-ready=true`）。CSS 规则本身正确（`.tabs[data-ready] .tab-mark{transition:translate .32s var(--ease-out),width .32s var(--ease-out)}`，`:202`），但被内联样式永久压过。
- 实测 `mark_before="4px" → mark_after="77px"`、`mark_text="跌幅榜"`、`mark_width="65px"` —— 位置确实变，但是**跳变**，不是 S2 验收要求的「黑色墨键从涨幅榜**滑**过去」。`verify [13]` 只数 `.tab-mark` 个数，测不到动画。
- 建议：`sync()` 改成 `mark.style.transition = animate ? '' : 'none'`（animate 时清空内联，让 `[data-ready]` 规则生效）。

### A3. Focus 聚焦「其余卡片淡到 .26」不生效（CSS/JS 契约不一致）
- CSS `index_fiapp.html:374`：`.focus-group:has(.focusable[data-focused]) .focusable:not([data-focused]){opacity:.26}` —— 要求**所有**同组行都带 `.focusable`。
- JS `index_fiapp.html:1661-1662`：hover 时先 `remove('focusable')` 清掉所有行，**只给当前行**加 `.focusable`。于是兄弟行不带 `.focusable`，选择器永不匹配。
- 实测：hover 榜首行 900ms 后 `focus_row_focused=true`、`focus_focusable_count=1`（共 20 行）、`sib_class="row"`、`sib_opacity="1"`（应为 `.26`）、`group_has=true`。放大本身有效（实时 CDP 测得 `scale=1.0397`），`::before pointer-events=none` 不拦截点击（`:377`）。
- 建议：初始化 `host` 时给所有 `g.rows` 一次性加 `.focusable`（CSS 已按此写），或把 CSS 改成 `.focus-group:has([data-focused]) tr:not([data-focused])`。
- 影响：S4 核心验收「首屏有对焦感、其余卡片变淡」失败；`verify [13]` 不覆盖。

---

## CONSIDER（非阻断，建议修）

- **C1. 深色模式热力图几乎不可见**：`index_fiapp.html:1067` 内联 `background-color:rgba(11,11,11,alpha)` 硬编码黑；实测深色下 body=`rgb(11,11,11)`、格子=`rgba(11,11,11,0.16)` → 对比度近 0。S5 规格要求默认填充 `color-mix(in srgb,var(--ink) 5%,transparent)`（深色应跟着变白），内联样式把它压掉了。浅色正常。建议改用 token。
- **C2. S3 Odometer 覆盖不全**：实测 `.odo` 仅 3 个（`bd-adv/bd-dec/temp-score`，`index_fiapp.html:905-911`）；`executor_spec §S3` 还要求「指数点位、涨跌幅、个股详情页现价」。执行 Agent 自述只声称「温度/宽度家数」，与必测项 3 一致但与规格全文有差距。`odo()` 本身正确：实测变更 4 位 `data-in`、相同 4 位不动、长度变化全播 4 位、`.odo-text` 正确、无 `--744` 前缀。
- **C3. 雷达图 SVG 硬编码蓝**：`index_fiapp.html:1415` `fill="rgba(37,99,235,.18)"` 不随主题变；十年线/K 线已全部用 `var(--*)` token（`:1395-1405`），主题一致性尚可。
- **C4. 默认曲线关键字**：`index_fiapp.html:471` `.subview{animation:viewIn .22s ease-out}` 与 `:230` shimmer 用 `linear` 关键字，不属 3 条 token 曲线（但 grep 口径的 cubic-bezier/linear() 字面量确为 3 token + key/knob 2 特例 = 5 条）。`ease-out` 关键字略偏离 S1「只允许 3 条」。
- **C5. `build_fiapp.py:65-72`** 只对 3 个 payload 锚点做计数断言，`DISCLOSURE` 锚点直接 replace 无计数校验；当前源模板 4 锚点各 1 次，暂无实际问题，建议补齐防御。

---

## NOTED（已核实为真/环境限制，无需改）

- **工程约束全过**：4 锚点源模板各 1 次、live 无残留；冻结三 sha=`cf60cc74…`/`a593329b…`/`0d166fe7…` 与 verify 基线一致；无 CDN/外链；隔离目录 `python3 build_fiapp.py` 退出 0 且生成 live 与交付 live sha256 完全相同（`84e69308…`），证明未手改 live。
- **曲线**：字面量 5 条 = `--ease-out cubic-bezier(.22,1,.36,1)`、`--ease-spring linear(...)`、`--ease-settle cubic-bezier(.45,0,.2,1)` + `--key-motion` 内 key 特例 + `.switch` 的 knob `cubic-bezier(.3,.7,.1,1)`；符合「3+2」。
- **红绿使用逐条**：`:90 .up/.down/.flat`（数字类）、`:369 .brief .up/.down`（数字）、`:583/:1294` 宽度双向条填充（涨跌家数标记，v1 既有）、`:1398/:1400` K 线蜡烛（S5 明确允许红绿）。无按钮/边框/标题/状态点用红绿；状态点已改灰阶/形状（`:445`）。
- **测试可信度**：`verify_ui_fiapp.mjs` [4] 用 `S.get('SH.600519')` 动态读 `chgPct` 并校验 `(last-prev)/prev*100`（`:85-86,245-250`），非写死；[11] 迁到 `--ease-out`+`--ease-spring linear(`+`has_flip`（`:161-168,271-275`）；[13] 迁到 cover/tabmark/keycap/odo/tnum/dots/goto（`:184-214,280-284`）。实跑 **13/13 PASS**，退出码 0。
- **回归全过**：45/45 唯一标的、四榜 20 行+3 深度徽标+分段 A股20/ETF8/全部45、真重排 `SH.600519→SH.601888`+tick+事件、期货 9 行 IF=3956.60 IH 无源1、十字光标 2/2、五视图与详情点击、断网 7s 落 SNAPSHOT、状态点诚实、data-goto 三 tab 正确、NaN/undefined=0、onerror/CDN=0。
- **主题/快捷键**：T 键与按钮均切换、localStorage 持久化、按钮点击调用 `startViewTransition`（计数 1→1 次调用），输入框内 T 不触发（实测 theme 不变），`[`/`]` 切 tab 生效。无头环境无合成帧导致 VT 回调延迟到下一次交互才落定（真实 CDP 实测存在此现象），属无头限制；代码写法符合 `executor_spec §S7`。
- **移动端**：390×844 CDP 实测 `docW=clientW=390`（无横向溢出）、菜单按钮显示、抽屉打开后 `transform:none`+遮罩显示。
- **CSS 未误插 JS 区**：`<style>`/`</style>` 各 1，JS 区无 CSS 声明，build 内联 `node --check` 退出 0。

---

## DISMISSED（执行 Agent 自述或疑点，实测不成立）

- 「dream-hero / `--dream-*` 残留」：实测 `dream_hero=false`、无 `--dream-*`，已删干净（仅 `.brief` 的 Georgia/渐变是另一处遗漏，见 A1）。
- 「odo 重复前缀 `--744`」：`odo()` `:1110-1112` 首调移除初始文本节点，实测 `.odo-roll` 文本 `3,251.02`、无前导 `--`，不成立。
- 「锚点逻辑源/live 不一致」：重建 sha 完全一致，不成立。
- 「[4] 写死真值」：已动态读，实测茅台 `1485.75/+1.75%` 与 `last/prev` 自算一致，不成立。

---

## VERDICT: REJECT

阻断项 A1/A2/A3 均为规格硬要求的直接违反（S6 删 Georgia、S2 墨键滑动、S4 其余卡淡 .26），且都**不在现有 13 项验收的覆盖范围内**，属于「测试通过但设计未落地」。修复 A1/A2/A3 后建议重跑本探针（`/tmp/alverify/probe.py` 与 `probe2.py`），三项预期分别为 `brief_font` 不含 Georgia、`mark_computed_transition` 含 `translate .32s`、`sib_opacity≈0.26 且 focusable_n=20`。C1（深色热力图）建议一并修。

---

### 汇报（≤400 字）
独立复核结论 **REJECT**。硬指标确为全绿：4 锚点各 1、冻结三 sha 一致、无 CDN、重建 live 哈希 `84e69308` 与交付完全相同、5 条曲线（3 token+key/knob 特例）、verify 实跑 **13/13**。自写 Chrome 探针另测：3 组 tab 各 1 墨键、ODO 变更 4 位/不动 4 位且无 `--744`、card 错峰 0–.55s、字体 5 个 woff2 全相对路径、tooltip 400ms、pcard 340px/500ms、T/按钮/localStorage/ViewTransition、390px 无溢出、断网降级 SNAPSHOT，均通过。但抓到三处阻断：①`index_fiapp.html:367` 二次 `.brief` 重新引入 Georgia 衬线+蓝橙渐变，computed 实测 Georgia，违反 S6/C8；②`:1693` 墨键 `transition:none` 写成内联后从不清除，实测 computed 恒为 `none`，墨键瞬移而非滑动，违反 S2；③`:1661-1662` 只给 hover 行加 `.focusable`，兄弟行实测 opacity=1（应 .26）、focusable 仅 1/20，违反 S4「其余淡出」。三者均绕过了 13 项测试。另有 CONSIDER：深色热力图内联硬编码黑 `rgba(11,11,11,.16)` 在 `#0b0b0b` 上近乎不可见、ODO 仅覆盖温度/宽度两处（规格还要求指数/涨跌/现价）、雷达 SVG 硬编码蓝。修复 A1/A2/A3 后可复判 PASS。

---

## 复审轮（2026-11-20，Builder 修复后，只读实测）

- 手段：复用并扩充独立探针（`/tmp/alverify/probe.py`、`probe2.py`、`probe3.py`、`focus_cdp.js`），全程不改交付文件；A3 用 CDP 真实鼠标 + 1440×900 视口最终确认
- 说明：上轮「兄弟行 opacity=1」系合成 PointerEvent + headless 虚拟时间动画帧不推进的假象，本轮用「直接设属性」与「真实鼠标」两路独立排除

### A1 `.brief` 二次定义 —— PASS
- 全文无 `Georgia`（`css_has_georgia=false`）；`:361-363` 仅保留 S6 单色版
- computed（probe.py）：`brief_font="Inter Variable, -apple-system, ..."`（无 Georgia）、`brief_bg="none"`、`brief_border=rgb(242,242,242)`
- 备注：`#al-provenance` 收起态仍有极淡蓝橙渐变（`:378`，`rgba(127,178,255,.10)/rgba(255,226,160,.08)`），与 v1 备份 `:312` 完全一致，属既有遗留而非本轮新增，上轮亦未阻断，不重开

### A2 墨键内联 transition 残留 —— PASS
- 代码：`:1698-1699` `if(!animate){mark.style.transition='none';}else{mark.style.transition='';}`；`:1701 sync(false)`；`:1703 rAF rAF→data-ready+sync(true)`；`:1706 resize`、`:1708-1709 al:viewchange` 均 `sync(false)→rAF sync(true)`
- computed（probe2.py）：`mark_inline_transition=""`、`mark_computed_transition="translate 0.32s cubic-bezier(0.22,1,0.36,1), width 0.32s cubic-bezier(0.22,1,0.36,1)"`
- CSS 规则仍在：`.tabs[data-ready] .tab-mark{transition:translate .32s var(--ease-out),width .32s var(--ease-out)}`

### A3 focus 兄弟行淡出 —— PASS
- 代码：`:1653-1658` `markAll()` 给所有候选行加 `.focusable` + MutationObserver 动态补类；`:1660-1662` `focusOn` 仅切 `data-focused`
- 静态探针（probe3.py）：`focusable_n=20/20`、`sel19b=19`、`opacity_notrans=0.26`，匹配规则仅 `.focus-group:has(.focusable[data-focused]) .focusable:not([data-focused]){opacity:.26}`
- CDP 真实鼠标（focus_cdp.js）：`BEFORE r0df=false,sibOp=1,match=0` → `AFTER_HOVER r0df=true,sibOp=0.26,match=19,scale=1.04` → `AFTER_LEAVE sibOp=1`（复位）

### 无新增问题（回归全过）
- `node verify_ui_fiapp.mjs` 实跑 **13/13 PASS**；`[1]` 冻结 SHA256 前16 = `cf60cc74ab901271`/`a593329b2ef3c216`/`0d166fe7db0b5cec`（`shasum -a 256` 独立复算一致）；`[2] verify.js 59/0`；`[3] errs=0 cdn=0`
- 4 锚点源模板各 1、live 残留各 0；无外链 CDN（仅 `data:` icon + 本地 `core.js`/`live.js`）；曲线字面量 5 条（3 token + key/knob 2 特例）
- 主题：T/按钮/localStorage 切换有效，dark/light 下 body bg = `rgb(11,11,11)`/`rgb(255,255,255)`；JS 错误 `errs=[]`、`e=[]`、`onerror=0`
- 其余（5 woff2 全相对路径、odo 变更/不动各 4 位、card 错峰 0–.55s、断网 SNAPSHOT、390px 无溢出）本轮未改动，沿用上轮已核结论

### CONSIDER（仍存在，不阻断）
- C1 深色热力图硬编码黑：`:1063` `background-color:rgba(11,11,11,'+alpha+')` 仍在，dark 实测 `rgba(11,11,11,0.16)` 近乎不可见
- C2 ODO 覆盖不全：仅 3 处（`:901` bd-adv/bd-dec/temp-score），规格还要求指数/涨跌/现价
- C3 雷达 SVG 硬编码蓝：`:1411` `fill="rgba(37,99,235,.18)"` 仍在

## VERDICT: PASS

A1/A2/A3 均按 Builder 承诺修复并经独立探针（computed 实测 + CDP 真实鼠标）复现，无新增阻断，13/13 与工程约束保持全绿。C1/C2/C3 为既有非阻断遗留，建议后续择机处理。
