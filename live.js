/* AlphaLens v3.1 realtime feed — Tencent qt.gtimg.cn, script-tag JSONP (works on file://).
 * Tencent answers without Referer (Sina returns 403 without one), so it is the
 * only source that survives a double-clicked local page. GBK charset is required
 * for Chinese names. On any failure the caller keeps the injected snapshot and
 * must show an explicit SNAPSHOT badge — never invent live values.
 *
 * v3.1 fixes:
 *  - Success condition: valid JSONP response with >= 1 parsed numeric quote counts as OK
 *    even when prices are unchanged (market close / weekends / holidays), avoiding false
 *    failure counts and unnecessary 30s backoff.
 *  - Fix Shenzhen 159xxx ETF prefix mapping (0/1/2/3 -> sz).
 *  - Expose exact parsed count & total count for header badge (e.g. LIVE 34/36).
 */
(function (global) {
  'use strict';
  var API = 'https://qt.gtimg.cn/q=';
  var CODES = [];
  var DATA = {};
  var STATE = 'SNAPSHOT';
  var STAMP = '';
  var LAST_COUNT = 0;
  var LISTENERS = [];
  var TIMER = null;
  var SEQ = 0;
  var FAILS = 0;

  var INDEX_CODES = {
    '000001': 'sh', '399001': 'sz', '399006': 'sz', '000688': 'sh',
    '000300': 'sh', '000905': 'sh', '000852': 'sh', '000016': 'sh'
  };

  function sym(code) {
    var s = String(code || '').trim();
    if (/^(sh|sz|bj)\d{6}$/i.test(s)) return s.toLowerCase();
    if (s.indexOf('IDX_') === 0) { var c = s.slice(4); return (INDEX_CODES[c] || 'sh') + c; }
    if (INDEX_CODES[s]) return INDEX_CODES[s] + s;
    if (/^(6|5|9)/.test(s)) return 'sh' + s;
    if (/^(0|1|2|3)/.test(s)) return 'sz' + s;
    if (/^(4|8)/.test(s)) return 'bj' + s;
    return 'sh' + s;
  }

  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
  function validNum(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

  function parse() {
    var parsedCount = 0;
    CODES.forEach(function (entry) {
      var isIdx = entry.indexOf('IDX_') === 0;
      var code = isIdx ? entry.slice(4) : entry.replace(/^(sh|sz|bj)/i, '');
      var fullSym = sym(entry);
      var raw = global['v_' + fullSym];
      if (!raw || typeof raw !== 'string') return;
      var f = raw.split('~');
      if (f.length < 38) return;
      var lastRaw = validNum(f[3]);
      var prevRaw = validNum(f[4]);
      var last = (lastRaw !== null && lastRaw > 0) ? lastRaw : ((prevRaw !== null && prevRaw > 0) ? prevRaw : 0);
      if (!(last > 0)) return;
      var v = {
        code: code, name: f[1], last: last, prev: num(f[4]), open: num(f[5]),
        time: f[30] || '', delta: num(f[31]), chgPct: num(f[32]),
        high: num(f[33]), low: num(f[34]), vol: num(f[36]), amount: num(f[37])
      };
      var key = isIdx ? ('IDX_' + code) : code;
      DATA[key] = v;
      STAMP = v.time || STAMP;
      parsedCount += 1;
    });
    LAST_COUNT = parsedCount;
    return parsedCount;
  }

  function status() {
    return {
      state: STATE,
      stamp: STAMP,
      count: Object.keys(DATA).length,
      lastCount: LAST_COUNT,
      total: CODES.length
    };
  }

  function emit() {
    var st = status();
    LISTENERS.forEach(function (fn) {
      try { fn(STATE, DATA, STAMP, st); }
      catch (e) { if (global.console) console.warn('[AlphaLive] listener failed:', e.message); }
    });
  }

  function tick() {
    if (!CODES.length) return;
    if (STATE !== 'LIVE') STATE = 'CONNECTING';
    emit();
    var s = document.createElement('script');
    var done = false;
    var timeoutId = null;
    var finish = function (ok) {
      if (done) return;
      done = true;
      if (timeoutId) { clearTimeout(timeoutId); timeoutId = null; }
      var parsed = ok ? parse() : 0;
      if (ok && parsed >= 1) {
        STATE = 'LIVE';
        FAILS = 0;
      } else {
        FAILS += 1;
        STATE = Object.keys(DATA).length > 0 ? 'LIVE' : 'SNAPSHOT';
      }
      if (s.parentNode) s.parentNode.removeChild(s);
      emit();
    };
    s.charset = 'gbk';
    s.src = API + CODES.map(sym).join(',') + '&_=' + (++SEQ);
    s.onload = function () { finish(true); };
    s.onerror = function () { finish(false); };
    timeoutId = setTimeout(function () { finish(false); }, 6000);
    (document.head || document.body).appendChild(s);
  }

  function start(codes, intervalMs, onChange) {
    stop();
    CODES = (codes || []).slice();
    FAILS = 0;
    LAST_COUNT = 0;
    if (onChange && LISTENERS.indexOf(onChange) < 0) LISTENERS.push(onChange);
    tick();
    var base = Math.max(3000, intervalMs || 5000);
    TIMER = setInterval(function () {
      tick();
      if (FAILS >= 3 && base < 30000) {
        stop();
        base = 30000;
        TIMER = setInterval(tick, base);
      }
    }, base);
  }

  function stop() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }
  function get(code) { return DATA[code] || DATA['IDX_' + code] || null; }
  function all() { return DATA; }

  global.AlphaLive = { start: start, stop: stop, get: get, all: all, status: status, sym: sym };
})(window);
