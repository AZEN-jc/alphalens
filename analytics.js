/* AlphaLens v3.1 — pure analytics engine (zero dependency, file:// ready).
 * Five functions from the v3.1 spec. Exposed on window.AlphaLensAnalytics.
 * No export keyword: loaded as plain/inlined <script> on file://.
 */
(function (global) {
  'use strict';

  function addExposure(map, stockCode, stockName, weight, sourceCode, sourceName) {
    if (!map.has(stockCode)) {
      map.set(stockCode, { code: stockCode, name: stockName, totalWeight: 0, contributors: [] });
    }
    var entry = map.get(stockCode);
    entry.totalWeight += weight;
    var existing = entry.contributors.find(function (c) { return c.sourceCode === sourceCode; });
    if (existing) {
      existing.contribution += weight;
    } else {
      entry.contributors.push({ sourceCode: sourceCode, sourceName: sourceName, contribution: weight });
    }
  }

  /** 1. Portfolio penetration & fake-diversification check */
  function penetratePortfolio(positions, assetsMap) {
    var valid = positions.filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
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
    var valid = positions.filter(function (p) { return Number(p.amount) > 0 && assetsMap[p.code]; });
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
    var maxSingle = (pen && pen.exposures && pen.exposures[0]) ? pen.exposures[0].totalWeight : 0;
    var overlapList = (pen && Array.isArray(pen.overlaps)) ? pen.overlaps : [];
    var overlapCount = overlapList.length;
    var overlapWeight = overlapList.reduce(function (s, x) { return s + x.totalWeight; }, 0);
    var avgCorr = (corr && corr.avgOffDiagonal !== undefined) ? corr.avgOffDiagonal : null;
    var absMdd = (curve && curve.maxDrawdown != null) ? Math.abs(curve.maxDrawdown) : null;
    var vol = (curve && curve.annualizedVol != null) ? curve.annualizedVol : null;

    var concentration = !hasPos
      ? { level: 'UNKNOWN', label: '暂无持仓', detail: '--' }
      : maxSingle >= 0.15
        ? { level: 'HIGH', label: '高集中', detail: '单一底层最高 ' + (maxSingle * 100).toFixed(1) + '%' }
        : maxSingle >= 0.08
          ? { level: 'MEDIUM', label: '中度集中', detail: '单一底层最高 ' + (maxSingle * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '分散良好', detail: '单一底层最高 ' + (maxSingle * 100).toFixed(1) + '%' };

    var overlap = !hasPos
      ? { level: 'UNKNOWN', label: '暂无持仓', detail: '--' }
      : (overlapCount >= 4 || overlapWeight >= 0.20)
        ? { level: 'HIGH', label: '严重重合', detail: overlapCount + ' 只重合 · 合计 ' + (overlapWeight * 100).toFixed(1) + '%' }
        : (overlapCount >= 2 || overlapWeight >= 0.08)
          ? { level: 'MEDIUM', label: '轻度重合', detail: overlapCount + ' 只重合 · 合计 ' + (overlapWeight * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '低重合', detail: overlapCount + ' 只重合' };

    var correlation = avgCorr === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : avgCorr >= 0.65
        ? { level: 'HIGH', label: '高正相关', detail: '均值 ' + avgCorr.toFixed(2) }
        : avgCorr >= 0.35
          ? { level: 'MEDIUM', label: '中等相关', detail: '均值 ' + avgCorr.toFixed(2) }
          : { level: 'LOW', label: '低相关分散', detail: '均值 ' + avgCorr.toFixed(2) };

    var drawdownVol = absMdd === null
      ? { level: 'UNKNOWN', label: '样本不足', detail: '--' }
      : (absMdd >= 0.25 || (vol !== null && vol >= 0.24))
        ? { level: 'HIGH', label: '高波动回撤', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
        : (absMdd >= 0.15 || (vol !== null && vol >= 0.16))
          ? { level: 'MEDIUM', label: '中等回撤', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' }
          : { level: 'LOW', label: '低波动稳健', detail: '最大回撤 -' + (absMdd * 100).toFixed(1) + '%' };

    return {
      concentration: concentration,
      overlap: overlap,
      correlation: correlation,
      drawdownVol: drawdownVol
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
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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
    penetratePortfolio: penetratePortfolio,
    computeCorrelationMatrix: computeCorrelationMatrix,
    computePortfolioCurveAndDrawdown: computePortfolioCurveAndDrawdown,
    evaluatePortfolioRisk: evaluatePortfolioRisk,
    calcAfterTaxDividend: calcAfterTaxDividend,
    correlationSVG: correlationSVG,
    navDrawdownSVG: navDrawdownSVG,
    dividendTimelineSVG: dividendTimelineSVG
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.AlphaLensAnalytics = api;
})(typeof window !== 'undefined' ? window : null);
