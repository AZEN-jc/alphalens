/* AlphaLens v3.2 — pure analytics engine (zero dependency, file:// ready).
 * Five core analytics functions + plain-language summary + hand-written SVG renderers.
 * Exposed on window.AlphaLensAnalytics. Loaded as plain/inlined <script> on file://.
 */
(function (global) {
  'use strict';

  var ASSET_COLORS = [
    '#2563EB', // 蓝
    '#7C3AED', // 紫
    '#EA580C', // 橙
    '#0D9488', // 青
    '#DB2777', // 玫红
    '#4F46E5', // 靛蓝
    '#CA8A04', // 琥珀
    '#059669'  // 翠绿
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

  /** 2. Pearson correlation matrix of asset daily returns (supports optional maxDays window) */
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

  /** 3. Composite NAV curve, max drawdown, annualized volatility (supports optional maxDays window) */
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

  function cleanStockLabel(name, maxLen) {
    var s = String(name || '').replace(/\s*\([A-Z0-9:]+\)\s*$/i, '').trim();
    return shortLabel(s, maxLen);
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
      ? ('最高押注 ' + cleanStockLabel(top1.name, 7) + ' ' + fmtYuan(totalAmt * maxSingle) + ' (' + (maxSingle * 100).toFixed(1) + '%)')
      : '单一底层最高 0%';
    var concentration = !hasPos
      ? { level: 'UNKNOWN', label: '暂无持仓', detail: '--' }
      : maxSingle >= 0.15
        ? { level: 'HIGH', label: '高集中', detail: topDetail }
        : maxSingle >= 0.08
          ? { level: 'MEDIUM', label: '中度集中', detail: topDetail }
          : { level: 'LOW', label: '分散良好', detail: topDetail };

    var overlap = !hasPos
      ? { level: 'UNKNOWN', label: '暂无持仓', detail: '--' }
      : (overlapCount >= 4 || overlapWeight >= 0.20)
        ? { level: 'HIGH', label: '严重撞车', detail: overlapCount + ' 只重合 · 合计 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
        : (overlapCount >= 2 || overlapWeight >= 0.08)
          ? { level: 'MEDIUM', label: '轻度撞车', detail: overlapCount + ' 只重合 · 合计 ' + fmtYuan(totalAmt * overlapWeight) + ' (' + (overlapWeight * 100).toFixed(1) + '%)' }
          : { level: 'LOW', label: overlapCount === 0 ? '零撞车' : '极少撞车', detail: overlapCount + ' 只重合' };

    var correlation = avgCorr === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : avgCorr >= 0.65
        ? { level: 'HIGH', label: '高度同涨同跌', detail: '走势相关性 ' + avgCorr.toFixed(2) }
        : avgCorr >= 0.35
          ? { level: 'MEDIUM', label: '中等同向', detail: '走势相关性 ' + avgCorr.toFixed(2) }
          : { level: 'LOW', label: '走势互补', detail: '走势相关性仅 ' + avgCorr.toFixed(2) };

    var drawdownVol = absMdd === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : (absMdd >= 0.25 || (vol !== null && vol >= 0.24))
        ? { level: 'HIGH', label: '波动较大', detail: '区间最惨跌 -' + (absMdd * 100).toFixed(1) + '%' }
        : (absMdd >= 0.15 || (vol !== null && vol >= 0.16))
          ? { level: 'MEDIUM', label: '中等回撤', detail: '区间最惨跌 -' + (absMdd * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '相对抗跌', detail: '区间最惨跌 -' + (absMdd * 100).toFixed(1) + '%' };

    return {
      concentration: concentration,
      overlap: overlap,
      correlation: correlation,
      drawdownVol: drawdownVol
    };
  }

  /** 4b. Plain-language one-sentence summary for ordinary investors */
  function generatePlainSummary(pen, risk4, curve, positions, assetsMap) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    if (!pen || pen.totalAmount <= 0 || valid.length === 0) {
      return {
        tone: 'neutral',
        badge: '等待选基',
        title: '还没有有效持仓，请先点选上方“预设组合”或从下方添加你想查看的基金 / 股票。',
        detail: '添加后即可透视每只基金内部重仓了哪些股票，并帮你换算成具体人民币金额。',
        overlapYuan: 0,
        overlapPct: 0
      };
    }

    var totalAmt = pen.totalAmount;
    var overlapList = pen.overlaps || [];
    var overlapCount = overlapList.length;
    var overlapWeight = overlapList.reduce(function (s, x) { return s + x.totalWeight; }, 0);
    var overlapYuan = totalAmt * overlapWeight;
    var overlapPct = overlapWeight * 100;
    var top1 = (pen.exposures && pen.exposures[0]) ? pen.exposures[0] : null;
    var top1Name = top1 ? cleanStockLabel(top1.name, 10) : '';
    var top1Yuan = top1 ? (totalAmt * top1.totalWeight) : 0;
    var top1Pct = top1 ? (top1.totalWeight * 100) : 0;
    var corrLevel = risk4 && risk4.correlation ? risk4.correlation.level : 'UNKNOWN';
    var mddText = (curve && curve.maxDrawdown != null) ? ('-' + (Math.abs(curve.maxDrawdown) * 100).toFixed(1) + '%') : '--';

    if (overlapCount >= 4 || overlapWeight >= 0.20) {
      return {
        tone: 'warn',
        badge: '注意“假分散”',
        title: '你买的 ' + valid.length + ' 只标的表面分散，其实有 ' + overlapCount + ' 只股票重复买入，撞车资金高达 ' + fmtYuan(overlapYuan) + '（占总钱 ' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '其中仅「' + top1Name + '」一家公司就间接押了 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '点击下方连线图里的任意基金或股票，可一眼看清钱是怎么撞到一起的。',
        overlapYuan: overlapYuan,
        overlapPct: overlapPct
      };
    }
    if (overlapCount >= 1) {
      return {
        tone: 'mid',
        badge: '存在部分撞车',
        title: '你选的 ' + valid.length + ' 只标的里有 ' + overlapCount + ' 只底层股票出现重合，撞车资金约 ' + fmtYuan(overlapYuan) + '（占 ' + overlapPct.toFixed(1) + '%）',
        detail: (top1 ? '第一大底层重仓是「' + top1Name + '」，折合 ' + fmtYuan(top1Yuan) + '（' + top1Pct.toFixed(1) + '%）。' : '') + '可在下方点开每只基金卡片，查看具体重仓明细。',
        overlapYuan: overlapYuan,
        overlapPct: overlapPct
      };
    }
    if (valid.length === 1) {
      return {
        tone: 'mid',
        badge: '单标的持仓',
        title: '当前只持有一只标的（' + (assetsMap[valid[0].code] ? assetsMap[valid[0].code].name : valid[0].code) + '），总资金 ' + fmtYuan(totalAmt),
        detail: (top1 ? '该标的头号重仓为「' + top1Name + '」（约 ' + fmtYuan(top1Yuan) + '）。' : '') + '建议再加入 1–2 只不同方向的资产，对比分散效果。',
        overlapYuan: 0,
        overlapPct: 0
      };
    }
    if (corrLevel === 'LOW') {
      return {
        tone: 'good',
        badge: '分散效果良好',
        title: '这组 ' + valid.length + ' 只配置做到了底层 0 撞车，而且平时涨跌互补（相关性低），能真正平滑波动',
        detail: '总本金 ' + fmtYuan(totalAmt) + ' 分布在不同大类资产中，所选窗口历史最大回撤仅 ' + mddText + '。点击下方基金卡片可随时核查各自持仓。',
        overlapYuan: 0,
        overlapPct: 0
      };
    }
    return {
      tone: 'good',
      badge: '底层无重仓撞车',
      title: '你选的 ' + valid.length + ' 只标的底层股票 0 撞车，不过它们整体走势仍有一定同步性（区间最大回撤 ' + mddText + '）',
      detail: (top1 ? '当前底层占比最大的是「' + top1Name + '」（' + fmtYuan(top1Yuan) + '，' + top1Pct.toFixed(1) + '%）。' : '') + '如果想进一步降低波动，可尝试加入黄金或跨市场资产。',
      overlapYuan: 0,
      overlapPct: 0
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

  /* --- Hand-written SVG renderers --- */

  /** Fund -> Underlying Stock interactive Sankey-style flow SVG */
  function fundStockFlowSVG(positions, assetsMap, pen, focusCode) {
    var valid = (positions || []).filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
    var totalAmt = pen && pen.totalAmount ? pen.totalAmount : 0;
    var stocks = (pen && pen.exposures) ? pen.exposures.slice(0, 10) : [];
    if (!valid.length || totalAmt <= 0 || !stocks.length) {
      return '<div style="padding:24px;text-align:center;color:var(--ink-faint,#888)">暂无有效持仓数据，无法绘制资金穿透连线图</div>';
    }

    var W = 640;
    var lx = 8, lw = 186;
    var rx = 396, rw = 236;
    var topPad = 24, botPad = 14;
    var rH = 34, rGap = 7;
    var rightTotalH = stocks.length * rH + Math.max(0, stocks.length - 1) * rGap;

    var minLeftH = 44;
    var lGap = 10;
    var availLeftH = Math.max(rightTotalH, valid.length * minLeftH + Math.max(0, valid.length - 1) * lGap);
    var H = topPad + availLeftH + botPad;

    // Color map per held position
    var colorBySource = {};
    valid.forEach(function (p, idx) {
      colorBySource[p.code] = ASSET_COLORS[idx % ASSET_COLORS.length];
    });

    // Left nodes distributed vertically proportional to position weight (with minimum height for readability)
    var totalGapL = Math.max(0, valid.length - 1) * lGap;
    var usableL = availLeftH - totalGapL;
    var rawHeights = valid.map(function (p) {
      return Math.max(minLeftH, (Number(p.amount) / totalAmt) * usableL);
    });
    var sumRawH = rawHeights.reduce(function (a, b) { return a + b; }, 0) || 1;
    var scaleL = usableL / sumRawH;
    var leftNodes = [];
    var curY = topPad;
    valid.forEach(function (p, idx) {
      var h = rawHeights[idx] * scaleL;
      var a = assetsMap[p.code] || {};
      var wPct = (Number(p.amount) / totalAmt) * 100;
      leftNodes.push({
        code: p.code,
        name: a.name || p.code,
        amount: Number(p.amount),
        wPct: wPct,
        color: colorBySource[p.code],
        x: lx, y: curY, w: lw, h: h,
        cy: curY + h / 2
      });
      curY += h + lGap;
    });

    // Right nodes (Top 10 underlying stocks)
    var rightOffsetTop = topPad + Math.max(0, (availLeftH - rightTotalH) / 2);
    var rightNodes = stocks.map(function (st, idx) {
      var y = rightOffsetTop + idx * (rH + rGap);
      return {
        code: st.code,
        name: st.name,
        totalWeight: st.totalWeight,
        totalYuan: totalAmt * st.totalWeight,
        contributors: st.contributors || [],
        isOverlap: (st.contributors || []).length >= 2,
        x: rx, y: y, w: rw, h: rH,
        cy: y + rH / 2
      };
    });

    var leftByCode = {};
    leftNodes.forEach(function (n) { leftByCode[n.code] = n; });

    // Compute max single edge contribution for stroke width scaling
    var maxEdge = 0.001;
    rightNodes.forEach(function (rn) {
      rn.contributors.forEach(function (c) {
        if (c.contribution > maxEdge) maxEdge = c.contribution;
      });
    });

    var hasFocus = !!(focusCode && (
      leftNodes.some(function (n) { return n.code === focusCode; }) ||
      rightNodes.some(function (n) { return n.code === focusCode; })
    ));

    var o = '<svg class="flow-svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto;display:block">';
    // Column headers
    o += '<text x="' + lx + '" y="14" font-size="10" font-weight="600" fill="var(--ink-faint,#888)">你持有的 ETF / 股票</text>';
    o += '<text x="' + rx + '" y="14" font-size="10" font-weight="600" fill="var(--ink-faint,#888)">穿透出的前 10 底层重仓（折合资金）</text>';

    // 1. Edges (draw inactive first so active edges stay on top)
    var edgesHtml = [];
    rightNodes.forEach(function (rn) {
      rn.contributors.forEach(function (c) {
        var ln = leftByCode[c.sourceCode];
        if (!ln) return;
        var active = !hasFocus || focusCode === ln.code || focusCode === rn.code;
        var sw = Math.max(1.8, Math.min(13, (c.contribution / maxEdge) * 11.5 + 1.5));
        if (hasFocus && active) sw = Math.min(15, sw * 1.15);
        var x1 = ln.x + ln.w, y1 = ln.cy;
        var x2 = rn.x, y2 = rn.cy;
        var cx1 = x1 + (x2 - x1) * 0.48;
        var cx2 = x2 - (x2 - x1) * 0.48;
        var d = 'M' + x1.toFixed(1) + ',' + y1.toFixed(1)
          + ' C' + cx1.toFixed(1) + ',' + y1.toFixed(1)
          + ' ' + cx2.toFixed(1) + ',' + y2.toFixed(1)
          + ' ' + x2.toFixed(1) + ',' + y2.toFixed(1);
        var opacity = !hasFocus ? (rn.isOverlap ? 0.42 : 0.24) : (active ? 0.82 : 0.06);
        var edgeColor = ln.color;
        edgesHtml.push({
          active: active ? 1 : 0,
          html: '<path class="flow-edge" data-src="' + esc(ln.code) + '" data-dst="' + esc(rn.code) + '" d="' + d
            + '" fill="none" stroke="' + edgeColor + '" stroke-width="' + sw.toFixed(2)
            + '" stroke-linecap="round" opacity="' + opacity + '"/>'
        });
      });
    });
    edgesHtml.sort(function (a, b) { return a.active - b.active; });
    edgesHtml.forEach(function (e) { o += e.html; });

    // 2. Left nodes (held funds/stocks)
    leftNodes.forEach(function (ln) {
      var isSelf = focusCode === ln.code;
      var connected = !hasFocus || isSelf || rightNodes.some(function (rn) {
        return rn.code === focusCode && rn.contributors.some(function (c) { return c.sourceCode === ln.code; });
      });
      var nodeOpacity = connected ? 1 : 0.34;
      o += '<g class="flow-node" data-flow-code="' + esc(ln.code) + '" style="cursor:pointer" opacity="' + nodeOpacity + '">';
      o += '<rect x="' + ln.x + '" y="' + ln.y.toFixed(1) + '" width="' + ln.w + '" height="' + ln.h.toFixed(1)
        + '" rx="7" fill="var(--bg,#fff)" stroke="' + (isSelf ? ln.color : 'var(--line2,#ccc)')
        + '" stroke-width="' + (isSelf ? '2' : '1') + '"/>';
      o += '<rect x="' + ln.x + '" y="' + ln.y.toFixed(1) + '" width="5" height="' + ln.h.toFixed(1) + '" rx="2" fill="' + ln.color + '"/>';
      o += '<text x="' + (ln.x + 12) + '" y="' + (ln.cy - 3).toFixed(1) + '" font-size="12.5" font-weight="600" fill="var(--ink,#111)">'
        + esc(shortLabel(ln.name, 11)) + '</text>';
      o += '<text x="' + (ln.x + 12) + '" y="' + (ln.cy + 13).toFixed(1) + '" font-size="11" font-family="monospace" fill="var(--ink-soft,#666)">'
        + esc(fmtYuan(ln.amount)) + ' · ' + ln.wPct.toFixed(0) + '%</text>';
      o += '</g>';
    });

    // 3. Right nodes (top 10 underlying stocks)
    rightNodes.forEach(function (rn) {
      var isSelf = focusCode === rn.code;
      var connected = !hasFocus || isSelf || rn.contributors.some(function (c) { return c.sourceCode === focusCode; });
      var nodeOpacity = connected ? 1 : 0.34;
      var strokeColor = isSelf ? 'var(--ink,#111)' : (rn.isOverlap ? '#D92D20' : 'var(--line2,#ccc)');
      var strokeOpacity = isSelf ? '1' : (rn.isOverlap ? '0.55' : '1');
      o += '<g class="flow-node" data-flow-code="' + esc(rn.code) + '" style="cursor:pointer" opacity="' + nodeOpacity + '">';
      o += '<rect x="' + rn.x + '" y="' + rn.y.toFixed(1) + '" width="' + rn.w + '" height="' + rn.h + '" rx="6" fill="var(--bg,#fff)" stroke="'
        + strokeColor + '" stroke-opacity="' + strokeOpacity + '" stroke-width="' + (isSelf ? '1.8' : '1') + '"/>';
      if (rn.isOverlap) {
        o += '<circle cx="' + (rn.x + 11) + '" cy="' + (rn.cy).toFixed(1) + '" r="3.5" fill="#D92D20"/>';
      }
      var nameX = rn.isOverlap ? (rn.x + 20) : (rn.x + 10);
      var cleanStockName = String(rn.name || '').replace(/\s*\([A-Z0-9:]+\)\s*$/i, '');
      o += '<text x="' + nameX + '" y="' + (rn.cy + 4.5).toFixed(1) + '" font-size="12" font-weight="600" fill="var(--ink,#111)">'
        + esc(shortLabel(cleanStockName, 8)) + '</text>';
      if (rn.isOverlap) {
        var tagTxt = rn.contributors.length + '撞车';
        o += '<rect x="' + (rn.x + 112) + '" y="' + (rn.cy - 8).toFixed(1) + '" width="38" height="16" rx="3" fill="#D92D20" opacity="0.12"/>';
        o += '<text x="' + (rn.x + 131) + '" y="' + (rn.cy + 3.5).toFixed(1) + '" font-size="9.5" font-weight="600" fill="#D92D20" text-anchor="middle">'
          + esc(tagTxt) + '</text>';
      }
      o += '<text x="' + (rn.x + rn.w - 8) + '" y="' + (rn.cy + 4).toFixed(1) + '" font-size="11.5" font-family="monospace" font-weight="600" fill="var(--ink,#111)" text-anchor="end">'
        + esc(fmtYuan(rn.totalYuan)) + '</text>';
      o += '</g>';
    });

    return o + '</svg>';
  }

  /** Correlation heatmap SVG; value printed in each cell. */
  function correlationSVG(corr, labels) {
    var m = corr.matrix || [];
    var n = m.length;
    if (!n) return '<div style="padding:20px;text-align:center;color:#888">相关性数据不足（需≥6个共同交易日）</div>';
    var cell = 46, L = 92, T = 24, W = L + n * cell + 8, H = T + n * cell + 8;
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px">';
    labels.forEach(function (lb, j) {
      o += '<text x="' + (L + j * cell + cell / 2) + '" y="' + (T - 6) + '" font-size="10" fill="#888" text-anchor="middle">' + esc(lb) + '</text>';
      o += '<text x="' + (L - 6) + '" y="' + (T + j * cell + cell / 2 + 3) + '" font-size="10" fill="#888" text-anchor="end">' + esc(lb) + '</text>';
    });
    for (var i = 0; i < n; i++) {
      for (var j = 0; j < n; j++) {
        var v = m[i][j];
        var x = L + j * cell, y = T + i * cell;
        var fill = 'var(--surface,#eee)', fg = 'var(--ink,#333)';
        if (v !== null && v > 0) { fill = 'rgba(217,45,32,' + (0.10 + v * 0.55).toFixed(3) + ')'; fg = v > 0.55 ? '#fff' : 'var(--ink,#333)'; }
        else if (v !== null && v < 0) { fill = 'rgba(37,99,235,' + (0.12 + Math.abs(v) * 0.45).toFixed(3) + ')'; fg = '#fff'; }
        o += '<rect x="' + x + '" y="' + y + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="4" fill="' + fill + '"/>';
        o += '<text x="' + (x + cell / 2 - 1) + '" y="' + (y + cell / 2 + 3) + '" font-size="10" font-family="monospace" fill="' + fg + '" text-anchor="middle">' + (v === null ? '--' : v.toFixed(2)) + '</text>';
      }
    }
    return o + '</svg>';
  }

  /** NAV curve with max-drawdown shading. */
  function navDrawdownSVG(result) {
    if (!result || !result.curve || result.curve.length < 2) return '<div style="padding:20px;text-align:center;color:#888">净值数据不足</div>';
    var curve = result.curve, W = 640, H = 220, L = 44, R = 12, T = 16, B = 28;
    var iw = W - L - R, ih = H - T - B;
    var lo = Infinity, hi = -Infinity;
    curve.forEach(function (p) { lo = Math.min(lo, p.nav); hi = Math.max(hi, p.nav); });
    if (hi === lo) { hi = lo + 1; }
    var X = function (i) { return L + i / (curve.length - 1) * iw; };
    var Y = function (v) { return T + (hi - v) / (hi - lo) * ih; };
    var pts = curve.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p.nav).toFixed(1); }).join(' ');
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (k) {
      var y = T + ih * k;
      o += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="var(--line,#eee)"/>';
      o += '<text x="' + (L - 5) + '" y="' + (y + 3) + '" font-size="9" fill="#888" text-anchor="end">' + (hi - (hi - lo) * k).toFixed(3) + '</text>';
    });
    if (result.mddRange && result.mddRange[0] && result.mddRange[1]) {
      var i0 = curve.findIndex(function (p) { return p.t >= result.mddRange[0]; });
      var i1 = curve.findIndex(function (p) { return p.t >= result.mddRange[1]; });
      if (i0 >= 0 && i1 > i0) {
        o += '<rect x="' + X(i0) + '" y="' + T + '" width="' + (X(i1) - X(i0)) + '" height="' + ih + '" fill="#D92D20" opacity="0.10"/>';
      }
    }
    o += '<polyline points="' + pts + '" fill="none" stroke="var(--ink,#111)" stroke-width="1.8"/>';
    o += '<text x="' + L + '" y="' + (H - 6) + '" font-size="9" fill="#888">' + esc(curve[0].t) + '</text>';
    o += '<text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="9" fill="#888" text-anchor="end">' + esc(curve[curve.length - 1].t) + '</text>';
    return o + '</svg>';
  }

  /** 10-year cash dividend bars + ex-rights fill timeline. */
  function dividendTimelineSVG(div) {
    var hist = (div && div.history) || [];
    if (!hist.length) return '<div style="padding:20px;text-align:center;color:#888">暂无实施分红记录</div>';
    var W = 640, H = 180, L = 34, R = 12, T = 16, B = 36;
    var iw = W - L - R, ih = H - T - B;
    var maxCash = Math.max.apply(null, hist.map(function (h) { return h.cashPer10 || 0; })) || 1;
    var bw = Math.min(28, iw / hist.length * 0.6);
    var yearCounts = {};
    hist.forEach(function (h) { yearCounts[h.year] = (yearCounts[h.year] || 0) + 1; });
    var o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    hist.forEach(function (h, i) {
      var x = L + (i + 0.5) * iw / hist.length;
      var bh = (h.cashPer10 / maxCash) * ih;
      var fill = h.filled === false ? '#D92D20' : (h.filled === true ? 'var(--ink,#111)' : '#bbb');
      var xLabel = (yearCounts[h.year] > 1 && h.exDate) ? h.exDate.slice(2, 7) : String(h.year);
      o += '<rect x="' + (x - bw / 2) + '" y="' + (T + ih - bh) + '" width="' + bw + '" height="' + bh + '" rx="3" fill="' + fill + '"/>';
      o += '<text x="' + x + '" y="' + (T + ih - bh - 4) + '" font-size="9" fill="#888" text-anchor="middle">' + (h.cashPer10 || 0) + '</text>';
      o += '<text x="' + x + '" y="' + (H - 17) + '" font-size="9" fill="#888" text-anchor="middle">' + esc(xLabel) + '</text>';
      o += '<text x="' + x + '" y="' + (H - 4) + '" font-size="8" fill="' + (h.filled === false ? '#D92D20' : '#999') + '" text-anchor="middle">' + (h.filled === false ? '未填权' : (h.fillDays ? h.fillDays + '日' : '--')) + '</text>';
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
    correlationSVG: correlationSVG,
    navDrawdownSVG: navDrawdownSVG,
    dividendTimelineSVG: dividendTimelineSVG
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.AlphaLensAnalytics = api;
})(typeof window !== 'undefined' ? window : null);
