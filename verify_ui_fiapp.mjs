#!/usr/bin/env node
/**
 * verify_ui_fiapp.mjs — 零依赖 UI 硬核验收 v2（Node 内置 + Chrome headless dump-dom）
 *
 * 吸取 v1 教训：v1 的 8/8 被独立验证器 REJECT——测试钩子掩盖断网 bug、字段映射错误漏测。
 * v2 加强：
 *  - 断网超时降级实测（stub live.js，等 7 秒看是否落 SNAPSHOT）
 *  - 富途涨跌必须由 last/prev 真算（茅台 +1.22%），不许假 0
 *  - 期货必须查价格非空（IF 有 fut 点位），IH 诚实无源允许 1 个
 *  - 重排实测注入榜尾标的冲顶，验证首行真变化
 *  - 首轮数据源切换不算假异动、事件文案无双加号
 *
 * 用法：node alphalens/verify_ui_fiapp.mjs [--shots]
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const LIVE = path.join(HERE, 'index_fiapp_live.html');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SHOTS = process.argv.includes('--shots');

const FROZEN = [
  ['core.js', 'cf60cc74ab901271'],
  ['verify.js', 'a593329b2ef3c216'],
  ['index.html', '0d166fe7db0b5cec'],
];
const results = [];
function record(n, name, pass, detail) {
  results.push({ n, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${name}${detail ? ' — ' + detail : ''}`);
}
function chromeDom(htmlPath, budget = 9000, extra = []) {
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    `--virtual-time-budget=${budget}`, ...extra, '--dump-dom', 'file://' + htmlPath],
    { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
  return r.stdout || '';
}

// ---------- 1. 冻结 SHA ----------
{
  let ok = true, notes = [];
  for (const [f, baseline] of FROZEN) {
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(HERE, f))).digest('hex').slice(0, 16);
    if (sha !== baseline) { ok = false; notes.push(`${f}=${sha}`); }
  }
  record(1, '三冻结文件 SHA 零变更', ok, ok ? 'core/verify/index 全匹配' : notes.join(';'));
}
// ---------- 2. verify.js 59/0 ----------
{
  const out = execFileSync('node', [path.join(HERE, 'verify.js')], { cwd: ROOT, encoding: 'utf8' });
  const m = out.match(/checks=(\d+)\s+failures=(\d+)/);
  record(2, '数据契约 verify.js = 59/0', !!(m && m[1] === '59' && m[2] === '0'), m ? `checks=${m[1]} failures=${m[2]}` : out.slice(-80));
}

// ---------- 3~8 主探针 ----------
const PROBE = String.raw`
<script>
(function(){
  var R={errs:[],cdn:[],checks:{}};
  window.addEventListener('error',function(e){R.errs.push(e.message);});
  var oe=console.error;console.error=function(){R.errs.push([].join.call(arguments,' '));oe.apply(console,arguments);};
  function done(){var d=document.getElementById('__AUDIT__');if(d)d.textContent=JSON.stringify(R);}
  window.addEventListener('load',function(){setTimeout(function(){
    try{
      [].forEach.call(document.querySelectorAll('link[href],script[src],img[src]'),function(el){
        var u=el.getAttribute('href')||el.getAttribute('src')||'';
        if(/^https?:/.test(u)&&!/^https?:\/\/127\.0\.0\.1/.test(u)&&u.indexOf('w3.org')<0)R.cdn.push(u);
      });
      var S=window.AlphaLens.store,c=R.checks;

      // [3] 零异常/零CDN + 红涨绿跌 token
      c.dom_ready=!!document.getElementById('rank-body');
      c.col_up=(function(){var el=document.createElement('div');el.className='up';document.body.appendChild(el);
        var v=getComputedStyle(el).color;el.remove();return v;})();

      // [4] 45/45 badge + 富途涨跌真值（茅台 +1.22%，不是假 0）
      c.symbol_rows=document.querySelectorAll('#symbol-body tr[data-sid]').length;
      c.sid_uniq=(function(){var s={};[].forEach.call(document.querySelectorAll('#symbol-body tr[data-sid]'),function(t){s[t.getAttribute('data-sid')]=1;});return Object.keys(s).length;})();
      c.broken_img=[].filter.call(document.images,function(i){return i.complete&&i.naturalWidth===0;}).length;
      // Q2：不写死真值——从页面内嵌数据读基准，验证渲染的涨跌与 last/prev 自算一致（核心是"非假 0"）
      var mq=S.get('SH.600519');c.moutai_chg=mq?mq.chgPct:null;c.moutai_last=mq?mq.last:null;c.moutai_prev=mq?mq.prev:null;
      c.badge_total=document.querySelectorAll('.tbadge').length;

      // [5] 榜单四榜各 20 行 + 深度徽标 + 分段切换真生效
      var rc={};[].forEach.call(document.querySelectorAll('#rank-tabs .tab'),function(tab){
        tab.click();rc[tab.getAttribute('data-rank')]=document.querySelectorAll('#rank-body tr[data-field-row]').length;});
      document.querySelector('#rank-tabs .tab[data-rank="gainers"]').click();
      c.rank_counts=rc;c.deep_badges=document.querySelectorAll('#rank-body .badge.deep').length;
      var scopeBtns=document.querySelectorAll('#rank-scope button'),scopes={};
      [].forEach.call(scopeBtns,function(b){b.click();scopes[b.getAttribute('data-scope')]=document.querySelectorAll('#rank-body tr[data-field-row]').length;});
      c.scopes=scopes;
      scopeBtns[0].click(); // 回 A股

      // [6] 状态引擎：注入榜尾标的冲顶→验证真重排 + tick + 事件 + 徽标
      var rows=document.querySelectorAll('#rank-body tr[data-field-row]');
      var lastRow=rows[rows.length-1],sid=lastRow?lastRow.getAttribute('data-field-row'):null;
      var firstSid=rows[0]?rows[0].getAttribute('data-sid'):null;
      var tickBefore=document.getElementById('reorder-pill').classList.contains('show');
      if(sid&&S&&window.AlphaLens.__injectQuote){
        // 两轮同源 LIVE 注入：先立基线，再制造真跃升。
        // 首轮从富途基准切到 LIVE 是数据源切换，按 Gate A 设计不应产生假异动。
        window.AlphaLens.__injectQuote(sid,{last:100,chgPct:1.0,amount:1e8,amplitude:1.0,time:'20261119200000',source:'LIVE'});
        window.AlphaLens.__injectQuote(sid,{last:99999.99,chgPct:99.99,amount:9.9e9,amplitude:19.9,time:'20261119200005',source:'LIVE'});
      }
      c.fill_sid=sid;c.first_before=firstSid;
      c.px_after=lastRow?lastRow.querySelector('[data-live-px]').textContent:'';
      c.tick_class=lastRow?!!lastRow.querySelector('.px-msg.tick-up'):false;
      c.live_label=document.getElementById('live-label').textContent;
      c.ev_html=document.getElementById('events-body').innerHTML;
      c.ev_has_injected=(c.ev_html.indexOf('涨跌变动')>=0 || c.ev_html.indexOf('突破日内新高')>=0 || c.ev_html.indexOf('成交额放量')>=0)
        && c.ev_html.indexOf('++')<0 && /\d{2}:\d{2}:\d{2}/.test(c.ev_html);
      c.reorder_shown=document.getElementById('reorder-pill').classList.contains('show');
      // 自动重排：注入后首行应立即变成被注入的榜尾标的，无需点击
      c.first_after=document.querySelector('#rank-body tr').getAttribute('data-sid');
      c.auto_reordered=(c.first_after===sid && sid!==c.first_before);

      // [7] 期货专页：9 行 + IF 有真点位 + IH 诚实无源(≤1) + 无假 0
      var fl=document.querySelector('#side .nav a[data-market="期货"]');if(fl)fl.click();
      c.future_rows=document.querySelectorAll('#market-body tr[data-sid]').length;
      c.future_badges=document.querySelectorAll('#market-body .badge').length;
      c.future_noSource=document.querySelectorAll('#market-body .badge.miss').length;
      var ifRow=null;[].forEach.call(document.querySelectorAll('#market-body tr[data-sid]'),function(t){if(t.getAttribute('data-sid')==='SH.IF')ifRow=t;});
      c.if_px=ifRow?ifRow.querySelector('[data-live-px]').textContent:'';
      c.if_chg=ifRow?ifRow.querySelector('[data-live-chg]').textContent:'';
      if(fl)document.querySelector('#side .nav a[data-view="overview"]').click();

      // [8] 十年图所有容器十字光标
      var charts=document.querySelectorAll('[data-chart="decade"]');
      c.chart_containers=charts.length;
      c.charts_bound=[].filter.call(charts,function(x){var s=x.querySelector('.chart-svg');return s&&s.__cross;}).length;

      // [10] 45 只都能点进个股页：点击后 view-symbol 可见且 sym-current 跟随标的
      function home(){var a=document.querySelector('#side a[data-view=overview]');if(a)a.click();}
      var clickable={rank:'#rank-body tr[data-code]',heat:'#heat .cell[data-code]',symbol:'#symbol-body tr[data-code]'};
      c.detail_clicks={};
      Object.keys(clickable).forEach(function(k){
        home();var el=document.querySelector(clickable[k]);
        if(!el){c.detail_clicks[k]='NO_EL';return;}
        var want=el.getAttribute('data-code');el.click();
        var got=document.getElementById('sym-current').textContent;
        var shown=document.getElementById('view-symbol').style.display!=='none';
        c.detail_clicks[k]={want:want,title:got,ok:shown&&got.indexOf(want)>=0};
      });
      // 事件专页是独立入口：验证能打开且诚实空态或真实事件
      home();var evNav=document.querySelector('#side a[data-view="events"]');
      if(evNav)evNav.click();
      c.eventsView=document.getElementById('view-events').style.display!=='none';
      c.eventsHasContent=document.getElementById('events-full').innerHTML.length>20;
      // 非深度标的 000858 必须有真实K线SVG（查结构不查文案，文案会被LIVE状态替换）
      home();var el858=document.querySelector('#rank-body tr[data-code="000858"]')||document.querySelector('#symbol-body tr[data-code="000858"]');
      if(el858){el858.click();var st=document.getElementById('sym-stage');
        // 手写K线用 <line> 蜡烛 + <rect> 成交量；polyline 只用于十年折线图
        c.nonDeepHasKline=!!st && st.querySelectorAll('line').length>10 && st.querySelectorAll('rect').length>5;
        c.nonDeepTitle=document.getElementById('sym-current').textContent;}

      // [11] 动效 token（Vibe Design Tips）：缓动按角色分类、reduced-motion、FLIP 类
      var cs=getComputedStyle(document.documentElement);
      c.ease_out=cs.getPropertyValue('--ease-out').trim();
      c.ease_inout=cs.getPropertyValue('--ease-in-out').trim();
      c.ease_spring=cs.getPropertyValue('--ease-spring').trim();
      c.has_flip=!!document.styleSheets.length && Array.from(document.styleSheets).some(function(ss){
        try{return Array.from(ss.cssRules).some(function(r){return r.selectorText&&r.selectorText.indexOf('flip-move')>=0;});}catch(e){return false;}
      });

      // [12] Gate A 诚实性：坏时间戳/假异动/黑话披露条/24H涨跌 全部消除
      var ev=document.getElementById('events-body').innerHTML;
      c.no_fake_events=ev.indexOf('涨跌跃升')<0 && ev.indexOf('数据源切换')<0;
      c.event_times_ok=!/class="t">\d{3,5}</.test(ev);   // 不再有 427/442 这种伪时间
      var prov=document.getElementById('al-provenance');
      var summary=prov&&prov.querySelector('.prov-summary');
      c.prov_collapsed=!!prov && !prov.classList.contains('expanded') && !!summary;
      // 只看默认可见的摘要，完整说明（.prov-full）本就应包含技术术语，点开才看
      c.no_jargon_firstscreen=!!summary && summary.textContent.indexOf('meta.proxies')<0;
      // 只查可见渲染文本，排除 script/style 里的探针字面量
      var vis=document.body.innerText||document.body.textContent;
      c.no_24h=vis.indexOf('24H 涨跌')<0;
      c.time_label=document.body.textContent.indexOf('深度指标截至')>=0;

      // [13] 超现实氛围层 + 五大类组件：hero/玻璃/skeleton/toast/按压/typography
      // S6 测试迁移（implementation_plan）：从超现实氛围层改成 Vibe 五大类组件
      // 顶部图标与底部色温图已移除：侧栏只保留 10 个编号导航 + 最近浏览
      c.navCount=document.querySelectorAll('#side .nav a').length;
      c.noLogo=!document.querySelector('#side .logo');
      c.noCover=!document.querySelector('#side .cover');
      c.cover=c.navCount===10 && c.noLogo && c.noCover;
      c.tabmark=document.querySelectorAll('.tabs .tab-mark').length>=3;
      var tabEl=document.querySelector('.tab');
      c.keycap=!!tabEl && getComputedStyle(tabEl).boxShadow.indexOf('inset')>=0;
      c.odo=!!document.querySelector('.odo .odo-glyph');
      c.brief=!!document.getElementById('brief-text') && document.getElementById('brief-text').textContent.indexOf('今日')>=0;
      c.has_toast=Array.from(document.styleSheets).some(function(ss){
        try{return Array.from(ss.cssRules).some(function(r){return r.selectorText&&r.selectorText.indexOf('al-toast')>=0;});}catch(e){return false;}
      });
      c.typography=cs.getPropertyValue('--font')!==undefined; // 占位，核心看 tabular-nums 规则
      // 查实际 computed 样式，不查 CSS 字面量（字面量会被 font: 简写复位而漏测）
      var numEl=document.querySelector('.breadth .num'),pctEl=document.querySelector('.pct');
      c.tnum_computed=!!numEl && getComputedStyle(numEl).fontVariantNumeric==='tabular-nums'
        && !!pctEl && getComputedStyle(pctEl).fontVariantNumeric==='tabular-nums';
      // 导航状态点诚实：非市场入口恒蓝、期货恒灰，不许伪装 LIVE 绿
      var dotEvents=document.querySelector('[data-status-key="nav:events"]');
      var dotFutures=document.querySelector('[data-status-key="nav:期货"]');
      var dotA=document.querySelector('[data-status-key="nav:A股"]');
      c.dots_honest=!!dotEvents && dotEvents.className.indexOf('live')<0
        && !!dotFutures && dotFutures.className.indexOf('none')>=0
        && !!dotA; // A股 允许绿(真有LIVE)或蓝(降级)
      // 研究入口 data-goto 必须落到指定 tab（不被 openSymbol 重置成 quote）
      c.goto_tabs={};
      ['report','fund','related'].forEach(function(to){
        home();var el=document.querySelector('[data-goto='+to+']');
        if(!el){c.goto_tabs[to]='NO_EL';return;}
        el.click();var act=document.querySelector('#detail-tabs .tab.on');
        c.goto_tabs[to]=act&&act.getAttribute('data-tab');
      });
    }catch(e){R.errs.push('PROBE_EX:'+e.message);}
    done();
  },2200);});
})();
</script>
`;
const probeFile = path.join(HERE, '__ui_probe.html');
const resultFile = path.join(ROOT, '.agents', 'handoffs', 'verify_ui_probe_result.json');
function injectProbe(extraHead = '') {
  let raw = fs.readFileSync(LIVE, 'utf8');
  raw = raw.replace('</body>', `<div id="__AUDIT__" style="display:none"></div>${PROBE}</body>`);
  if (extraHead) raw = raw.replace('</head>', extraHead + '</head>');
  fs.writeFileSync(probeFile, raw);
}
function readAudit(dom) {
  const m = dom.match(/<div id="__AUDIT__"[^>]*>([\s\S]*?)<\/div>/);
  try {
    return JSON.parse((m ? m[1] : '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  } catch (e) { return { errs: ['PROBE_PARSE_FAIL:' + e.message], checks: {} }; }
}

injectProbe();
let R = readAudit(chromeDom(probeFile));
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, JSON.stringify(R, null, 2));
const c = R.checks || {};

record(3, '零运行时异常 / 无CDN / 红涨绿跌',
  R.errs.length === 0 && R.cdn.length === 0 && /rgb\(217,\s*45,\s*32\)/.test(c.col_up || ''),
  `errs=${R.errs.length} cdn=${R.cdn.length} upColor=${c.col_up}`);
record(4, '45/45 唯一标的徽章 + 富途涨跌真值',
  c.symbol_rows === 45 && c.sid_uniq === 45 && c.broken_img === 0 &&
  // 动态真值：chgPct 必须等于 (last-prev)/prev*100（不是假 0），且价格为真数
  Math.abs(c.moutai_chg||0) > 0.01 && Math.abs((c.moutai_last||0)-(c.moutai_prev||0)) > 0.01 &&
  Math.abs((c.moutai_chg||0) - ((c.moutai_last-c.moutai_prev)/c.moutai_prev*100)) < 0.05,
  `rows=${c.symbol_rows} uniq=${c.sid_uniq} broken=${c.broken_img} 茅台=${c.moutai_last}/${c.moutai_chg}% (last/prev自算一致)`);
record(5, '四榜单各 20 行 + 深度徽标 + 分段真切换',
  ['gainers', 'losers', 'volatile', 'turnover'].every(k => c.rank_counts?.[k] === 20) &&
  c.deep_badges === 3 && c.scopes?.['A股'] === 20 && c.scopes?.['ETF'] === 8 && c.scopes?.['all'] === 45,
  `榜单=${JSON.stringify(c.rank_counts)} deep=${c.deep_badges} 分段=${JSON.stringify(c.scopes)}`);
record(6, '状态引擎：真重排 + tick + 事件 + 徽标',
  /99,?999\.99/.test(c.px_after || '') && c.tick_class === true && /LIVE/.test(c.live_label || '') &&
  c.ev_has_injected === true && c.auto_reordered === true,
  `px=${c.px_after} tick=${c.tick_class} ev=${c.ev_has_injected} 自动重排 ${c.first_before}→${c.first_after} (应为${c.fill_sid})`);
record(7, '期货：9 行 + IF 真点位 + IH 诚实无源 + 无假 0',
  c.future_rows === 9 && /3,?956\.6/.test(c.if_px || '') && !/0\.00%/.test(c.if_chg || '') && c.future_noSource <= 1,
  `rows=${c.future_rows} IF=${c.if_px}/${c.if_chg} 无源=${c.future_noSource}`);
record(8, '十年图所有容器十字光标绑定',
  c.chart_containers >= 1 && c.charts_bound === c.chart_containers,
  `containers=${c.chart_containers} bound=${c.charts_bound}`);
{
  const dc = c.detail_clicks || {};
  const allClickable = ['rank', 'heat', 'symbol'].every(k => dc[k] && dc[k].ok)
    && c.eventsView === true && c.eventsHasContent === true;
  record(10, '榜单/热力/标的进个股页 + 事件独立入口', allClickable,
    Object.keys(dc).map(k => `${k}:${dc[k].title || dc[k]}`).join(' ') + ` 事件页=${c.eventsView}/${c.eventsHasContent}`);
  record(11, '非深度标的有真实K线SVG + 动效 token 生效',
    c.nonDeepHasKline === true && /000858/.test(c.nonDeepTitle || '') &&
    /cubic-bezier\(\.22,\s*1,\s*\.36,\s*1\)/.test(c.ease_out || '') &&
    /linear\(/.test(c.ease_spring || '') && c.has_flip === true,
    `五粮液K线SVG=${c.nonDeepHasKline} ease-out=${c.ease_out} spring=${(c.ease_spring||'').slice(0,24)} FLIP=${c.has_flip}`);
  record(12, '诚实性：无假异动/坏时间/黑话/24H错误概念',
    c.no_fake_events === true && c.event_times_ok === true && c.prov_collapsed === true &&
    c.no_jargon_firstscreen === true && c.no_24h === true && c.time_label === true,
    `假异动=${c.no_fake_events} 时间=${c.event_times_ok} 披露收起=${c.prov_collapsed} 黑话=${c.no_jargon_firstscreen} 24H=${c.no_24h} 时间标签=${c.time_label}`);
  record(13, '超现实氛围 + Vibe五大类落地',
    c.cover === true && c.tabmark === true && c.keycap === true && c.odo === true && c.brief === true &&
    c.has_toast === true && c.tnum_computed === true && c.dots_honest === true
    && ['report','fund','related'].every(function(k){return (c.goto_tabs||{})[k]===k;}),
    `cover=${c.cover} 墨键=${c.tabmark} 按键凹陷=${c.keycap} odo=${c.odo} 速览=${c.brief} tabular=${c.tnum_computed} 状态点=${c.dots_honest} goto=${JSON.stringify(c.goto_tabs||{})}`);
}

// ---------- 9. 断网降级实测（新增，堵住 A1 漏测）----------
{
  // stub live.js：把 AlphaLive.start 变成永不回调的 stub，模拟连不上网
  const stub = '<script>window.__STUB_LIVE=1;</script>';
  let raw = fs.readFileSync(LIVE, 'utf8');
  raw = raw.replace('<script src="live.js"></script>',
    '<script>window.AlphaLive={start:function(){},status:function(){return{state:"SNAPSHOT",stamp:"",count:0};},get:function(){return null;},all:function(){return{};},stop:function(){}};</script>');
  raw = raw.replace('</body>', '<div id="__OFFLINE__" style="display:none"></div><script>window.addEventListener("load",function(){setTimeout(function(){document.getElementById("__OFFLINE__").textContent=JSON.stringify({label:document.getElementById("live-label").textContent,state:window.AlphaLens.store.status}); },7500);});</script></body>');
  const offFile = path.join(HERE, '__offline_probe.html');
  fs.writeFileSync(offFile, raw);
  const dom = chromeDom(offFile, 9000);
  fs.rmSync(offFile, { force: true });
  const m = dom.match(/<div id="__OFFLINE__"[^>]*>([\s\S]*?)<\/div>/);
  let o = {};
  try { o = JSON.parse((m ? m[1] : '{}').replace(/&quot;/g, '"')); } catch (e) {}
  const pass = o.state === 'SNAPSHOT' && /SNAPSHOT/.test(o.label || '');
  record(9, '断网 7 秒后降级 SNAPSHOT（非永久 CONNECTING）', pass,
    `state=${o.state} label=${o.label}`);
}

fs.rmSync(probeFile, { force: true });

if (SHOTS) {
  const desktop = path.join(ROOT, '.agents', 'handoffs', 'shot-desktop.png');
  const mobile = path.join(ROOT, '.agents', 'handoffs', 'shot-mobile.png');
  for (const [w, h, out] of [[1440, 1000, desktop], [390, 844, mobile]]) {
    spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--window-size=${w},${h}`,
      '--virtual-time-budget=8000', `--screenshot=${out}`, 'file://' + LIVE], { encoding: 'utf8' });
  }
  console.log(`SHOTS  desktop=${fs.existsSync(desktop) ? fs.statSync(desktop).size : 0}B mobile=${fs.existsSync(mobile) ? fs.statSync(mobile).size : 0}B`);
}

const passed = results.filter(r => r.pass).length;
console.log(`\n=== VERIFY_UI_FIAPP v3: ${passed}/${results.length} PASS ===`);
if (passed !== results.length) process.exit(1);
