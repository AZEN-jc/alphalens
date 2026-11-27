#!/usr/bin/env node
/**
 * AlphaLens v3.1 hard verification (zero dependency, Node builtins + cross-platform Chrome headless).
 * Run: node verify_v3.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, 'index_alphalens_v3_live.html');
const ROOT_INDEX = path.join(HERE, 'index.html');
const DATA_FILE = path.join(HERE, 'analysis_data.json');
const ARCHIVE = path.join(HERE, 'archive', 'v2');
const README = path.join(HERE, 'README.md');
const LICENSE = path.join(HERE, 'LICENSE');
const OUT = path.join(HERE, 'verify_v3_result.json');

function detectChrome() {
  const candidates = [];
  if (process.env.CHROME_BIN) candidates.push(process.env.CHROME_BIN);
  if (process.platform === 'darwin') {
    candidates.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    );
  } else if (process.platform === 'win32') {
    const localApp = process.env.LOCALAPPDATA || '';
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      localApp ? path.join(localApp, 'Google', 'Chrome', 'Application', 'chrome.exe') : ''
    );
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
      const which = spawnSync('which', [bin], { encoding: 'utf8' });
      if (which.status === 0 && which.stdout.trim()) candidates.push(which.stdout.trim());
    }
    candidates.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser');
  }
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return null;
}

const CHROME = detectChrome();
if (!CHROME) {
  console.error(
    'FATAL: Could not locate Chrome/Chromium automatically.\n' +
    'Please install Google Chrome / Chromium or set CHROME_BIN=/path/to/chrome and re-run `node verify_v3.mjs`.'
  );
  process.exit(1);
}

const results = [];
const rec = (n, name, pass, detail) => {
  results.push({ n, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${name}${detail ? ' — ' + detail : ''}`);
};

function decodeHtmlJson(raw) {
  return JSON.parse(
    (raw || '{}')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#39;/g, "'")
  );
}

function chromeDom(htmlPath, extra = []) {
  const url = pathToFileURL(htmlPath).href;
  const hasWinSize = extra.some(a => a.startsWith('--window-size='));
  const defaultWin = hasWinSize ? [] : ['--window-size=1440,960'];
  const r = spawnSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--no-sandbox', '--virtual-time-budget=8000', ...defaultWin, ...extra, '--dump-dom', url],
    { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 }
  );
  return r.stdout || '';
}

// ---- 阶段1：目录、单文件与数据口径（Node 层文件检查）----
const liveText = fs.existsSync(LIVE) ? fs.readFileSync(LIVE, 'utf8') : '';
const rootText = fs.existsSync(ROOT_INDEX) ? fs.readFileSync(ROOT_INDEX, 'utf8') : '';
const extScripts = rootText.match(/<script\b[^>]*\bsrc\s*=/gi) || [];
const rootOk = fs.existsSync(ROOT_INDEX) && fs.existsSync(LIVE) && rootText === liveText && extScripts.length === 0;
rec(11, '主入口index.html与live版一致且真单文件无外链JS', rootOk,
  `index.html=${fs.existsSync(ROOT_INDEX)} live=${fs.existsSync(LIVE)} identical=${rootText === liveText} extScripts=${extScripts.length}`);

const archived = ['core.js', 'index_fiapp.html', 'build_fiapp.py', 'verify.js', 'snapshot.json'];
const archiveOk = fs.existsSync(ARCHIVE) && archived.every(f => fs.existsSync(path.join(ARCHIVE, f)));
const rootClean = !archived.some(f => fs.existsSync(path.join(HERE, f)));
rec(12, 'v2旧文件已归档且根目录清爽', archiveOk && rootClean,
  `archive=${archiveOk} rootClean=${rootClean}`);

const readme = fs.existsSync(README) ? fs.readFileSync(README, 'utf8') : '';
const lic = fs.existsSync(LICENSE) ? fs.readFileSync(LICENSE, 'utf8') : '';
const docsOk = /AlphaLens v[345]\./.test(readme) && /持仓穿透/.test(readme) && /四维/.test(readme) &&
  /GitHub Pages/.test(readme) && /archive\/v2/.test(readme) && /MIT License/.test(lic) && /Zen Ao/.test(lic);
rec(13, 'README 文档与MIT LICENSE齐全', docsOk,
  `readmeLen=${readme.length} licenseOk=${/MIT License/.test(lic)}`);

// ---- 断言 [17] 窗口一致性（analysis_data.json 静态硬校验）----
const rawData = fs.existsSync(DATA_FILE) ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) : {};
const assetEntries = Object.values(rawData.assets || {});
const closeLens = assetEntries.map(a => (a.closes || []).length);
const minCloseLen = closeLens.length ? Math.min(...closeLens) : 0;
const maxCloseLen = closeLens.length ? Math.max(...closeLens) : 0;
const endDates = new Set(assetEntries.map(a => (a.closes && a.closes.length) ? a.closes[a.closes.length - 1].t : ''));
const metaObj = rawData.meta || {};
const windowConsistencyOk =
  metaObj.priceAdjustMode === 'qfq' &&
  metaObj.fillCheckAdjustMode === 'raw' &&
  assetEntries.length === 36 &&
  minCloseLen >= 250 &&
  maxCloseLen - minCloseLen <= 60 &&
  endDates.size <= 2;
rec(17, '窗口一致性断言（统一前复权qfq，36标的无错位）', windowConsistencyOk,
  `adjust=${metaObj.priceAdjustMode}/${metaObj.fillCheckAdjustMode} assets=${assetEntries.length} closes=[${minCloseLen}..${maxCloseLen}] endDates=${Array.from(endDates).join(',')}`);

// ---- 阶段2：主单文件全功能浏览器探针 ----
const PROBE = String.raw`
<script>
window.__errs=[];
window.addEventListener('error',function(e){window.__errs.push(e.message)});
(function(){var oe=console.error;console.error=function(){window.__errs.push([].join.call(arguments,' '));oe.apply(console,arguments)}})();
window.addEventListener('load',function(){setTimeout(function(){
var R={errs:window.__errs};
try{
var A=window.AlphaLensAnalytics,D=window.ALPHALENS_DATA,V=window.ALPHALENS_V3;
R.hasData=!!D&&!!D.assets&&!!D.dividends;
R.hasAnalytics=!!A&&typeof A.penetratePortfolio==='function'&&typeof A.computeCorrelationMatrix==='function'&&typeof A.computePortfolioCurveAndDrawdown==='function'&&typeof A.evaluatePortfolioRisk==='function'&&typeof A.calcAfterTaxDividend==='function';
R.assets=Object.keys(D.assets||{}).length;
R.etfs=Object.values(D.assets||{}).filter(function(a){return a.type==='ETF'}).length;
R.divs=Object.keys(D.dividends||{}).length;
R.presets=(D.presets||[]).length;

// 5 套预设组合在近1年(250日)与近3年(全量)双窗口下无 NaN + 四维风险诊断
var presets=D.presets||[],summaries=[];
presets.forEach(function(p){
  var pen=A.penetratePortfolio(p.positions,D.assets);
  var codes=p.positions.map(function(x){return x.code});
  var corr1y=A.computeCorrelationMatrix(codes,D.assets,250);
  var curve1y=A.computePortfolioCurveAndDrawdown(p.positions,D.assets,250);
  var risk1y=A.evaluatePortfolioRisk(pen,corr1y,curve1y);
  var corr3y=A.computeCorrelationMatrix(codes,D.assets,null);
  var curve3y=A.computePortfolioCurveAndDrawdown(p.positions,D.assets,null);
  var risk3y=A.evaluatePortfolioRisk(pen,corr3y,curve3y);
  var flat=JSON.stringify({pen:pen,corr1y:corr1y,curve1y:curve1y,risk1y:risk1y,corr3y:corr3y,curve3y:curve3y,risk3y:risk3y});
  summaries.push({
    id:p.id,total:pen.totalAmount,covered:pen.coveredRatio,
    overlaps:pen.overlaps.length,
    overlapCodes:pen.overlaps.map(function(o){return o.code}),
    avgCorr1y:corr1y.avgOffDiagonal,sample1y:curve1y?curve1y.sampleDays:0,dateRange1y:curve1y?curve1y.dateRange:null,
    mdd1y:curve1y?curve1y.maxDrawdown:null,vol1y:curve1y?curve1y.annualizedVol:null,
    avgCorr3y:corr3y.avgOffDiagonal,sample3y:curve3y?curve3y.sampleDays:0,dateRange3y:curve3y?curve3y.dateRange:null,
    mdd3y:curve3y?curve3y.maxDrawdown:null,vol3y:curve3y?curve3y.annualizedVol:null,
    risk1y:risk1y,risk3y:risk3y,
    hasNaN:/NaN|Infinity/.test(flat)
  });
});
R.summaries=summaries;

// 回测窗口切换测试（默认 250 -> 切 all -> 切回 250）
var metaBefore=document.getElementById('nav-meta').textContent;
var btn3y=document.querySelector('#window-seg button[data-window=all]');
if(btn3y)btn3y.click();
var meta3y=document.getElementById('nav-meta').textContent;
var btn1y=document.querySelector('#window-seg button[data-window="250"]');
if(btn1y)btn1y.click();
R.windowSwitch={
  changed:metaBefore!==meta3y,
  hasQfq:/前复权/.test(metaBefore)&&/前复权/.test(meta3y),
  hasRange:/\d{4}-\d{2}-\d{2}\s*~\s*\d{4}-\d{2}-\d{2}/.test(metaBefore)
};

// 四维风险 DOM 渲染
R.riskCards=document.querySelectorAll('#risk-dims .risk-card').length;
R.corrSvg=document.querySelectorAll('#corr-chart svg').length;
R.navSvg=document.querySelectorAll('#nav-chart svg').length;
R.exposureRows=document.querySelectorAll('#exposure-list .exp-row').length;

// 报告导出校验
R.hasV3Api=!!V&&typeof V.buildCheckupMarkdown==='function';
if(V){
  var chk=V.currentCheckup();
  var md=chk.md;
  R.md={
    len:md.length,
    total:md.indexOf('组合总金额')>=0,
    mdd:md.indexOf('历史最大回撤')>=0,
    risk4:md.indexOf('四维独立风险诊断')>=0,
    top:md.indexOf('底层重仓股穿透 Top 10')>=0,
    disclaimer:md.indexOf('不构成投资建议')>=0,
    bad:/undefined|NaN/.test(md)
  };

  // [20] 交互与持久化断言1：添加新持仓立即写入 localStorage
  localStorage.removeItem('alphalens_v3_state');
  var sel=document.getElementById('asset-select');
  sel.value='513100';
  document.getElementById('amount-input').value='25000';
  document.getElementById('add-btn').click();
  var storedAfterAdd=JSON.parse(localStorage.getItem('alphalens_v3_state')||'{}');
  var addedFound=!!(storedAfterAdd.positions&&storedAfterAdd.positions.some(function(p){return p.code==='513100'&&Number(p.amount)>=25000}));

  // [20] 交互与持久化断言2：编辑金额时 input 保持焦点不失焦且占比就地更新
  var firstInp=document.querySelector('#pos-list input[data-idx="0"]');
  var firstWeight=document.querySelector('#pos-list .pos-weight[data-idx="0"]');
  var weightBefore=firstWeight?firstWeight.textContent:'';
  var focusKept=false,weightChanged=false,savedAfterEdit=false;
  if(firstInp){
    firstInp.focus();
    firstInp.value='88000';
    firstInp.dispatchEvent(new Event('input',{bubbles:true}));
    focusKept=(document.activeElement===firstInp);
    weightChanged=(firstWeight&&firstWeight.textContent!==weightBefore);
    var storedAfterEdit=JSON.parse(localStorage.getItem('alphalens_v3_state')||'{}');
    savedAfterEdit=!!(storedAfterEdit.positions&&storedAfterEdit.positions[0].amount===88000);
  }
  R.interact={addedFound:addedFound,focusKept:focusKept,weightChanged:weightChanged,savedAfterEdit:savedAfterEdit};

  // [22] 总金额双向调节与一键平均分断言（先重置回默认 40k/30k/30k）
  document.getElementById('reset-btn').click();
  var totInp=document.getElementById('total-amount-input');
  var totFocusKept=false,totScaled=false,totSaved=false,eqOk=false;
  if(totInp){
    totInp.focus();
    totInp.value='200000';
    totInp.dispatchEvent(new Event('input',{bubbles:true}));
    totFocusKept=(document.activeElement===totInp);
    var sumAfterScale=V.state.positions.reduce(function(s,p){return s+p.amount},0);
    totScaled=(sumAfterScale===200000&&V.state.positions[0].amount===80000);
    var stTot=JSON.parse(localStorage.getItem('alphalens_v3_state')||'{}');
    totSaved=(stTot.positions&&stTot.positions.reduce(function(s,p){return s+p.amount},0)===200000);
  }
  var eqBtn=document.getElementById('equal-weight-btn');
  if(eqBtn)eqBtn.click();
  var psEq=V.state.positions.map(function(p){return p.amount});
  eqOk=psEq.length===3&&Math.max.apply(null,psEq)-Math.min.apply(null,psEq)<=2;
  R.capitalInteract={totFocusKept:totFocusKept,totScaled:totScaled,totSaved:totSaved,eqOk:eqOk};

  // 重置默认与清理 localStorage
  document.getElementById('reset-btn').click();
  R.persist={
    saved:addedFound&&savedAfterEdit,
    hasTab:!!storedAfterAdd.activeTab,
    reset:V.state.positions[0].amount===40000&&V.state.positions.length===3,
    cleared:!localStorage.getItem('alphalens_v3_state')
  };
}

// [23] 一句话总结 + 流向连线图 + 单只 ETF 持仓展开 + 第三层折叠验证
var advPanel=document.getElementById('adv-panel');
var advDefaultClosed=!!(advPanel&&!advPanel.open);
var flowNodes=document.querySelectorAll('#flow-chart .flow-node');
var flowEdges=document.querySelectorAll('#flow-chart .flow-edge').length;
var firstFlow=flowNodes[0];
if(firstFlow)firstFlow.dispatchEvent(new MouseEvent('click',{bubbles:true}));
var flowFocused=!!(V&&V.state&&V.state.flowFocus);
var flowReset=document.getElementById('flow-reset-btn');
if(flowReset)flowReset.click();
var drillTabs=document.querySelectorAll('#drill-tabs .drill-tab');
if(drillTabs[1])drillTabs[1].click();
var drillItems=document.querySelectorAll('#etf-drilldown .drill-item').length;
var drillHasYuan=/¥[\d,]+/.test((document.getElementById('etf-drilldown')||{}).textContent||'');
var plainOk=!!(document.getElementById('pb-title')&&document.getElementById('pb-title').textContent.length>10);
var aiLines=document.querySelectorAll('#ai-terminal-log .ai-line').length;
var hasSpectrum=!!document.getElementById('sp-marker');
var stageCanvas=document.getElementById('stage-3d-canvas');
var surfCanvas=document.getElementById('surface-3d-canvas');
var drillBox=document.getElementById('drill-card');
var verdictBox=document.getElementById('verdict-card');
var splitBottomDiff=(drillBox&&verdictBox)?Math.abs(drillBox.getBoundingClientRect().bottom-verdictBox.getBoundingClientRect().bottom):999;
var pbBadgeTxt=(document.getElementById('pb-badge')||{}).textContent||'';
var aiLogTxt=(document.getElementById('ai-terminal-log')||{}).textContent||'';
var bodyTxt=document.body.innerText||'';
var noEmojiInNarrator=!/[\u{1F300}-\u{1FAFF}\u{26A0}\u{1F4CA}]/u.test(pbBadgeTxt+aiLogTxt);
var noArchaicCopy=!/观澜|叠嶂|定盘|尺牍|遣入|麾下|璇玑/.test(bodyTxt);

// [26] v4.1 交互工具链与回归实测：3D/2D 切换 + 3D 卡片精准点击 + ⌘K 搜索加仓与关闭失焦 + 删除撤销 Toast + 静谧模式 + 重置解绑
var btn2d=document.querySelector('#stage-mode-seg button[data-smode="2d"]');
var btn3d=document.querySelector('#stage-mode-seg button[data-smode="3d"]');
if(btn2d)btn2d.click();
var mode2dOk=!!document.querySelector('#flow-chart .flow-2d-svg')&&document.querySelectorAll('#flow-chart .flow-node').length>=5;
if(btn3d)btn3d.click();
var mode3dBackOk=!!document.getElementById('stage-3d-canvas');

// 实测 3D 右侧卡片真实坐标点击：必须命中对应股票而非被透明 SVG 劫持，且 #flow-hint 显示中文名
var cardClickOk=false;
var overlaySvg=document.querySelector('#flow-chart .stage-3d-overlay');
var overlayNoPtr=!!(overlaySvg&&getComputedStyle(overlaySvg).pointerEvents==='none');
var stageWrap=document.getElementById('flow-chart');
var stageCvs=document.getElementById('stage-3d-canvas');
var hbs=(window.AlphaLensAnalytics&&window.AlphaLensAnalytics.getStage3DHitBoxes)?window.AlphaLensAnalytics.getStage3DHitBoxes():[];
var targetCard=hbs.find(function(h){return h.kind==='stock-card'&&h.code==='603259';})||hbs.find(function(h){return h.kind==='stock-card';});
if(overlayNoPtr&&stageWrap&&stageCvs&&targetCard){
  var sr=stageWrap.getBoundingClientRect();
  stageCvs.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:sr.left+targetCard.x+targetCard.w/2,clientY:sr.top+targetCard.y+targetCard.h/2}));
  var hintAfterClick=(document.getElementById('flow-hint')||{}).textContent||'';
  cardClickOk=(V.state.flowFocus===targetCard.code)&&hintAfterClick.indexOf(targetCard.title)>=0;
  var frBtn=document.getElementById('flow-reset-btn');
  if(frBtn)frBtn.click();
}

var cmdOpenBtn=document.getElementById('cmd-open-btn');
if(cmdOpenBtn)cmdOpenBtn.click();
var cmdBackdrop=document.getElementById('cmd-backdrop');
var cmdIsOpen=cmdBackdrop.className.indexOf('open')>=0;
var cmdInp=document.getElementById('cmd-input');
if(cmdInp){cmdInp.focus();cmdInp.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));}
var cmdBlurOk=(document.activeElement!==cmdInp)&&(getComputedStyle(cmdBackdrop).visibility==='hidden');
if(cmdOpenBtn)cmdOpenBtn.click();
if(cmdInp){cmdInp.value='518880';cmdInp.dispatchEvent(new Event('input',{bubbles:true}));}
var cmdAddBtn=document.querySelector('#cmd-results button[data-cact="add"]');
if(cmdAddBtn)cmdAddBtn.click();
var cmdAddedGold=!!(V&&V.state&&V.state.positions.some(function(p){return p.code==='518880';}));

var cntBeforeDel=V.state.positions.length;
var delBtns=document.querySelectorAll('#pos-list button.del');
if(delBtns.length)delBtns[delBtns.length-1].click();
var cntAfterDel=V.state.positions.length;
var toastUndo=document.getElementById('toast-act-btn');
if(toastUndo)toastUndo.click();
var cntAfterUndo=V.state.positions.length;
var undoOk=(cntAfterDel===cntBeforeDel-1)&&(cntAfterUndo===cntBeforeDel);

var motBtn=document.getElementById('motion-btn');
if(motBtn)motBtn.click();
var quietOn=document.documentElement.getAttribute('data-motion')==='off';
if(motBtn)motBtn.click();

// 实测风险三维坐标系放大检视弹窗（打开 + 4项实时坐标卡 + 大画布渲染 + 关闭隐藏）
var surfExpandBtn=document.getElementById('surf-expand-btn');
var surfModalBg=document.getElementById('surface-modal-backdrop');
var surfModalOk=false;
if(surfExpandBtn&&surfModalBg){
  surfExpandBtn.click();
  var smOpen=surfModalBg.className.indexOf('open')>=0;
  var smCvs=document.getElementById('surface-modal-canvas');
  var smCards=document.querySelectorAll('#sm-metrics .sm-mcard').length;
  var smClose=document.getElementById('sm-close-btn');
  if(smClose)smClose.click();
  var smClosedHidden=getComputedStyle(surfModalBg).visibility==='hidden';
  surfModalOk=smOpen&&!!(smCvs&&smCvs.width>=500&&smCvs.height>=300)&&smCards===4&&smClosedHidden;
}

// 清理回默认组合并校验 reset 清空 stageModePinned
document.getElementById('reset-btn').click();
var resetUnpinOk=(V.state.stageModePinned===false);

R.vizV32={
  plainOk:plainOk&&aiLines===3&&hasSpectrum,
  advDefaultClosed:advDefaultClosed,
  flowNodes:flowNodes.length,
  flowEdges:flowEdges,
  flowFocused:flowFocused,
  drillTabs:drillTabs.length,
  drillItems:drillItems,
  drillHasYuan:drillHasYuan,
  aiLines:aiLines,
  stage3dOk:!!(stageCanvas&&stageCanvas.width>=600&&stageCanvas.height>=200),
  surf3dOk:!!(surfCanvas&&surfCanvas.width>=200&&surfCanvas.height>=150),
  zeroVoidEqualHeight:splitBottomDiff<=2,
  cleanCopyOk:/总览/.test(aiLogTxt)&&/重合/.test(aiLogTxt)&&/建议/.test(aiLogTxt)&&noEmojiInNarrator&&noArchaicCopy
};

R.brand=document.body.textContent.indexOf('Zen Ao')>=0&&/v3\.[123]/.test(document.body.textContent);
R.exportBtns=document.querySelectorAll('.report-btn').length;

// Tab2：15 只高股息股 + 填权样本格式 + 红利税更名与财税101号文 + 行业筛选 + 一键加入组合
var divTab=document.querySelector('.main-tabs button[data-main=div]');
if(divTab)divTab.click();
R.divViewOn=document.getElementById('view-div').className.indexOf('on')>=0;
R.divRows=document.querySelectorAll('#div-body tr').length;
R.divBadges=document.querySelectorAll('#div-body .badge').length;
var divTableText=document.getElementById('div-body').textContent;
R.fillSampleFmt=/已填\s*\d+\s*\/\s*未填\s*\d+/.test(divTableText);
var divSectionText=document.getElementById('view-div').textContent;
R.taxRenameOk=divSectionText.indexOf('历史股息税后收益情景测算')>=0&&divSectionText.indexOf('101 号文')>=0;

var divFirstSelOk=!!document.querySelector('#div-body tr.sel');
var catBtns=document.querySelectorAll('#div-cat-chips button[data-dcat]');
var catFiltered=false;
if(catBtns.length>=2){
  catBtns[1].click();
  catFiltered=document.querySelectorAll('#div-body tr').length<15&&document.querySelectorAll('#div-body tr').length>=1&&!!document.querySelector('#div-body tr.sel');
  catBtns[0].click();
}
var divAddBtn=document.getElementById('div-add-port-btn');
var posBeforeDivAdd=V.state.positions.length;
if(divAddBtn)divAddBtn.click();
var divAddOk=V.state.positions.length>=posBeforeDivAdd&&(document.getElementById('app-toast').className.indexOf('show')>=0);
document.getElementById('reset-btn').click();
if(divTab)divTab.click();

R.v41Ux={
  mode2dOk:mode2dOk,
  mode3dBackOk:mode3dBackOk,
  cardClickOk:cardClickOk,
  cmdIsOpen:cmdIsOpen,
  cmdBlurOk:cmdBlurOk,
  cmdAddedGold:cmdAddedGold,
  undoOk:undoOk,
  quietOn:quietOn,
  surfModalOk:surfModalOk,
  resetUnpinOk:resetUnpinOk,
  divFirstSelOk:divFirstSelOk,
  catFiltered:catFiltered,
  divAddOk:divAddOk
};

var before=document.getElementById('tax-result').textContent;
var b2=document.querySelector('#period-seg button[data-period=lt_1m]');if(b2)b2.click();
var after=document.getElementById('tax-result').textContent;
R.taxChanges=before!==after;
R.taxHasNaN=/NaN|Infinity/.test(after);
var bench=document.getElementById('benchmark');bench.value='4';bench.dispatchEvent(new Event('input',{bubbles:true}));
R.benchChanges=document.getElementById('tax-result').textContent!==after;
}catch(e){R.fatal=e.message+' @ '+(e.stack||'').split('\n')[1]}
var d=document.createElement('div');d.id='__VR';d.style.display='none';d.textContent=JSON.stringify(R);document.body.appendChild(d);
},2500);});
</script>`;

if (!fs.existsSync(LIVE)) { console.error('MISSING ' + LIVE); process.exit(1); }
const tmp = path.join(HERE, '__v3_probe.html');
let R;
try {
  fs.writeFileSync(tmp, liveText.replace('</body>', PROBE + '</body>'));
  const dom = chromeDom(tmp);
  const m = dom.match(/<div id="__VR"[^>]*>([\s\S]*?)<\/div>/);
  try { R = decodeHtmlJson(m ? m[1] : '{}'); }
  catch (e) { R = { fatal: 'parse: ' + e.message }; }
} finally {
  fs.rmSync(tmp, { force: true });
}
fs.writeFileSync(OUT, JSON.stringify(R, null, 2));

rec(1, '零运行时错误 / 数据与五函数引擎完整',
  (R.errs || []).length === 0 && R.hasData === true && R.hasAnalytics === true,
  `errs=${(R.errs || []).length} data=${R.hasData} analytics=${R.hasAnalytics} fatal=${R.fatal || 'none'}`);

rec(2, '36标的（21 ETF + 15个股）+ 15分红 + 5预设',
  R.assets === 36 && R.etfs === 21 && R.divs === 15 && R.presets === 5,
  `assets=${R.assets} etfs=${R.etfs} divs=${R.divs} presets=${R.presets}`);

const sums = R.summaries || [];
rec(3, '5套预设双窗口（1年/3年）全量计算无NaN/Infinity',
  sums.length === 5 && sums.every(s => !s.hasNaN && s.total > 0 && s.sample1y >= 200 && s.sample3y >= 600),
  sums.map(s => `${s.id}(1y:${s.sample1y}d,3y:${s.sample3y}d):${s.hasNaN ? 'NaN' : 'ok'}`).join(' '));

const fake = sums.find(s => s.id === 'fake_diversification');
const bal = sums.find(s => s.id === 'balanced_contrast');
rec(4, '假分散vs均衡对照有显著区分',
  !!(fake && bal && fake.overlaps >= 4 && bal.overlaps === 0 && Math.abs((fake.avgCorr3y || 0) - (bal.avgCorr3y || 0)) > 0.15),
  `fake(overlap=${fake && fake.overlaps},corr3y=${fake && fake.avgCorr3y?.toFixed(2)}) bal(overlap=${bal && bal.overlaps},corr3y=${bal && bal.avgCorr3y?.toFixed(2)})`);

rec(5, 'Tab2 15股齐全 + 填权样本透明 + 财税101号文 + SVG渲染',
  R.divRows === 15 && R.divBadges === 15 && R.fillSampleFmt === true && R.taxRenameOk === true &&
  R.corrSvg >= 1 && R.navSvg >= 1 && R.exposureRows > 0 && R.riskCards === 4,
  `rows=${R.divRows} fillFmt=${R.fillSampleFmt} taxRename=${R.taxRenameOk} riskCards=${R.riskCards} corrSVG=${R.corrSvg} navSVG=${R.navSvg}`);

rec(6, '税率/基准与回测窗口切换实时更新且无NaN',
  R.taxChanges === true && R.benchChanges === true && R.taxHasNaN === false &&
  R.windowSwitch && R.windowSwitch.changed && R.windowSwitch.hasQfq && R.windowSwitch.hasRange,
  `tax=${R.taxChanges} bench=${R.benchChanges} winSwitch=${R.windowSwitch && R.windowSwitch.changed} qfq=${R.windowSwitch && R.windowSwitch.hasQfq}`);

// ---- [7] 断网 6 秒降级 SNAPSHOT（stub 内联 live.js）----
const offlineFile = path.join(HERE, '__v3_offline.html');
let O = {};
try {
  const stubbed = liveText.replace(
    /<script data-inline="live\.js">[\s\S]*?<\/script>/,
    '<script data-inline="live.js">window.AlphaLive={start:function(){},status:function(){return{state:"SNAPSHOT",stamp:"",count:0,lastCount:0,total:36}}};</script>'
  ).replace(
    '</body>',
    '<div id="__OFF" style="display:none"></div><script>setTimeout(function(){var t=document.querySelector(".main-tabs button[data-main=div]");if(t)t.click();document.getElementById("__OFF").textContent=JSON.stringify({label:document.getElementById("live-label").textContent,svg:document.querySelectorAll("#corr-chart svg").length,rows:document.querySelectorAll("#div-body tr").length,snaps:document.querySelectorAll("#div-body .snap-tag").length,tax:document.getElementById("tax-result").textContent.length})},6800)</script></body>'
  );
  fs.writeFileSync(offlineFile, stubbed);
  const odom = chromeDom(offlineFile, ['--virtual-time-budget=9500']);
  const om = odom.match(/<div id="__OFF"[^>]*>([\s\S]*?)<\/div>/);
  try { O = decodeHtmlJson(om ? om[1] : '{}'); } catch (_) {}
} finally {
  fs.rmSync(offlineFile, { force: true });
}
rec(7, '断网6秒降级SNAPSHOT且表格标注快照与图表可用',
  /SNAPSHOT/.test(O.label || '') && (O.svg || 0) >= 1 && (O.rows || 0) === 15 && (O.snaps || 0) === 15 && (O.tax || 0) > 10,
  `label=${O.label} svg=${O.svg} rows=${O.rows} snapTags=${O.snaps} taxLen=${O.tax}`);

// ---- 阶段2 报告/持久化/标识断言 ----
const md = R.md || {}, ps = R.persist || {};
rec(14, '报告导出完整（含四维诊断/总金额/MDD/Top10/免责）无NaN',
  R.hasV3Api === true && md.len > 600 && md.total && md.mdd && md.risk4 && md.top && md.disclaimer && !md.bad,
  `len=${md.len} risk4=${md.risk4} MDD=${md.mdd} Top10=${md.top} bad=${md.bad}`);

rec(15, 'localStorage持久化与重置默认',
  ps.saved === true && ps.hasTab === true && ps.reset === true && ps.cleared === true,
  `saved=${ps.saved} tab=${ps.hasTab} reset=${ps.reset} cleared=${ps.cleared}`);

rec(16, 'v3.2个人标识与导出按钮',
  R.brand === true && (R.exportBtns || 0) >= 3,
  `brand=${R.brand} exportBtns=${R.exportBtns}`);

// ---- [18] 美股重仓归一化断言 ----
const usTech = sums.find(s => s.id === 'us_tech_fake_div');
const usCodes = (usTech && usTech.overlapCodes) || [];
const hasUsCore = ['US:NVDA', 'US:AAPL', 'US:MSFT'].every(c => usCodes.includes(c));
rec(18, '美股重仓归一化断言（us_tech_fake_div重合>=3且识别US:NVDA/AAPL/MSFT）',
  !!(usTech && usTech.overlaps >= 3 && hasUsCore),
  `overlaps=${usTech && usTech.overlaps} top=${usCodes.slice(0, 6).join(',')}`);

// ---- [19] 四维风险区分度断言 ----
const globalLow = sums.find(s => s.id === 'global_low_corr');
const divInc = sums.find(s => s.id === 'dividend_income');
const allLevels = new Set();
sums.forEach(s => {
  if (!s.risk1y) return;
  Object.values(s.risk1y).forEach(d => allLevels.add(d.level));
});
const notAllHigh = sums.every(s => s.risk1y && !Object.values(s.risk1y).every(d => d.level === 'HIGH'));
const riskDiffOk = !!(
  notAllHigh &&
  globalLow && globalLow.risk1y.correlation.level === 'LOW' &&
  usTech && usTech.risk1y.overlap.level === 'HIGH' && usTech.risk1y.correlation.level === 'HIGH' &&
  divInc && divInc.risk3y.drawdownVol.level !== 'HIGH' &&
  Math.abs(divInc.mdd3y) < Math.abs(usTech.mdd3y) &&
  allLevels.has('LOW') && allLevels.has('MEDIUM') && allLevels.has('HIGH')
);
rec(19, '四维风险区分度断言（告别一刀切标红）', riskDiffOk,
  `globalLow.corr=${globalLow && globalLow.risk1y.correlation.level} usTech.overlap=${usTech && usTech.risk1y.overlap.level} divInc.mdd3y=${divInc && (divInc.mdd3y * 100).toFixed(1)}% vs usTech.mdd3y=${usTech && (usTech.mdd3y * 100).toFixed(1)}%`);

// ---- [20] 交互与持久化断言（新增即存 + 编辑金额不失焦）----
const ix = R.interact || {};
rec(20, '交互与持久化断言（新增即存localStorage + 修改金额输入框保焦）',
  ix.addedFound === true && ix.focusKept === true && ix.weightChanged === true && ix.savedAfterEdit === true,
  `addedSaved=${ix.addedFound} focusKept=${ix.focusKept} weightInPlace=${ix.weightChanged} editSaved=${ix.savedAfterEdit}`);

// ---- [22] 总金额双向缩放与一键平均分断言 ----
const cap = R.capitalInteract || {};
rec(22, '总金额双向缩放保焦 + 一键平均分断言',
  cap.totFocusKept === true && cap.totScaled === true && cap.totSaved === true && cap.eqOk === true,
  `totFocus=${cap.totFocusKept} scaled=${cap.totScaled} saved=${cap.totSaved} equalized=${cap.eqOk}`);

// ---- [23] 一句话诊断 + 基金->股票连线流向图 + 单基金透视 + 第三层默认收起断言 ----
const vz = R.vizV32 || {};
rec(23, '流向连线图 + 单只ETF持仓展开 + 三层递进默认收起断言',
  vz.plainOk === true && vz.advDefaultClosed === true && vz.flowNodes >= 5 && vz.flowEdges >= 5 &&
  vz.flowFocused === true && vz.drillTabs === 3 && vz.drillItems >= 5 && vz.drillHasYuan === true,
  `plain=${vz.plainOk} advClosed=${vz.advDefaultClosed} flow=${vz.flowNodes}n/${vz.flowEdges}e focus=${vz.flowFocused} drill=${vz.drillItems}i`);

rec(25, '双真3D透视Canvas引擎 + 四象限零空洞等高对齐 + 全站极简白话无古风词/无Emoji断言',
  vz.stage3dOk === true && vz.surf3dOk === true && vz.zeroVoidEqualHeight === true && vz.cleanCopyOk === true,
  `stage3d=${vz.stage3dOk} surf3d=${vz.surf3dOk} equalHeight=${vz.zeroVoidEqualHeight} cleanCopy=${vz.cleanCopyOk}`);

const ux = R.v41Ux || {};
rec(26, 'v4.1流畅交互工具链（3D/2D切换 + 3D卡片精准点击 + 三维坐标系弹窗 + ⌘K失焦加仓 + 撤销Toast + 静谧模式 + 高股息入组）',
  ux.mode2dOk === true && ux.mode3dBackOk === true && ux.cardClickOk === true && ux.surfModalOk === true &&
  ux.cmdIsOpen === true && ux.cmdBlurOk === true && ux.cmdAddedGold === true && ux.undoOk === true &&
  ux.quietOn === true && ux.resetUnpinOk === true && ux.divFirstSelOk === true && ux.catFiltered === true && ux.divAddOk === true,
  `2d=${ux.mode2dOk} 3d=${ux.mode3dBackOk} cardClick=${ux.cardClickOk} surfModal=${ux.surfModalOk} cmd=${ux.cmdIsOpen}/${ux.cmdBlurOk}/${ux.cmdAddedGold} undo=${ux.undoOk} quiet=${ux.quietOn} unpin=${ux.resetUnpinOk} divSel=${ux.divFirstSelOk} divFilter=${ux.catFiltered} divAdd=${ux.divAddOk}`);

// ---- [21] 孤立单文件验收（仅拷贝 index.html 至系统临时目录单独加载）----
const isoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphalens_isolated_'));
const isoFile = path.join(isoDir, 'index.html');
let ISO = {};
try {
  const isoProbe = String.raw`
<script>
window.__isoErrs=[];
window.addEventListener('error',function(e){window.__isoErrs.push(e.message)});
(function(){var oe=console.error;console.error=function(){window.__isoErrs.push([].join.call(arguments,' '));oe.apply(console,arguments)}})();
window.addEventListener('load',function(){setTimeout(function(){
  var R={errs:window.__isoErrs,extScripts:document.querySelectorAll('script[src]').length};
  try{
    R.hasData=!!window.ALPHALENS_DATA;
    R.hasAnalytics=!!window.AlphaLensAnalytics;
    R.assets=Object.keys((window.ALPHALENS_DATA&&window.ALPHALENS_DATA.assets)||{}).length;
    R.flowSvg=document.querySelectorAll('#flow-chart svg').length;
    R.corrSvg=document.querySelectorAll('#corr-chart svg').length;
    R.navSvg=document.querySelectorAll('#nav-chart svg').length;
    R.riskCards=document.querySelectorAll('#risk-dims .risk-card').length;
    R.expRows=document.querySelectorAll('#exposure-list .exp-row').length;
    var md=window.ALPHALENS_V3?window.ALPHALENS_V3.currentCheckup().md:'';
    R.mdOk=md.length>500&&!/undefined|NaN/.test(md);
    var t=document.querySelector('.main-tabs button[data-main=div]');if(t)t.click();
    R.divRows=document.querySelectorAll('#div-body tr').length;
    R.divSvg=document.querySelectorAll('#div-chart svg').length;
  }catch(e){R.fatal=e.message}
  var d=document.createElement('div');d.id='__ISO';d.style.display='none';d.textContent=JSON.stringify(R);document.body.appendChild(d);
},2200);});
</script>`;
  fs.writeFileSync(isoFile, rootText.replace('</body>', isoProbe + '</body>'));
  const idom = chromeDom(isoFile);
  const im = idom.match(/<div id="__ISO"[^>]*>([\s\S]*?)<\/div>/);
  try { ISO = decodeHtmlJson(im ? im[1] : '{}'); } catch (e) { ISO = { fatal: e.message }; }
} finally {
  fs.rmSync(isoDir, { recursive: true, force: true });
}
const isoOk = (ISO.errs || []).length === 0 && ISO.extScripts === 0 && ISO.hasData && ISO.hasAnalytics &&
  ISO.assets === 36 && ISO.flowSvg >= 1 && ISO.corrSvg >= 1 && ISO.navSvg >= 1 && ISO.riskCards === 4 &&
  ISO.expRows > 0 && ISO.divRows === 15 && ISO.divSvg >= 1 && ISO.mdOk === true && !ISO.fatal;
rec(21, '孤立单文件验收（拷贝至临时目录零外部文件独立加载）', isoOk,
  `errs=${(ISO.errs || []).length} extSrc=${ISO.extScripts} assets=${ISO.assets} svgs=${ISO.flowSvg}/${ISO.corrSvg}/${ISO.navSvg}/${ISO.divSvg} riskCards=${ISO.riskCards} mdOk=${ISO.mdOk}`);

// ---- [24] 手机端窄屏响应式无横向溢出 + 横滑胶囊 + 底部毛玻璃Dock与上拉抽屉断言 ----
const mobFile = path.join(HERE, '__v3_mobile.html');
let MOB = {};
try {
  const mobProbe = String.raw`
<script>
window.addEventListener('load',function(){setTimeout(function(){
  var plist=document.getElementById('preset-list');
  var cs=plist?getComputedStyle(plist):null;
  var presetFlexDir=cs?cs.flexDirection:'';
  var presetScrollW=plist?plist.scrollWidth:0;
  var presetClientW=plist?plist.clientWidth:0;
  var flowSvg=document.querySelectorAll('#flow-chart svg').length;
  var p1=document.documentElement.scrollWidth<=window.innerWidth;
  var dock=document.getElementById('mobile-dock');
  var dockVisible=!!(dock&&getComputedStyle(dock).display==='grid');
  var sheetDockBtn=document.querySelector('#mobile-dock button[data-dock="sheet"]');
  if(sheetDockBtn)sheetDockBtn.click();
  var sheetOpened=document.getElementById('mobile-sheet-backdrop').className.indexOf('open')>=0;
  var sheetRowsBefore=document.querySelectorAll('#sheet-body input[data-sidx]').length;
  var sheetDelBtn=document.querySelector('#sheet-body button[data-sdel]');
  if(sheetDelBtn)sheetDelBtn.click();
  var sheetRowsAfterDel=document.querySelectorAll('#sheet-body input[data-sidx]').length;
  var toastAct=document.getElementById('toast-act-btn');
  if(toastAct)toastAct.click();
  var sheetRowsAfterUndo=document.querySelectorAll('#sheet-body input[data-sidx]').length;
  var sheetUndoSyncOk=(sheetRowsBefore>=2)&&(sheetRowsAfterDel===sheetRowsBefore-1)&&(sheetRowsAfterUndo===sheetRowsBefore);
  var sheetClose=document.getElementById('sheet-close-btn');
  if(sheetClose)sheetClose.click();
  var divBtn=document.querySelector('#mobile-dock button[data-dock="div"]');
  if(divBtn)divBtn.click();
  var p2=document.documentElement.scrollWidth<=window.innerWidth;
  var R={
    vw:window.innerWidth,
    swPen:document.documentElement.scrollWidth,
    noOverflowPen:p1,
    noOverflowDiv:p2,
    presetFlexDir:presetFlexDir,
    presetScrollW:presetScrollW,
    presetClientW:presetClientW,
    flowSvg:flowSvg,
    dockVisible:dockVisible,
    sheetOpened:sheetOpened,
    sheetUndoSyncOk:sheetUndoSyncOk
  };
  var d=document.createElement('div');d.id='__MOB';d.style.display='none';d.textContent=JSON.stringify(R);document.body.appendChild(d);
},1800);});
</script>`;
  fs.writeFileSync(mobFile, rootText.replace('</body>', mobProbe + '</body>'));
  const mdom = chromeDom(mobFile, ['--window-size=390,844']);
  const mm = mdom.match(/<div id="__MOB"[^>]*>([\s\S]*?)<\/div>/);
  try { MOB = decodeHtmlJson(mm ? mm[1] : '{}'); } catch (e) { MOB = { fatal: e.message }; }
} finally {
  fs.rmSync(mobFile, { force: true });
}
rec(24, '手机端（窄屏）零横向溢出 + 横滑胶囊 + 底部Dock与上拉调仓抽屉撤销同步断言',
  MOB.noOverflowPen === true && MOB.noOverflowDiv === true && MOB.presetFlexDir === 'row' &&
  MOB.presetScrollW > MOB.presetClientW && MOB.flowSvg >= 1 && MOB.dockVisible === true &&
  MOB.sheetOpened === true && MOB.sheetUndoSyncOk === true,
  `vw=${MOB.vw} overflowPen=${!MOB.noOverflowPen} overflowDiv=${!MOB.noOverflowDiv} presetDir=${MOB.presetFlexDir} scrollW=${MOB.presetScrollW}/${MOB.presetClientW} dock=${MOB.dockVisible} sheet=${MOB.sheetOpened} sheetUndo=${MOB.sheetUndoSyncOk}`);

// ---- [27-33] AlphaLens v5.0 毕业设计量化闭环、答辩弹层、交互图表与 P1 接口全量验收 ----
const v5File = path.join(HERE, '__v5_probe.html');
let V5 = {};
try {
  const v5Probe = String.raw`
<script>
window.addEventListener('load',function(){setTimeout(function(){
  var R={errs:[]};
  window.addEventListener('error',function(e){R.errs.push(e.message);});
  try{
    var AZ=window.AlphaLensAnalytics,DATA=window.ALPHALENS_DATA,V3=window.ALPHALENS_V3;
    var A=DATA.assets||{};
    var fakePos=(DATA.presets[0]&&DATA.presets[0].positions)||[];
    // 27: Advanced quant metrics
    var pen=AZ.penetratePortfolio(fakePos,A);
    var corr=AZ.computeCorrelationMatrix(fakePos.map(function(p){return p.code;}),A,250);
    var curve=AZ.computePortfolioCurveAndDrawdown(fakePos,A,250);
    var bench=AZ.computePortfolioCurveAndDrawdown([{code:'510300',amount:10000}],A,250);
    var qm=AZ.computeAdvancedQuantMetrics(pen,corr,curve,bench);
    R.quantOk=!!(qm&&isFinite(qm.cagr)&&isFinite(qm.sharpe)&&isFinite(qm.calmar)&&qm.hhi>0&&qm.hhi<=1&&qm.effectiveN>=1&&qm.benchAligned&&qm.benchAligned.points.length>10);
    R.quantChips=document.querySelectorAll('#quant-strip .q-chip').length;

    // 28: Dual-mode optimizer strictly lowers risk & overlap on fake diversification
    var optW=AZ.optimizePortfolio(fakePos,A,250,'weights_only');
    var optD=AZ.optimizePortfolio(fakePos,A,250,'diversify_add');
    R.optWeightsOk=!!(optW&&optW.suggestedPositions.length===fakePos.length&&optW.rationale.length>=1);
    R.optDivOk=!!(optD&&optD.after.riskScore<optD.before.riskScore&&optD.after.overlapCount<optD.before.overlapCount);
    R.optRiskBefore=optD?optD.before.riskScore:null;
    R.optRiskAfter=optD?optD.after.riskScore:null;

    // 29: Optimizer modal open -> Apply -> Undo
    var posBeforeJson=JSON.stringify(V3.state.positions);
    document.getElementById('opt-open-btn').click();
    R.optModalOpen=document.getElementById('opt-modal-backdrop').className.indexOf('open')>=0;
    R.optCards=document.querySelectorAll('#opt-metrics-grid .opt-mcard').length;
    document.getElementById('opt-apply-btn').click();
    var posAfterApply=JSON.stringify(V3.state.positions);
    var undoBtn=document.getElementById('toast-act-btn');
    if(undoBtn)undoBtn.click();
    var posAfterUndo=JSON.stringify(V3.state.positions);
    R.optApplyUndoOk=(posAfterApply!==posBeforeJson)&&(posAfterUndo===posBeforeJson);

    // 30: A/B Comparison Lab
    document.getElementById('cmp-open-btn').click();
    R.cmpModalOpen=document.getElementById('cmp-modal-backdrop').className.indexOf('open')>=0;
    R.cmpSvgCount=document.querySelectorAll('#cmp-chart-box svg.cmp-nav-svg').length;
    R.cmpRows=document.querySelectorAll('#cmp-table tbody tr').length;
    document.getElementById('cmp-close-btn').click();

    // 31: Academic Formula & Methodology modal
    document.getElementById('method-open-btn').click();
    R.methodModalOpen=document.getElementById('method-modal-backdrop').className.indexOf('open')>=0;
    R.methodCards=document.querySelectorAll('#method-modal-backdrop .method-card').length;
    document.getElementById('method-close-btn').click();

    // 32: Merged filter + interactive NAV crosshair & benchmark toggle
    V3.setHoldingsView('merged');
    var allExpCnt=document.querySelectorAll('#exposure-list .exp-row').length;
    document.getElementById('mf-dup').click();
    var dupExpCnt=document.querySelectorAll('#exposure-list .exp-row').length;
    document.getElementById('mf-all').click();
    R.mergedFilterOk=(allExpCnt>dupExpCnt&&dupExpCnt>0);
    R.navCrosshairOk=!!(document.querySelector('#nav-chart svg.nav-svg .nav-xhair')&&document.querySelector('#nav-chart svg.nav-svg .nav-hit'));
    R.corrCells=document.querySelectorAll('#corr-chart svg.corr-svg .corr-cell').length;

    // 33: State serialization round-trip + P1 strategy hook + v5.0 Markdown quant metrics
    var tok=AZ.serializePortfolioState({positions:fakePos,window:'250',theme:'dark'});
    var dec=AZ.deserializePortfolioState(tok,A);
    R.serialOk=!!(tok&&dec&&dec.positions.length===fakePos.length&&dec.theme==='dark');
    var hookReg=AZ.registerStrategyHook('__test_eq',function(pos){return pos;});
    R.hookOk=hookReg&&AZ.listStrategyHooks().indexOf('__test_eq')>=0;
    var md=V3.currentCheckup().md;
    R.mdV5Ok=/AlphaLens v5\.0/.test(md)&&/夏普比率/.test(md)&&/HHI/.test(md)&&!/undefined|NaN/.test(md);
  }catch(e){R.fatal=e.message;}
  var d=document.createElement('div');d.id='__V5';d.style.display='none';d.textContent=JSON.stringify(R);document.body.appendChild(d);
},1800);});
</script>`;
  fs.writeFileSync(v5File, rootText.replace('</body>', v5Probe + '</body>'));
  const v5dom = chromeDom(v5File, ['--window-size=1440,1040']);
  const vm = v5dom.match(/<div id="__V5"[^>]*>([\s\S]*?)<\/div>/);
  try { V5 = decodeHtmlJson(vm ? vm[1] : '{}'); } catch (e) { V5 = { fatal: e.message }; }
} finally {
  fs.rmSync(v5File, { force: true });
}
rec(27, 'v5.0 经典量化指标引擎（CAGR / Sharpe / Calmar / HHI / N_eff / 沪深300基准对齐）',
  V5.quantOk === true && V5.quantChips === 5 && (V5.errs || []).length === 0,
  `quantOk=${V5.quantOk} chips=${V5.quantChips} errs=${(V5.errs || []).length}`);
rec(28, 'v5.0 智能去重降险优化引擎（双模式均合法，引入低相关资产后风险分与重合数严格下降）',
  V5.optWeightsOk === true && V5.optDivOk === true,
  `weightsOk=${V5.optWeightsOk} divOk=${V5.optDivOk} risk=${V5.optRiskBefore}->${V5.optRiskAfter}`);
rec(29, 'v5.0 智能优化弹窗开关 + 一键应用 + 撤销 Toast 无损回退闭环',
  V5.optModalOpen === true && V5.optCards === 6 && V5.optApplyUndoOk === true,
  `open=${V5.optModalOpen} cards=${V5.optCards} applyUndo=${V5.optApplyUndoOk}`);
rec(30, 'v5.0 组合 A/B 同屏对照实验台（叠加双净值曲线 + 8 项指标对照表）',
  V5.cmpModalOpen === true && V5.cmpSvgCount === 1 && V5.cmpRows === 8,
  `open=${V5.cmpModalOpen} svg=${V5.cmpSvgCount} rows=${V5.cmpRows}`);
rec(31, 'v5.0 算法公式与数据口径学术说明书弹窗（6 大板块完整渲染）',
  V5.methodModalOpen === true && V5.methodCards === 6,
  `open=${V5.methodModalOpen} cards=${V5.methodCards}`);
rec(32, 'v5.0 合并重仓「仅看撞车」过滤 + 净值十字准星 DOM + 相关性交互单元格',
  V5.mergedFilterOk === true && V5.navCrosshairOk === true && V5.corrCells >= 4,
  `filter=${V5.mergedFilterOk} xhair=${V5.navCrosshairOk} corrCells=${V5.corrCells}`);
rec(33, 'v5.0 状态序列化往返 + P1 策略钩子注册 + v5.0 Markdown 量化报告断言',
  V5.serialOk === true && V5.hookOk === true && V5.mdV5Ok === true,
  `serial=${V5.serialOk} hook=${V5.hookOk} mdV5=${V5.mdV5Ok}`);

const passed = results.filter(r => r.pass).length;
console.log(`\n=== VERIFY_V5.0: ${passed}/${results.length} PASS (Chrome: ${CHROME}) ===`);
if (passed !== results.length) process.exit(1);
