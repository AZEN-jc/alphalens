/* AlphaLens realtime feed — Tencent qt.gtimg.cn, script-tag JSONP (works on file://).
 * Tencent answers without Referer (Sina returns 403 without one), so it is the
 * only source that survives a double-clicked local page. GBK charset is required
 * for Chinese names. On any failure the caller keeps the injected snapshot and
 * must show an explicit SNAPSHOT badge — never invent live values.
 */
(function (global) {
  'use strict';
  var API = 'https://qt.gtimg.cn/q=';
  var CODES = [];
  var DATA = {};
  var STATE = 'SNAPSHOT';
  var STAMP = '';
  var LISTENERS = [];
  var TIMER = null;
  var SEQ = 0;
  var FAILS = 0;

  var INDEX_CODES = { '000001':'sh', '399001':'sz', '399006':'sz', '000688':'sh',
                      '000300':'sh', '000905':'sh', '000852':'sh', '000016':'sh' };
  function sym(code) {
    if (code.indexOf('IDX_') === 0) { var c = code.slice(4); return (INDEX_CODES[c]||'sh') + c; }
    if (INDEX_CODES[code]) return INDEX_CODES[code] + code;
    if (/^(6|5|9)/.test(code)) return 'sh' + code;
    if (/^(0|3)/.test(code)) return 'sz' + code;
    if (/^(4|8)/.test(code)) return 'bj' + code;
    return 'sh' + code;
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }

  function parse() {
    var changed = false;
    CODES.forEach(function (entry) {
      var isIdx = entry.indexOf('IDX_') === 0;
      var code = isIdx ? entry.slice(4) : entry;
      var raw = global['v_' + sym(entry)];
      if (!raw || typeof raw !== 'string') return;
      var f = raw.split('~');
      if (f.length < 38) return;
      var v = {
        code: code, name: f[1], last: num(f[3]), prev: num(f[4]), open: num(f[5]),
        time: f[30] || '', delta: num(f[31]), chgPct: num(f[32]),
        high: num(f[33]), low: num(f[34]), vol: num(f[36]), amount: num(f[37])
      };
      var key = code;
      if (isIdx) key = 'IDX_' + code;
      var old = DATA[key];
      if (!old || old.last !== v.last || old.time !== v.time) changed = true;
      DATA[key] = v;
      STAMP = v.time || STAMP;
    });
    return changed;
  }

  function emit() {
    LISTENERS.forEach(function (fn) {
      try { fn(STATE, DATA, STAMP); }
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
      var got = ok ? parse() : false;
      if (got) { STATE = 'LIVE'; FAILS = 0; }
      else {
        FAILS += 1;
        STATE = DATA && Object.keys(DATA).length ? 'LIVE' : 'SNAPSHOT';
      }
      if (s.parentNode) s.parentNode.removeChild(s);
      emit();
    };
    s.charset = 'gbk'; s.src = API + CODES.map(sym).join(',') + '&_=' + (++SEQ);
    s.onload = function () { finish(true); };
    s.onerror = function () { finish(false); };
    timeoutId = setTimeout(function () { finish(false); }, 5000);
    (document.head || document.body).appendChild(s);
  }

  function start(codes, intervalMs, onChange) {
    stop();
    CODES = (codes || []).slice();
    FAILS = 0;
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
  function status() { return { state: STATE, stamp: STAMP, count: Object.keys(DATA).length }; }

  global.AlphaLive = { start: start, stop: stop, get: get, all: all, status: status, sym: sym };
})(window);
