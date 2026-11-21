(function (global) {
  'use strict';

  const FRAMES = 48;
  const LABELS = (() => {
    const out = [];
    for (let i = 0; i < FRAMES; i++) {
      const minutes = 9 * 60 + 30 + i * 7;
      const h = Math.floor(minutes / 60) % 24;
      const m = minutes % 60;
      out.push(String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0'));
    }
    return out;
  })();

  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const fmt = (v, d) => (v === null || !isFinite(v) ? '--' : Number(v).toFixed(d === undefined ? 2 : d));
  const signed = (v, d) => (v > 0 ? '+' : '') + fmt(v, d);

  function buildStock(seed, shape, cfg) {
    const rand = rng(seed);
    const bars = [];
    const fund = [];
    let price = cfg.base;
    for (let i = 0; i < FRAMES; i++) {
      const p = i / (FRAMES - 1);
      let drift;
      let volScale;
      if (shape === 'accumulation') {
        drift = p < 0.65 ? -0.0011 : 0.0016;
        volScale = p > 0.6 && p < 0.85 ? 1.9 : 0.85;
      } else if (shape === 'distribution') {
        drift = p < 0.55 ? 0.0040 : -0.0040;
        const ramp = p > 0.28 && p < 0.55 ? 1 + 2.2 * (p - 0.28) / 0.27 : (p >= 0.55 ? 0.6 : 0.75);
        volScale = 1.9 * ramp;
      } else {
        drift = 0.0002 * Math.sin(i * 0.55);
        volScale = 1 + 0.35 * Math.sin(i * 0.4);
      }
      const open = price;
      const wave = (rand() - 0.5) * cfg.base * 0.006 * volScale;
      const close = Math.max(0.5, open * (1 + drift) + wave);
      const high = Math.max(open, close) + Math.abs(rand() * cfg.base * 0.0025);
      const low = Math.min(open, close) - Math.abs(rand() * cfg.base * 0.0025);
      const vol = Math.round(cfg.volBase * volScale * (0.65 + rand() * 0.8));
      bars.push({ t: LABELS[i], o: open, h: high, l: low, c: close, vol: vol });

      let main;
      if (shape === 'accumulation') {
        main = 180 + 520 * Math.max(0, Math.sin((p - 0.15) * 3.1)) + (rand() - 0.5) * 160;
      } else if (shape === 'distribution') {
        if (p < 0.28) main = 620 + 380 * p + (rand() - 0.5) * 220;
        else if (p < 0.55) main = -(700 + 1200 * (p - 0.28)) + (rand() - 0.5) * 220;
        else main = -350 + (rand() - 0.5) * 220;
      } else {
        main = (rand() - 0.48) * 420;
      }
      const retail = -main;
      fund.push({
        t: LABELS[i],
        superLarge: main * 0.63,
        large: main * 0.37,
        medium: retail * 0.34,
        small: retail * 0.66
      });
      price = close;
    }
    return { bars: bars, fund: fund };
  }

  const REPORTS = {
    'SIM.001': {
      name: '样本甲 / 消费制造', period: '2025Q3', roe3y: [21.4, 19.8, 18.6],
      grossMargin: 52.3, netMargin: 24.1, revYoY: 16.8, deductYoY: 19.2,
      ocf: 68.4, netProfit: 55.2, debtRatio: 32.6, currentRatio: 2.41,
      goodwill: 3.1, equity: 242.0, inventoryTurn: 6.8, inventoryTurnPrev: 6.5,
      arDays: 28.4, adminRate: 4.2, adminRatePrev: 4.5, rdRate: 3.1,
      shortLoan: 8.2, shortLoanPrev: 7.9, cash: 96.5
    },
    'SIM.002': {
      name: '样本乙 / 新能源中盘', period: '2025Q3', roe3y: [13.2, 11.5, 9.4],
      grossMargin: 24.6, netMargin: 8.3, revYoY: 22.4, deductYoY: 6.1,
      ocf: 21.6, netProfit: 28.9, debtRatio: 54.1, currentRatio: 1.42,
      goodwill: 12.4, equity: 118.0, inventoryTurn: 4.2, inventoryTurnPrev: 4.6,
      arDays: 78.2, adminRate: 6.8, adminRatePrev: 5.9, rdRate: 6.4,
      shortLoan: 34.2, shortLoanPrev: 25.1, cash: 30.8
    },
    'SIM.003': {
      name: '样本丙 / 周期材料', period: '2025Q3', roe3y: [6.1, 3.8, -2.4],
      grossMargin: 11.2, netMargin: 1.6, revYoY: -8.7, deductYoY: -31.5,
      ocf: 3.2, netProfit: 6.8, debtRatio: 76.3, currentRatio: 0.83,
      goodwill: 28.6, equity: 96.0, inventoryTurn: 2.1, inventoryTurnPrev: 3.4,
      arDays: 132.6, adminRate: 9.7, adminRatePrev: 6.2, rdRate: 1.2,
      shortLoan: 58.4, shortLoanPrev: 31.2, cash: 19.6
    }
  };

  const MARKET = {
    indices: [
      { code: '000001', name: '上证指数', last: 3412.86, chgPct: 0.62, vol: 5820 },
      { code: '399001', name: '深证成指', last: 10984.31, chgPct: 0.87, vol: 7140 },
      { code: '399006', name: '创业板指', last: 2286.45, chgPct: 1.34, vol: 3120 },
      { code: '000688', name: '科创50', last: 1042.77, chgPct: -0.41, vol: 980 },
      { code: '000300', name: '沪深300', last: 4021.58, chgPct: 0.48, vol: 4260 }
    ],
    breadth: { adv: 2874, dec: 1962, flat: 214, total: 5050, limitUp: 68, limitDown: 11, brokenBoard: 19, turnover: 16842, turnoverPrev: 14360 }
  };

  const SECTORS = [
    { name: '半导体', turnover: 1240, flow: 86.4, chgPct: 2.81 },
    { name: '证券', turnover: 980, flow: 62.1, chgPct: 1.94 },
    { name: '人工智能', turnover: 1120, flow: 54.7, chgPct: 2.36 },
    { name: '电力设备', turnover: 860, flow: 38.2, chgPct: 1.12 },
    { name: '黄金概念', turnover: 540, flow: 31.6, chgPct: 2.05 },
    { name: '医药生物', turnover: 720, flow: 12.4, chgPct: 0.36 },
    { name: '银行', turnover: 610, flow: -8.7, chgPct: -0.21 },
    { name: '食品饮料', turnover: 480, flow: -18.3, chgPct: -0.54 },
    { name: '房地产', turnover: 390, flow: -34.6, chgPct: -1.42 },
    { name: '煤炭', turnover: 330, flow: -27.2, chgPct: -1.08 },
    { name: '石油石化', turnover: 410, flow: -14.9, chgPct: -0.66 },
    { name: '传媒', turnover: 520, flow: -41.8, chgPct: -1.87 }
  ];

  const DERIV = {
    basis: [
      { sym: 'IF', name: '沪深300', fut: 4026.4, spot: 4021.58, prevBasis: -14.2 },
      { sym: 'IC', name: '中证500', fut: 6182.0, spot: 6196.74, prevBasis: -22.6 },
      { sym: 'IM', name: '中证1000', fut: 6542.8, spot: 6568.10, prevBasis: -31.4 }
    ],
    commodity: [
      { sym: 'AU', name: '沪金主力', chgPct: 1.86, mapped: '黄金概念' },
      { sym: 'CU', name: '沪铜主力', chgPct: 0.94, mapped: '有色金属' },
      { sym: 'SC', name: '原油主力', chgPct: -1.32, mapped: '石油石化' },
      { sym: 'RB', name: '螺纹钢主力', chgPct: -0.78, mapped: '钢铁建材' },
      { sym: 'LC', name: '碳酸锂主力', chgPct: 2.41, mapped: '锂电新能源' }
    ],
    options: [
      { underlying: '50ETF', putVol: 812400, callVol: 976200, iv: 18.4, ivPrev: 17.1 },
      { underlying: '300ETF', putVol: 1048600, callVol: 1132400, iv: 19.7, ivPrev: 18.9 },
      { underlying: '500ETF', putVol: 642300, callVol: 518700, iv: 23.6, ivPrev: 21.2 }
    ]
  };

  const STOCKS = (() => {
    const out = {};
    const defs = [
      { code: 'SIM.001', seed: 20261114, shape: 'accumulation', base: 168.4, volBase: 42000, floatShares: 125600 },
      { code: 'SIM.002', seed: 77319001, shape: 'distribution', base: 42.7, volBase: 186000, floatShares: 468000 },
      { code: 'SIM.003', seed: 44128037, shape: 'neutral', base: 9.36, volBase: 92000, floatShares: 712000 }
    ];
    defs.forEach(function (d) {
      out[d.code] = Object.assign({}, buildStock(d.seed, d.shape, d), {
        code: d.code, name: REPORTS[d.code].name, shape: d.shape,
        floatShares: d.floatShares, report: REPORTS[d.code]
      });
    });
    return out;
  })();

  function validate(snap) {
    if (!snap || !snap.stock || !snap.market || !snap.deriv || !snap.sectors) {
      throw new Error('snapshot: missing top-level section');
    }
    const st = snap.stock;
    if (st.bars.length !== st.fund.length || st.bars.length < 12) {
      throw new Error('snapshot: bars/fund frame mismatch');
    }
    st.bars.forEach(function (b, i) {
      if (!(b.h >= Math.max(b.o, b.c) && b.l <= Math.min(b.o, b.c) && b.l > 0 && b.vol > 0)) {
        throw new Error('snapshot: invalid bar at ' + i);
      }
    });
    let maxAbs = 0;
    st.fund.forEach(function (f, i) {
      const parts = [f.superLarge, f.large, f.medium, f.small];
      if (parts.some(function (v) { return !isFinite(v); })) {
        throw new Error('snapshot: non-finite fund at ' + i);
      }
      const sum = parts.reduce(function (a, b) { return a + b; }, 0);
      if (Math.abs(sum) > 1e-3) throw new Error('snapshot: fund not zero-sum at ' + i);
      maxAbs = Math.max(maxAbs, Math.abs(parts[0] + parts[1]));
      if (f.t !== st.bars[i].t) throw new Error('snapshot: timestamp drift at ' + i);
    });
    const bd = snap.market.breadth;
    if (bd.adv + bd.dec + bd.flat !== bd.total) throw new Error('snapshot: breadth does not sum');
    snap.deriv.options.forEach(function (o) {
      if (!(o.callVol > 0 && o.putVol >= 0 && o.iv > 0)) throw new Error('snapshot: invalid option board');
    });
    snap.deriv.basis.forEach(function (b) {
      if (!(b.spot > 0 && b.fut > 0)) throw new Error('snapshot: invalid basis spot');
    });
    if (!(Number.isFinite(st.report.netProfit) && st.report.netProfit !== 0 && st.floatShares > 0)) {
      throw new Error('snapshot: invalid report denominator');
    }
    return true;
  }

  function fundSeries(stock) {
    let m = 0;
    let r = 0;
    const main = [];
    const retail = [];
    stock.fund.forEach(function (f) {
      m += f.superLarge + f.large;
      r += f.medium + f.small;
      main.push(m);
      retail.push(r);
    });
    const frameScale = Math.max.apply(null, stock.fund.map(function (f) { return Math.abs(f.superLarge + f.large); })) || 1;
    const threshold = frameScale * 1.2;
    const signals = [];
    let lastAt = { accumulation: -99, distribution: -99 };
    for (let i = 10; i < stock.bars.length; i++) {
      const j = i - 6;
      const priceChg = (stock.bars[i].c - stock.bars[j].c) / stock.bars[j].c;
      const mSlope = main[i] - main[j];
      const rSlope = retail[i] - retail[j];
      const avg5 = (stock.bars[i - 1].vol + stock.bars[i - 2].vol + stock.bars[i - 3].vol + stock.bars[i - 4].vol + stock.bars[i - 5].vol) / 5;
      const vr = stock.bars[i].vol / avg5;
      let type = null;
      if (priceChg <= 0.004 && mSlope > threshold && rSlope < 0) type = 'accumulation';
      if (priceChg > 0.012 && vr > 1.55 && mSlope < -threshold && rSlope > 0) type = 'distribution';
      if (type && i - lastAt[type] >= 9) {
        signals.push({
          i: i, t: stock.bars[i].t, type: type,
          label: type === 'accumulation' ? '主力暗中吸筹 / 散户割肉' : '主力拉高派发 / 散户接盘风险',
          priceChg: priceChg, volRatio: vr, mainSlope: mSlope
        });
        lastAt[type] = i;
      }
    }
    return { main: main, retail: retail, signals: signals, mainNet: m, retailNet: r };
  }

  function volumeRadar(stock) {
    const bars = stock.bars;
    const last = bars[bars.length - 1];
    const hist = bars.slice(-6, -1);
    const avg5 = hist.length ? hist.reduce(function (a, b) { return a + b.vol; }, 0) / hist.length : last.vol;
    const volRatio = last.vol / avg5;
    const turnover = last.vol / stock.floatShares * 100;
    const first = bars[0].c;
    const chg = (last.c - first) / first;
    const maxPrice = Math.max.apply(null, bars.map(function (b) { return b.c; }));
    const nearHigh = (maxPrice - last.c) / maxPrice < 0.012;
    const out = [];
    if (volRatio > 1.6 && chg > 0.015) out.push({ level: 'warn', text: '底部放量突破：量比 ' + fmt(volRatio) + '，价格同步走强，有增量资金进场。' });
    if (volRatio < 0.7 && nearHigh && chg > 0.01) out.push({ level: 'warn', text: '高位缩量滞涨：价格贴近高点但量能萎缩，上攻缺乏承接。' });
    if (volRatio > 2.2 && nearHigh) out.push({ level: 'danger', text: '天量见天价：量比 ' + fmt(volRatio) + ' 且处高位，警惕短线见顶。' });
    if (volRatio > 1.6 && chg < -0.01) out.push({ level: 'danger', text: '放量下跌：抛压集中释放，不宜逆势接货。' });
    if (!out.length) out.push({ level: 'ok', text: '量价配合平稳，无显著异动形态，维持观察。' });
    return { volRatio: volRatio, turnover: turnover, chg: chg, patterns: out };
  }

  function temperature(breadth) {
    const n = function (x) { return clamp((x + 1) / 2, 0, 1); };
    const adv = (breadth.adv - breadth.dec) / breadth.total;
    const limit = (breadth.limitUp - breadth.limitDown) / Math.max(1, breadth.limitUp + breadth.limitDown);
    const broken = 1 - breadth.brokenBoard / Math.max(1, breadth.limitUp + breadth.brokenBoard);
    const turn = clamp((breadth.turnover / breadth.turnoverPrev - 1) * 2 + 0.5, 0, 1);
    const score = 100 * (0.35 * n(adv) + 0.25 * n(limit) + 0.20 * broken + 0.20 * turn);
    const zone = score < 20 ? '冰点期' : score < 40 ? '偏冷' : score < 60 ? '中性' : score < 80 ? '偏热' : '过热期';
    const advice = score < 20 ? '宜空仓或分批低吸，别追反弹' : score < 40 ? '仓位控制在三成以内' : score < 60 ? '结构性行情，跟着资金流走' : score < 80 ? '持股为主，减掉高位放量票' : '防回调，兑现利润优先';
    return {
      score: score, zone: zone, advice: advice,
      parts: [
        { label: '涨跌家数比', value: adv, weight: 0.35 },
        { label: '涨跌停比', value: limit, weight: 0.25 },
        { label: '封板稳固度', value: broken * 2 - 1, weight: 0.20 },
        { label: '成交额增减', value: turn * 2 - 1, weight: 0.20 }
      ]
    };
  }

  function scoreReport(r) {
    const lin = function (v, lo, hi) { return clamp((v - lo) / (hi - lo), 0, 1) * 100; };
    const roe = r.roe3y.reduce(function (a, b) { return a + b; }, 0) / r.roe3y.length;
    const cashRatio = r.ocf / r.netProfit;
    const goodwillRatio = r.goodwill / r.equity * 100;
    const dims = [
      { key: 'profit', label: '盈利能力', score: 0.5 * lin(roe, 0, 25) + 0.3 * lin(r.grossMargin, 5, 60) + 0.2 * lin(r.netMargin, 0, 30), note: 'ROE 三年均值 ' + fmt(roe, 1) + '% / 毛利率 ' + fmt(r.grossMargin, 1) + '%' },
      { key: 'growth', label: '成长潜力', score: 0.5 * lin(r.revYoY, -20, 40) + 0.5 * lin(r.deductYoY, -30, 40), note: '营收同比 ' + signed(r.revYoY, 1) + '% / 扣非同比 ' + signed(r.deductYoY, 1) + '%' },
      { key: 'cash', label: '现金流含金量', score: lin(cashRatio, 0, 1.5), note: '净现比 ' + fmt(cashRatio) + '（经营现金流 / 净利润）' },
      { key: 'safety', label: '财务安全性', score: 0.45 * lin(70 - r.debtRatio, 0, 40) + 0.3 * lin(r.currentRatio, 0.5, 2.5) + 0.25 * lin(25 - goodwillRatio, 0, 25), note: '负债率 ' + fmt(r.debtRatio, 1) + '% / 流动比率 ' + fmt(r.currentRatio) },
      { key: 'ops', label: '运营管理效率', score: 0.4 * lin(r.inventoryTurn, 1, 8) + 0.3 * lin(160 - r.arDays, 0, 130) + 0.3 * lin(12 - r.adminRate, 0, 9), note: '存货周转 ' + fmt(r.inventoryTurn, 1) + ' 次 / 应收 ' + fmt(r.arDays, 0) + ' 天' }
    ];
    dims.forEach(function (d) { d.score = clamp(d.score, 0, 100); });
    const lights = [];
    const loanSurge = (r.shortLoan - r.shortLoanPrev) / Math.max(Math.abs(r.shortLoanPrev), 1e-9);
    if (r.netProfit <= 0) lights.push({ level: 'bad', text: '当期净利润为负，盈利质量与偿债能力需单独核查，五维评分按保守口径处理。' });
    if (roe > 15 && r.roe3y.every(function (v) { return v > 15; }) && cashRatio > 1.1) {
      lights.push({ level: 'ok', text: '优质特征：ROE 连续 3 年大于 15%，净现比 ' + fmt(cashRatio) + ' 高于 1.1。护城河较深，赚的是真金白银。' });
    }
    if (cashRatio < 0.8) lights.push({ level: 'bad', text: '利润含金量偏低：净现比仅 ' + fmt(cashRatio) + '，净利润里白条应收账款占比偏高。' });
    if (loanSurge > 0.3 && r.cash < r.shortLoan) {
      lights.push({ level: 'bad', text: '资金链紧绷：短期借款同比激增 ' + fmt(loanSurge * 100, 0) + '%，货币资金 ' + fmt(r.cash, 1) + ' 亿已无法覆盖短债 ' + fmt(r.shortLoan, 1) + ' 亿。' });
    }
    if (goodwillRatio > 20) lights.push({ level: 'bad', text: '商誉暴雷风险：商誉占净资产 ' + fmt(goodwillRatio, 1) + '%，减值一旦计提将直接冲击当期利润。' });
    if (r.adminRate - r.adminRatePrev > 1 && r.inventoryTurn < r.inventoryTurnPrev) {
      lights.push({ level: 'bad', text: '管理层控费不力：管理费用率上升 ' + fmt(r.adminRate - r.adminRatePrev, 1) + ' 个百分点，同期存货周转由 ' + fmt(r.inventoryTurnPrev, 1) + ' 降至 ' + fmt(r.inventoryTurn, 1) + '。' });
    }
    if (r.debtRatio > 70) lights.push({ level: 'bad', text: '杠杆过高：资产负债率 ' + fmt(r.debtRatio, 1) + '%，利率上行周期偿债压力大。' });
    if (r.currentRatio < 1) lights.push({ level: 'bad', text: '短期偿债缺口：流动比率 ' + fmt(r.currentRatio) + ' 小于 1，流动资产覆盖不了流动负债。' });
    if (r.revYoY > 20 && r.deductYoY > 20) lights.push({ level: 'ok', text: '成长质量良好：营收与扣非净利润同步超 20% 增长，非靠一次性收益撑业绩。' });
    if (r.rdRate > 5) lights.push({ level: 'ok', text: '研发费用率 ' + fmt(r.rdRate, 1) + '%，投入强度高于样本中位数。' });
    if (r.roe3y.some(function (v) { return v < 0; })) lights.push({ level: 'bad', text: '近三年出现亏损年度，盈利稳定性不足，散户宜规避。' });
    if (r.grossMargin > 40) lights.push({ level: 'ok', text: '定价权较强：毛利率 ' + fmt(r.grossMargin, 1) + '%，高于样本中枢，产品具备溢价空间。' });
    if (r.arDays > 90) lights.push({ level: 'warn', text: '回款周期偏长：应收账款周转 ' + fmt(r.arDays, 0) + ' 天，需关注下游客户信用与坏账计提。' });
    if (r.debtRatio < 40) lights.push({ level: 'ok', text: '杠杆保守：资产负债率 ' + fmt(r.debtRatio, 1) + '%，偿债缓冲充足。' });
    if (!lights.length) lights.push({ level: 'warn', text: '未触发显著红绿灯规则，财务表现处于中性区间。' });
    const total = dims.reduce(function (a, d) { return a + d.score; }, 0) / dims.length;
    return { dims: dims, total: total, lights: lights, grade: total >= 75 ? 'A' : total >= 55 ? 'B' : total >= 35 ? 'C' : 'D' };
  }

  function derivSignals(deriv) {
    const basis = deriv.basis.map(function (b) {
      const diff = b.fut - b.spot;
      const prev = b.prevBasis;
      const delta = diff - prev;
      let text;
      let tone;
      if (delta > 6) { text = '期指多头抢跑，大盘短线看涨'; tone = 'up'; }
      else if (delta < -6) { text = '贴水扩大，机构对冲意愿升温'; tone = 'down'; }
      else { text = '基差平稳，方向信号不明确'; tone = 'flat'; }
      return { sym: b.sym, name: b.name, fut: b.fut, spot: b.spot, prevBasis: prev, basis: diff, basisPct: diff / b.spot * 100, delta: delta, text: text, tone: tone };
    });
    const options = deriv.options.map(function (o) {
      const pcr = o.putVol / o.callVol;
      const state = pcr > 1.2 ? '极度恐慌 / 关注见底' : pcr > 0.95 ? '偏谨慎' : pcr < 0.7 ? '极度贪婪 / 防回调' : '中性偏乐观';
      return { underlying: o.underlying, pcr: pcr, iv: o.iv, ivDelta: o.iv - o.ivPrev, state: state };
    });
    const commodity = deriv.commodity.map(function (c) {
      return { sym: c.sym, name: c.name, chgPct: c.chgPct, mapped: c.mapped, hot: Math.abs(c.chgPct) >= 1.5 };
    });
    const alerts = [];
    basis.filter(function (b) { return b.tone !== 'flat'; }).forEach(function (b) {
      alerts.push('[' + b.sym + '] ' + b.text + '（基差 ' + signed(b.basis, 1) + '，环比 ' + signed(b.delta, 1) + '）');
    });
    commodity.filter(function (c) { return c.hot; }).forEach(function (c) {
      alerts.push('[' + c.sym + '] ' + c.name + ' ' + signed(c.chgPct, 2) + '%，联动关注「' + c.mapped + '」板块');
    });
    options.filter(function (o) { return o.pcr > 1.2 || o.pcr < 0.7 || o.ivDelta > 2; }).forEach(function (o) {
      alerts.push('[' + o.underlying + '] PCR ' + fmt(o.pcr) + '，' + o.state + '；隐波环比 ' + signed(o.ivDelta, 1) + ' 点');
    });
    return { basis: basis, options: options, commodity: commodity, alerts: alerts };
  }

  // ponytail: row-greedy treemap instead of squarified; ceiling: aspect ratio drifts when sectors < 8, upgrade to squarify() if needed
  function treemap(items, W, H) {
    const sorted = items.slice().sort(function (a, b) { return b.turnover - a.turnover; });
    const total = sorted.reduce(function (a, b) { return a + b.turnover; }, 0);
    const rects = [];
    let y = 0;
    let i = 0;
    while (i < sorted.length && y < H - 2) {
      let rowArea = 0;
      let j = i;
      while (j < sorted.length) {
        const next = rowArea + sorted[j].turnover;
        if (j > i && next / total * (W * H) / W > H * 0.42) break;
        rowArea = next;
        j++;
      }
      const rowH = Math.min(H - y, rowArea / total * H);
      let x = 0;
      for (let k = i; k < j; k++) {
        const w = rowArea > 0 ? sorted[k].turnover / rowArea * W : 0;
        rects.push({ item: sorted[k], x: x, y: y, w: w, h: rowH });
        x += w;
      }
      y += rowH;
      i = j;
    }
    return rects;
  }

  let SOURCE = { stocks: STOCKS, market: MARKET, sectors: SECTORS, deriv: DERIV };

  function setSource(src) {
    if (!src || !src.stocks || !src.market || !src.sectors || !src.deriv) {
      throw new Error('source: incomplete section');
    }
    const keys = Object.keys(src.stocks);
    if (!keys.length) throw new Error('source: empty stocks');
    keys.forEach(function (k) {
      const v = src.stocks[k];
      if (!v.bars || !v.fund || !v.report || !v.floatShares) throw new Error('source: malformed stock ' + k);
      validate({ stock: v, market: src.market, sectors: src.sectors, deriv: src.deriv });
    });
    SOURCE = src;
    api.codes = keys;
    return keys.length;
  }

  function computeAll(code) {
    const keys = Object.keys(SOURCE.stocks);
    const stock = SOURCE.stocks[code] || SOURCE.stocks[keys[0]];
    const snap = { stock: stock, market: SOURCE.market, sectors: SOURCE.sectors, deriv: SOURCE.deriv };
    validate(snap);
    return {
      code: stock.code, name: stock.name, shape: stock.shape,
      stock: stock, market: SOURCE.market, sectors: SOURCE.sectors, deriv: SOURCE.deriv,
      fund: fundSeries(stock), volume: volumeRadar(stock),
      temp: temperature(SOURCE.market.breadth), report: scoreReport(stock.report),
      derivSignals: derivSignals(SOURCE.deriv), treemap: treemap(SOURCE.sectors, 900, 420)
    };
  }

  const api = {
    FRAMES: FRAMES, LABELS: LABELS, STOCKS: STOCKS, MARKET: MARKET,
    SECTORS: SECTORS, DERIV: DERIV, codes: Object.keys(STOCKS),
    setSource: setSource, source: function () { return SOURCE; },
    clamp: clamp, fmt: fmt, signed: signed,
    validate: validate, fundSeries: fundSeries, volumeRadar: volumeRadar,
    temperature: temperature, scoreReport: scoreReport,
    derivSignals: derivSignals, treemap: treemap, computeAll: computeAll
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.AlphaLensCore = api;
})(typeof window !== 'undefined' ? window : null);
