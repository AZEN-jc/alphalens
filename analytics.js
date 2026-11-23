/* AlphaLens v4.0 (v3.3 engine contract) — Eastern Ink-Jade Cold Quant Terminal & Dual Hand-Written 3D Perspective Canvas Engine.
 * Five core analytics functions + Poetic Eastern Financial Narrator (`尺牍判词`) + Hand-written 3D Perspective Canvas Engines (`观澜` & `叠嶂`).
 * Inspired by @ludoonchart $24k/yr 3D perspective terminal aesthetic, infused with Eastern Ink-Jade restraint.
 * Exposed on window.AlphaLensAnalytics. Zero external dependencies, file:// ready.
 */
(function (global) {
  'use strict';

  // Editorial Semantic Palette aligned with muse-grammar-notes (why-blue, formula-violet, jade-teal, mnemonic-amber, trap-crimson)
  var ASSET_COLORS = [
    '#2563EB', // 逻辑蓝 (--why-accent)
    '#7C3AED', // 公式紫 (--formula-accent)
    '#0D9488', // 竹月青 (Teal Jade)
    '#D97706', // 琥珀金 (Mnemonic Amber)
    '#DC2626', // 朱砂红 (--trap-accent)
    '#4F46E5', // 靛青蓝 (Indigo)
    '#0891B2', // 天青蓝 (Cyan)
    '#059669'  // 琅玕翠 (Emerald)
  ];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmtYuan(v) {
    var n = Math.round(Number(v) || 0);
    return '¥' + n.toLocaleString('en-US');
  }

  function shortLabel(name, maxLen) {
    var s = String(name || '').trim();
    if (!maxLen || s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
  }

  function cleanStockLabel(name, maxLen) {
    var s = String(name || '').replace(/\s*\([A-Z0-9:]+\)\s*$/i, '').trim();
    return shortLabel(s, maxLen);
  }

  function hexToRgba(hex, alpha) {
    var h = String(hex || '#5CE1E6').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var num = parseInt(h, 16);
    if (!isFinite(num)) return 'rgba(92,225,230,' + alpha + ')';
    var r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function addExposure(map, stockCode, stockName, weight, sourceCode, sourceName) {
    if (!map.has(stockCode)) {
      map.set(stockCode, { code: stockCode, name: stockName, totalWeight: 0, totalYuan: 0, contributors: [] });
    }
    var entry = map.get(stockCode);
    entry.totalWeight += weight;
    var existing = entry.contributors.find(function (c) { return c.sourceCode === sourceCode; });
    if (existing) {
      existing.contribution += weight;
    } else {
      entry.contributors.push({ sourceCode: sourceCode, sourceName: sourceName, contribution: weight, contributionYuan: 0 });
    }
  }

  /** 1. Portfolio penetration & fake-diversification check */
  function penetratePortfolio(positions, assetsMap) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmount = valid.reduce(function (sum, p) { return sum + Number(p.amount); }, 0);
    if (totalAmount <= 0) {
      return { totalAmount: 0, exposures: [], overlaps: [], coveredRatio: 0, weightedFee: 0, riskLevel: 'EMPTY' };
    }
    var exposureMap = new Map();
    var coveredRatio = 0, weightedFee = 0;
    for (var idx = 0; idx < valid.length; idx++) {
      var pos = valid[idx];
      var asset = assetsMap[pos.code];
      var portWeight = Number(pos.amount) / totalAmount;
      weightedFee += portWeight * (Number(asset.fee) || 0);
      if (asset.type === 'STOCK' || asset.holdingsStatus === 'NO_EQUITY_HOLDINGS') {
        coveredRatio += portWeight;
        addExposure(exposureMap, asset.code, asset.name, portWeight, asset.code, asset.name);
      } else if (asset.type === 'ETF' && Array.isArray(asset.holdings)) {
        var etfTopSum = 0;
        for (var j = 0; j < asset.holdings.length; j++) {
          var h = asset.holdings[j];
          var w = (Number(h.weight) || 0) / 100;
          if (w <= 0) continue;
          etfTopSum += w;
          addExposure(exposureMap, h.code, h.name, portWeight * w, asset.code, asset.name);
        }
        coveredRatio += portWeight * Math.min(etfTopSum, 1);
      }
    }
    var exposures = Array.from(exposureMap.values()).sort(function (a, b) { return b.totalWeight - a.totalWeight; });
    exposures.forEach(function (item) {
      item.totalYuan = totalAmount * item.totalWeight;
      item.contributors.forEach(function (c) {
        c.contributionYuan = totalAmount * c.contribution;
      });
    });
    var overlaps = exposures.filter(function (item) { return item.contributors.length >= 2; });
    var maxSingleWeight = exposures[0] ? exposures[0].totalWeight : 0;
    var riskLevel = 'LOW';
    if (maxSingleWeight >= 0.15 || overlaps.length >= 4) riskLevel = 'HIGH';
    else if (maxSingleWeight >= 0.08 || overlaps.length >= 2) riskLevel = 'MEDIUM';
    return {
      totalAmount: totalAmount,
      exposures: exposures.slice(0, 15),
      overlaps: overlaps,
      coveredRatio: coveredRatio,
      weightedFee: weightedFee,
      riskLevel: riskLevel
    };
  }

  function alignCloseSeries(codes, assetsMap, maxDays) {
    var seriesMaps = codes.map(function (code) {
      var m = new Map();
      var bars = (assetsMap[code] && assetsMap[code].closes) || [];
      for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        if (Number.isFinite(bar.c) && bar.c > 0) m.set(bar.t, bar.c);
      }
      return m;
    });
    if (seriesMaps.length === 0) return { dates: [], matrix: [] };
    var commonDates = Array.from(seriesMaps[0].keys())
      .filter(function (d) { return seriesMaps.every(function (m) { return m.has(d); }); })
      .sort();
    var limit = Number(maxDays);
    if (Number.isFinite(limit) && limit > 0 && commonDates.length > limit) {
      commonDates = commonDates.slice(-Math.floor(limit));
    }
    var matrix = seriesMaps.map(function (m) {
      return commonDates.map(function (d) { return m.get(d); });
    });
    return { dates: commonDates, matrix: matrix };
  }

  function pearson(xs, ys) {
    var len = Math.min(xs.length, ys.length);
    if (len < 5) return null;
    var mx = 0, my = 0;
    for (var i = 0; i < len; i++) { mx += xs[i]; my += ys[i]; }
    mx /= len; my /= len;
    var num = 0, dx2 = 0, dy2 = 0;
    for (var j = 0; j < len; j++) {
      var dx = xs[j] - mx, dy = ys[j] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    var denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? null : num / denom;
  }

  /** 2. Pearson correlation matrix of asset daily returns */
  function computeCorrelationMatrix(codes, assetsMap, maxDays) {
    var aligned = alignCloseSeries(codes, assetsMap, maxDays);
    var dates = aligned.dates, series = aligned.matrix;
    var n = codes.length;
    var dateRange = dates.length ? [dates[0], dates[dates.length - 1]] : null;
    if (dates.length < 6 || n === 0) {
      return {
        codes: codes, matrix: [], avgOffDiagonal: null,
        sampleDays: dates.length, tradingDays: dates.length, dateRange: dateRange
      };
    }
    var returns = series.map(function (prices) {
      var r = [];
      for (var i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      return r;
    });
    var corr = Array.from({ length: n }, function () { return Array(n).fill(null); });
    var offSum = 0, offCount = 0;
    for (var i = 0; i < n; i++) {
      corr[i][i] = 1;
      for (var j = i + 1; j < n; j++) {
        var val = pearson(returns[i], returns[j]);
        corr[i][j] = val; corr[j][i] = val;
        if (val !== null) { offSum += val; offCount++; }
      }
    }
    return {
      codes: codes, matrix: corr,
      avgOffDiagonal: offCount > 0 ? offSum / offCount : null,
      sampleDays: dates.length - 1,
      tradingDays: dates.length,
      dateRange: dateRange
    };
  }

  /** 3. Composite NAV curve, max drawdown, annualized volatility */
  function computePortfolioCurveAndDrawdown(positions, assetsMap, maxDays) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmount = valid.reduce(function (s, p) { return s + Number(p.amount); }, 0);
    if (totalAmount <= 0) return null;
    var codes = valid.map(function (p) { return p.code; });
    var weights = valid.map(function (p) { return Number(p.amount) / totalAmount; });
    var aligned = alignCloseSeries(codes, assetsMap, maxDays);
    var dates = aligned.dates, series = aligned.matrix;
    if (dates.length < 2) return null;
    var navSeries = [];
    var peak = -Infinity, peakDate = dates[0], maxDrawdown = 0;
    var mddPeakDate = dates[0], mddTroughDate = dates[0];
    for (var t = 0; t < dates.length; t++) {
      var nav = 0;
      for (var i = 0; i < codes.length; i++) nav += weights[i] * (series[i][t] / series[i][0]);
      if (nav > peak) { peak = nav; peakDate = dates[t]; }
      var dd = (nav - peak) / peak;
      if (dd < maxDrawdown) { maxDrawdown = dd; mddPeakDate = peakDate; mddTroughDate = dates[t]; }
      navSeries.push({ t: dates[t], nav: nav, dd: dd });
    }
    var dailyRet = [];
    for (var k = 1; k < navSeries.length; k++) {
      dailyRet.push((navSeries[k].nav - navSeries[k - 1].nav) / navSeries[k - 1].nav);
    }
    var mean = dailyRet.reduce(function (a, b) { return a + b; }, 0) / dailyRet.length;
    var variance = dailyRet.reduce(function (s, r) { return s + (r - mean) * (r - mean); }, 0) / Math.max(dailyRet.length - 1, 1);
    var annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
    return {
      curve: navSeries,
      totalReturn: navSeries[navSeries.length - 1].nav - 1,
      maxDrawdown: maxDrawdown,
      mddRange: [mddPeakDate, mddTroughDate],
      annualizedVol: annualizedVol,
      sampleDays: dates.length,
      dateRange: [dates[0], dates[dates.length - 1]]
    };
  }

  /** 4. Four-dimensional independent portfolio risk diagnosis (Eastern poetic precision) */
  function evaluatePortfolioRisk(pen, corr, curve) {
    var hasPos = !!(pen && pen.totalAmount > 0);
    var totalAmt = hasPos ? pen.totalAmount : 0;
    var top1 = (pen && pen.exposures && pen.exposures[0]) ? pen.exposures[0] : null;
    var maxSingle = top1 ? top1.totalWeight : 0;
    var overlapList = (pen && Array.isArray(pen.overlaps)) ? pen.overlaps : [];
    var overlapCount = overlapList.length;
    var overlapWeight = overlapList.reduce(function (s, x) { return s + x.totalWeight; }, 0);
    var avgCorr = (corr && corr.avgOffDiagonal !== undefined) ? corr.avgOffDiagonal : null;
    var absMdd = (curve && curve.maxDrawdown != null) ? Math.abs(curve.maxDrawdown) : null;
    var vol = (curve && curve.annualizedVol != null) ? curve.annualizedVol : null;

    var topDetail = top1
      ? ('魁首「' + cleanStockLabel(top1.name, 7) + '」' + fmtYuan(totalAmt * maxSingle) + ' (' + (maxSingle * 100).toFixed(1) + '%)')
      : '单一底层最高 0%';
    var concentration = !hasPos
      ? { level: 'UNKNOWN', label: '虚席以待', detail: '--' }
      : maxSingle >= 0.15
        ? { level: 'HIGH', label: '孤峰独耸', detail: topDetail }
        : maxSingle >= 0.08
          ? { level: 'MEDIUM', label: '主次有别', detail: topDetail }
          : { level: 'LOW', label: '众星拱月', detail: topDetail };

    var overlap = !hasPos
      ? { level: 'UNKNOWN', label: '虚席以待', detail: '--' }
      : (overlapCount >= 4 || overlapWeight >= 0.20)
        ? { level: 'HIGH', label: '同源重聚', detail: overlapCount + ' 股交叠 · 共 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
        : (overlapCount >= 2 || overlapWeight >= 0.08)
          ? { level: 'MEDIUM', label: '偶有交集', detail: overlapCount + ' 股交叠 · 共 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
          : { level: 'LOW', label: overlapCount === 0 ? '泾渭分明' : '疏朗微交', detail: overlapCount + ' 股交叠' };

    var correlation = avgCorr === null
      ? { level: 'UNKNOWN', label: '样本未足', detail: '--' }
      : avgCorr >= 0.65
        ? { level: 'HIGH', label: '同起同落', detail: '相关系数 ' + avgCorr.toFixed(2) }
        : avgCorr >= 0.35
          ? { level: 'MEDIUM', label: '温婉和鸣', detail: '相关系数 ' + avgCorr.toFixed(2) }
          : { level: 'LOW', label: '东西互补', detail: '相关系数仅 ' + avgCorr.toFixed(2) };

    var drawdownVol = absMdd === null
      ? { level: 'UNKNOWN', label: '样本未足', detail: '--' }
      : (absMdd >= 0.25 || (vol !== null && vol >= 0.24))
        ? { level: 'HIGH', label: '惊涛拍岸', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
        : (absMdd >= 0.15 || (vol !== null && vol >= 0.16))
          ? { level: 'MEDIUM', label: '中流微澜', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '静水深流', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' };

    return {
      concentration: concentration,
      overlap: overlap,
      correlation: correlation,
      drawdownVol: drawdownVol
    };
  }

  /** 4b. Poetic Eastern Financial Narrator (`尺牍诗意判词`) + Spectrum Score + 3-line Inscription Log */
  function generatePlainSummary(pen, risk4, curve, positions, assetsMap, corr) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    if (!pen || pen.totalAmount <= 0 || valid.length === 0) {
      return {
        tone: 'neutral',
        badge: '【虚席待命】',
        title: '砚池未启，请于上方点选「预置方略」或遣入标的，立观三维穿透景深。',
        detail: '选定持仓后，主舞台将以真 3D 透视走廊推演每路资金去向，并折算每一股的真金白银。',
        overlapYuan: 0,
        overlapPct: 0,
        top1Name: '--',
        top1Yuan: 0,
        top1Pct: 0,
        spectrumScore: 50,
        terminalLines: [
          { tag: '壹·观澜', cls: 'cyan', text: '阵列待命：尚未检出有效持仓筹码…' },
          { tag: '贰·听风', cls: 'violet', text: '轻点顶部五组预置方略，三秒洞见基金底层重仓与同源暗涌。' },
          { tag: '叁·定盘', cls: 'emerald', text: '支持点击三维舞台任意基金走廊或底层晶柱，独锁其激光流向。' }
        ]
      };
    }

    var totalAmt = pen.totalAmount;
    var overlapList = pen.overlaps || [];
    var overlapCount = overlapList.length;
    var overlapWeight = overlapList.reduce(function (s, x) { return s + x.totalWeight; }, 0);
    var overlapYuan = totalAmt * overlapWeight;
    var overlapPct = overlapWeight * 100;
    var top5List = (pen.exposures || []).slice(0, 5);
    var top5Weight = top5List.reduce(function (s, x) { return s + x.totalWeight; }, 0);
    var top5Yuan = totalAmt * top5Weight;
    var top1 = (pen.exposures && pen.exposures[0]) ? pen.exposures[0] : null;
    var top2 = (pen.exposures && pen.exposures[1]) ? pen.exposures[1] : null;
    var top1Name = top1 ? cleanStockLabel(top1.name, 10) : '--';
    var top2Name = top2 ? cleanStockLabel(top2.name, 8) : null;
    var top1Yuan = top1 ? (totalAmt * top1.totalWeight) : 0;
    var top1Pct = top1 ? (top1.totalWeight * 100) : 0;
    var corrLevel = risk4 && risk4.correlation ? risk4.correlation.level : 'UNKNOWN';
    var avgCorrVal = (corr && corr.avgOffDiagonal != null) ? corr.avgOffDiagonal : null;
    var mddText = (curve && curve.maxDrawdown != null) ? ('-' + (Math.abs(curve.maxDrawdown) * 100).toFixed(1) + '%') : '--';

    // Spectrum score: 0 (和合真分散) -> 100 (同源重撞车)
    var rawScore = Math.min(62, overlapWeight * 135)
      + Math.min(22, (top1 ? top1.totalWeight : 0) * 55)
      + (avgCorrVal !== null && avgCorrVal > 0 ? Math.min(16, avgCorrVal * 20) : 0);
    var spectrumScore = Math.max(6, Math.min(95, Math.round(rawScore)));

    var line1 = {
      tag: '壹·观澜',
      cls: 'cyan',
      text: '账面分持 ' + valid.length + ' 席标的、共统本金 ' + fmtYuan(totalAmt) + '；穿透表象，前五大底层重仓已敛聚 ' + fmtYuan(top5Yuan) + '（占全仓 ' + (top5Weight * 100).toFixed(1) + '%，前十透明覆盖率 ' + (pen.coveredRatio * 100).toFixed(1) + '%）。'
    };

    var line2 = overlapCount > 0
      ? {
          tag: '贰·听风',
          cls: 'rose',
          text: '检出 ' + overlapCount + ' 处同源交叠，暗合资金达 ' + fmtYuan(overlapYuan) + '（占总本金 ' + overlapPct.toFixed(1) + '%）；魁首「' + top1Name + '」独揽 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）' + (top2Name ? '，次席「' + top2Name + '」紧随其后。' : '。')
        }
      : {
          tag: '贰·听风',
          cls: 'emerald',
          text: '各路底层脉络泾渭分明，前十重仓 0 处交叠；头号压舱石为「' + top1Name + '」，折合 ' + fmtYuan(top1Yuan) + '（占 ' + top1Pct.toFixed(1) + '%）。'
        };

    var line3;
    var rebalanceLow = fmtYuan(totalAmt * 0.20);
    var rebalanceHigh = fmtYuan(totalAmt * 0.30);

    if (overlapCount >= 4 || overlapWeight >= 0.20) {
      line3 = {
        tag: '叁·破局',
        cls: 'violet',
        text: '名虽多路分兵，实则同源合流（恰似千溪归于一壑）；宜裁减同质宽基，拨出 20%~30% 筹码（约 ' + rebalanceLow + '~' + rebalanceHigh + '）改配红利低波、黄金或跨洋资产，方成掎角之势。'
      };
      return {
        tone: 'warn',
        badge: '【同源之困】',
        title: '名虽 ' + valid.length + ' 路分兵，实则千溪归于一壑：' + overlapCount + ' 只底层核心股多基共持，同源暗合高达 ' + fmtYuan(overlapYuan) + '（' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '仅「' + top1Name + '」一席便借多基合流敛聚 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '三维舞台中朱砂四棱锥所示即为同源交叠之处，点击任一走廊可独观其脉。',
        overlapYuan: overlapYuan,
        overlapPct: overlapPct,
        top1Name: top1Name,
        top1Yuan: top1Yuan,
        top1Pct: top1Pct,
        spectrumScore: spectrumScore,
        terminalLines: [line1, line2, line3]
      };
    }
    if (overlapCount >= 1) {
      line3 = {
        tag: '叁·审势',
        cls: 'violet',
        text: '阵中虽有微澜交集（区间最大回撤 ' + mddText + '），然未伤大体；可于左下「叠嶂」舱核查共持权重，酌情以跨周期资产微调平衡。'
      };
      return {
        tone: 'mid',
        badge: '【微澜同源】',
        title: '麾下 ' + valid.length + ' 席持仓偶有交集：检出 ' + overlapCount + ' 只底层重仓跨基共持，合流资金约 ' + fmtYuan(overlapYuan) + '（占 ' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '头号底层重仓为「' + top1Name + '」，折合 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '可于下方切换「单基十股」与「三维共振曲面」细审脉络。',
        overlapYuan: overlapYuan,
        overlapPct: overlapPct,
        top1Name: top1Name,
        top1Yuan: top1Yuan,
        top1Pct: top1Pct,
        spectrumScore: spectrumScore,
        terminalLines: [line1, line2, line3]
      };
    }
    if (valid.length === 1) {
      line3 = {
        tag: '叁·拓疆',
        cls: 'violet',
        text: '当前独骑孤军（区间最大回撤 ' + mddText + '），风浪全系于一脉；不妨添入 1~2 席异源资产（如红利、黄金或海外宽基），演练跨界制衡之道。'
      };
      return {
        tone: 'mid',
        badge: '【独木成林】',
        title: '当前独守一席「' + (assetsMap[valid[0].code] ? assetsMap[valid[0].code].name : valid[0].code) + '」，统御本金 ' + fmtYuan(totalAmt),
        detail: (top1 ? '该标的头号底层筹码为「' + top1Name + '」（折合 ' + fmtYuan(top1Yuan) + '）。' : '') + '建议于顶部再遣入 1~2 席不同脉络资产，观其三维共振之变。',
        overlapYuan: 0,
        overlapPct: 0,
        top1Name: top1Name,
        top1Yuan: top1Yuan,
        top1Pct: top1Pct,
        spectrumScore: spectrumScore,
        terminalLines: [line1, line2, line3]
      };
    }
    if (corrLevel === 'LOW') {
      line3 = {
        tag: '叁·守成',
        cls: 'emerald',
        text: '阵法已得“和而不同”之妙（历史最大回撤仅 ' + mddText + '），东隅纵有风浪，桑榆足可相抵；无需轻易易辙，季末削盈补亏、守正待时即可。'
      };
      return {
        tone: 'good',
        badge: '【和而不同】',
        title: '四时各司其职，风浪互为藩篱：' + valid.length + ' 路资产底层 0 交叠且走势互补，深得真分散之妙',
        detail: '总本金 ' + fmtYuan(totalAmt) + ' 疏朗分布于异源资产，历史最大回撤仅 ' + mddText + '，尽避同源踩踏之虞。',
        overlapYuan: 0,
        overlapPct: 0,
        top1Name: top1Name,
        top1Yuan: top1Yuan,
        top1Pct: top1Pct,
        spectrumScore: spectrumScore,
        terminalLines: [line1, line2, line3]
      };
    }
    line3 = {
      tag: '叁·守正',
      cls: 'violet',
      text: '底层筹码虽无重叠（区间最大回撤 ' + mddText + '），然同处一域潮汐，走势尚存共鸣；若欲更臻稳健，可掺入一成黄金或高息压舱。'
    };
    return {
      tone: 'good',
      badge: '【疏朗有致】',
      title: '麾下 ' + valid.length + ' 席标的底层 0 交叠，筹码疏朗有致；唯同处相近周期，潮汐尚存共鸣（最大回撤 ' + mddText + '）',
      detail: (top1 ? '当前头号底层重仓为「' + top1Name + '」（' + fmtYuan(top1Yuan) + '，' + top1Pct.toFixed(1) + '%）。' : '') + '若欲进一步削峰填谷，可引入跨洋或商品资产。',
      overlapYuan: 0,
      overlapPct: 0,
      top1Name: top1Name,
      top1Yuan: top1Yuan,
      top1Pct: top1Pct,
      spectrumScore: spectrumScore,
      terminalLines: [line1, line2, line3]
    };
  }

  /** 5. After-tax dividend yield by A-share holding period */
  function calcAfterTaxDividend(ttmYieldPct, principal, holdingPeriod, benchmarkPct) {
    holdingPeriod = holdingPeriod || 'gt_1y';
    if (benchmarkPct === undefined || benchmarkPct === null) benchmarkPct = 2.0;
    var taxMap = { lt_1m: 0.20, '1m_to_1y': 0.10, gt_1y: 0.00 };
    var taxRate = taxMap[holdingPeriod] === undefined ? 0 : taxMap[holdingPeriod];
    var netYieldPct = Number(ttmYieldPct) * (1 - taxRate);
    var annualCashAfterTax = Number(principal) * (netYieldPct / 100);
    var extraCashVsBenchmark = Number(principal) * ((netYieldPct - Number(benchmarkPct)) / 100);
    return {
      taxRate: taxRate,
      netYieldPct: netYieldPct,
      annualCashAfterTax: annualCashAfterTax,
      spreadPct: netYieldPct - Number(benchmarkPct),
      extraCashVsBenchmark: extraCashVsBenchmark
    };
  }

  /* ============================================================================
   * HAND-WRITTEN 3D PERSPECTIVE PROJECTION KERNEL (Zero External Libraries)
   * ============================================================================ */

  function projectPoint3D(x, y, z, cam) {
    var dx = x - (cam.targetX || 0);
    var dy = y - (cam.targetY || 0);
    var dz = z - (cam.targetZ || 0);

    var cosY = Math.cos(cam.yaw), sinY = Math.sin(cam.yaw);
    var x1 = dx * cosY - dz * sinY;
    var z1 = dx * sinY + dz * cosY;

    var cosP = Math.cos(cam.pitch), sinP = Math.sin(cam.pitch);
    var y2 = dy * cosP - z1 * sinP;
    var z2 = dy * sinP + z1 * cosP;

    var depth = cam.dist + z2;
    if (depth < 40) depth = 40;
    var scale = cam.fov / depth;
    return {
      x: cam.cx + x1 * scale,
      y: cam.cy - y2 * scale,
      z: z2,
      scale: scale
    };
  }

  /**
   * Build the transparent interactive SVG overlay aligned with the 3D Stage coordinates.
   * Preserves `.flow-node[data-flow-code]` and `.flow-edge` DOM contracts for instant click hit-testing,
   * accessibility, and 100% compatibility with automated verification suites.
   */
  function fundStockFlowSVG(positions, assetsMap, pen, focusCode) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmt = pen && pen.totalAmount ? pen.totalAmount : 0;
    var stocks = (pen && pen.exposures) ? pen.exposures.slice(0, 10) : [];
    if (!valid.length || totalAmt <= 0 || !stocks.length) {
      return '<div style="padding:36px;text-align:center;color:var(--ink-faint,#888)">暂无有效持仓数据，无法开启三维穿透景深舞台</div>';
    }

    var W = 1120, H = 376;
    var cam = {
      cx: W * 0.50,
      cy: H * 0.56,
      fov: 760,
      dist: 790,
      yaw: -0.26,
      pitch: 0.34,
      targetX: 0,
      targetY: 36,
      targetZ: 0
    };

    var colorBySource = {};
    valid.forEach(function (p, idx) {
      colorBySource[p.code] = ASSET_COLORS[idx % ASSET_COLORS.length];
    });

    var nFunds = valid.length;
    var leftNodes = valid.map(function (p, idx) {
      var t = nFunds === 1 ? 0.5 : idx / (nFunds - 1);
      var zPos = -75 + t * 265;
      var xPos = -310;
      var wRatio = Number(p.amount) / totalAmt;
      var h3d = 26 + wRatio * 82;
      var ptBase = projectPoint3D(xPos, 0, zPos, cam);
      var ptTop = projectPoint3D(xPos, h3d, zPos, cam);
      var a = assetsMap[p.code] || {};
      return {
        code: p.code,
        name: a.name || p.code,
        amount: Number(p.amount),
        wPct: wRatio * 100,
        color: colorBySource[p.code],
        x3: xPos, y3: h3d, z3: zPos,
        sx: ptTop.x, sy: ptTop.y,
        bx: ptBase.x, by: ptBase.y
      };
    });

    var maxStockW = stocks[0] ? stocks[0].totalWeight : 0.01;
    var nStocks = stocks.length;
    var rightNodes = stocks.map(function (st, idx) {
      var t = nStocks === 1 ? 0.5 : idx / (nStocks - 1);
      var zPos = -180 + t * 350;
      var xPos = 35 + idx * 33;
      var barRatio = Math.max(0.12, Math.min(1, st.totalWeight / maxStockW));
      var h3d = 28 + barRatio * 118;
      var ptBase = projectPoint3D(xPos, 0, zPos, cam);
      var ptTop = projectPoint3D(xPos, h3d, zPos, cam);
      return {
        code: st.code,
        name: st.name,
        totalWeight: st.totalWeight,
        totalYuan: totalAmt * st.totalWeight,
        barRatio: barRatio,
        contributors: st.contributors || [],
        isOverlap: (st.contributors || []).length >= 2,
        x3: xPos, y3: h3d, z3: zPos,
        sx: ptTop.x, sy: ptTop.y,
        bx: ptBase.x, by: ptBase.y
      };
    });

    var leftByCode = {};
    leftNodes.forEach(function (n) { leftByCode[n.code] = n; });

    var hasFocus = !!(focusCode && (
      leftNodes.some(function (n) { return n.code === focusCode; }) ||
      rightNodes.some(function (n) { return n.code === focusCode; })
    ));

    // SVG overlay provides accessible hit-targets & vector crisp badges over the 3D Canvas
    var o = '<svg class="flow-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block;position:relative;z-index:2">';

    // Laser-thin 3D projected parabolic light arcs (`.flow-edge` contract)
    rightNodes.forEach(function (rn) {
      rn.contributors.forEach(function (c) {
        var ln = leftByCode[c.sourceCode];
        if (!ln) return;
        var active = !hasFocus || focusCode === ln.code || focusCode === rn.code;
        var midX = (ln.x3 + rn.x3) * 0.5;
        var midY = Math.max(ln.y3, rn.y3) + 52 + (rn.isOverlap ? 24 : 8);
        var midZ = (ln.z3 + rn.z3) * 0.5;
        var pMid = projectPoint3D(midX, midY, midZ, cam);
        var d = 'M' + ln.sx.toFixed(1) + ',' + ln.sy.toFixed(1)
          + ' Q' + pMid.x.toFixed(1) + ',' + pMid.y.toFixed(1)
          + ' ' + rn.sx.toFixed(1) + ',' + rn.sy.toFixed(1);
        var opacity = !hasFocus ? 0.18 : (active ? 0.55 : 0.03);
        o += '<path class="flow-edge" data-src="' + esc(ln.code) + '" data-dst="' + esc(rn.code) + '" d="' + d
          + '" fill="none" stroke="' + ln.color + '" stroke-width="1.2" stroke-linecap="round" opacity="' + opacity + '" pointer-events="none"/>';
      });
    });

    // Fund 3D Corridor Hit Targets (`.flow-node` contract)
    leftNodes.forEach(function (ln) {
      var isSelf = focusCode === ln.code;
      var boxW = 152, boxH = 38;
      var rx = Math.max(8, ln.sx - boxW * 0.72);
      var ry = Math.max(8, ln.sy - boxH * 0.55);
      o += '<g class="flow-node" data-flow-code="' + esc(ln.code) + '" style="cursor:pointer">';
      o += '<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + boxW + '" height="' + boxH
        + '" rx="3" fill="rgba(7,10,16,0.01)" stroke="' + (isSelf ? ln.color : 'transparent') + '" stroke-width="1.2"/>';
      o += '<title>' + esc(ln.name) + ' · ' + esc(fmtYuan(ln.amount)) + ' (' + ln.wPct.toFixed(1) + '%)</title>';
      o += '</g>';
    });

    // Underlying Stock 3D Crystal Pillar Hit Targets (`.flow-node` contract)
    rightNodes.forEach(function (rn) {
      var isSelf = focusCode === rn.code;
      var boxW = 110, boxH = Math.max(44, Math.abs(rn.by - rn.sy) + 28);
      var rx = rn.sx - boxW * 0.5;
      var ry = rn.sy - 22;
      o += '<g class="flow-node" data-flow-code="' + esc(rn.code) + '" style="cursor:pointer">';
      o += '<rect x="' + rx.toFixed(1) + '" y="' + ry.toFixed(1) + '" width="' + boxW + '" height="' + boxH.toFixed(1)
        + '" rx="3" fill="rgba(7,10,16,0.01)" stroke="' + (isSelf ? '#5CE1E6' : 'transparent') + '" stroke-width="1.2"/>';
      o += '<title>' + esc(cleanStockLabel(rn.name, 12)) + ' · ' + esc(fmtYuan(rn.totalYuan)) + ' (' + (rn.totalWeight * 100).toFixed(2) + '%)</title>';
      o += '</g>';
    });

    return o + '</svg>';
  }

  /**
   * Hand-Written 3D Perspective Stage Engine (`观澜 · 3D PERSPECTIVE PENETRATION STAGE`)
   * Renders directly onto `<canvas id="stage-3d-canvas">` inside `#flow-chart`:
   *  - 3D Perspective receding floor grid & horizon coordinates
   *  - Multi-depth Z-lanes for held ETFs with 3D historical NAV ribbons & glowing pedestals
   *  - Front Hero Composite Equity 3D Ribbon + Underwater 3D Amber Drawdown Pillars
   *  - Top-10 Underlying Stock 3D Crystal Prisms + Rotating 3D Cinnabar Wireframe Pyramids (`▲`)
   *  - Laser-thin 3D Parabolic Light Arcs (`1.1px`) with traveling light pulses
   *  - Right-edge vertical glowing telemetry scale & price callout tags
   */
  var STAGE_ANIM = {
    rafId: null,
    phase: 0,
    mouseX: 0,
    mouseY: 0,
    boundContainer: null,
    state: null
  };

  function draw3DPrism(ctx, x, z, wx, wz, h, cam, topCol, sideCol, frontCol, strokeCol) {
    var x0 = x - wx / 2, x1 = x + wx / 2;
    var z0 = z - wz / 2, z1 = z + wz / 2;
    var b00 = projectPoint3D(x0, 0, z0, cam);
    var b10 = projectPoint3D(x1, 0, z0, cam);
    var b11 = projectPoint3D(x1, 0, z1, cam);
    var b01 = projectPoint3D(x0, 0, z1, cam);

    var t00 = projectPoint3D(x0, h, z0, cam);
    var t10 = projectPoint3D(x1, h, z0, cam);
    var t11 = projectPoint3D(x1, h, z1, cam);
    var t01 = projectPoint3D(x0, h, z1, cam);

    // Front face (z1)
    ctx.beginPath();
    ctx.moveTo(b01.x, b01.y); ctx.lineTo(b11.x, b11.y);
    ctx.lineTo(t11.x, t11.y); ctx.lineTo(t01.x, t01.y);
    ctx.closePath();
    ctx.fillStyle = frontCol;
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 0.85;
    ctx.stroke();

    // Right/Left visible side face depending on yaw
    ctx.beginPath();
    ctx.moveTo(b10.x, b10.y); ctx.lineTo(b11.x, b11.y);
    ctx.lineTo(t11.x, t11.y); ctx.lineTo(t10.x, t10.y);
    ctx.closePath();
    ctx.fillStyle = sideCol;
    ctx.fill();
    ctx.stroke();

    // Left face (subtle translucent glass)
    ctx.beginPath();
    ctx.moveTo(b00.x, b00.y); ctx.lineTo(b01.x, b01.y);
    ctx.lineTo(t01.x, t01.y); ctx.lineTo(t00.x, t00.y);
    ctx.closePath();
    ctx.fillStyle = sideCol;
    ctx.fill();

    // Top cap
    ctx.beginPath();
    ctx.moveTo(t00.x, t00.y); ctx.lineTo(t10.x, t10.y);
    ctx.lineTo(t11.x, t11.y); ctx.lineTo(t01.x, t01.y);
    ctx.closePath();
    ctx.fillStyle = topCol;
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    return {
      topCenter: projectPoint3D(x, h, z, cam),
      baseCenter: projectPoint3D(x, 0, z, cam)
    };
  }

  function draw3DRotatingPyramid(ctx, x, yBase, z, radius, height, angle, cam, color) {
    var apex = projectPoint3D(x, yBase + height, z, cam);
    var corners = [];
    for (var i = 0; i < 4; i++) {
      var a = angle + i * Math.PI * 0.5;
      var cx = x + Math.cos(a) * radius;
      var cz = z + Math.sin(a) * radius;
      corners.push(projectPoint3D(cx, yBase, cz, cam));
    }
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = hexToRgba(color, 0.24);
    ctx.lineWidth = 1.15;

    // Base quad
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var j = 1; j < 4; j++) ctx.lineTo(corners[j].x, corners[j].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 4 triangular edges to apex
    for (var k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(corners[k].x, corners[k].y);
      ctx.lineTo(apex.x, apex.y);
      ctx.stroke();
    }
    ctx.restore();
    return apex;
  }

  function renderStage3DFrame() {
    var st = STAGE_ANIM.state;
    if (!st || !st.canvas) return;
    var canvas = st.canvas;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(320, rect.width || 960);
    var cssH = Math.max(250, rect.height || 376);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    var isLight = document.documentElement.getAttribute('data-theme') !== 'dark';
    var bgTop = isLight ? '#FAF9F5' : '#0E0E10';
    var bgBot = isLight ? '#F2F0E8' : '#151518';
    var gradBg = ctx.createLinearGradient(0, 0, 0, cssH);
    gradBg.addColorStop(0, bgTop);
    gradBg.addColorStop(1, bgBot);
    ctx.fillStyle = gradBg;
    ctx.fillRect(0, 0, cssW, cssH);

    // Subtle warm paper / obsidian radial aura in the 3D horizon
    var aura = ctx.createRadialGradient(cssW * 0.48, cssH * 0.44, 10, cssW * 0.48, cssH * 0.48, cssW * 0.56);
    aura.addColorStop(0, isLight ? 'rgba(37,99,235,0.06)' : 'rgba(96,165,250,0.08)');
    aura.addColorStop(0.55, isLight ? 'rgba(124,58,237,0.04)' : 'rgba(167,139,250,0.05)');
    aura.addColorStop(1, isLight ? 'rgba(250,249,245,0)' : 'rgba(14,14,16,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, cssW, cssH);

    var swayYaw = Math.sin(STAGE_ANIM.phase * 0.65) * 0.022 + STAGE_ANIM.mouseX * 0.08;
    var swayPitch = Math.cos(STAGE_ANIM.phase * 0.45) * 0.010 + STAGE_ANIM.mouseY * 0.04;
    var cam = {
      cx: cssW * 0.485,
      cy: cssH * 0.585,
      fov: Math.min(cssW, 1120) * 0.72,
      dist: 790,
      yaw: -0.26 + swayYaw,
      pitch: 0.34 + swayPitch,
      targetX: 0,
      targetY: 34,
      targetZ: 0
    };

    // 1. 3D Perspective Floor Grid (y = 0 plane, homage to muse-grammar-notes --paper-rule)
    var gridXMin = -420, gridXMax = 340;
    var gridZMin = -230, gridZMax = 230;
    ctx.lineWidth = 1;
    for (var gx = gridXMin; gx <= gridXMax; gx += 76) {
      var p0 = projectPoint3D(gx, 0, gridZMin, cam);
      var p1 = projectPoint3D(gx, 0, gridZMax, cam);
      ctx.strokeStyle = isLight ? 'rgba(64,112,178,0.13)' : 'rgba(255,255,255,0.075)';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    for (var gz = gridZMin; gz <= gridZMax; gz += 46) {
      var q0 = projectPoint3D(gridXMin, 0, gz, cam);
      var q1 = projectPoint3D(gridXMax, 0, gz, cam);
      ctx.strokeStyle = isLight ? 'rgba(64,112,178,0.11)' : 'rgba(255,255,255,0.065)';
      ctx.beginPath();
      ctx.moveTo(q0.x, q0.y);
      ctx.lineTo(q1.x, q1.y);
      ctx.stroke();
    }

    // Back vertical telemetry grid wall (z = gridZMin)
    for (var gy = 35; gy <= 140; gy += 35) {
      var w0 = projectPoint3D(gridXMin, gy, gridZMin, cam);
      var w1 = projectPoint3D(gridXMax, gy, gridZMin, cam);
      ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)';
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y);
      ctx.lineTo(w1.x, w1.y);
      ctx.stroke();
    }

    var valid = st.valid;
    var stocks = st.stocks;
    var totalAmt = st.totalAmt;
    var focusCode = st.focusCode;
    var assetsMap = st.assetsMap;

    // 2. Multi-Lane 3D ETF Historical NAV Ribbons & Pedestals (Left-to-Center Z corridors)
    var nFunds = valid.length;
    var leftNodes = [];
    for (var fIdx = 0; fIdx < nFunds; fIdx++) {
      var pos = valid[fIdx];
      var asset = assetsMap[pos.code] || {};
      var color = ASSET_COLORS[fIdx % ASSET_COLORS.length];
      var tFund = nFunds === 1 ? 0.5 : fIdx / (nFunds - 1);
      var zLane = -75 + tFund * 265;
      var xPedestal = -310;
      var wRatio = Number(pos.amount) / totalAmt;
      var hPedestal = 26 + wRatio * 82;

      var isFocused = !focusCode || focusCode === pos.code;
      var alphaMul = isFocused ? 1 : 0.25;

      // Draw 3D Historical NAV Ribbon along X: [-310 .. -65] at Z = zLane
      var closes = (asset.closes || []).slice(-90);
      if (closes.length >= 4) {
        var cMin = Infinity, cMax = -Infinity;
        for (var ci = 0; ci < closes.length; ci++) {
          var cv = closes[ci].c;
          if (cv < cMin) cMin = cv;
          if (cv > cMax) cMax = cv;
        }
        if (cMax <= cMin) cMax = cMin + 1;
        var ribbonPts = [];
        var floorPts = [];
        var step = Math.max(1, Math.floor(closes.length / 28));
        for (var k = 0; k < closes.length; k += step) {
          var u = k / (closes.length - 1);
          var rx = -305 + u * 235;
          var norm = (closes[k].c - cMin) / (cMax - cMin);
          var ry = 14 + norm * (36 + wRatio * 52);
          ribbonPts.push(projectPoint3D(rx, ry, zLane, cam));
          floorPts.push(projectPoint3D(rx, 0, zLane, cam));
        }
        if (ribbonPts.length >= 2) {
          // Translucent 3D ribbon curtain wall
          ctx.beginPath();
          ctx.moveTo(floorPts[0].x, floorPts[0].y);
          for (var rp = 0; rp < ribbonPts.length; rp++) ctx.lineTo(ribbonPts[rp].x, ribbonPts[rp].y);
          ctx.lineTo(floorPts[floorPts.length - 1].x, floorPts[floorPts.length - 1].y);
          ctx.closePath();
          ctx.fillStyle = hexToRgba(color, (isLight ? 0.16 : 0.14) * alphaMul);
          ctx.fill();

          // Glowing 3D top ridge line
          ctx.beginPath();
          for (var rl = 0; rl < ribbonPts.length; rl++) {
            if (rl === 0) ctx.moveTo(ribbonPts[rl].x, ribbonPts[rl].y);
            else ctx.lineTo(ribbonPts[rl].x, ribbonPts[rl].y);
          }
          ctx.strokeStyle = hexToRgba(color, 0.88 * alphaMul);
          ctx.lineWidth = isFocused ? 1.85 : 1.05;
          ctx.stroke();
        }
      }

      // Draw 3D Pedestal Prism for the Fund at x = -335
      var prism = draw3DPrism(
        ctx, xPedestal, zLane, 24, 24, hPedestal, cam,
        hexToRgba(color, (isLight ? 0.82 : 0.72) * alphaMul),
        hexToRgba(color, (isLight ? 0.42 : 0.34) * alphaMul),
        hexToRgba(color, (isLight ? 0.58 : 0.48) * alphaMul),
        hexToRgba(color, 0.95 * alphaMul)
      );

      // Crisp 3D Fund Label Plaque
      var tx = prism.topCenter.x - 10;
      var ty = prism.topCenter.y - 8;
      ctx.save();
      ctx.font = '600 11px "PingFang SC","SF Pro Text",sans-serif';
      var labelTxt = shortLabel(asset.name || pos.code, 8);
      var subTxt = fmtYuan(pos.amount) + ' · ' + (wRatio * 100).toFixed(0) + '%';
      ctx.fillStyle = isLight ? (isFocused ? '#0B0B0B' : 'rgba(11,11,11,0.35)') : (isFocused ? '#F2F2F2' : 'rgba(242,242,242,0.32)');
      ctx.textAlign = 'right';
      ctx.fillText(labelTxt, tx, ty - 11);
      ctx.font = '600 10px "JetBrains Mono","SF Mono",monospace';
      ctx.fillStyle = hexToRgba(color, isFocused ? 0.96 : 0.38);
      ctx.fillText(subTxt, tx, ty + 1);
      ctx.restore();

      leftNodes.push({
        code: pos.code,
        name: asset.name || pos.code,
        amount: Number(pos.amount),
        wPct: wRatio * 100,
        color: color,
        x3: xPedestal, y3: hPedestal, z3: zLane,
        topPt: prism.topCenter
      });
    }

    // 3. Front Hero Composite Portfolio 3D Equity Ribbon & Underwater Drawdown Amber Bars
    if (st.curve && st.curve.curve && st.curve.curve.length >= 6) {
      var cSeries = st.curve.curve;
      var nMin = Infinity, nMax = -Infinity;
      for (var ni = 0; ni < cSeries.length; ni++) {
        if (cSeries[ni].nav < nMin) nMin = cSeries[ni].nav;
        if (cSeries[ni].nav > nMax) nMax = cSeries[ni].nav;
      }
      if (nMax <= nMin) nMax = nMin + 0.1;
      var zFront = 212;
      var heroPts = [], heroBase = [];
      var cStep = Math.max(1, Math.floor(cSeries.length / 40));
      for (var hi = 0; hi < cSeries.length; hi += cStep) {
        var hu = hi / (cSeries.length - 1);
        var hx = -270 + hu * 430;
        var hNorm = (cSeries[hi].nav - nMin) / (nMax - nMin);
        var hy = 12 + hNorm * 62;
        heroPts.push(projectPoint3D(hx, hy, zFront, cam));
        heroBase.push(projectPoint3D(hx, 0, zFront, cam));

        // 3D Underwater Drawdown Amber Micro-Bars along front trench
        var ddAbs = Math.abs(cSeries[hi].dd || 0);
        if (ddAbs > 0.015) {
          var ddH = Math.min(26, ddAbs * 85);
          var pDdTop = projectPoint3D(hx, 0, zFront + 12, cam);
          var pDdBot = projectPoint3D(hx, -ddH, zFront + 12, cam);
          ctx.strokeStyle = isLight ? 'rgba(217,119,6,0.58)' : 'rgba(245,158,11,0.55)';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(pDdTop.x, pDdTop.y);
          ctx.lineTo(pDdBot.x, pDdBot.y);
          ctx.stroke();
        }
      }
      if (heroPts.length >= 2) {
        ctx.beginPath();
        ctx.moveTo(heroBase[0].x, heroBase[0].y);
        for (var hp = 0; hp < heroPts.length; hp++) ctx.lineTo(heroPts[hp].x, heroPts[hp].y);
        ctx.lineTo(heroBase[heroBase.length - 1].x, heroBase[heroBase.length - 1].y);
        ctx.closePath();
        ctx.fillStyle = isLight ? 'rgba(124,58,237,0.13)' : 'rgba(167,139,250,0.13)';
        ctx.fill();

        ctx.beginPath();
        for (var hl = 0; hl < heroPts.length; hl++) {
          if (hl === 0) ctx.moveTo(heroPts[hl].x, heroPts[hl].y);
          else ctx.lineTo(heroPts[hl].x, heroPts[hl].y);
        }
        ctx.strokeStyle = isLight ? '#7C3AED' : '#A78BFA';
        ctx.lineWidth = 2.2;
        ctx.stroke();
      }
    }

    // 4. Right Foreground: Top-10 Underlying Stock 3D Crystal Prisms + Floating Cinnabar Pyramids + Non-Overlapping Telemetry Callouts
    var maxStockW = stocks[0] ? stocks[0].totalWeight : 0.01;
    var nStocks = stocks.length;
    var rightNodes = [];
    var isCompactScreen = cssW < 640;
    var overlapCol = isLight ? '#DC2626' : '#F43F5E';
    var normalCol = isLight ? '#2563EB' : '#60A5FA';
    var jadeCol = isLight ? '#079455' : '#10B981';

    for (var sIdx = 0; sIdx < nStocks; sIdx++) {
      var stItem = stocks[sIdx];
      var tStock = nStocks === 1 ? 0.5 : sIdx / (nStocks - 1);
      var zStock = -180 + tStock * 350;
      var xStock = 35 + sIdx * 33;
      var barRatio = Math.max(0.12, Math.min(1, stItem.totalWeight / maxStockW));
      var hCrystal = 28 + barRatio * 118;
      var isOverlap = (stItem.contributors || []).length >= 2;
      var sConnected = !focusCode || focusCode === stItem.code || (stItem.contributors || []).some(function (c) { return c.sourceCode === focusCode; });
      var sAlpha = sConnected ? 1 : 0.22;

      var cBase = isOverlap ? overlapCol : normalCol;
      var cPrism = draw3DPrism(
        ctx, xStock, zStock, 20, 20, hCrystal, cam,
        hexToRgba(cBase, (isLight ? 0.85 : 0.82) * sAlpha),
        hexToRgba(cBase, (isLight ? 0.36 : 0.30) * sAlpha),
        hexToRgba(cBase, (isLight ? 0.54 : 0.48) * sAlpha),
        hexToRgba(cBase, 0.96 * sAlpha)
      );

      var beaconPt = cPrism.topCenter;
      // Floating Rotating 3D Cinnabar Pyramid above overlapped stocks
      if (isOverlap) {
        beaconPt = draw3DRotatingPyramid(
          ctx, xStock, hCrystal + 8, zStock, 10, 15,
          STAGE_ANIM.phase * 1.6 + sIdx, cam,
          hexToRgba(overlapCol, sAlpha)
        );
      }

      // Non-overlapping callout plaque with laser leader line on desktop, compact top-5 tags on narrow mobile
      if (!isCompactScreen || sIdx < 5 || focusCode === stItem.code) {
        var cleanNm = cleanStockLabel(stItem.name, 6);
        var yuanTxt = fmtYuan(totalAmt * stItem.totalWeight);
        var colX = isCompactScreen
          ? Math.min(cssW - 108, Math.max(120, beaconPt.x + 8))
          : (sIdx % 2 === 0 ? cssW - 295 : cssW - 172);
        var rowY = isCompactScreen
          ? (36 + sIdx * 52)
          : (34 + Math.floor(sIdx / 2) * 52 + (sIdx % 2) * 24);

        ctx.save();
        // Thin laser leader line from 3D pyramid/crystal apex to callout tag
        ctx.beginPath();
        ctx.moveTo(beaconPt.x, beaconPt.y);
        ctx.lineTo(colX - 4, rowY - 3);
        ctx.strokeStyle = hexToRgba(cBase, (sConnected ? 0.42 : 0.12));
        ctx.lineWidth = 0.85;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Translucent callout pill background
        var pillW = isCompactScreen ? 102 : 108, pillH = 26;
        ctx.fillStyle = isLight ? 'rgba(255,255,255,0.92)' : 'rgba(18,18,22,0.88)';
        ctx.strokeStyle = hexToRgba(cBase, sConnected ? 0.50 : 0.18);
        ctx.lineWidth = 0.9;
        ctx.fillRect(colX - 3, rowY - 14, pillW, pillH);
        ctx.strokeRect(colX - 3, rowY - 14, pillW, pillH);

        ctx.textAlign = 'left';
        ctx.font = '600 10.5px "PingFang SC","SF Pro Text",sans-serif';
        ctx.fillStyle = isLight
          ? (sConnected ? '#0B0B0B' : 'rgba(11,11,11,0.32)')
          : (sConnected ? (isOverlap ? '#FCA5A5' : '#F2F2F2') : 'rgba(242,242,242,0.30)');
        ctx.fillText((isOverlap ? '▲ ' : '') + cleanNm, colX + 2, rowY - 2);

        ctx.font = '700 9.5px "JetBrains Mono","SF Mono",monospace';
        ctx.fillStyle = isOverlap
          ? hexToRgba(overlapCol, sConnected ? 0.96 : 0.30)
          : hexToRgba(jadeCol, sConnected ? 0.96 : 0.30);
        ctx.fillText(yuanTxt + (isOverlap ? '·' + stItem.contributors.length + '基' : '·' + (stItem.totalWeight * 100).toFixed(1) + '%'), colX + 2, rowY + 9);
        ctx.restore();
      }

      rightNodes.push({
        code: stItem.code,
        name: stItem.name,
        isOverlap: isOverlap,
        contributors: stItem.contributors || [],
        x3: xStock, y3: hCrystal, z3: zStock,
        topPt: cPrism.topCenter
      });
    }

    // 5. Laser-Thin 3D Parabolic Light Arcs + Traveling Light Pulses
    var leftMap = {};
    leftNodes.forEach(function (ln) { leftMap[ln.code] = ln; });

    rightNodes.forEach(function (rn, rIdx) {
      rn.contributors.forEach(function (c, cIdx) {
        var ln = leftMap[c.sourceCode];
        if (!ln) return;
        var active = !focusCode || focusCode === ln.code || focusCode === rn.code;
        var midX = (ln.x3 + rn.x3) * 0.5;
        var midY = Math.max(ln.y3, rn.y3) + 52 + (rn.isOverlap ? 24 : 8);
        var midZ = (ln.z3 + rn.z3) * 0.5;
        var p0 = ln.topPt;
        var p1 = projectPoint3D(midX, midY, midZ, cam);
        var p2 = rn.topPt;

        var arcAlpha = !focusCode ? (rn.isOverlap ? (isLight ? 0.65 : 0.62) : (isLight ? 0.42 : 0.36)) : (active ? 0.94 : 0.06);
        var arcColor = rn.isOverlap && active ? overlapCol : ln.color;

        // Ultra-crisp laser arc (1.0px ~ 1.7px, never thick noodles!)
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.strokeStyle = hexToRgba(arcColor, arcAlpha);
        ctx.lineWidth = active && focusCode ? 1.75 : (rn.isOverlap ? 1.35 : 0.95);
        ctx.stroke();

        // Traveling laser pulse particle along quadratic Bezier
        if (active) {
          var uPulse = ((STAGE_ANIM.phase * 0.38 + rIdx * 0.17 + cIdx * 0.31) % 1 + 1) % 1;
          var omt = 1 - uPulse;
          var px = omt * omt * p0.x + 2 * omt * uPulse * p1.x + uPulse * uPulse * p2.x;
          var py = omt * omt * p0.y + 2 * omt * uPulse * p1.y + uPulse * uPulse * p2.y;
          ctx.beginPath();
          ctx.arc(px, py, rn.isOverlap ? 2.5 : 1.9, 0, Math.PI * 2);
          ctx.fillStyle = rn.isOverlap ? overlapCol : (isLight ? '#2563EB' : '#93C5FD');
          ctx.fill();
        }
        ctx.restore();
      });
    });

    // 6. Right-Edge Vertical Telemetry Scale & HUD Callout Pills (Homage to @ludoonchart right axis)
    var axisX = cssW - 58;
    ctx.save();
    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(axisX, 20);
    ctx.lineTo(axisX, cssH - 22);
    ctx.stroke();

    var maxYuan = stocks[0] ? (totalAmt * stocks[0].totalWeight) : totalAmt * 0.1;
    for (var s = 0; s <= 4; s++) {
      var sy = 28 + (cssH - 56) * (s / 4);
      var valY = maxYuan * (1 - s / 4);
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.55)';
      ctx.font = '500 9px "JetBrains Mono","SF Mono",monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fmtYuan(valY), axisX + 5, sy + 3);
      ctx.beginPath();
      ctx.moveTo(axisX - 3, sy);
      ctx.lineTo(axisX + 2, sy);
      ctx.stroke();
    }

    // Bottom-left & bottom-center 3D axis telemetry captions
    ctx.font = '600 9.5px "JetBrains Mono","SF Mono",monospace';
    ctx.fillStyle = isLight ? '#2563EB' : '#60A5FA';
    ctx.textAlign = 'left';
    ctx.fillText('Z-CORRIDOR · 持仓基金三维净值走廊', 14, cssH - 9);
    if (!isCompactScreen) {
      ctx.textAlign = 'center';
      ctx.fillStyle = isLight ? '#7C3AED' : '#A78BFA';
      ctx.fillText('3D CRYSTAL PRISMS · 底层十股真实穿透晶柱 (▲ 朱砂四棱锥=多基同源)', cssW * 0.48, cssH - 9);
    }
    ctx.restore();

    ctx.restore();
  }

  function mountStage3DCanvas(container, positions, assetsMap, pen, curve, focusCode) {
    if (!container) return;
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmt = pen && pen.totalAmount ? pen.totalAmount : 0;
    var stocks = (pen && pen.exposures) ? pen.exposures.slice(0, 10) : [];

    // Populate container with `<canvas id="stage-3d-canvas">` + transparent interactive SVG overlay
    var svgOverlay = fundStockFlowSVG(positions, assetsMap, pen, focusCode);
    container.innerHTML =
      '<div class="stage-3d-stack" style="position:relative;width:100%;height:332px;overflow:hidden">'
      + '<canvas id="stage-3d-canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1"></canvas>'
      + svgOverlay
      + '</div>';

    var canvas = container.querySelector('#stage-3d-canvas');
    if (!canvas || !valid.length || totalAmt <= 0 || !stocks.length) return;

    STAGE_ANIM.state = {
      canvas: canvas,
      valid: valid,
      stocks: stocks,
      totalAmt: totalAmt,
      curve: curve,
      focusCode: focusCode,
      assetsMap: assetsMap
    };

    if (STAGE_ANIM.boundContainer !== container) {
      STAGE_ANIM.boundContainer = container;
      container.addEventListener('mousemove', function (e) {
        var r = container.getBoundingClientRect();
        if (!r.width || !r.height) return;
        STAGE_ANIM.mouseX = ((e.clientX - r.left) / r.width - 0.5) * 2;
        STAGE_ANIM.mouseY = ((e.clientY - r.top) / r.height - 0.5) * 2;
      });
      container.addEventListener('mouseleave', function () {
        STAGE_ANIM.mouseX = 0;
        STAGE_ANIM.mouseY = 0;
      });
    }

    // Immediately render synchronous first frame for instant paint & headless verification
    renderStage3DFrame();

    if (!STAGE_ANIM.rafId && typeof window !== 'undefined' && window.requestAnimationFrame) {
      var tick = function () {
        STAGE_ANIM.phase += 0.025;
        renderStage3DFrame();
        STAGE_ANIM.rafId = window.requestAnimationFrame(tick);
      };
      STAGE_ANIM.rafId = window.requestAnimationFrame(tick);
    }
  }

  /**
   * Hand-Written 3D Risk & Overlap Resonance Terrain Surface (`叠嶂 · 3D RESONANCE SURFACE`)
   * Direct homage to @ludoonchart's bottom-left `3D SURFACE · LIVE SHARPE` mesh:
   *  - 15×15 3D bicubic wireframe + shaded surface mesh (Concentration × Overlap/Correlation -> Resonance Height)
   *  - Live glowing Apex Beacon dot (`●`) marking the active portfolio's exact 3D coordinate on the terrain
   */
  function renderSurface3DCanvas(canvas, pen, corr, curve) {
    if (!canvas) return;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(240, rect.width || 320);
    var cssH = Math.max(165, rect.height || 195);
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);

    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.scale(dpr, dpr);

    var isLight = document.documentElement.getAttribute('data-theme') !== 'dark';
    ctx.fillStyle = isLight ? '#F8F7F2' : '#111114';
    ctx.fillRect(0, 0, cssW, cssH);

    var top1W = (pen && pen.exposures && pen.exposures[0]) ? pen.exposures[0].totalWeight : 0.06;
    var overlapW = (pen && pen.overlaps)
      ? pen.overlaps.reduce(function (s, x) { return s + x.totalWeight; }, 0)
      : 0;
    var avgCorr = (corr && corr.avgOffDiagonal != null) ? Math.max(0, corr.avgOffDiagonal) : 0.35;
    var mddAbs = (curve && curve.maxDrawdown != null) ? Math.abs(curve.maxDrawdown) : 0.15;

    // Normalized portfolio coordinate (uPort, vPort) in [0.12 .. 0.88]
    var uPort = Math.max(0.12, Math.min(0.88, top1W * 3.6 + mddAbs * 0.7));
    var vPort = Math.max(0.12, Math.min(0.88, overlapW * 2.1 + avgCorr * 0.45));

    var cam = {
      cx: cssW * 0.50,
      cy: cssH * 0.64,
      fov: Math.min(cssW, 380) * 0.92,
      dist: 360,
      yaw: -0.62,
      pitch: 0.48,
      targetX: 0,
      targetY: 18,
      targetZ: 0
    };

    var N = 14;
    var span = 176;
    var heightFn = function (u, v) {
      // Smooth two-peak resonance surface: low valley near (0,0), glowing ridge near (uPort, vPort) & (0.82, 0.82)
      var d1 = Math.pow(u - uPort, 2) + Math.pow(v - vPort, 2);
      var d2 = Math.pow(u - 0.82, 2) + Math.pow(v - 0.78, 2);
      var ridge1 = Math.exp(-d1 * 9.5) * (24 + overlapW * 95 + top1W * 120);
      var ridge2 = Math.exp(-d2 * 7.0) * 38;
      var wave = Math.sin(u * Math.PI * 1.5) * Math.cos(v * Math.PI * 1.5) * 8;
      return Math.max(3, 6 + (u * 0.4 + v * 0.6) * 22 + ridge1 + ridge2 + wave);
    };

    var gridPts = [];
    for (var i = 0; i <= N; i++) {
      var row = [];
      var u = i / N;
      var x = (u - 0.5) * span;
      for (var j = 0; j <= N; j++) {
        var v = j / N;
        var z = (v - 0.5) * span;
        var y = heightFn(u, v);
        var p = projectPoint3D(x, y, z, cam);
        p.h = y;
        row.push(p);
      }
      gridPts.push(row);
    }

    // Painter's algorithm from back rows to front rows
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var p00 = gridPts[r][c];
        var p10 = gridPts[r + 1][c];
        var p11 = gridPts[r + 1][c + 1];
        var p01 = gridPts[r][c + 1];
        var hAvg = (p00.h + p10.h + p11.h + p01.h) * 0.25;
        var hNorm = Math.min(1, Math.max(0, (hAvg - 6) / 68));

        var fillCol, strokeCol;
        if (hNorm < 0.35) {
          fillCol = isLight ? 'rgba(13,148,136,0.16)' : 'rgba(45,212,191,0.16)';
          strokeCol = isLight ? 'rgba(37,99,235,0.45)' : 'rgba(96,165,250,0.45)';
        } else if (hNorm < 0.68) {
          fillCol = isLight ? 'rgba(124,58,237,0.20)' : 'rgba(167,139,250,0.22)';
          strokeCol = isLight ? 'rgba(124,58,237,0.62)' : 'rgba(167,139,250,0.62)';
        } else {
          fillCol = isLight ? 'rgba(220,38,38,0.24)' : 'rgba(244,63,94,0.28)';
          strokeCol = isLight ? 'rgba(220,38,38,0.82)' : 'rgba(244,63,94,0.82)';
        }

        ctx.beginPath();
        ctx.moveTo(p00.x, p00.y);
        ctx.lineTo(p10.x, p10.y);
        ctx.lineTo(p11.x, p11.y);
        ctx.lineTo(p01.x, p01.y);
        ctx.closePath();
        ctx.fillStyle = fillCol;
        ctx.fill();
        ctx.strokeStyle = strokeCol;
        ctx.lineWidth = 0.75;
        ctx.stroke();
      }
    }

    // Live Portfolio Apex Beacon Dot on the 3D Surface
    var bx = (uPort - 0.5) * span;
    var bz = (vPort - 0.5) * span;
    var by = heightFn(uPort, vPort);
    var pBeacon = projectPoint3D(bx, by + 3, bz, cam);
    var pFloor = projectPoint3D(bx, 0, bz, cam);

    // Vertical laser plumb line
    var beaconCol = overlapW >= 0.15 ? (isLight ? '#DC2626' : '#F43F5E') : (overlapW > 0 ? '#D97706' : '#079455');
    ctx.strokeStyle = beaconCol;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath();
    ctx.moveTo(pFloor.x, pFloor.y);
    ctx.lineTo(pBeacon.x, pBeacon.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Beacon outer halo + core dot
    ctx.beginPath();
    ctx.arc(pBeacon.x, pBeacon.y, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(beaconCol, 0.26);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(pBeacon.x, pBeacon.y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.strokeStyle = beaconCol;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Micro HUD captions inside 3D Surface Canvas
    ctx.font = '600 9.5px "JetBrains Mono","SF Mono",monospace';
    ctx.fillStyle = isLight ? '#0B0B0B' : '#F2F2F2';
    ctx.textAlign = 'left';
    ctx.fillText('3D SURFACE · 同源共振地形', 8, 14);
    ctx.fillStyle = beaconCol;
    ctx.textAlign = 'right';
    ctx.fillText('● 当前坐标 (' + (uPort * 100).toFixed(0) + ',' + (vPort * 100).toFixed(0) + ')', cssW - 8, 14);

    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.58)';
    ctx.textAlign = 'left';
    ctx.fillText('X:集中度 × Z:同源相关', 8, cssH - 6);
    ctx.textAlign = 'right';
    ctx.fillText(overlapW >= 0.15 ? '峰值: 高危同源峰' : '峰值: 平缓绿洲', cssW - 8, cssH - 6);

    ctx.restore();
  }

  /* --- Auxiliary SVG Renderers (Correlation Matrix, Equity Ribbon, Dividend Timeline) --- */

  function perspectiveFloorSVG(W, H, topY, botY) {
    var o = '<g class="stage-floor" pointer-events="none">';
    var steps = [0, 0.22, 0.48, 0.74, 1.0];
    var leftIn = 46, rightIn = 34;
    steps.forEach(function (t) {
      var y = topY + (botY - topY) * t;
      var xL = leftIn * (1 - t * 0.65);
      var xR = W - rightIn * (1 - t * 0.65);
      o += '<line x1="' + xL.toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + xR.toFixed(1) + '" y2="' + y.toFixed(1)
        + '" stroke="var(--stage-grid,#5CE1E6)" stroke-opacity="' + (0.06 + t * 0.08).toFixed(2) + '" stroke-width="1"/>';
    });
    var cols = 9;
    for (var i = 0; i <= cols; i++) {
      var u = i / cols;
      var xTop = leftIn + (W - leftIn - rightIn) * u;
      var xBot = (leftIn * 0.35) + (W - (leftIn + rightIn) * 0.35) * u;
      o += '<line x1="' + xTop.toFixed(1) + '" y1="' + topY.toFixed(1) + '" x2="' + xBot.toFixed(1) + '" y2="' + botY.toFixed(1)
        + '" stroke="var(--stage-grid,#5CE1E6)" stroke-opacity="0.07" stroke-width="1"/>';
    }
    o += '</g>';
    return o;
  }

  /** Correlation heatmap SVG; value printed in each cell. */
  function correlationSVG(corr, labels) {
    var m = corr.matrix || [];
    var n = m.length;
    if (!n) return '<div style="padding:20px;text-align:center;color:#888">相关性数据不足（需≥6个共同交易日）</div>';
    var cell = 48, L = 86, T = 24, W = L + n * cell + 12, H = T + n * cell + 10;
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px">';
    labels.forEach(function (lb, j) {
      o += '<text x="' + (L + j * cell + cell / 2) + '" y="' + (T - 7) + '" font-size="10" fill="var(--ink-soft,#94A3B8)" text-anchor="middle">' + esc(lb) + '</text>';
      o += '<text x="' + (L - 6) + '" y="' + (T + j * cell + cell / 2 + 3) + '" font-size="10" fill="var(--ink-soft,#94A3B8)" text-anchor="end">' + esc(lb) + '</text>';
    });
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var v = m[i][j];
        var x = L + j * cell, y = T + i * cell;
        var fill = 'var(--surface,#101522)', fg = 'var(--ink,#F2F5FA)';
        if (i === j) {
          fill = 'rgba(165,148,249,0.22)';
        } else if (v !== null && v >= 0.55) {
          fill = 'rgba(244,63,94,' + (0.20 + v * 0.45).toFixed(3) + ')';
          fg = '#fff';
        } else if (v !== null && v > 0) {
          fill = 'rgba(92,225,230,' + (0.12 + v * 0.35).toFixed(3) + ')';
        } else if (v !== null && v < 0) {
          fill = 'rgba(45,212,191,' + (0.15 + Math.abs(v) * 0.45).toFixed(3) + ')';
          fg = '#fff';
        }
        o += '<rect x="' + x + '" y="' + y + '" width="' + (cell - 3) + '" height="' + (cell - 3) + '" rx="3" fill="' + fill + '" stroke="var(--line,#1b2336)"/>';
        o += '<text x="' + (x + (cell - 3) / 2) + '" y="' + (y + (cell - 3) / 2 + 3.5) + '" font-size="10.5" font-family="monospace" font-weight="600" fill="' + fg + '" text-anchor="middle">' + (v === null ? '--' : v.toFixed(2)) + '</text>';
      }
    }
    return o + '</svg>';
  }

  /** Glowing Ribbon NAV curve with max-drawdown depth shading & right-edge callout tag. */
  function navDrawdownSVG(result) {
    if (!result || !result.curve || result.curve.length < 2) return '<div style="padding:20px;text-align:center;color:#888">净值数据不足</div>';
    var curve = result.curve, W = 640, H = 236, L = 16, R = 64, T = 20, B = 34;
    var iw = W - L - R, ih = H - T - B;
    var lo = Infinity, hi = -Infinity;
    curve.forEach(function (p) { lo = Math.min(lo, p.nav); hi = Math.max(hi, p.nav); });
    if (hi === lo) { hi = lo + 1; }
    var X = function (i) { return L + i / (curve.length - 1) * iw; };
    var Y = function (v) { return T + (hi - v) / (hi - lo) * ih; };
    var pts = curve.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p.nav).toFixed(1); }).join(' ');
    var areaPts = X(0).toFixed(1) + ',' + (T + ih) + ' ' + pts + ' ' + X(curve.length - 1).toFixed(1) + ',' + (T + ih);

    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">';
    o += perspectiveFloorSVG(W - R + 10, H, H - 34, H - 4);

    [0, 0.25, 0.5, 0.75, 1].forEach(function (k) {
      var y = T + ih * k;
      var val = (hi - (hi - lo) * k);
      o += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="var(--line,#1e2638)" stroke-dasharray="2,3"/>';
      o += '<text x="' + (W - R + 6) + '" y="' + (y + 3).toFixed(1) + '" font-size="9.5" font-family="monospace" fill="var(--ink-faint,#64748B)">' + val.toFixed(3) + '</text>';
    });

    if (result.mddRange && result.mddRange[0] && result.mddRange[1]) {
      var i0 = curve.findIndex(function (p) { return p.t >= result.mddRange[0]; });
      var i1 = curve.findIndex(function (p) { return p.t >= result.mddRange[1]; });
      if (i0 >= 0 && i1 > i0) {
        o += '<rect x="' + X(i0).toFixed(1) + '" y="' + T + '" width="' + (X(i1) - X(i0)).toFixed(1) + '" height="' + ih + '" fill="#F43F5E" opacity="0.13"/>';
        o += '<text x="' + ((X(i0) + X(i1)) / 2).toFixed(1) + '" y="' + (T + 13) + '" font-size="9" font-family="monospace" fill="#FB7185" text-anchor="middle">最大回撤 ' + (result.maxDrawdown * 100).toFixed(1) + '%</text>';
      }
    }

    o += '<polygon points="' + areaPts + '" fill="#A594F9" opacity="0.09"/>';
    o += '<polyline points="' + pts + '" fill="none" stroke="#A594F9" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.22"/>';
    o += '<polyline points="' + pts + '" fill="none" stroke="#A594F9" stroke-width="2.0" stroke-linecap="round" stroke-linejoin="round"/>';

    var lastNav = curve[curve.length - 1].nav;
    var lastY = Math.max(T + 10, Math.min(T + ih - 10, Y(lastNav)));
    var retPct = ((lastNav - 1) * 100);
    var pillCol = retPct >= 0 ? '#2DD4BF' : '#F43F5E';
    o += '<line x1="' + L + '" y1="' + lastY.toFixed(1) + '" x2="' + (W - R) + '" y2="' + lastY.toFixed(1) + '" stroke="' + pillCol + '" stroke-dasharray="3,3" stroke-opacity="0.6"/>';
    o += '<rect x="' + (W - R + 3) + '" y="' + (lastY - 9).toFixed(1) + '" width="56" height="18" rx="3" fill="' + pillCol + '"/>';
    o += '<text x="' + (W - R + 31) + '" y="' + (lastY + 3.5).toFixed(1) + '" font-size="9.5" font-family="monospace" font-weight="700" fill="#041014" text-anchor="middle">'
      + (retPct >= 0 ? '+' : '') + retPct.toFixed(1) + '%</text>';

    o += '<text x="' + L + '" y="' + (H - 8) + '" font-size="9.5" font-family="monospace" fill="var(--ink-faint,#64748B)">' + esc(curve[0].t) + '</text>';
    o += '<text x="' + (W - R) + '" y="' + (H - 8) + '" font-size="9.5" font-family="monospace" fill="var(--ink-faint,#64748B)" text-anchor="end">' + esc(curve[curve.length - 1].t) + '</text>';
    return o + '</svg>';
  }

  /** 10-year cash dividend bars + ex-rights fill timeline. */
  function dividendTimelineSVG(div) {
    var hist = (div && div.history) || [];
    if (!hist.length) return '<div style="padding:20px;text-align:center;color:#888">暂无实施分红记录</div>';
    var W = 640, H = 190, L = 34, R = 14, T = 20, B = 38;
    var iw = W - L - R, ih = H - T - B;
    var maxCash = Math.max.apply(null, hist.map(function (h) { return h.cashPer10 || 0; })) || 1;
    var bw = Math.min(28, iw / hist.length * 0.6);
    var yearCounts = {};
    hist.forEach(function (h) { yearCounts[h.year] = (yearCounts[h.year] || 0) + 1; });
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">';
    o += perspectiveFloorSVG(W, H, H - 36, H - 4);
    hist.forEach(function (h, i) {
      var x = L + (i + 0.5) * iw / hist.length;
      var bh = Math.max(4, (h.cashPer10 / maxCash) * ih);
      var fill = h.filled === false ? '#F43F5E' : (h.filled === true ? '#A594F9' : '#64748B');
      var xLabel = (yearCounts[h.year] > 1 && h.exDate) ? h.exDate.slice(2, 7) : String(h.year);
      o += '<rect x="' + (x - bw / 2).toFixed(1) + '" y="' + (T + ih - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="2" fill="' + fill + '" opacity="0.88"/>';
      o += '<text x="' + x.toFixed(1) + '" y="' + (T + ih - bh - 5).toFixed(1) + '" font-size="9.5" font-family="monospace" fill="var(--ink,#F2F5FA)" text-anchor="middle">' + (h.cashPer10 || 0) + '</text>';
      o += '<text x="' + x.toFixed(1) + '" y="' + (H - 18) + '" font-size="9.5" font-family="monospace" fill="var(--ink-soft,#94A3B8)" text-anchor="middle">' + esc(xLabel) + '</text>';
      o += '<text x="' + x.toFixed(1) + '" y="' + (H - 5) + '" font-size="8.5" font-family="monospace" fill="' + (h.filled === false ? '#FB7185' : '#2DD4BF') + '" text-anchor="middle">' + (h.filled === false ? '未填权' : (h.fillDays ? h.fillDays + '日' : '--')) + '</text>';
    });
    return o + '</svg>';
  }

  var api = {
    ASSET_COLORS: ASSET_COLORS,
    penetratePortfolio: penetratePortfolio,
    computeCorrelationMatrix: computeCorrelationMatrix,
    computePortfolioCurveAndDrawdown: computePortfolioCurveAndDrawdown,
    evaluatePortfolioRisk: evaluatePortfolioRisk,
    generatePlainSummary: generatePlainSummary,
    calcAfterTaxDividend: calcAfterTaxDividend,
    fundStockFlowSVG: fundStockFlowSVG,
    mountStage3DCanvas: mountStage3DCanvas,
    renderSurface3DCanvas: renderSurface3DCanvas,
    correlationSVG: correlationSVG,
    navDrawdownSVG: navDrawdownSVG,
    dividendTimelineSVG: dividendTimelineSVG
  };
  global.AlphaLensAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
