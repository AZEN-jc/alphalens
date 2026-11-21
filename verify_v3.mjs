#!/usr/bin/env node
/**
 * AlphaLens v3 hard verification (zero dependency, Node builtins + Chrome headless).
 * Run: node verify_v3.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE = path.join(HERE, 'index_alphalens_v3_live.html');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = path.join(HERE, 'verify_v3_result.json');
const results = [];
const rec = (n, name, pass, detail) => {
  results.push({ n, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${n}] ${name}${detail ? ' — ' + detail : ''}`);
};

const PROBE = String.raw`
<script>
window.__errs=[];window.__reqs=[];
window.addEventListener('error',function(e){window.__errs.push(e.message)});
(function(){var oe=console.error;console.error=function(){window.__errs.push([].join.call(arguments,' '));oe.apply(console,arguments)}})();
window.addEventListener('load',function(){setTimeout(function(){
var R={errs:window.__errs,reqs:window.__reqs};
try{
var A=window.AlphaLensAnalytics,D=window.ALPHALENS_DATA;
R.hasData=!!D&&!!D.assets&&!!D.dividends;
R.hasAnalytics=!!A&&typeof A.penetratePortfolio==='function'&&typeof A.computeCorrelationMatrix==='function'&&typeof A.computePortfolioCurveAndDrawdown==='function'&&typeof A.calcAfterTaxDividend==='function';
R.assets=Object.keys(D.assets||{}).length;R.divs=Object.keys(D.dividends||{}).length;R.presets=(D.presets||[]).length;
// 3 预设组合四大函数无 NaN
var presets=D.presets||[],summaries=[];
presets.forEach(function(p){
  var pen=A.penetratePortfolio(p.positions,D.assets);
  var codes=p.positions.map(function(x){return x.code});
  var corr=A.computeCorrelationMatrix(codes,D.assets);
  var curve=A.computePortfolioCurveAndDrawdown(p.positions,D.assets);
  var flat=JSON.stringify({pen:pen,corr:corr,curve:curve});
  summaries.push({id:p.id,total:pen.totalAmount,covered:pen.coveredRatio,overlaps:pen.overlaps.length,
    risk:pen.riskLevel,mdd:curve?curve.maxDrawdown:null,vol:curve?curve.annualizedVol:null,
    avgCorr:corr.avgOffDiagonal,sample:corr.sampleDays,
    hasNaN:/NaN|Infinity/.test(flat),curveLen:curve?curve.curve.length:0});
});
R.summaries=summaries;
// Tab2 15 股状态与排序表（先切到 div tab，表格在该视图首次显示时渲染）
var divTab0=document.querySelector('.main-tabs button[data-main=div]');if(divTab0)divTab0.click();
R.divRows=document.querySelectorAll('#div-body tr').length;
R.divBadges=document.querySelectorAll('#div-body .badge').length;
// 红利税切换实时更新
var before=document.getElementById('tax-result').textContent;
var b2=document.querySelector('#period-seg button[data-period=lt_1m]');if(b2)b2.click();
var after=document.getElementById('tax-result').textContent;
R.taxChanges=before!==after;
R.taxHasNaN=/NaN|Infinity/.test(after);
var bench=document.getElementById('benchmark');bench.value='4';bench.dispatchEvent(new Event('input',{bubbles:true}));
R.benchChanges=document.getElementById('tax-result').textContent!==after;
// 相关性/净值 SVG 已渲染
R.corrSvg=document.querySelectorAll('#corr-chart svg').length;
R.navSvg=document.querySelectorAll('#nav-chart svg').length;
// exposure 行
R.exposureRows=document.querySelectorAll('#exposure-list .exp-row').length;
// 主 Tab 切换
var divTab=document.querySelector('.main-tabs button[data-main=div]');if(divTab)divTab.click();
R.divViewOn=document.getElementById('view-div').className.indexOf('on')>=0;
}catch(e){R.fatal=e.message+' @ '+(e.stack||'').split('\\n')[1]}
var d=document.createElement('div');d.id='__VR';d.style.display='none';d.textContent=JSON.stringify(R);document.body.appendChild(d);
},2500);});
</script>`;

function chromeDom(htmlPath, extra = []) {
  const r = spawnSync(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--virtual-time-budget=8000', ...extra, '--dump-dom', 'file://' + htmlPath],
    { encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
  return r.stdout || '';
}

if (!fs.existsSync(LIVE)) { console.error('MISSING ' + LIVE); process.exit(1); }
const tmp = path.join(HERE, '__v3_probe.html');
fs.writeFileSync(tmp, fs.readFileSync(LIVE, 'utf8').replace('</body>', PROBE + '</body>'));
const dom = chromeDom(tmp);
fs.rmSync(tmp, { force: true });
const m = dom.match(/<div id="__VR"[^>]*>([\s\S]*?)<\/div>/);
let R;
try { R = JSON.parse((m ? m[1] : '{}').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')); }
catch (e) { R = { fatal: 'parse: ' + e.message }; }
fs.writeFileSync(OUT, JSON.stringify(R, null, 2));

rec(1, '零运行时错误 / 数据注入完整', (R.errs || []).length === 0 && R.hasData === true && R.hasAnalytics === true,
  `errs=${(R.errs || []).length} data=${R.hasData} analytics=${R.hasAnalytics} fatal=${R.fatal || 'none'}`);
rec(2, '30标的+15分红+3预设', R.assets === 30 && R.divs === 15 && R.presets === 3,
  `assets=${R.assets} divs=${R.divs} presets=${R.presets}`);
const sums = R.summaries || [];
rec(3, '三预设四函数无NaN/Infinity', sums.length === 3 && sums.every(s => !s.hasNaN && s.total > 0),
  sums.map(s => `${s.id}:${s.hasNaN ? 'NaN' : 'ok'}`).join(' '));
const fake = sums.find(s => s.id === 'fake_diversification');
const bal = sums.find(s => s.id === 'balanced_contrast');
rec(4, '假分散vs均衡对照有区分', !!(fake && bal && (fake.overlaps !== bal.overlaps || Math.abs((fake.avgCorr || 0) - (bal.avgCorr || 0)) > 0.05)),
  `fake(overlap=${fake && fake.overlaps},corr=${fake && fake.avgCorr}) bal(overlap=${bal && bal.overlaps},corr=${bal && bal.avgCorr})`);
rec(5, 'Tab2 15股状态齐全 + 图表渲染', R.divRows === 15 && R.divBadges === 15 && R.corrSvg >= 1 && R.navSvg >= 1 && R.exposureRows > 0,
  `rows=${R.divRows} badges=${R.divBadges} corrSVG=${R.corrSvg} navSVG=${R.navSvg} exp=${R.exposureRows}`);
rec(6, '税率/基准切换实时更新且无NaN', R.taxChanges === true && R.benchChanges === true && R.taxHasNaN === false,
  `taxChange=${R.taxChanges} benchChange=${R.benchChanges} NaN=${R.taxHasNaN}`);

// 断网降级：stub live.js 为永不回调
const offlineFile = path.join(HERE, '__v3_offline.html');
let offlineHtml = fs.readFileSync(LIVE, 'utf8');
offlineHtml = offlineHtml.replace('<script src="live.js"></script>',
  '<script>window.AlphaLive={start:function(){},status:function(){return{state:"SNAPSHOT",stamp:"",count:0}}};</script>');
offlineHtml = offlineHtml.replace('</body>', '<div id="__OFF" style="display:none"></div><script>setTimeout(function(){var t=document.querySelector(".main-tabs button[data-main=div]");if(t)t.click();document.getElementById("__OFF").textContent=JSON.stringify({label:document.getElementById("live-label").textContent,svg:document.querySelectorAll("#corr-chart svg").length,rows:document.querySelectorAll("#div-body tr").length,tax:document.getElementById("tax-result").textContent.length})},7000)</script></body>');
fs.writeFileSync(offlineFile, offlineHtml);
const odom = chromeDom(offlineFile, ['--virtual-time-budget=9000']);
fs.rmSync(offlineFile, { force: true });
const om = odom.match(/<div id="__OFF"[^>]*>([\s\S]*?)<\/div>/);
let O = {};
try { O = JSON.parse((om ? om[1] : '{}').replace(/&quot;/g, '"')); } catch (e) {}
rec(7, '断网6秒降级SNAPSHOT且图表测算可用', /SNAPSHOT/.test(O.label || '') && (O.svg || 0) >= 1 && (O.rows || 0) === 15 && (O.tax || 0) > 10,
  `label=${O.label} svg=${O.svg} rows=${O.rows} taxLen=${O.tax}`);

const passed = results.filter(r => r.pass).length;
console.log(`\n=== VERIFY_V3: ${passed}/${results.length} PASS ===`);
if (passed !== results.length) process.exit(1);
