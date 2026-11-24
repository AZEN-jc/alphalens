/* AlphaLens v4.1 (v3.3 engine contract) — Monochrome Editorial Paper Quant Terminal & Dual 3D/2D Flow Engines.
 * Five core analytics functions + Plain-Chinese Portfolio Diagnostics + 3D Perspective / 2D Flat Flow & Orbitable 3D Surface Engines.
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

  /** 4. Four-dimensional independent portfolio risk diagnosis */
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
      ? ('最大单股 ' + cleanStockLabel(top1.name, 7) + ' ' + fmtYuan(totalAmt * maxSingle) + ' (' + (maxSingle * 100).toFixed(1) + '%)')
      : '最大单股 0%';
    var concentration = !hasPos
      ? { level: 'UNKNOWN', label: '待添加', detail: '--' }
      : maxSingle >= 0.15
        ? { level: 'HIGH', label: '单股偏重', detail: topDetail }
        : maxSingle >= 0.08
          ? { level: 'MEDIUM', label: '中度集中', detail: topDetail }
          : { level: 'LOW', label: '分布均匀', detail: topDetail };

    var overlap = !hasPos
      ? { level: 'UNKNOWN', label: '待添加', detail: '--' }
      : (overlapCount >= 4 || overlapWeight >= 0.20)
        ? { level: 'HIGH', label: '重叠偏多', detail: overlapCount + ' 只重复 · 共 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
        : (overlapCount >= 2 || overlapWeight >= 0.08)
          ? { level: 'MEDIUM', label: '部分重叠', detail: overlapCount + ' 只重复 · 共 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
          : { level: 'LOW', label: overlapCount === 0 ? '无重叠' : '极少重叠', detail: overlapCount + ' 只重复' };

    var correlation = avgCorr === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : avgCorr >= 0.65
        ? { level: 'HIGH', label: '高度同向', detail: '走势相关性 ' + avgCorr.toFixed(2) }
        : avgCorr >= 0.35
          ? { level: 'MEDIUM', label: '中度同向', detail: '走势相关性 ' + avgCorr.toFixed(2) }
          : { level: 'LOW', label: '走势互补', detail: '走势相关性 ' + avgCorr.toFixed(2) };

    var drawdownVol = absMdd === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : (absMdd >= 0.25 || (vol !== null && vol >= 0.24))
        ? { level: 'HIGH', label: '波动较大', detail: '区间最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
        : (absMdd >= 0.15 || (vol !== null && vol >= 0.16))
          ? { level: 'MEDIUM', label: '波动适中', detail: '区间最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '回撤较小', detail: '区间最大回撤 -' + (absMdd * 100).toFixed(1) + '%' };

    return {
      concentration: concentration,
      overlap: overlap,
      correlation: correlation,
      drawdownVol: drawdownVol
    };
  }

  /** 4b. Concise Plain-Language Portfolio Summary + Spectrum Score + 3-line Log */
  function generatePlainSummary(pen, risk4, curve, positions, assetsMap, corr) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    if (!pen || pen.totalAmount <= 0 || valid.length === 0) {
      return {
        tone: 'neutral',
        badge: '暂无持仓',
        title: '还没有持仓，点选上方「预设组合」或按 ⌘K 搜索添加基金与股票。',
        detail: '添加后会展开每只基金背后的前十大重仓股，并折算人民币持仓金额。',
        overlapYuan: 0,
        overlapPct: 0,
        top1Name: '--',
        top1Yuan: 0,
        top1Pct: 0,
        spectrumScore: 50,
        terminalLines: [
          { tag: '总览', cls: 'cyan', text: '当前未录入持仓，可先从上方预设组合开始体验。' },
          { tag: '重合', cls: 'violet', text: '录入多只基金后，会自动识别被重复持有的底层股票与资金金额。' },
          { tag: '建议', cls: 'emerald', text: '点击图中任意基金或股票标签，可单独高亮对应资金流向。' }
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

    var rawScore = Math.min(62, overlapWeight * 135)
      + Math.min(22, (top1 ? top1.totalWeight : 0) * 55)
      + (avgCorrVal !== null && avgCorrVal > 0 ? Math.min(16, avgCorrVal * 20) : 0);
    var spectrumScore = Math.max(6, Math.min(95, Math.round(rawScore)));

    var line1 = {
      tag: '总览',
      cls: 'cyan',
      text: '共持 ' + valid.length + ' 只标的、总本金 ' + fmtYuan(totalAmt) + '；前 5 大底层股合计占 ' + (top5Weight * 100).toFixed(1) + '%（' + fmtYuan(top5Yuan) + '），前十重仓透明覆盖率 ' + (pen.coveredRatio * 100).toFixed(1) + '%。'
    };

    var line2 = overlapCount > 0
      ? {
          tag: '重合',
          cls: 'rose',
          text: overlapCount + ' 只底层股票被多只基金重复持有，重叠资金 ' + fmtYuan(overlapYuan) + '（占 ' + overlapPct.toFixed(1) + '%）；第一重仓「' + top1Name + '」占 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）' + (top2Name ? '，第二重仓「' + top2Name + '」。' : '。')
        }
      : {
          tag: '重合',
          cls: 'emerald',
          text: '各基金前十大重仓股 0 重叠；当前占比最高单股为「' + top1Name + '」，折合 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。'
        };

    var line3;
    var rebalanceLow = fmtYuan(totalAmt * 0.20);
    var rebalanceHigh = fmtYuan(totalAmt * 0.30);

    if (overlapCount >= 4 || overlapWeight >= 0.20) {
      line3 = {
        tag: '建议',
        cls: 'violet',
        text: '表面买多只基金，底层重复度偏高；可将 20%~30% 资金（约 ' + rebalanceLow + '~' + rebalanceHigh + '）换配红利、黄金或海外宽基。'
      };
      return {
        tone: 'warn',
        badge: '重仓高度重合',
        title: valid.length + ' 只标的共有 ' + overlapCount + ' 只底层股票重复持有，重叠资金 ' + fmtYuan(overlapYuan) + '（占 ' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '单只股票最多押注「' + top1Name + '」' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '点击下方任意基金或股票标签可单独高亮其资金连线。',
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
        tag: '建议',
        cls: 'violet',
        text: '存在少量重仓重叠（区间最大回撤 ' + mddText + '），整体尚可；可在左下「重仓明细」核对各基金重合占比。'
      };
      return {
        tone: 'mid',
        badge: '存在部分重合',
        title: valid.length + ' 只标的中有 ' + overlapCount + ' 只底层股票重叠，重叠资金约 ' + fmtYuan(overlapYuan) + '（占 ' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '第一大底层重仓为「' + top1Name + '」，折合 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '可在左下切换单只基金查看各自前十重仓。',
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
        tag: '建议',
        cls: 'violet',
        text: '当前为单一持仓（区间最大回撤 ' + mddText + '），可再添加 1~2 只不同风格的基金对比分散效果。'
      };
      return {
        tone: 'mid',
        badge: '单一持仓',
        title: '当前仅持有「' + (assetsMap[valid[0].code] ? assetsMap[valid[0].code].name : valid[0].code) + '」，投入本金 ' + fmtYuan(totalAmt),
        detail: (top1 ? '该标的头号重仓股为「' + top1Name + '」（折合 ' + fmtYuan(top1Yuan) + '）。' : '') + '可按 ⌘K 或在顶部继续添加其他资产。',
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
        tag: '建议',
        cls: 'emerald',
        text: '各资产走势互补且底层 0 重叠（历史最大回撤仅 ' + mddText + '），定期检查仓位偏离即可。'
      };
      return {
        tone: 'good',
        badge: '分散良好',
        title: valid.length + ' 只标的底层 0 重叠且走势互补，具备较好的分散减震效果',
        detail: '总本金 ' + fmtYuan(totalAmt) + ' 分布在不同类别资产中，区间最大回撤 ' + mddText + '。',
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
      tag: '建议',
      cls: 'violet',
      text: '底层股票 0 重叠（区间最大回撤 ' + mddText + '），但同受单一市场影响；若想降低波动，可搭配黄金或红利资产。'
    };
    return {
      tone: 'good',
      badge: '无重仓重叠',
      title: valid.length + ' 只标的底层前十 0 重叠，走势有一定联动（最大回撤 ' + mddText + '）',
      detail: (top1 ? '当前最大单股为「' + top1Name + '」（' + fmtYuan(top1Yuan) + '，' + top1Pct.toFixed(1) + '%）。' : '') + '可按需搭配跨市场或商品类资产平滑波动。',
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
      return '<div style="padding:36px;text-align:center;color:var(--ink-faint,#888)">暂无有效持仓，请先添加基金或选择预设组合</div>';
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

    // Keep .flow-node/.flow-edge DOM contracts while routing all real pointer clicks to Canvas hitBoxes
    var o = '<svg class="flow-svg stage-3d-overlay" aria-hidden="true" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:100%;display:block;position:relative;z-index:2;opacity:0;pointer-events:none">';

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

  var STAGE_ANIM = {
    rafId: null,
    phase: 0,
    mouseX: 0,
    mouseY: 0,
    hoverCode: null,
    hitBoxes: [],
    boundContainer: null,
    onSelect: null,
    state: null
  };

  function isQuietMotion() {
    return typeof document !== 'undefined' && document.documentElement.getAttribute('data-motion') === 'off';
  }

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

    ctx.beginPath();
    ctx.moveTo(b01.x, b01.y); ctx.lineTo(b11.x, b11.y);
    ctx.lineTo(t11.x, t11.y); ctx.lineTo(t01.x, t01.y);
    ctx.closePath();
    ctx.fillStyle = frontCol;
    ctx.fill();
    ctx.strokeStyle = strokeCol;
    ctx.lineWidth = 0.85;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(b10.x, b10.y); ctx.lineTo(b11.x, b11.y);
    ctx.lineTo(t11.x, t11.y); ctx.lineTo(t10.x, t10.y);
    ctx.closePath();
    ctx.fillStyle = sideCol;
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(b00.x, b00.y); ctx.lineTo(b01.x, b01.y);
    ctx.lineTo(t01.x, t01.y); ctx.lineTo(t00.x, t00.y);
    ctx.closePath();
    ctx.fillStyle = sideCol;
    ctx.fill();

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

    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (var j = 1; j < 4; j++) ctx.lineTo(corners[j].x, corners[j].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    for (var k = 0; k < 4; k++) {
      ctx.beginPath();
      ctx.moveTo(corners[k].x, corners[k].y);
      ctx.lineTo(apex.x, apex.y);
      ctx.stroke();
    }
    ctx.restore();
    return apex;
  }

  function findHitBox(hitBoxes, mx, my) {
    for (var i = hitBoxes.length - 1; i >= 0; i--) {
      var b = hitBoxes[i];
      if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) return b;
    }
    return null;
  }

  function renderStage3DFrame() {
    var st = STAGE_ANIM.state;
    if (!st || !st.canvas) return;
    var canvas = st.canvas;
    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(300, rect.width || 960);
    var cssH = Math.max(240, rect.height || 348);
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
    var quiet = isQuietMotion();
    var bgTop = isLight ? '#FAF9F5' : '#0E0E10';
    var bgBot = isLight ? '#F2F0E8' : '#151518';
    var gradBg = ctx.createLinearGradient(0, 0, 0, cssH);
    gradBg.addColorStop(0, bgTop);
    gradBg.addColorStop(1, bgBot);
    ctx.fillStyle = gradBg;
    ctx.fillRect(0, 0, cssW, cssH);

    var aura = ctx.createRadialGradient(cssW * 0.45, cssH * 0.45, 10, cssW * 0.45, cssH * 0.48, cssW * 0.56);
    aura.addColorStop(0, isLight ? 'rgba(37,99,235,0.06)' : 'rgba(96,165,250,0.08)');
    aura.addColorStop(0.55, isLight ? 'rgba(124,58,237,0.04)' : 'rgba(167,139,250,0.05)');
    aura.addColorStop(1, isLight ? 'rgba(250,249,245,0)' : 'rgba(14,14,16,0)');
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, cssW, cssH);

    var swayYaw = quiet ? 0 : (Math.sin(STAGE_ANIM.phase * 0.65) * 0.016 + STAGE_ANIM.mouseX * 0.05);
    var swayPitch = quiet ? 0 : (Math.cos(STAGE_ANIM.phase * 0.45) * 0.008 + STAGE_ANIM.mouseY * 0.025);
    var cam = {
      cx: cssW * 0.43,
      cy: cssH * 0.58,
      fov: Math.min(cssW, 1120) * 0.72,
      dist: 790,
      yaw: -0.25 + swayYaw,
      pitch: 0.34 + swayPitch,
      targetX: 0,
      targetY: 32,
      targetZ: 0
    };

    var hitBoxes = [];
    var activeFocus = st.focusCode || STAGE_ANIM.hoverCode || null;

    // 1. 3D Perspective Floor Grid
    var gridXMin = -400, gridXMax = 340;
    var gridZMin = -220, gridZMax = 220;
    ctx.lineWidth = 1;
    for (var gx = gridXMin; gx <= gridXMax; gx += 74) {
      var p0 = projectPoint3D(gx, 0, gridZMin, cam);
      var p1 = projectPoint3D(gx, 0, gridZMax, cam);
      ctx.strokeStyle = isLight ? 'rgba(64,112,178,0.13)' : 'rgba(255,255,255,0.075)';
      ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
    }
    for (var gz = gridZMin; gz <= gridZMax; gz += 44) {
      var q0 = projectPoint3D(gridXMin, 0, gz, cam);
      var q1 = projectPoint3D(gridXMax, 0, gz, cam);
      ctx.strokeStyle = isLight ? 'rgba(64,112,178,0.11)' : 'rgba(255,255,255,0.065)';
      ctx.beginPath(); ctx.moveTo(q0.x, q0.y); ctx.lineTo(q1.x, q1.y); ctx.stroke();
    }

    var valid = st.valid;
    var stocks = st.stocks;
    var totalAmt = st.totalAmt;
    var assetsMap = st.assetsMap;

    // 2. Multi-Lane 3D ETF Ribbons & Pedestals
    var nFunds = valid.length;
    var leftNodes = [];
    for (var fIdx = 0; fIdx < nFunds; fIdx++) {
      var pos = valid[fIdx];
      var asset = assetsMap[pos.code] || {};
      var color = ASSET_COLORS[fIdx % ASSET_COLORS.length];
      var tFund = nFunds === 1 ? 0.5 : fIdx / (nFunds - 1);
      var zLane = -145 + tFund * 290;
      var xPedestal = -305;
      var wRatio = Number(pos.amount) / totalAmt;
      var hPedestal = 28 + wRatio * 96;

      var isFocused = !activeFocus || activeFocus === pos.code;
      var alphaMul = isFocused ? 1 : 0.24;

      var closes = (asset.closes || []).slice(-90);
      if (closes.length >= 4) {
        var cMin = Infinity, cMax = -Infinity;
        for (var ci = 0; ci < closes.length; ci++) {
          var cv = closes[ci].c;
          if (cv < cMin) cMin = cv;
          if (cv > cMax) cMax = cv;
        }
        if (cMax <= cMin) cMax = cMin + 1;
        var ribbonPts = [], floorPts = [];
        var step = Math.max(1, Math.floor(closes.length / 28));
        for (var k = 0; k < closes.length; k += step) {
          var u = k / (closes.length - 1);
          var rx = -280 + u * 215;
          var norm = (closes[k].c - cMin) / (cMax - cMin);
          var ry = 14 + norm * (36 + wRatio * 52);
          ribbonPts.push(projectPoint3D(rx, ry, zLane, cam));
          floorPts.push(projectPoint3D(rx, 0, zLane, cam));
        }
        if (ribbonPts.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(floorPts[0].x, floorPts[0].y);
          for (var rp = 0; rp < ribbonPts.length; rp++) ctx.lineTo(ribbonPts[rp].x, ribbonPts[rp].y);
          ctx.lineTo(floorPts[floorPts.length - 1].x, floorPts[floorPts.length - 1].y);
          ctx.closePath();
          ctx.fillStyle = hexToRgba(color, (isLight ? 0.16 : 0.14) * alphaMul);
          ctx.fill();

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

      var prism = draw3DPrism(
        ctx, xPedestal, zLane, 24, 24, hPedestal, cam,
        hexToRgba(color, (isLight ? 0.84 : 0.74) * alphaMul),
        hexToRgba(color, (isLight ? 0.42 : 0.34) * alphaMul),
        hexToRgba(color, (isLight ? 0.58 : 0.48) * alphaMul),
        hexToRgba(color, 0.96 * alphaMul)
      );

      var tx = prism.topCenter.x - 16;
      var ty = prism.topCenter.y - 8;
      var labelTxt = shortLabel(asset.name || pos.code, 9);
      var subTxt = fmtYuan(pos.amount) + ' · ' + (wRatio * 100).toFixed(0) + '%';
      ctx.save();
      ctx.font = '600 11px "PingFang SC","SF Pro Text",sans-serif';
      var nameW = ctx.measureText(labelTxt).width;
      ctx.font = '600 10px "JetBrains Mono","SF Mono",monospace';
      var subW = ctx.measureText(subTxt).width;
      var boxW = Math.max(nameW, subW) + 12;
      var boxX = Math.max(6, tx - boxW + 4);
      var boxY = ty - 23;
      ctx.fillStyle = isLight ? 'rgba(255,255,255,0.90)' : 'rgba(20,20,24,0.88)';
      ctx.strokeStyle = hexToRgba(color, isFocused ? 0.45 : 0.16);
      ctx.lineWidth = isFocused ? 1 : 0.7;
      ctx.fillRect(boxX, boxY, boxW, 29);
      ctx.strokeRect(boxX, boxY, boxW, 29);
      ctx.textAlign = 'right';
      var textX = boxX + boxW - 6;
      ctx.font = '600 11px "PingFang SC","SF Pro Text",sans-serif';
      ctx.fillStyle = isLight ? (isFocused ? '#0B0B0B' : 'rgba(11,11,11,0.34)') : (isFocused ? '#F2F2F2' : 'rgba(242,242,242,0.32)');
      ctx.fillText(labelTxt, textX, boxY + 12);
      ctx.font = '600 10px "JetBrains Mono","SF Mono",monospace';
      ctx.fillStyle = hexToRgba(color, isFocused ? 0.96 : 0.38);
      ctx.fillText(subTxt, textX, boxY + 24);
      ctx.restore();

      // HitBox covering both the fund label plaque and the 3D pedestal prism
      var fMinX = boxX;
      var fMaxX = prism.topCenter.x + 18;
      var fMinY = Math.min(boxY, prism.topCenter.y - 12);
      var fMaxY = Math.max(boxY + 29, prism.baseCenter.y + 8);
      hitBoxes.push({
        code: pos.code,
        kind: 'fund',
        title: asset.name || pos.code,
        detail: '持仓 ' + fmtYuan(pos.amount) + ' · 占比 ' + (wRatio * 100).toFixed(1) + '%',
        x: fMinX, y: fMinY, w: Math.max(64, fMaxX - fMinX), h: Math.max(36, fMaxY - fMinY)
      });

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

    // 3. Front Hero Composite Portfolio 3D Equity Ribbon & Drawdown Bars
    if (st.curve && st.curve.curve && st.curve.curve.length >= 6) {
      var cSeries = st.curve.curve;
      var nMin = Infinity, nMax = -Infinity;
      for (var ni = 0; ni < cSeries.length; ni++) {
        if (cSeries[ni].nav < nMin) nMin = cSeries[ni].nav;
        if (cSeries[ni].nav > nMax) nMax = cSeries[ni].nav;
      }
      if (nMax <= nMin) nMax = nMin + 0.1;
      var zFront = 205;
      var heroPts = [], heroBase = [];
      var cStep = Math.max(1, Math.floor(cSeries.length / 40));
      for (var hi = 0; hi < cSeries.length; hi += cStep) {
        var hu = hi / (cSeries.length - 1);
        var hx = -255 + hu * 410;
        var hNorm = (cSeries[hi].nav - nMin) / (nMax - nMin);
        var hy = 12 + hNorm * 58;
        heroPts.push(projectPoint3D(hx, hy, zFront, cam));
        heroBase.push(projectPoint3D(hx, 0, zFront, cam));

        var ddAbs = Math.abs(cSeries[hi].dd || 0);
        if (ddAbs > 0.015) {
          var ddH = Math.min(24, ddAbs * 80);
          var pDdTop = projectPoint3D(hx, 0, zFront + 12, cam);
          var pDdBot = projectPoint3D(hx, -ddH, zFront + 12, cam);
          ctx.strokeStyle = isLight ? 'rgba(217,119,6,0.58)' : 'rgba(245,158,11,0.55)';
          ctx.lineWidth = 2.1;
          ctx.beginPath(); ctx.moveTo(pDdTop.x, pDdTop.y); ctx.lineTo(pDdBot.x, pDdBot.y); ctx.stroke();
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

    // 4. Right Foreground: Top-10 Underlying Stock 3D Crystal Prisms + Callout Cards
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
      var zStock = -170 + tStock * 335;
      var xStock = cssW < 1140 ? (-24 + sIdx * 23) : (-8 + sIdx * 27);
      var barRatio = Math.max(0.12, Math.min(1, stItem.totalWeight / maxStockW));
      var hCrystal = 24 + barRatio * 96;
      var isOverlap = (stItem.contributors || []).length >= 2;
      var sConnected = !activeFocus || activeFocus === stItem.code || (stItem.contributors || []).some(function (c) { return c.sourceCode === activeFocus; });
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
      if (isOverlap) {
        beaconPt = draw3DRotatingPyramid(
          ctx, xStock, hCrystal + 8, zStock, 9.5, 14,
          (quiet ? 0.45 : STAGE_ANIM.phase * 1.6) + sIdx, cam,
          hexToRgba(overlapCol, sAlpha)
        );
      }

      var cleanNm = cleanStockLabel(stItem.name, 7);
      var yuanTxt = fmtYuan(totalAmt * stItem.totalWeight);
      var stockDetail = yuanTxt + ' (' + (stItem.totalWeight * 100).toFixed(2) + '%)' + (isOverlap ? ' · ' + stItem.contributors.length + ' 只基金共持' : '');

      // HitBox for 3D prism column
      hitBoxes.push({
        code: stItem.code,
        kind: 'stock',
        title: cleanNm,
        detail: stockDetail,
        x: cPrism.topCenter.x - 16,
        y: beaconPt.y - 10,
        w: 32,
        h: Math.max(28, cPrism.baseCenter.y - beaconPt.y + 16)
      });

      // Non-overlapping callout plaque with laser leader line
      if (!isCompactScreen || sIdx < 6 || activeFocus === stItem.code) {
        var colX = isCompactScreen
          ? Math.min(cssW - 110, Math.max(118, beaconPt.x + 8))
          : (sIdx % 2 === 0 ? cssW - 294 : cssW - 172);
        var rowY = isCompactScreen
          ? (34 + sIdx * 48)
          : (32 + Math.floor(sIdx / 2) * 56 + (sIdx % 2) * 26);
        var isCardSelected = activeFocus === stItem.code;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(beaconPt.x, beaconPt.y);
        ctx.lineTo(colX - 4, rowY - 2);
        ctx.strokeStyle = hexToRgba(cBase, (sConnected ? 0.46 : 0.12));
        ctx.lineWidth = isCardSelected ? 1.4 : 0.85;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        var pillW = isCompactScreen ? 104 : 112, pillH = 28;
        ctx.fillStyle = isCardSelected
          ? (isLight ? '#19191B' : '#E4E4E7')
          : (isLight ? 'rgba(255,255,255,0.95)' : 'rgba(22,22,26,0.92)');
        ctx.strokeStyle = isCardSelected ? cBase : hexToRgba(cBase, sConnected ? 0.52 : 0.18);
        ctx.lineWidth = isCardSelected ? 1.5 : 0.9;
        ctx.fillRect(colX - 3, rowY - 14, pillW, pillH);
        ctx.strokeRect(colX - 3, rowY - 14, pillW, pillH);

        ctx.textAlign = 'left';
        ctx.font = '600 10.5px "PingFang SC","SF Pro Text",sans-serif';
        ctx.fillStyle = isCardSelected
          ? (isLight ? '#FFFFFF' : '#0B0B0B')
          : (isLight ? (sConnected ? '#0B0B0B' : 'rgba(11,11,11,0.32)') : (sConnected ? (isOverlap ? '#FCA5A5' : '#F2F2F2') : 'rgba(242,242,242,0.30)'));
        ctx.fillText((isOverlap ? '▲ ' : '') + cleanStockLabel(stItem.name, 6), colX + 3, rowY - 2);

        ctx.font = '700 9.5px "JetBrains Mono","SF Mono",monospace';
        ctx.fillStyle = isCardSelected
          ? (isLight ? '#E5E7EB' : '#27272A')
          : (isOverlap ? hexToRgba(overlapCol, sConnected ? 0.96 : 0.30) : hexToRgba(jadeCol, sConnected ? 0.96 : 0.30));
        ctx.fillText(yuanTxt + (isOverlap ? '·' + stItem.contributors.length + '基' : '·' + (stItem.totalWeight * 100).toFixed(1) + '%'), colX + 3, rowY + 10);
        ctx.restore();

        // HitBox for the clickable right-side stock card (so clicking the card ALWAYS works!)
        hitBoxes.push({
          code: stItem.code,
          kind: 'stock-card',
          title: cleanNm,
          detail: stockDetail,
          x: colX - 4, y: rowY - 15, w: pillW + 2, h: pillH + 2
        });
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

    // 5. Laser-Thin 3D Parabolic Light Arcs + Traveling Pulses
    var leftMap = {};
    leftNodes.forEach(function (ln) { leftMap[ln.code] = ln; });

    rightNodes.forEach(function (rn, rIdx) {
      rn.contributors.forEach(function (c, cIdx) {
        var ln = leftMap[c.sourceCode];
        if (!ln) return;
        var active = !activeFocus || activeFocus === ln.code || activeFocus === rn.code;
        var midX = (ln.x3 + rn.x3) * 0.5;
        var midY = Math.max(ln.y3, rn.y3) + 52 + (rn.isOverlap ? 24 : 8);
        var midZ = (ln.z3 + rn.z3) * 0.5;
        var p0 = ln.topPt;
        var p1 = projectPoint3D(midX, midY, midZ, cam);
        var p2 = rn.topPt;

        var arcAlpha = !activeFocus ? (rn.isOverlap ? 0.64 : 0.40) : (active ? 0.94 : 0.06);
        var arcColor = rn.isOverlap && active ? overlapCol : ln.color;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
        ctx.strokeStyle = hexToRgba(arcColor, arcAlpha);
        ctx.lineWidth = active && activeFocus ? 1.85 : (rn.isOverlap ? 1.35 : 0.95);
        ctx.stroke();

        if (active && !quiet) {
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

    // 6. Right-Edge Vertical Scale + Clean Bottom Captions
    var axisX = cssW - 56;
    ctx.save();
    ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(axisX, 20); ctx.lineTo(axisX, cssH - 22); ctx.stroke();

    var maxYuan = stocks[0] ? (totalAmt * stocks[0].totalWeight) : totalAmt * 0.1;
    for (var s = 0; s <= 4; s++) {
      var sy = 28 + (cssH - 56) * (s / 4);
      var valY = maxYuan * (1 - s / 4);
      ctx.fillStyle = isLight ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.55)';
      ctx.font = '500 9px "JetBrains Mono","SF Mono",monospace';
      ctx.textAlign = 'left';
      ctx.fillText(fmtYuan(valY), axisX + 5, sy + 3);
      ctx.beginPath(); ctx.moveTo(axisX - 3, sy); ctx.lineTo(axisX + 2, sy); ctx.stroke();
    }

    ctx.font = '600 9.5px "PingFang SC","SF Pro Text",sans-serif';
    ctx.fillStyle = isLight ? '#2563EB' : '#60A5FA';
    ctx.textAlign = 'left';
    ctx.fillText('所持基金与近3月走势', 12, cssH - 9);
    if (!isCompactScreen) {
      ctx.textAlign = 'center';
      ctx.fillStyle = isLight ? '#7C3AED' : '#A78BFA';
      ctx.fillText('穿透后的前 10 大底层股票（▲ 为多只基金重复持有 · 点击柱体或卡片可单独查看）', cssW * 0.47, cssH - 9);
    }
    ctx.restore();

    // Floating Hover / Focus Inspection Pill at top-left (tiny, zero occlusion)
    if (activeFocus) {
      var infoBox = hitBoxes.find(function (b) { return b.code === activeFocus; });
      if (infoBox) {
        ctx.save();
        var tipText = infoBox.title + ' · ' + infoBox.detail;
        ctx.font = '600 11px "PingFang SC","SF Pro Text",sans-serif';
        var tw = Math.min(cssW - 32, ctx.measureText(tipText).width + 22);
        ctx.fillStyle = isLight ? 'rgba(25,25,27,0.92)' : 'rgba(242,242,242,0.94)';
        ctx.fillRect(12, 10, tw, 24);
        ctx.fillStyle = isLight ? '#FFFFFF' : '#0B0B0B';
        ctx.textAlign = 'left';
        ctx.fillText(tipText, 22, 26);
        ctx.restore();
      }
    }

    STAGE_ANIM.hitBoxes = hitBoxes;
    ctx.restore();
  }

  /** Clean 2D Flat Flow SVG Stage (ideal for mobile 390px readability & instant 2D/3D toggle) */
  function renderStage2DFlowSVG(positions, assetsMap, pen, focusCode) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmt = pen && pen.totalAmount ? pen.totalAmount : 0;
    var stocks = (pen && pen.exposures) ? pen.exposures.slice(0, 10) : [];
    if (!valid.length || totalAmt <= 0 || !stocks.length) {
      return '<div style="padding:36px;text-align:center;color:var(--ink-faint,#888)">暂无持仓，请先添加基金或选择预设组合</div>';
    }

    var W = 680;
    var lx = 10, lw = 178;
    var rx = 382, rw = 288;
    var topPad = 24, botPad = 14;
    var rH = 30, rGap = 6;
    var rightTotalH = stocks.length * rH + Math.max(0, stocks.length - 1) * rGap;
    var minLeftH = 44, lGap = 10;
    var availLeftH = Math.max(rightTotalH, valid.length * minLeftH + Math.max(0, valid.length - 1) * lGap);
    var H = topPad + availLeftH + botPad;

    var colorBySource = {};
    valid.forEach(function (p, idx) { colorBySource[p.code] = ASSET_COLORS[idx % ASSET_COLORS.length]; });

    var usableL = availLeftH - Math.max(0, valid.length - 1) * lGap;
    var rawH = valid.map(function (p) { return Math.max(minLeftH, (Number(p.amount) / totalAmt) * usableL); });
    var sumRaw = rawH.reduce(function (a, b) { return a + b; }, 0) || 1;
    var scaleL = usableL / sumRaw;
    var leftNodes = [], curY = topPad;
    valid.forEach(function (p, idx) {
      var h = rawH[idx] * scaleL;
      var a = assetsMap[p.code] || {};
      leftNodes.push({
        code: p.code, name: a.name || p.code, amount: Number(p.amount),
        wPct: (Number(p.amount) / totalAmt) * 100, color: colorBySource[p.code],
        x: lx, y: curY, w: lw, h: h, cy: curY + h / 2
      });
      curY += h + lGap;
    });

    var maxStockW = stocks[0] ? stocks[0].totalWeight : 0.01;
    var rightTop = topPad + Math.max(0, (availLeftH - rightTotalH) / 2);
    var rightNodes = stocks.map(function (st, idx) {
      var y = rightTop + idx * (rH + rGap);
      return {
        code: st.code, name: st.name, totalWeight: st.totalWeight,
        totalYuan: totalAmt * st.totalWeight,
        barRatio: Math.max(0.08, Math.min(1, st.totalWeight / maxStockW)),
        contributors: st.contributors || [],
        isOverlap: (st.contributors || []).length >= 2,
        x: rx, y: y, w: rw, h: rH, cy: y + rH / 2
      };
    });

    var leftByCode = {};
    leftNodes.forEach(function (n) { leftByCode[n.code] = n; });
    var hasFocus = !!(focusCode && (
      leftNodes.some(function (n) { return n.code === focusCode; }) ||
      rightNodes.some(function (n) { return n.code === focusCode; })
    ));

    var o = '<svg class="flow-svg flow-2d-svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">';
    o += '<text x="' + lx + '" y="14" font-size="10.5" font-weight="600" fill="var(--ink-soft,#666)">持仓标的</text>';
    o += '<text x="' + rx + '" y="14" font-size="10.5" font-weight="600" fill="var(--ink-soft,#666)">前 10 大底层重仓股（折合人民币）</text>';

    // Crisp slim Bezier curves
    var edges = [];
    rightNodes.forEach(function (rn) {
      rn.contributors.forEach(function (c) {
        var ln = leftByCode[c.sourceCode];
        if (!ln) return;
        var active = !hasFocus || focusCode === ln.code || focusCode === rn.code;
        var x1 = ln.x + ln.w, y1 = ln.cy, x2 = rn.x, y2 = rn.cy;
        var cx1 = x1 + (x2 - x1) * 0.45, cx2 = x2 - (x2 - x1) * 0.45;
        var d = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1) + ' C' + cx1.toFixed(1) + ',' + y1.toFixed(1) + ' ' + cx2.toFixed(1) + ',' + y2.toFixed(1) + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
        var stroke = rn.isOverlap && active ? 'var(--rose,#dc2626)' : ln.color;
        var op = !hasFocus ? (rn.isOverlap ? 0.52 : 0.28) : (active ? 0.90 : 0.06);
        var sw = active && hasFocus ? 2.4 : (rn.isOverlap ? 1.8 : 1.3);
        edges.push({ a: active ? 1 : 0, html: '<path class="flow-edge" data-src="' + esc(ln.code) + '" data-dst="' + esc(rn.code) + '" d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="' + sw + '" stroke-linecap="round" opacity="' + op + '"/>' });
      });
    });
    edges.sort(function (a, b) { return a.a - b.a; });
    edges.forEach(function (e) { o += e.html; });

    // Left fund cards
    leftNodes.forEach(function (ln) {
      var isSelf = focusCode === ln.code;
      var conn = !hasFocus || isSelf || rightNodes.some(function (rn) {
        return rn.code === focusCode && rn.contributors.some(function (c) { return c.sourceCode === ln.code; });
      });
      o += '<g class="flow-node" data-flow-code="' + esc(ln.code) + '" style="cursor:pointer" opacity="' + (conn ? 1 : 0.28) + '">';
      o += '<rect x="' + ln.x + '" y="' + ln.y.toFixed(1) + '" width="' + ln.w + '" height="' + ln.h.toFixed(1) + '" rx="6" fill="var(--panel,#fff)" stroke="' + (isSelf ? 'var(--ink,#0b0b0b)' : 'var(--line2,#cbd5e1)') + '" stroke-width="' + (isSelf ? '1.8' : '1') + '"/>';
      o += '<rect x="' + ln.x + '" y="' + ln.y.toFixed(1) + '" width="4.5" height="' + ln.h.toFixed(1) + '" rx="2" fill="' + ln.color + '"/>';
      o += '<text x="' + (ln.x + 12) + '" y="' + (ln.cy - 2).toFixed(1) + '" font-size="12" font-weight="600" fill="var(--ink,#0b0b0b)">' + esc(shortLabel(ln.name, 10)) + '</text>';
      o += '<text x="' + (ln.x + 12) + '" y="' + (ln.cy + 13).toFixed(1) + '" font-size="10.5" font-family="monospace" fill="var(--ink-soft,#666)">' + esc(fmtYuan(ln.amount)) + ' · ' + ln.wPct.toFixed(0) + '%</text>';
      o += '</g>';
    });

    // Right stock cards
    rightNodes.forEach(function (rn, idx) {
      var isSelf = focusCode === rn.code;
      var conn = !hasFocus || isSelf || rn.contributors.some(function (c) { return c.sourceCode === focusCode; });
      var col = rn.isOverlap ? 'var(--rose,#dc2626)' : 'var(--cyan,#2563eb)';
      o += '<g class="flow-node" data-flow-code="' + esc(rn.code) + '" style="cursor:pointer" opacity="' + (conn ? 1 : 0.26) + '">';
      o += '<rect x="' + rn.x + '" y="' + rn.y.toFixed(1) + '" width="' + rn.w + '" height="' + rn.h + '" rx="6" fill="var(--panel,#fff)" stroke="' + (isSelf ? 'var(--ink,#0b0b0b)' : (rn.isOverlap ? 'var(--rose,#dc2626)' : 'var(--line2,#cbd5e1)')) + '" stroke-opacity="' + (isSelf ? '1' : '0.65') + '" stroke-width="' + (isSelf ? '1.8' : '1') + '"/>';
      var barW = Math.round((rn.w - 86) * rn.barRatio);
      o += '<rect x="' + (rn.x + 1) + '" y="' + (rn.y + 1).toFixed(1) + '" width="' + barW + '" height="' + (rn.h - 2) + '" rx="5" fill="' + col + '" opacity="0.10"/>';
      o += '<text x="' + (rn.x + 10) + '" y="' + (rn.cy + 4).toFixed(1) + '" font-size="12" font-weight="600" fill="var(--ink,#0b0b0b)">' + esc(cleanStockLabel(rn.name, 8)) + '</text>';
      if (rn.isOverlap) {
        o += '<rect x="' + (rn.x + 132) + '" y="' + (rn.cy - 8).toFixed(1) + '" width="48" height="16" rx="4" fill="var(--rose,#dc2626)" opacity="0.14"/>';
        o += '<text x="' + (rn.x + 156) + '" y="' + (rn.cy + 3.5).toFixed(1) + '" font-size="9.5" font-weight="700" fill="var(--rose,#dc2626)" text-anchor="middle">' + rn.contributors.length + '基共持</text>';
      } else {
        o += '<text x="' + (rn.x + 156) + '" y="' + (rn.cy + 3.5).toFixed(1) + '" font-size="9.5" font-family="monospace" fill="var(--ink-faint,#888)" text-anchor="middle">' + (rn.totalWeight * 100).toFixed(1) + '%</text>';
      }
      var pillW = 76, pillX = rn.x + rn.w - pillW - 5;
      var pillBg = idx === 0 ? (rn.isOverlap ? '#dc2626' : 'var(--ink,#0b0b0b)') : 'var(--surface,#f5f5f5)';
      var pillFg = idx === 0 ? (rn.isOverlap ? '#ffffff' : 'var(--on-ink,#ffffff)') : 'var(--ink,#0b0b0b)';
      o += '<rect x="' + pillX + '" y="' + (rn.cy - 10).toFixed(1) + '" width="' + pillW + '" height="20" rx="4" fill="' + pillBg + '"/>';
      o += '<text x="' + (pillX + pillW / 2) + '" y="' + (rn.cy + 3.5).toFixed(1) + '" font-size="11" font-family="monospace" font-weight="700" fill="' + pillFg + '" text-anchor="middle">' + esc(fmtYuan(rn.totalYuan)) + '</text>';
      o += '</g>';
    });

    return o + '</svg>';
  }

  function startStage3DLoop() {
    if (isQuietMotion() || STAGE_ANIM.rafId || typeof window === 'undefined' || !window.requestAnimationFrame) return;
    var tick = function () {
      if (isQuietMotion() || !STAGE_ANIM.state || !STAGE_ANIM.state.canvas || !STAGE_ANIM.state.canvas.isConnected) {
        STAGE_ANIM.rafId = null;
        return;
      }
      STAGE_ANIM.phase += 0.024;
      renderStage3DFrame();
      STAGE_ANIM.rafId = window.requestAnimationFrame(tick);
    };
    STAGE_ANIM.rafId = window.requestAnimationFrame(tick);
  }

  function syncStage3DMotion() {
    if (isQuietMotion()) {
      if (STAGE_ANIM.rafId && typeof window !== 'undefined' && window.cancelAnimationFrame) {
        window.cancelAnimationFrame(STAGE_ANIM.rafId);
      }
      STAGE_ANIM.rafId = null;
      STAGE_ANIM.mouseX = 0;
      STAGE_ANIM.mouseY = 0;
      if (STAGE_ANIM.state && STAGE_ANIM.state.canvas && STAGE_ANIM.state.canvas.isConnected) {
        renderStage3DFrame();
      }
    } else if (STAGE_ANIM.state && STAGE_ANIM.state.canvas && STAGE_ANIM.state.canvas.isConnected) {
      startStage3DLoop();
    }
  }

  function getStage3DHitBoxes() {
    return STAGE_ANIM.hitBoxes.slice();
  }

  function mountStage3DCanvas(container, positions, assetsMap, pen, curve, focusCode, onSelect) {
    if (!container) return;
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmt = pen && pen.totalAmount ? pen.totalAmount : 0;
    var stocks = (pen && pen.exposures) ? pen.exposures.slice(0, 10) : [];

    var svgOverlay = fundStockFlowSVG(positions, assetsMap, pen, focusCode);
    container.innerHTML =
      '<div class="stage-3d-stack" style="position:relative;width:100%;height:348px;overflow:hidden">'
      + '<canvas id="stage-3d-canvas" style="position:absolute;inset:0;width:100%;height:100%;display:block;z-index:1"></canvas>'
      + svgOverlay
      + '</div>';

    var canvas = container.querySelector('#stage-3d-canvas');
    if (!canvas || !valid.length || totalAmt <= 0 || !stocks.length) return;

    STAGE_ANIM.onSelect = typeof onSelect === 'function' ? onSelect : null;
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
        if (!container.querySelector('#stage-3d-canvas')) return;
        var r = container.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var mx = e.clientX - r.left, my = e.clientY - r.top;
        STAGE_ANIM.mouseX = (mx / r.width - 0.5) * 2;
        STAGE_ANIM.mouseY = (my / r.height - 0.5) * 2;
        var hit = findHitBox(STAGE_ANIM.hitBoxes, mx, my);
        var nextHover = hit ? hit.code : null;
        if (nextHover !== STAGE_ANIM.hoverCode) {
          STAGE_ANIM.hoverCode = nextHover;
          container.style.cursor = nextHover ? 'pointer' : 'default';
          if (isQuietMotion()) renderStage3DFrame();
        }
      });
      container.addEventListener('mouseleave', function () {
        STAGE_ANIM.mouseX = 0;
        STAGE_ANIM.mouseY = 0;
        if (STAGE_ANIM.hoverCode) {
          STAGE_ANIM.hoverCode = null;
          container.style.cursor = 'default';
          if (isQuietMotion()) renderStage3DFrame();
        }
      });
      container.addEventListener('click', function (e) {
        if (!container.querySelector('#stage-3d-canvas')) return;
        if (e.target && e.target.closest && e.target.closest('.flow-node')) return;
        var r = container.getBoundingClientRect();
        var hit = findHitBox(STAGE_ANIM.hitBoxes, e.clientX - r.left, e.clientY - r.top);
        if (hit && STAGE_ANIM.onSelect) {
          e.stopPropagation();
          STAGE_ANIM.onSelect(hit.code);
        }
      });
    }

    renderStage3DFrame();
    syncStage3DMotion();
  }

  /**
   * Interactive Drag-to-Orbit 3D Risk & Overlap Distribution Surface
   */
  var SURFACE_STATE = {
    yaw: -0.62,
    pitch: 0.48,
    dragging: false,
    lastX: 0,
    lastY: 0,
    boundCanvas: null,
    lastArgs: null
  };

  function resetSurface3DView() {
    SURFACE_STATE.yaw = -0.62;
    SURFACE_STATE.pitch = 0.48;
    if (SURFACE_STATE.lastArgs) {
      renderSurface3DCanvas(
        SURFACE_STATE.lastArgs.canvas,
        SURFACE_STATE.lastArgs.pen,
        SURFACE_STATE.lastArgs.corr,
        SURFACE_STATE.lastArgs.curve
      );
    }
  }

  function bindSurface3DInteraction(canvas) {
    if (!canvas || SURFACE_STATE.boundCanvas === canvas) return;
    SURFACE_STATE.boundCanvas = canvas;
    canvas.style.cursor = 'grab';
    canvas.style.touchAction = 'none';

    var onStart = function (x, y) {
      SURFACE_STATE.dragging = true;
      SURFACE_STATE.lastX = x;
      SURFACE_STATE.lastY = y;
      canvas.style.cursor = 'grabbing';
    };
    var onMove = function (x, y) {
      if (!SURFACE_STATE.dragging) return;
      var dx = x - SURFACE_STATE.lastX;
      var dy = y - SURFACE_STATE.lastY;
      SURFACE_STATE.lastX = x;
      SURFACE_STATE.lastY = y;
      SURFACE_STATE.yaw += dx * 0.012;
      SURFACE_STATE.pitch = Math.max(0.18, Math.min(1.05, SURFACE_STATE.pitch + dy * 0.009));
      if (SURFACE_STATE.lastArgs) {
        renderSurface3DCanvas(
          SURFACE_STATE.lastArgs.canvas,
          SURFACE_STATE.lastArgs.pen,
          SURFACE_STATE.lastArgs.corr,
          SURFACE_STATE.lastArgs.curve
        );
      }
    };
    var onEnd = function () {
      if (!SURFACE_STATE.dragging) return;
      SURFACE_STATE.dragging = false;
      canvas.style.cursor = 'grab';
    };

    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerId != null && canvas.setPointerCapture) {
        try { canvas.setPointerCapture(e.pointerId); } catch (err) { SURFACE_STATE.captureFallback = String(err && err.name || 'unsupported'); }
      }
      onStart(e.clientX, e.clientY);
    });
    canvas.addEventListener('pointermove', function (e) { onMove(e.clientX, e.clientY); });
    canvas.addEventListener('pointerup', onEnd);
    canvas.addEventListener('pointercancel', onEnd);
    canvas.addEventListener('dblclick', resetSurface3DView);
  }

  function renderSurface3DCanvas(canvas, pen, corr, curve) {
    if (!canvas) return;
    SURFACE_STATE.lastArgs = { canvas: canvas, pen: pen, corr: corr, curve: curve };
    bindSurface3DInteraction(canvas);

    var rect = canvas.getBoundingClientRect();
    var cssW = Math.max(220, rect.width || 240);
    var cssH = Math.max(165, rect.height || 210);
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

    var uPort = Math.max(0.12, Math.min(0.88, top1W * 3.6 + mddAbs * 0.7));
    var vPort = Math.max(0.12, Math.min(0.88, overlapW * 2.1 + avgCorr * 0.45));

    var cam = {
      cx: cssW * 0.50,
      cy: cssH * 0.63,
      fov: Math.min(cssW, 380) * 0.92,
      dist: 360,
      yaw: SURFACE_STATE.yaw,
      pitch: SURFACE_STATE.pitch,
      targetX: 0,
      targetY: 18,
      targetZ: 0
    };

    var N = 14;
    var span = 176;
    var heightFn = function (u, v) {
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

    // Painter's sort quads by average projected Z for smooth 360° drag rotation
    var quads = [];
    for (var r = 0; r < N; r++) {
      for (var c = 0; c < N; c++) {
        var p00 = gridPts[r][c], p10 = gridPts[r + 1][c], p11 = gridPts[r + 1][c + 1], p01 = gridPts[r][c + 1];
        quads.push({
          pts: [p00, p10, p11, p01],
          zAvg: (p00.z + p10.z + p11.z + p01.z) * 0.25,
          hAvg: (p00.h + p10.h + p11.h + p01.h) * 0.25
        });
      }
    }
    quads.sort(function (a, b) { return b.zAvg - a.zAvg; });

    for (var qi = 0; qi < quads.length; qi++) {
      var q = quads[qi];
      var hNorm = Math.min(1, Math.max(0, (q.hAvg - 6) / 68));
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
      ctx.moveTo(q.pts[0].x, q.pts[0].y);
      ctx.lineTo(q.pts[1].x, q.pts[1].y);
      ctx.lineTo(q.pts[2].x, q.pts[2].y);
      ctx.lineTo(q.pts[3].x, q.pts[3].y);
      ctx.closePath();
      ctx.fillStyle = fillCol;
      ctx.fill();
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 0.75;
      ctx.stroke();
    }

    var bx = (uPort - 0.5) * span;
    var bz = (vPort - 0.5) * span;
    var by = heightFn(uPort, vPort);
    var pBeacon = projectPoint3D(bx, by + 3, bz, cam);
    var pFloor = projectPoint3D(bx, 0, bz, cam);

    var beaconCol = overlapW >= 0.15 ? (isLight ? '#DC2626' : '#F43F5E') : (overlapW > 0 ? '#D97706' : '#079455');
    ctx.strokeStyle = beaconCol;
    ctx.lineWidth = 1.2;
    ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(pFloor.x, pFloor.y); ctx.lineTo(pBeacon.x, pBeacon.y); ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath(); ctx.arc(pBeacon.x, pBeacon.y, 7.5, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(beaconCol, 0.26); ctx.fill();
    ctx.beginPath(); ctx.arc(pBeacon.x, pBeacon.y, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF'; ctx.fill();
    ctx.strokeStyle = beaconCol; ctx.lineWidth = 1.8; ctx.stroke();

    ctx.font = '600 9.5px "PingFang SC","SF Pro Text",sans-serif';
    ctx.fillStyle = isLight ? '#0B0B0B' : '#F2F2F2';
    ctx.textAlign = 'left';
    ctx.fillText('集中度 × 重合度地形', 8, 14);
    ctx.fillStyle = beaconCol;
    ctx.textAlign = 'right';
    ctx.fillText('● 当前组合', cssW - 8, 14);

    ctx.fillStyle = isLight ? 'rgba(0,0,0,0.48)' : 'rgba(255,255,255,0.52)';
    ctx.textAlign = 'left';
    ctx.fillText('拖动旋转 · 双击复位', 8, cssH - 6);
    ctx.textAlign = 'right';
    ctx.fillText(overlapW >= 0.15 ? '偏集中' : '较分散', cssW - 8, cssH - 6);

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
        var fill = 'var(--surface,#f5f5f5)', fg = 'var(--ink,#0b0b0b)';
        if (i === j) {
          fill = 'rgba(124,58,237,0.16)';
        } else if (v !== null && v >= 0.55) {
          fill = 'rgba(220,38,38,' + Math.min(0.34, 0.14 + v * 0.22).toFixed(3) + ')';
        } else if (v !== null && v > 0) {
          fill = 'rgba(37,99,235,' + Math.min(0.24, 0.08 + v * 0.18).toFixed(3) + ')';
        } else if (v !== null && v < 0) {
          fill = 'rgba(13,148,136,' + Math.min(0.32, 0.12 + Math.abs(v) * 0.22).toFixed(3) + ')';
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
    renderStage2DFlowSVG: renderStage2DFlowSVG,
    mountStage3DCanvas: mountStage3DCanvas,
    syncStage3DMotion: syncStage3DMotion,
    getStage3DHitBoxes: getStage3DHitBoxes,
    renderSurface3DCanvas: renderSurface3DCanvas,
    resetSurface3DView: resetSurface3DView,
    correlationSVG: correlationSVG,
    navDrawdownSVG: navDrawdownSVG,
    dividendTimelineSVG: dividendTimelineSVG
  };
  global.AlphaLensAnalytics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
