/* AlphaLens v3 — pure analytics engine (zero dependency, file:// ready).
 * Four functions from the v3 spec. Exposed on window.AlphaLensAnalytics.
 * No export keyword: this is loaded as a plain <script> on file://.
 */
(function (global) {
  'use strict';

  function addExposure(map, stockCode, stockName, weight, sourceCode, sourceName) {
    if (!map.has(stockCode)) {
      map.set(stockCode, { code: stockCode, name: stockName, totalWeight: 0, contributors: [] });
    }
    const entry = map.get(stockCode);
    entry.totalWeight += weight;
    entry.contributors.push({ sourceCode, sourceName, contribution: weight });
  }

  /** 1. Portfolio penetration & fake-diversification check */
  function penetratePortfolio(positions, assetsMap) {
    const valid = positions.filter(p => Number(p.amount) > 0 && assetsMap[p.code]);
    const totalAmount = valid.reduce((sum, p) => sum + Number(p.amount), 0);
    if (totalAmount <= 0) {
      return { totalAmount: 0, exposures: [], overlaps: [], coveredRatio: 0, weightedFee: 0, riskLevel: 'EMPTY' };
    }
    const exposureMap = new Map();
    let coveredRatio = 0, weightedFee = 0;
    for (const pos of valid) {
      const asset = assetsMap[pos.code];
      const portWeight = Number(pos.amount) / totalAmount;
      weightedFee += portWeight * (Number(asset.fee) || 0);
      if (asset.type === 'STOCK' || asset.holdingsStatus === 'NO_EQUITY_HOLDINGS') {
        coveredRatio += portWeight;
        addExposure(exposureMap, asset.code, asset.name, portWeight, asset.code, asset.name);
      } else if (asset.type === 'ETF' && Array.isArray(asset.holdings)) {
        let etfTopSum = 0;
        for (const h of asset.holdings) {
          const w = (Number(h.weight) || 0) / 100;
          if (w <= 0) continue;
          etfTopSum += w;
          addExposure(exposureMap, h.code, h.name, portWeight * w, asset.code, asset.name);
        }
        coveredRatio += portWeight * Math.min(etfTopSum, 1);
      }
    }
    const exposures = Array.from(exposureMap.values()).sort((a, b) => b.totalWeight - a.totalWeight);
    const overlaps = exposures.filter(item => item.contributors.length >= 2);
    const maxSingleWeight = exposures[0] ? exposures[0].totalWeight : 0;
    let riskLevel = 'LOW';
    if (maxSingleWeight >= 0.15 || overlaps.length >= 4) riskLevel = 'HIGH';
    else if (maxSingleWeight >= 0.08 || overlaps.length >= 2) riskLevel = 'MEDIUM';
    return {
      totalAmount, exposures: exposures.slice(0, 15), overlaps,
      coveredRatio, weightedFee, riskLevel
    };
  }

  function alignCloseSeries(codes, assetsMap) {
    const seriesMaps = codes.map(code => {
      const m = new Map();
      const bars = (assetsMap[code] && assetsMap[code].closes) || [];
      for (const bar of bars) {
        if (Number.isFinite(bar.c) && bar.c > 0) m.set(bar.t, bar.c);
      }
      return m;
    });
    if (seriesMaps.length === 0) return { dates: [], matrix: [] };
    const commonDates = Array.from(seriesMaps[0].keys())
      .filter(d => seriesMaps.every(m => m.has(d)))
      .sort();
    const matrix = seriesMaps.map(m => commonDates.map(d => m.get(d)));
    return { dates: commonDates, matrix };
  }

  function pearson(xs, ys) {
    const len = Math.min(xs.length, ys.length);
    if (len < 5) return null;
    let mx = 0, my = 0;
    for (let i = 0; i < len; i++) { mx += xs[i]; my += ys[i]; }
    mx /= len; my /= len;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < len; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    return denom === 0 ? null : num / denom;
  }

  /** 2. Pearson correlation matrix of asset daily returns */
  function computeCorrelationMatrix(codes, assetsMap) {
    const aligned = alignCloseSeries(codes, assetsMap);
    const dates = aligned.dates, series = aligned.matrix;
    const n = codes.length;
    if (dates.length < 6 || n === 0) {
      return { codes, matrix: [], avgOffDiagonal: null, sampleDays: dates.length };
    }
    const returns = series.map(prices => {
      const r = [];
      for (let i = 1; i < prices.length; i++) r.push((prices[i] - prices[i - 1]) / prices[i - 1]);
      return r;
    });
    const corr = Array.from({ length: n }, () => Array(n).fill(null));
    let offSum = 0, offCount = 0;
    for (let i = 0; i < n; i++) {
      corr[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const val = pearson(returns[i], returns[j]);
        corr[i][j] = val; corr[j][i] = val;
        if (val !== null) { offSum += val; offCount++; }
      }
    }
    return {
      codes, matrix: corr,
      avgOffDiagonal: offCount > 0 ? offSum / offCount : null,
      sampleDays: dates.length - 1
    };
  }

  /** 3. Composite NAV curve, max drawdown, annualized volatility */
  function computePortfolioCurveAndDrawdown(positions, assetsMap) {
    const valid = positions.filter(p => Number(p.amount) > 0 && assetsMap[p.code]);
    const totalAmount = valid.reduce((s, p) => s + Number(p.amount), 0);
    if (totalAmount <= 0) return null;
    const codes = valid.map(p => p.code);
    const weights = valid.map(p => Number(p.amount) / totalAmount);
    const aligned = alignCloseSeries(codes, assetsMap);
    const dates = aligned.dates, series = aligned.matrix;
    if (dates.length < 2) return null;
    const navSeries = [];
    let peak = -Infinity, peakDate = dates[0], maxDrawdown = 0;
    let mddPeakDate = dates[0], mddTroughDate = dates[0];
    for (let t = 0; t < dates.length; t++) {
      let nav = 0;
      for (let i = 0; i < codes.length; i++) nav += weights[i] * (series[i][t] / series[i][0]);
      if (nav > peak) { peak = nav; peakDate = dates[t]; }
      const dd = (nav - peak) / peak;
      if (dd < maxDrawdown) { maxDrawdown = dd; mddPeakDate = peakDate; mddTroughDate = dates[t]; }
      navSeries.push({ t: dates[t], nav, dd });
    }
    const dailyRet = [];
    for (let i = 1; i < navSeries.length; i++) {
      dailyRet.push((navSeries[i].nav - navSeries[i - 1].nav) / navSeries[i - 1].nav);
    }
    const mean = dailyRet.reduce((a, b) => a + b, 0) / dailyRet.length;
    const variance = dailyRet.reduce((s, r) => s + (r - mean) * (r - mean), 0) / Math.max(dailyRet.length - 1, 1);
    const annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
    return {
      curve: navSeries,
      totalReturn: navSeries[navSeries.length - 1].nav - 1,
      maxDrawdown, mddRange: [mddPeakDate, mddTroughDate],
      annualizedVol, sampleDays: dates.length
    };
  }

  /** 4. After-tax dividend yield by A-share holding period */
  function calcAfterTaxDividend(ttmYieldPct, principal, holdingPeriod, benchmarkPct) {
    holdingPeriod = holdingPeriod || 'gt_1y';
    if (benchmarkPct === undefined || benchmarkPct === null) benchmarkPct = 2.0;
    const taxMap = { lt_1m: 0.20, '1m_to_1y': 0.10, gt_1y: 0.00 };
    const taxRate = taxMap[holdingPeriod] === undefined ? 0 : taxMap[holdingPeriod];
    const netYieldPct = Number(ttmYieldPct) * (1 - taxRate);
    const annualCashAfterTax = Number(principal) * (netYieldPct / 100);
    const extraCashVsBenchmark = Number(principal) * ((netYieldPct - Number(benchmarkPct)) / 100);
    return {
      taxRate, netYieldPct, annualCashAfterTax,
      spreadPct: netYieldPct - Number(benchmarkPct),
      extraCashVsBenchmark
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
    const m = corr.matrix || [];
    const n = m.length;
    if (!n) return '<div style="padding:20px;text-align:center;color:#888">相关性数据不足（需≥6个共同交易日）</div>';
    const cell = 44, L = 92, T = 24, W = L + n * cell + 8, H = T + n * cell + 8;
    let o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px">';
    labels.forEach(function (lb, j) {
      o += '<text x="' + (L + j * cell + cell / 2) + '" y="' + (T - 6) + '" font-size="10" fill="#888" text-anchor="middle">' + esc(lb) + '</text>';
      o += '<text x="' + (L - 6) + '" y="' + (T + j * cell + cell / 2 + 3) + '" font-size="10" fill="#888" text-anchor="end">' + esc(lb) + '</text>';
    });
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = m[i][j];
        const x = L + j * cell, y = T + i * cell;
        let fill = '#eee', fg = '#333';
        if (v !== null && v > 0) { fill = 'rgba(217,45,32,' + (0.10 + v * 0.55).toFixed(3) + ')'; fg = v > 0.55 ? '#fff' : '#333'; }
        else if (v !== null && v < 0) { fill = 'rgba(37,99,235,' + (0.10 + Math.abs(v) * 0.4).toFixed(3) + ')'; fg = '#fff'; }
        o += '<rect x="' + x + '" y="' + y + '" width="' + (cell - 2) + '" height="' + (cell - 2) + '" rx="4" fill="' + fill + '"/>';
        o += '<text x="' + (x + cell / 2 - 1) + '" y="' + (y + cell / 2 + 3) + '" font-size="10" font-family="monospace" fill="' + fg + '" text-anchor="middle">' + (v === null ? '--' : v.toFixed(2)) + '</text>';
      }
    }
    return o + '</svg>';
  }

  /** NAV curve with max-drawdown shading. */
  function navDrawdownSVG(result) {
    if (!result || !result.curve || result.curve.length < 2) return '<div style="padding:20px;text-align:center;color:#888">净值数据不足</div>';
    const curve = result.curve, W = 640, H = 220, L = 44, R = 12, T = 16, B = 28;
    const iw = W - L - R, ih = H - T - B;
    let lo = Infinity, hi = -Infinity;
    curve.forEach(function (p) { lo = Math.min(lo, p.nav); hi = Math.max(hi, p.nav); });
    if (hi === lo) { hi = lo + 1; }
    const X = function (i) { return L + i / (curve.length - 1) * iw; };
    const Y = function (v) { return T + (hi - v) / (hi - lo) * ih; };
    const pts = curve.map(function (p, i) { return X(i).toFixed(1) + ',' + Y(p.nav).toFixed(1); }).join(' ');
    let o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (k) {
      const y = T + ih * k;
      o += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="#eee"/>';
      o += '<text x="' + (L - 5) + '" y="' + (y + 3) + '" font-size="9" fill="#888" text-anchor="end">' + (hi - (hi - lo) * k).toFixed(3) + '</text>';
    });
    // drawdown shaded band between mdd peak and trough
    if (result.mddRange && result.mddRange[0] && result.mddRange[1]) {
      const i0 = curve.findIndex(function (p) { return p.t >= result.mddRange[0]; });
      const i1 = curve.findIndex(function (p) { return p.t >= result.mddRange[1]; });
      if (i0 >= 0 && i1 > i0) {
        o += '<rect x="' + X(i0) + '" y="' + T + '" width="' + (X(i1) - X(i0)) + '" height="' + ih + '" fill="#D92D20" opacity="0.08"/>';
      }
    }
    o += '<polyline points="' + pts + '" fill="none" stroke="#111" stroke-width="1.8"/>';
    o += '<text x="' + L + '" y="' + (H - 6) + '" font-size="9" fill="#888">' + esc(curve[0].t) + '</text>';
    o += '<text x="' + (W - R) + '" y="' + (H - 6) + '" font-size="9" fill="#888" text-anchor="end">' + esc(curve[curve.length - 1].t) + '</text>';
    return o + '</svg>';
  }

  /** 10-year cash dividend bars + ex-rights fill timeline. */
  function dividendTimelineSVG(div) {
    const hist = (div && div.history) || [];
    if (!hist.length) return '<div style="padding:20px;text-align:center;color:#888">暂无实施分红记录</div>';
    const W = 640, H = 180, L = 34, R = 12, T = 16, B = 34;
    const iw = W - L - R, ih = H - T - B;
    const maxCash = Math.max.apply(null, hist.map(function (h) { return h.cashPer10 || 0; })) || 1;
    const bw = Math.min(28, iw / hist.length * 0.6);
    let o = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';
    hist.forEach(function (h, i) {
      const x = L + (i + 0.5) * iw / hist.length;
      const bh = (h.cashPer10 / maxCash) * ih;
      const fill = h.filled === false ? '#D92D20' : (h.filled === true ? '#111' : '#bbb');
      o += '<rect x="' + (x - bw / 2) + '" y="' + (T + ih - bh) + '" width="' + bw + '" height="' + bh + '" rx="3" fill="' + fill + '"/>';
      o += '<text x="' + x + '" y="' + (T + ih - bh - 4) + '" font-size="9" fill="#666" text-anchor="middle">' + (h.cashPer10 || 0) + '</text>';
      o += '<text x="' + x + '" y="' + (H - 16) + '" font-size="9" fill="#888" text-anchor="middle">' + h.year + '</text>';
      o += '<text x="' + x + '" y="' + (H - 4) + '" font-size="8" fill="' + (h.filled === false ? '#D92D20' : '#999') + '" text-anchor="middle">' + (h.filled === false ? '未填权' : (h.fillDays ? h.fillDays + '日' : '--')) + '</text>';
    });
    return o + '</svg>';
  }

  const api = {
    penetratePortfolio, computeCorrelationMatrix,
    computePortfolioCurveAndDrawdown, calcAfterTaxDividend,
    correlationSVG, navDrawdownSVG, dividendTimelineSVG
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.AlphaLensAnalytics = api;
})(typeof window !== 'undefined' ? window : null);
