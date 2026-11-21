'use strict';
const A = require('./core.js');

let failures = 0;
const checks = [];
function ok(name, cond, detail) {
  checks.push({ name: name, pass: !!cond, detail: detail === undefined ? '' : String(detail) });
  if (!cond) failures++;
}
function finite(v) { return typeof v === 'number' && isFinite(v); }

A.codes.forEach(function (code) {
  const c = A.computeAll(code);
  ok(code + ' schema', A.validate({ stock: c.stock, market: c.market, sectors: c.sectors, deriv: c.deriv }));
  ok(code + ' frame alignment', c.stock.bars.length === c.stock.fund.length, c.stock.bars.length + ' frames');

  let worst = 0;
  c.stock.fund.forEach(function (f) {
    const main = f.superLarge + f.large;
    const sum = f.superLarge + f.large + f.medium + f.small;
    if (Math.abs(main) > 1) worst = Math.max(worst, Math.abs(sum) / Math.abs(main));
  });
  ok(code + ' fund conservation', worst < 1e-9, 'max |sum4|/|main| = ' + worst.toFixed(6));

  const s = c.fund;
  ok(code + ' cumulative finite', finite(s.mainNet) && finite(s.retailNet) && s.main.every(finite));
  ok(code + ' signal timestamps', s.signals.every(function (x) { return x.t === c.stock.bars[x.i].t; }));

  const t = c.temp;
  ok(code + ' temperature range', finite(t.score) && t.score >= 0 && t.score <= 100, t.score.toFixed(1));
  ok(code + ' temperature zone', typeof t.zone === 'string' && t.zone.length > 0, t.zone);

  const r = c.report;
  ok(code + ' radar dims', r.dims.length === 5 && r.dims.every(function (d) { return finite(d.score) && d.score >= 0 && d.score <= 100; }));
  ok(code + ' radar grade', 'ABCD'.indexOf(r.grade) >= 0, r.grade + ' / ' + r.total.toFixed(1));
  ok(code + ' diagnosis non-empty', r.lights.length > 0 && r.lights.every(function (l) { return l.text.length > 8; }));

  const d = c.derivSignals;
  ok(code + ' basis math', d.basis.every(function (b) { return Math.abs(b.basis - (b.fut - b.spot)) < 1e-9; }));
  ok(code + ' basis render contract', d.basis.every(function (b) {
    return finite(b.prevBasis) && finite(b.delta) && finite(b.basis) && ['up', 'down', 'flat'].indexOf(b.tone) >= 0;
  }));
  ok(code + ' pcr math', d.options.every(function (o) { return o.pcr > 0 && finite(o.pcr); }));

  const area = c.treemap.reduce(function (a, x) { return a + x.w * x.h; }, 0);
  ok(code + ' treemap coverage', c.treemap.length === A.SECTORS.length && Math.abs(area - 900 * 420) < 900 * 420 * 0.02, area.toFixed(0) + ' / ' + 900 * 420);
});

const acc = A.computeAll('SIM.001');
const dis = A.computeAll('SIM.002');
ok('SIM.001 absorption detected', acc.fund.signals.some(function (x) { return x.type === 'accumulation'; }), acc.fund.signals.length + ' signals');
ok('SIM.002 distribution detected', dis.fund.signals.some(function (x) { return x.type === 'distribution'; }), dis.fund.signals.length + ' signals');
ok('SIM.001 main net positive', acc.fund.mainNet > 0, acc.fund.mainNet.toFixed(0));
ok('SIM.002 main net negative', dis.fund.mainNet < 0, dis.fund.mainNet.toFixed(0));

const bad = JSON.parse(JSON.stringify({ stock: A.STOCKS['SIM.001'], market: A.MARKET, sectors: A.SECTORS, deriv: A.DERIV }));
bad.market = JSON.parse(JSON.stringify(A.MARKET));
bad.market.breadth.adv = 0;
let rejected = false;
try { A.validate(bad); } catch (e) { rejected = true; }
ok('invalid breadth rejected', rejected);

const bad2 = JSON.parse(JSON.stringify({ stock: A.STOCKS['SIM.001'], market: A.MARKET, sectors: A.SECTORS, deriv: A.DERIV }));
bad2.stock = JSON.parse(JSON.stringify(A.STOCKS['SIM.001']));
bad2.stock.bars[3].h = bad2.stock.bars[3].l - 1;
let rejected2 = false;
try { A.validate(bad2); } catch (e) { rejected2 = true; }
ok('invalid OHLC rejected', rejected2);

const source = A.source();
ok('source sections', Object.keys(source.stocks).length === 3 && source.market.indices.length === 5);

const lossy = JSON.parse(JSON.stringify(source));
lossy.stocks['SIM.001'].report.netProfit = -5;
const lossSnap = { stock: lossy.stocks['SIM.001'], market: source.market, sectors: source.sectors, deriv: source.deriv };
ok('negative netProfit accepted', A.validate(lossSnap));
ok('loss flagged in diagnosis', A.scoreReport(lossy.stocks['SIM.001'].report).lights.some(function (l) {
  return l.level === 'bad' && l.text.indexOf('净利润为负') >= 0;
}));
lossy.stocks['SIM.001'].report.netProfit = 0;
let rejected4 = false;
try { A.validate(lossSnap); } catch (e) { rejected4 = true; }
ok('zero netProfit rejected', rejected4);

const wrap = function (stock) {
  return { stock: stock, market: source.market, sectors: source.sectors, deriv: source.deriv };
};
const drifted = JSON.parse(JSON.stringify(source.stocks['SIM.001']));
drifted.fund[0].small += 50;
let rejected5 = false;
try { A.validate(wrap(drifted)); } catch (e) { rejected5 = true; }
ok('zero-sum violation rejected', rejected5);

const nanFund = JSON.parse(JSON.stringify(source.stocks['SIM.001']));
nanFund.fund[0].medium = NaN;
let rejected6 = false;
try { A.validate(wrap(nanFund)); } catch (e) { rejected6 = true; }
ok('non-finite fund rejected', rejected6);

const nanProfit = JSON.parse(JSON.stringify(source.stocks['SIM.001']));
nanProfit.report.netProfit = NaN;
let rejected7 = false;
try { A.validate(wrap(nanProfit)); } catch (e) { rejected7 = true; }
ok('non-finite netProfit rejected', rejected7);
const injected = JSON.parse(JSON.stringify(source));
injected.stocks['SIM.001'].name = 'INJECTED / 测试标的';
ok('setSource accepts', A.setSource(injected) === 3);
ok('setSource applied', A.computeAll('SIM.001').name === 'INJECTED / 测试标的');
let rejected3 = false;
try { A.setSource({ stocks: {}, market: source.market, sectors: source.sectors, deriv: source.deriv }); } catch (e) { rejected3 = true; }
ok('setSource rejects empty', rejected3);
A.setSource(source);

let shortOk = true;
for (let n = 0; n < 8; n++) {
  const short = { bars: source.stocks['SIM.001'].bars.slice(0, n + 1), fund: source.stocks['SIM.001'].fund.slice(0, n + 1), floatShares: source.stocks['SIM.001'].floatShares };
  if (!finite(A.volumeRadar(short).volRatio)) shortOk = false;
}
ok('short-frame replay finite', shortOk);

checks.forEach(function (c) {
  console.log((c.pass ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  [' + c.detail + ']' : ''));
});
console.log('---');
console.log('checks=' + checks.length + ' failures=' + failures);
process.exit(failures ? 1 : 0);
