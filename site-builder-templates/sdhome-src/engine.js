(function() {
  let e21 = document.createElement(`link`).relList;
  if (e21 && e21.supports && e21.supports(`modulepreload`)) return;
  for (let e22 of document.querySelectorAll(`link[rel="modulepreload"]`)) n2(e22);
  new MutationObserver((e22) => {
    for (let t3 of e22) if (t3.type === `childList`) for (let e23 of t3.addedNodes) e23.tagName === `LINK` && e23.rel === `modulepreload` && n2(e23);
  }).observe(document, { childList: true, subtree: true });
  function t2(e22) {
    let t3 = {};
    return e22.integrity && (t3.integrity = e22.integrity), e22.referrerPolicy && (t3.referrerPolicy = e22.referrerPolicy), t3.credentials = e22.crossOrigin === `use-credentials` ? `include` : e22.crossOrigin === `anonymous` ? `omit` : `same-origin`, t3;
  }
  function n2(e22) {
    if (e22.ep) return;
    e22.ep = true;
    let n3 = t2(e22);
    fetch(e22.href, n3);
  }
})();
function e(e21) {
  if (e21 === void 0) throw ReferenceError(`this hasn't been initialised - super() hasn't been called`);
  return e21;
}
function t(e21, t2) {
  e21.prototype = Object.create(t2.prototype), e21.prototype.constructor = e21, e21.__proto__ = t2;
}
var n = { autoSleep: 120, force3D: `auto`, nullTargetWarn: 1, units: { lineHeight: `` } }, r = { duration: 0.5, overwrite: false, delay: 0 }, i, a, o, s = 1e8, c = 1 / s, l = Math.PI * 2, u = l / 4, d = 0, f = Math.sqrt, p = Math.cos, m = Math.sin, h = function(e21) {
  return typeof e21 == `string`;
}, g = function(e21) {
  return typeof e21 == `function`;
}, _ = function(e21) {
  return typeof e21 == `number`;
}, v = function(e21) {
  return e21 === void 0;
}, y = function(e21) {
  return typeof e21 == `object`;
}, b = function(e21) {
  return e21 !== false;
}, x = function() {
  return typeof window < `u`;
}, S = function(e21) {
  return g(e21) || h(e21);
}, C = typeof ArrayBuffer == `function` && ArrayBuffer.isView || function() {
}, w = Array.isArray, T = /random\([^)]+\)/g, E = /,\s*/g, D = /(?:-?\.?\d|\.)+/gi, O = /[-+=.]*\d+[.e\-+]*\d*[e\-+]*\d*/g, k = /[-+=.]*\d+[.e-]*\d*[a-z%]*/g, A = /[-+=.]*\d+\.?\d*(?:e-|e\+)?\d*/gi, j = /[+-]=-?[.\d]+/, M = /[^,'"\[\]\s]+/gi, N = /^[+\-=e\s\d]*\d+[.\d]*([a-z]*|%)\s*$/i, P, F, I, L, R = {}, ee = {}, te, z = function(e21) {
  return (ee = G(e21, R)) && Kn;
}, ne = function(e21, t2) {
  return console.warn(`Invalid property`, e21, `set to`, t2, `Missing plugin? gsap.registerPlugin()`);
}, B = function(e21, t2) {
  return !t2 && console.warn(e21);
}, re = function(e21, t2) {
  return e21 && (R[e21] = t2) && ee && (ee[e21] = t2) || R;
}, ie = function() {
  return 0;
}, ae = { suppressEvents: true, isStart: true, kill: false }, V = { suppressEvents: true, kill: false }, oe = { suppressEvents: true }, se = {}, H = [], ce = {}, le, ue = {}, de = {}, fe = 30, pe = [], me = ``, he = function(e21) {
  var t2 = e21[0], n2, r2;
  if (y(t2) || g(t2) || (e21 = [e21]), !(n2 = (t2._gsap || {}).harness)) {
    for (r2 = pe.length; r2-- && !pe[r2].targetTest(t2); ) ;
    n2 = pe[r2];
  }
  for (r2 = e21.length; r2--; ) e21[r2] && (e21[r2]._gsap || (e21[r2]._gsap = new tn(e21[r2], n2))) || e21.splice(r2, 1);
  return e21;
}, ge = function(e21) {
  return e21._gsap || he(ut(e21))[0]._gsap;
}, U = function(e21, t2, n2) {
  return (n2 = e21[t2]) && g(n2) ? e21[t2]() : v(n2) && e21.getAttribute && e21.getAttribute(t2) || n2;
}, _e = function(e21, t2) {
  return (e21 = e21.split(`,`)).forEach(t2) || e21;
}, W = function(e21) {
  return Math.round(e21 * 1e5) / 1e5 || 0;
}, ve = function(e21) {
  return Math.round(e21 * 1e7) / 1e7 || 0;
}, ye = function(e21, t2) {
  var n2 = t2.charAt(0), r2 = parseFloat(t2.substr(2));
  return e21 = parseFloat(e21), n2 === `+` ? e21 + r2 : n2 === `-` ? e21 - r2 : n2 === `*` ? e21 * r2 : e21 / r2;
}, be = function(e21, t2) {
  for (var n2 = t2.length, r2 = 0; e21.indexOf(t2[r2]) < 0 && ++r2 < n2; ) ;
  return r2 < n2;
}, xe = function() {
  var e21 = H.length, t2 = H.slice(0), n2, r2;
  for (ce = {}, H.length = 0, n2 = 0; n2 < e21; n2++) r2 = t2[n2], r2 && r2._lazy && (r2.render(r2._lazy[0], r2._lazy[1], true)._lazy = 0);
}, Se = function(e21) {
  return !!(e21._initted || e21._startAt || e21.add);
}, Ce = function(e21, t2, n2, r2) {
  H.length && !a && xe(), e21.render(t2, n2, r2 || !!(a && t2 < 0 && Se(e21))), H.length && !a && xe();
}, we = function(e21) {
  var t2 = parseFloat(e21);
  return (t2 || t2 === 0) && (e21 + ``).match(M).length < 2 ? t2 : h(e21) ? e21.trim() : e21;
}, Te = function(e21) {
  return e21;
}, Ee = function(e21, t2) {
  for (var n2 in t2) n2 in e21 || (e21[n2] = t2[n2]);
  return e21;
}, De = function(e21) {
  return function(t2, n2) {
    for (var r2 in n2) r2 in t2 || r2 === `duration` && e21 || r2 === `ease` || (t2[r2] = n2[r2]);
  };
}, G = function(e21, t2) {
  for (var n2 in t2) e21[n2] = t2[n2];
  return e21;
}, Oe = function e2(t2, n2) {
  for (var r2 in n2) r2 !== `__proto__` && r2 !== `constructor` && r2 !== `prototype` && (t2[r2] = y(n2[r2]) ? e2(t2[r2] || (t2[r2] = {}), n2[r2]) : n2[r2]);
  return t2;
}, ke = function(e21, t2) {
  var n2 = {}, r2;
  for (r2 in e21) r2 in t2 || (n2[r2] = e21[r2]);
  return n2;
}, Ae = function(e21) {
  var t2 = e21.parent || P, n2 = e21.keyframes ? De(w(e21.keyframes)) : Ee;
  if (b(e21.inherit)) for (; t2; ) n2(e21, t2.vars.defaults), t2 = t2.parent || t2._dp;
  return e21;
}, je = function(e21, t2) {
  for (var n2 = e21.length, r2 = n2 === t2.length; r2 && n2-- && e21[n2] === t2[n2]; ) ;
  return n2 < 0;
}, Me = function(e21, t2, n2, r2, i2) {
  n2 === void 0 && (n2 = `_first`), r2 === void 0 && (r2 = `_last`);
  var a2 = e21[r2], o2;
  if (i2) for (o2 = t2[i2]; a2 && a2[i2] > o2; ) a2 = a2._prev;
  return a2 ? (t2._next = a2._next, a2._next = t2) : (t2._next = e21[n2], e21[n2] = t2), t2._next ? t2._next._prev = t2 : e21[r2] = t2, t2._prev = a2, t2.parent = t2._dp = e21, t2;
}, Ne = function(e21, t2, n2, r2) {
  n2 === void 0 && (n2 = `_first`), r2 === void 0 && (r2 = `_last`);
  var i2 = t2._prev, a2 = t2._next;
  i2 ? i2._next = a2 : e21[n2] === t2 && (e21[n2] = a2), a2 ? a2._prev = i2 : e21[r2] === t2 && (e21[r2] = i2), t2._next = t2._prev = t2.parent = null;
}, Pe = function(e21, t2) {
  e21.parent && (!t2 || e21.parent.autoRemoveChildren) && e21.parent.remove && e21.parent.remove(e21), e21._act = 0;
}, Fe = function(e21, t2) {
  if (e21 && (!t2 || t2._end > e21._dur || t2._start < 0)) for (var n2 = e21; n2; ) n2._dirty = 1, n2 = n2.parent;
  return e21;
}, Ie = function(e21) {
  for (var t2 = e21.parent; t2 && t2.parent; ) t2._dirty = 1, t2.totalDuration(), t2 = t2.parent;
  return e21;
}, Le = function(e21, t2, n2, r2) {
  return e21._startAt && (a ? e21._startAt.revert(V) : e21.vars.immediateRender && !e21.vars.autoRevert || e21._startAt.render(t2, true, r2));
}, Re = function e3(t2) {
  return !t2 || t2._ts && e3(t2.parent);
}, ze = function(e21) {
  return e21._repeat ? Be(e21._tTime, e21 = e21.duration() + e21._rDelay) * e21 : 0;
}, Be = function(e21, t2) {
  var n2 = Math.floor(e21 = ve(e21 / t2));
  return e21 && n2 === e21 ? n2 - 1 : n2;
}, Ve = function(e21, t2) {
  return (e21 - t2._start) * t2._ts + (t2._ts >= 0 ? 0 : t2._dirty ? t2.totalDuration() : t2._tDur);
}, He = function(e21) {
  return e21._end = ve(e21._start + (e21._tDur / Math.abs(e21._ts || e21._rts || c) || 0));
}, Ue = function(e21, t2) {
  var n2 = e21._dp;
  return n2 && n2.smoothChildTiming && e21._ts && (e21._start = ve(n2._time - (e21._ts > 0 ? t2 / e21._ts : ((e21._dirty ? e21.totalDuration() : e21._tDur) - t2) / -e21._ts)), He(e21), n2._dirty || Fe(n2, e21)), e21;
}, We = function(e21, t2) {
  var n2;
  if ((t2._time || !t2._dur && t2._initted || t2._start < e21._time && (t2._dur || !t2.add)) && (n2 = Ve(e21.rawTime(), t2), (!t2._dur || it(0, t2.totalDuration(), n2) - t2._tTime > c) && t2.render(n2, true)), Fe(e21, t2)._dp && e21._initted && e21._time >= e21._dur && e21._ts) {
    if (e21._dur < e21.duration()) for (n2 = e21; n2._dp; ) n2.rawTime() >= 0 && n2.totalTime(n2._tTime), n2 = n2._dp;
    e21._zTime = -c;
  }
}, Ge = function(e21, t2, n2, r2) {
  return t2.parent && Pe(t2), t2._start = ve((_(n2) ? n2 : n2 || e21 !== P ? tt(e21, n2, t2) : e21._time) + t2._delay), t2._end = ve(t2._start + (t2.totalDuration() / Math.abs(t2.timeScale()) || 0)), Me(e21, t2, `_first`, `_last`, e21._sort ? `_start` : 0), Ye(t2) || (e21._recent = t2), r2 || We(e21, t2), e21._ts < 0 && Ue(e21, e21._tTime), e21;
}, Ke = function(e21, t2) {
  return (R.ScrollTrigger || ne(`scrollTrigger`, t2)) && R.ScrollTrigger.create(t2, e21);
}, qe = function(e21, t2, n2, r2, i2) {
  if (dn(e21, t2, i2), !e21._initted) return 1;
  if (!n2 && e21._pt && !a && (e21._dur && e21.vars.lazy !== false || !e21._dur && e21.vars.lazy) && le !== Ht.frame) return H.push(e21), e21._lazy = [i2, r2], 1;
}, Je = function e4(t2) {
  var n2 = t2.parent;
  return n2 && n2._ts && n2._initted && !n2._lock && (n2.rawTime() < 0 || e4(n2));
}, Ye = function(e21) {
  var t2 = e21.data;
  return t2 === `isFromStart` || t2 === `isStart`;
}, Xe = function(e21, t2, n2, r2) {
  var i2 = e21.ratio, o2 = t2 < 0 || !t2 && (!e21._start && Je(e21) && (e21._initted || !Ye(e21)) || (e21._ts < 0 || e21._dp._ts < 0) && !Ye(e21)) ? 0 : 1, s2 = e21._rDelay, l2 = 0, u2, d2, f2;
  if (s2 && e21._repeat && (l2 = it(0, e21._tDur, t2), d2 = Be(l2, s2), e21._yoyo && d2 & 1 && (o2 = 1 - o2), d2 !== Be(e21._tTime, s2) && (i2 = 1 - o2, e21.vars.repeatRefresh && e21._initted && e21.invalidate())), o2 !== i2 || a || r2 || e21._zTime === c || !t2 && e21._zTime) {
    if (!e21._initted && qe(e21, t2, r2, n2, l2)) return;
    for (f2 = e21._zTime, e21._zTime = t2 || (n2 ? c : 0), n2 || (n2 = t2 && !f2), e21.ratio = o2, e21._from && (o2 = 1 - o2), e21._time = 0, e21._tTime = l2, u2 = e21._pt; u2; ) u2.r(o2, u2.d), u2 = u2._next;
    t2 < 0 && Le(e21, t2, n2, true), e21._onUpdate && !n2 && Dt(e21, `onUpdate`), l2 && e21._repeat && !n2 && e21.parent && Dt(e21, `onRepeat`), (t2 >= e21._tDur || t2 < 0) && e21.ratio === o2 && (o2 && Pe(e21, 1), !n2 && !a && (Dt(e21, o2 ? `onComplete` : `onReverseComplete`, true), e21._prom && e21._prom()));
  } else e21._zTime || (e21._zTime = t2);
}, Ze = function(e21, t2, n2) {
  var r2;
  if (n2 > t2) for (r2 = e21._first; r2 && r2._start <= n2; ) {
    if (r2.data === `isPause` && r2._start > t2) return r2;
    r2 = r2._next;
  }
  else for (r2 = e21._last; r2 && r2._start >= n2; ) {
    if (r2.data === `isPause` && r2._start < t2) return r2;
    r2 = r2._prev;
  }
}, Qe = function(e21, t2, n2, r2) {
  var i2 = e21._repeat, a2 = ve(t2) || 0, o2 = e21._tTime / e21._tDur;
  return o2 && !r2 && (e21._time *= a2 / e21._dur), e21._dur = a2, e21._tDur = i2 ? i2 < 0 ? 1e10 : ve(a2 * (i2 + 1) + e21._rDelay * i2) : a2, o2 > 0 && !r2 && Ue(e21, e21._tTime = e21._tDur * o2), e21.parent && He(e21), n2 || Fe(e21.parent, e21), e21;
}, $e = function(e21) {
  return e21 instanceof rn ? Fe(e21) : Qe(e21, e21._dur);
}, et = { _start: 0, endTime: ie, totalDuration: ie }, tt = function e5(t2, n2, r2) {
  var i2 = t2.labels, a2 = t2._recent || et, o2 = t2.duration() >= s ? a2.endTime(false) : t2._dur, c2, l2, u2;
  return h(n2) && (isNaN(n2) || n2 in i2) ? (l2 = n2.charAt(0), u2 = n2.substr(-1) === `%`, c2 = n2.indexOf(`=`), l2 === `<` || l2 === `>` ? (c2 >= 0 && (n2 = n2.replace(/=/, ``)), (l2 === `<` ? a2._start : a2.endTime(a2._repeat >= 0)) + (parseFloat(n2.substr(1)) || 0) * (u2 ? (c2 < 0 ? a2 : r2).totalDuration() / 100 : 1)) : c2 < 0 ? (n2 in i2 || (i2[n2] = o2), i2[n2]) : (l2 = parseFloat(n2.charAt(c2 - 1) + n2.substr(c2 + 1)), u2 && r2 && (l2 = l2 / 100 * (w(r2) ? r2[0] : r2).totalDuration()), c2 > 1 ? e5(t2, n2.substr(0, c2 - 1), r2) + l2 : o2 + l2)) : n2 == null ? o2 : +n2;
}, nt = function(e21, t2, n2) {
  var r2 = _(t2[1]), i2 = (r2 ? 2 : 1) + (e21 < 2 ? 0 : 1), a2 = t2[i2], o2, s2;
  if (r2 && (a2.duration = t2[1]), a2.parent = n2, e21) {
    for (o2 = a2, s2 = n2; s2 && !(`immediateRender` in o2); ) o2 = s2.vars.defaults || {}, s2 = b(s2.vars.inherit) && s2.parent;
    a2.immediateRender = b(o2.immediateRender), e21 < 2 ? a2.runBackwards = 1 : a2.startAt = t2[i2 - 1];
  }
  return new vn(t2[0], a2, t2[i2 + 1]);
}, rt = function(e21, t2) {
  return e21 || e21 === 0 ? t2(e21) : t2;
}, it = function(e21, t2, n2) {
  return n2 < e21 ? e21 : n2 > t2 ? t2 : n2;
}, at = function(e21, t2) {
  return !h(e21) || !(t2 = N.exec(e21)) ? `` : t2[1];
}, ot = function(e21, t2, n2) {
  return rt(n2, function(n3) {
    return it(e21, t2, n3);
  });
}, st = [].slice, ct = function(e21, t2) {
  return e21 && y(e21) && `length` in e21 && (!t2 && !e21.length || e21.length - 1 in e21 && y(e21[0])) && !e21.nodeType && e21 !== F;
}, lt = function(e21, t2, n2) {
  return n2 === void 0 && (n2 = []), e21.forEach(function(e22) {
    var r2;
    return h(e22) && !t2 || ct(e22, 1) ? (r2 = n2).push.apply(r2, ut(e22)) : n2.push(e22);
  }) || n2;
}, ut = function(e21, t2, n2) {
  return o && !t2 && o.selector ? o.selector(e21) : h(e21) && !n2 && (I || !Ut()) ? st.call((t2 || L).querySelectorAll(e21), 0) : w(e21) ? lt(e21, n2) : ct(e21) ? st.call(e21, 0) : e21 ? [e21] : [];
}, dt = function(e21) {
  return e21 = ut(e21)[0] || B(`Invalid scope`) || {}, function(t2) {
    var n2 = e21.current || e21.nativeElement || e21;
    return ut(t2, n2.querySelectorAll ? n2 : n2 === e21 ? B(`Invalid scope`) || L.createElement(`div`) : e21);
  };
}, ft = function(e21) {
  return e21.sort(function() {
    return 0.5 - Math.random();
  });
}, pt = function(e21) {
  if (g(e21)) return e21;
  var t2 = y(e21) ? e21 : { each: e21 }, n2 = Xt(t2.ease), r2 = t2.from || 0, i2 = parseFloat(t2.base) || 0, a2 = {}, o2 = r2 > 0 && r2 < 1, c2 = isNaN(r2) || o2, l2 = t2.axis, u2 = r2, d2 = r2;
  return h(r2) ? u2 = d2 = { center: 0.5, edges: 0.5, end: 1 }[r2] || 0 : !o2 && c2 && (u2 = r2[0], d2 = r2[1]), function(e22, o3, p2) {
    var m2 = (p2 || t2).length, h2 = a2[m2], g2, _2, v2, y2, b2, x2, S2, C2, w2;
    if (!h2) {
      if (w2 = t2.grid === `auto` ? 0 : (t2.grid || [1, s])[1], !w2) {
        for (S2 = -s; S2 < (S2 = p2[w2++].getBoundingClientRect().left) && w2 < m2; ) ;
        w2 < m2 && w2--;
      }
      for (h2 = a2[m2] = [], g2 = c2 ? Math.min(w2, m2) * u2 - 0.5 : r2 % w2, _2 = w2 === s ? 0 : c2 ? m2 * d2 / w2 - 0.5 : r2 / w2 | 0, S2 = 0, C2 = s, x2 = 0; x2 < m2; x2++) v2 = x2 % w2 - g2, y2 = _2 - (x2 / w2 | 0), h2[x2] = b2 = l2 ? Math.abs(l2 === `y` ? y2 : v2) : f(v2 * v2 + y2 * y2), b2 > S2 && (S2 = b2), b2 < C2 && (C2 = b2);
      r2 === `random` && ft(h2), h2.max = S2 - C2, h2.min = C2, h2.v = m2 = (parseFloat(t2.amount) || parseFloat(t2.each) * (w2 > m2 ? m2 - 1 : l2 ? l2 === `y` ? m2 / w2 : w2 : Math.max(w2, m2 / w2)) || 0) * (r2 === `edges` ? -1 : 1), h2.b = m2 < 0 ? i2 - m2 : i2, h2.u = at(t2.amount || t2.each) || 0, n2 = n2 && m2 < 0 ? Yt(n2) : n2;
    }
    return m2 = (h2[e22] - h2.min) / h2.max || 0, ve(h2.b + (n2 ? n2(m2) : m2) * h2.v) + h2.u;
  };
}, mt = function(e21) {
  var t2 = 10 ** ((e21 + ``).split(`.`)[1] || ``).length;
  return function(n2) {
    var r2 = ve(Math.round(parseFloat(n2) / e21) * e21 * t2);
    return (r2 - r2 % 1) / t2 + (_(n2) ? 0 : at(n2));
  };
}, ht = function(e21, t2) {
  var n2 = w(e21), r2, i2;
  return !n2 && y(e21) && (r2 = n2 = e21.radius || s, e21.values ? (e21 = ut(e21.values), (i2 = !_(e21[0])) && (r2 *= r2)) : e21 = mt(e21.increment)), rt(t2, n2 ? g(e21) ? function(t3) {
    return i2 = e21(t3), Math.abs(i2 - t3) <= r2 ? i2 : t3;
  } : function(t3) {
    for (var n3 = parseFloat(i2 ? t3.x : t3), a2 = parseFloat(i2 ? t3.y : 0), o2 = s, c2 = 0, l2 = e21.length, u2, d2; l2--; ) i2 ? (u2 = e21[l2].x - n3, d2 = e21[l2].y - a2, u2 = u2 * u2 + d2 * d2) : u2 = Math.abs(e21[l2] - n3), u2 < o2 && (o2 = u2, c2 = l2);
    return c2 = !r2 || o2 <= r2 ? e21[c2] : t3, i2 || c2 === t3 || _(t3) ? c2 : c2 + at(t3);
  } : mt(e21));
}, gt = function(e21, t2, n2, r2) {
  return rt(w(e21) ? !t2 : n2 === true ? !!(n2 = 0) : !r2, function() {
    return w(e21) ? e21[~~(Math.random() * e21.length)] : (n2 = n2 || 1e-5) && (r2 = n2 < 1 ? 10 ** ((n2 + ``).length - 2) : 1) && Math.floor(Math.round((e21 - n2 / 2 + Math.random() * (t2 - e21 + n2 * 0.99)) / n2) * n2 * r2) / r2;
  });
}, _t = function() {
  var e21 = [...arguments];
  return function(t2) {
    return e21.reduce(function(e22, t3) {
      return t3(e22);
    }, t2);
  };
}, vt = function(e21, t2) {
  return function(n2) {
    return e21(parseFloat(n2)) + (t2 || at(n2));
  };
}, yt = function(e21, t2, n2) {
  return wt(e21, t2, 0, 1, n2);
}, bt = function(e21, t2, n2) {
  return rt(n2, function(n3) {
    return e21[~~t2(n3)];
  });
}, xt = function e6(t2, n2, r2) {
  var i2 = n2 - t2;
  return w(t2) ? bt(t2, e6(0, t2.length), n2) : rt(r2, function(e21) {
    return (i2 + (e21 - t2) % i2) % i2 + t2;
  });
}, St = function e7(t2, n2, r2) {
  var i2 = n2 - t2, a2 = i2 * 2;
  return w(t2) ? bt(t2, e7(0, t2.length - 1), n2) : rt(r2, function(e21) {
    return e21 = (a2 + (e21 - t2) % a2) % a2 || 0, t2 + (e21 > i2 ? a2 - e21 : e21);
  });
}, Ct = function(e21) {
  return e21.replace(T, function(e22) {
    var t2 = e22.indexOf(`[`) + 1, n2 = e22.substring(t2 || 7, t2 ? e22.indexOf(`]`) : e22.length - 1).split(E);
    return gt(t2 ? n2 : +n2[0], t2 ? 0 : +n2[1], +n2[2] || 1e-5);
  });
}, wt = function(e21, t2, n2, r2, i2) {
  var a2 = t2 - e21, o2 = r2 - n2;
  return rt(i2, function(t3) {
    return n2 + ((t3 - e21) / a2 * o2 || 0);
  });
}, Tt = function e8(t2, n2, r2, i2) {
  var a2 = isNaN(t2 + n2) ? 0 : function(e21) {
    return (1 - e21) * t2 + e21 * n2;
  };
  if (!a2) {
    var o2 = h(t2), s2 = {}, c2, l2, u2, d2, f2;
    if (r2 === true && (i2 = 1) && (r2 = null), o2) t2 = { p: t2 }, n2 = { p: n2 };
    else if (w(t2) && !w(n2)) {
      for (u2 = [], d2 = t2.length, f2 = d2 - 2, l2 = 1; l2 < d2; l2++) u2.push(e8(t2[l2 - 1], t2[l2]));
      d2--, a2 = function(e21) {
        e21 *= d2;
        var t3 = Math.min(f2, ~~e21);
        return u2[t3](e21 - t3);
      }, r2 = n2;
    } else i2 || (t2 = G(w(t2) ? [] : {}, t2));
    if (!u2) {
      for (c2 in n2) on.call(s2, t2, c2, `get`, n2[c2]);
      a2 = function(e21) {
        return Dn(e21, s2) || (o2 ? t2.p : t2);
      };
    }
  }
  return rt(r2, a2);
}, Et = function(e21, t2, n2) {
  var r2 = e21.labels, i2 = s, a2, o2, c2;
  for (a2 in r2) o2 = r2[a2] - t2, o2 < 0 == !!n2 && o2 && i2 > (o2 = Math.abs(o2)) && (c2 = a2, i2 = o2);
  return c2;
}, Dt = function(e21, t2, n2) {
  var r2 = e21.vars, i2 = r2[t2], a2 = o, s2 = e21._ctx, c2, l2, u2;
  if (i2) return c2 = r2[t2 + `Params`], l2 = r2.callbackScope || e21, n2 && H.length && xe(), s2 && (o = s2), u2 = c2 ? i2.apply(l2, c2) : i2.call(l2), o = a2, u2;
}, Ot = function(e21) {
  return Pe(e21), e21.scrollTrigger && e21.scrollTrigger.kill(!!a), e21.progress() < 1 && Dt(e21, `onInterrupt`), e21;
}, kt, At = [], jt = function(e21) {
  if (e21) {
    if (e21 = !e21.name && e21.default || e21, x() || e21.headless) {
      var t2 = e21.name, n2 = g(e21), r2 = t2 && !n2 && e21.init ? function() {
        this._props = [];
      } : e21, i2 = { init: ie, render: Dn, add: on, kill: kn, modifier: On, rawVars: 0 }, a2 = { targetTest: 0, get: 0, getSetter: Cn, aliases: {}, register: 0 };
      if (Ut(), e21 !== r2) {
        if (ue[t2]) return;
        Ee(r2, Ee(ke(e21, i2), a2)), G(r2.prototype, G(i2, ke(e21, a2))), ue[r2.prop = t2] = r2, e21.targetTest && (pe.push(r2), se[t2] = 1), t2 = (t2 === `css` ? `CSS` : t2.charAt(0).toUpperCase() + t2.substr(1)) + `Plugin`;
      }
      re(t2, r2), e21.register && e21.register(Kn, r2, Mn);
    } else At.push(e21);
  }
}, Mt = 255, Nt = { aqua: [0, Mt, Mt], lime: [0, Mt, 0], silver: [192, 192, 192], black: [0, 0, 0], maroon: [128, 0, 0], teal: [0, 128, 128], blue: [0, 0, Mt], navy: [0, 0, 128], white: [Mt, Mt, Mt], olive: [128, 128, 0], yellow: [Mt, Mt, 0], orange: [Mt, 165, 0], gray: [128, 128, 128], purple: [128, 0, 128], green: [0, 128, 0], red: [Mt, 0, 0], pink: [Mt, 192, 203], cyan: [0, Mt, Mt], transparent: [Mt, Mt, Mt, 0] }, Pt = function(e21, t2, n2) {
  return e21 += e21 < 0 ? 1 : e21 > 1 ? -1 : 0, (e21 * 6 < 1 ? t2 + (n2 - t2) * e21 * 6 : e21 < 0.5 ? n2 : e21 * 3 < 2 ? t2 + (n2 - t2) * (2 / 3 - e21) * 6 : t2) * Mt + 0.5 | 0;
}, Ft = function(e21, t2, n2) {
  var r2 = e21 ? _(e21) ? [e21 >> 16, e21 >> 8 & Mt, e21 & Mt] : 0 : Nt.black, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2;
  if (!r2) {
    if (e21.substr(-1) === `,` && (e21 = e21.substr(0, e21.length - 1)), Nt[e21]) r2 = Nt[e21];
    else if (e21.charAt(0) === `#`) {
      if (e21.length < 6 && (i2 = e21.charAt(1), a2 = e21.charAt(2), o2 = e21.charAt(3), e21 = `#` + i2 + i2 + a2 + a2 + o2 + o2 + (e21.length === 5 ? e21.charAt(4) + e21.charAt(4) : ``)), e21.length === 9) return r2 = parseInt(e21.substr(1, 6), 16), [r2 >> 16, r2 >> 8 & Mt, r2 & Mt, parseInt(e21.substr(7), 16) / 255];
      e21 = parseInt(e21.substr(1), 16), r2 = [e21 >> 16, e21 >> 8 & Mt, e21 & Mt];
    } else if (e21.substr(0, 3) === `hsl`) {
      if (r2 = p2 = e21.match(D), !t2) s2 = r2[0] % 360 / 360, c2 = r2[1] / 100, l2 = r2[2] / 100, a2 = l2 <= 0.5 ? l2 * (c2 + 1) : l2 + c2 - l2 * c2, i2 = l2 * 2 - a2, r2.length > 3 && (r2[3] *= 1), r2[0] = Pt(s2 + 1 / 3, i2, a2), r2[1] = Pt(s2, i2, a2), r2[2] = Pt(s2 - 1 / 3, i2, a2);
      else if (~e21.indexOf(`=`)) return r2 = e21.match(O), n2 && r2.length < 4 && (r2[3] = 1), r2;
    } else r2 = e21.match(D) || Nt.transparent;
    r2 = r2.map(Number);
  }
  return t2 && !p2 && (i2 = r2[0] / Mt, a2 = r2[1] / Mt, o2 = r2[2] / Mt, u2 = Math.max(i2, a2, o2), d2 = Math.min(i2, a2, o2), l2 = (u2 + d2) / 2, u2 === d2 ? s2 = c2 = 0 : (f2 = u2 - d2, c2 = l2 > 0.5 ? f2 / (2 - u2 - d2) : f2 / (u2 + d2), s2 = u2 === i2 ? (a2 - o2) / f2 + (a2 < o2 ? 6 : 0) : u2 === a2 ? (o2 - i2) / f2 + 2 : (i2 - a2) / f2 + 4, s2 *= 60), r2[0] = ~~(s2 + 0.5), r2[1] = ~~(c2 * 100 + 0.5), r2[2] = ~~(l2 * 100 + 0.5)), n2 && r2.length < 4 && (r2[3] = 1), r2;
}, It = function(e21) {
  var t2 = [], n2 = [], r2 = -1;
  return e21.split(Rt).forEach(function(e22) {
    var i2 = e22.match(k) || [];
    t2.push.apply(t2, i2), n2.push(r2 += i2.length + 1);
  }), t2.c = n2, t2;
}, Lt = function(e21, t2, n2) {
  var r2 = ``, i2 = (e21 + r2).match(Rt), a2 = t2 ? `hsla(` : `rgba(`, o2 = 0, s2, c2, l2, u2;
  if (!i2) return e21;
  if (i2 = i2.map(function(e22) {
    return (e22 = Ft(e22, t2, 1)) && a2 + (t2 ? e22[0] + `,` + e22[1] + `%,` + e22[2] + `%,` + e22[3] : e22.join(`,`)) + `)`;
  }), n2 && (l2 = It(e21), s2 = n2.c, s2.join(r2) !== l2.c.join(r2))) for (c2 = e21.replace(Rt, `1`).split(k), u2 = c2.length - 1; o2 < u2; o2++) r2 += c2[o2] + (~s2.indexOf(o2) ? i2.shift() || a2 + `0,0,0,0)` : (l2.length ? l2 : i2.length ? i2 : n2).shift());
  if (!c2) for (c2 = e21.split(Rt), u2 = c2.length - 1; o2 < u2; o2++) r2 += c2[o2] + i2[o2];
  return r2 + c2[u2];
}, Rt = (function() {
  var e21 = `(?:\\b(?:(?:rgb|rgba|hsl|hsla)\\(.+?\\))|\\B#(?:[0-9a-f]{3,4}){1,2}\\b`, t2;
  for (t2 in Nt) e21 += `|` + t2 + `\\b`;
  return RegExp(e21 + `)`, `gi`);
})(), zt = /hsl[a]?\(/, Bt = function(e21) {
  var t2 = e21.join(` `), n2;
  if (Rt.lastIndex = 0, Rt.test(t2)) return n2 = zt.test(t2), e21[1] = Lt(e21[1], n2), e21[0] = Lt(e21[0], n2, It(e21[1])), true;
}, Vt, Ht = (function() {
  var e21 = Date.now, t2 = 500, n2 = 33, r2 = e21(), i2 = r2, a2 = 1e3 / 240, o2 = a2, s2 = [], c2, l2, u2, d2, f2, p2, m2 = function u3(m3) {
    var h2 = e21() - i2, g2 = m3 === true, _2, v2, y2, b2;
    if ((h2 > t2 || h2 < 0) && (r2 += h2 - n2), i2 += h2, y2 = i2 - r2, _2 = y2 - o2, (_2 > 0 || g2) && (b2 = ++d2.frame, f2 = y2 - d2.time * 1e3, d2.time = y2 /= 1e3, o2 += _2 + (_2 >= a2 ? 4 : a2 - _2), v2 = 1), g2 || (c2 = l2(u3)), v2) for (p2 = 0; p2 < s2.length; p2++) s2[p2](y2, f2, b2, m3);
  };
  return d2 = { time: 0, frame: 0, tick: function() {
    m2(true);
  }, deltaRatio: function(e22) {
    return f2 / (1e3 / (e22 || 60));
  }, wake: function() {
    te && (!I && x() && (F = I = window, L = F.document || {}, R.gsap = Kn, (F.gsapVersions || (F.gsapVersions = [])).push(Kn.version), z(ee || F.GreenSockGlobals || !F.gsap && F || {}), At.forEach(jt)), u2 = typeof requestAnimationFrame < `u` && requestAnimationFrame, c2 && d2.sleep(), l2 = u2 || function(e22) {
      return setTimeout(e22, o2 - d2.time * 1e3 + 1 | 0);
    }, Vt = 1, m2(2));
  }, sleep: function() {
    (u2 ? cancelAnimationFrame : clearTimeout)(c2), Vt = 0, l2 = ie;
  }, lagSmoothing: function(e22, r3) {
    t2 = e22 || 1 / 0, n2 = Math.min(r3 || 33, t2);
  }, fps: function(e22) {
    a2 = 1e3 / (e22 || 240), o2 = d2.time * 1e3 + a2;
  }, add: function(e22, t3, n3) {
    var r3 = t3 ? function(t4, n4, i3, a3) {
      e22(t4, n4, i3, a3), d2.remove(r3);
    } : e22;
    return d2.remove(e22), s2[n3 ? `unshift` : `push`](r3), Ut(), r3;
  }, remove: function(e22, t3) {
    ~(t3 = s2.indexOf(e22)) && s2.splice(t3, 1) && p2 >= t3 && p2--;
  }, _listeners: s2 }, d2;
})(), Ut = function() {
  return !Vt && Ht.wake();
}, K = {}, Wt = /^[\d.\-M][\d.\-,\s]/, Gt = /["']/g, Kt = function(e21) {
  for (var t2 = {}, n2 = e21.substr(1, e21.length - 3).split(`:`), r2 = n2[0], i2 = 1, a2 = n2.length, o2, s2, c2; i2 < a2; i2++) s2 = n2[i2], o2 = i2 === a2 - 1 ? s2.length : s2.lastIndexOf(`,`), c2 = s2.substr(0, o2), t2[r2] = isNaN(c2) ? c2.replace(Gt, ``).trim() : +c2, r2 = s2.substr(o2 + 1).trim();
  return t2;
}, qt = function(e21) {
  var t2 = e21.indexOf(`(`) + 1, n2 = e21.indexOf(`)`), r2 = e21.indexOf(`(`, t2);
  return e21.substring(t2, ~r2 && r2 < n2 ? e21.indexOf(`)`, n2 + 1) : n2);
}, Jt = function(e21) {
  var t2 = (e21 + ``).split(`(`), n2 = K[t2[0]];
  return n2 && t2.length > 1 && n2.config ? n2.config.apply(null, ~e21.indexOf(`{`) ? [Kt(t2[1])] : qt(e21).split(`,`).map(we)) : K._CE && Wt.test(e21) ? K._CE(``, e21) : n2;
}, Yt = function(e21) {
  return function(t2) {
    return 1 - e21(1 - t2);
  };
}, Xt = function(e21, t2) {
  return e21 && (g(e21) ? e21 : K[e21] || Jt(e21)) || t2;
}, Zt = function(e21, t2, n2, r2) {
  n2 === void 0 && (n2 = function(e22) {
    return 1 - t2(1 - e22);
  }), r2 === void 0 && (r2 = function(e22) {
    return e22 < 0.5 ? t2(e22 * 2) / 2 : 1 - t2((1 - e22) * 2) / 2;
  });
  var i2 = { easeIn: t2, easeOut: n2, easeInOut: r2 }, a2;
  return _e(e21, function(e22) {
    for (var t3 in K[e22] = R[e22] = i2, K[a2 = e22.toLowerCase()] = n2, i2) K[a2 + (t3 === `easeIn` ? `.in` : t3 === `easeOut` ? `.out` : `.inOut`)] = K[e22 + `.` + t3] = i2[t3];
  }), i2;
}, Qt = function(e21) {
  return function(t2) {
    return t2 < 0.5 ? (1 - e21(1 - t2 * 2)) / 2 : 0.5 + e21((t2 - 0.5) * 2) / 2;
  };
}, $t = function e9(t2, n2, r2) {
  var i2 = n2 >= 1 ? n2 : 1, a2 = (r2 || (t2 ? 0.3 : 0.45)) / (n2 < 1 ? n2 : 1), o2 = a2 / l * (Math.asin(1 / i2) || 0), s2 = function(e21) {
    return e21 === 1 ? 1 : i2 * 2 ** (-10 * e21) * m((e21 - o2) * a2) + 1;
  }, c2 = t2 === `out` ? s2 : t2 === `in` ? function(e21) {
    return 1 - s2(1 - e21);
  } : Qt(s2);
  return a2 = l / a2, c2.config = function(n3, r3) {
    return e9(t2, n3, r3);
  }, c2;
}, en = function e10(t2, n2) {
  n2 === void 0 && (n2 = 1.70158);
  var r2 = function(e21) {
    return e21 ? --e21 * e21 * ((n2 + 1) * e21 + n2) + 1 : 0;
  }, i2 = t2 === `out` ? r2 : t2 === `in` ? function(e21) {
    return 1 - r2(1 - e21);
  } : Qt(r2);
  return i2.config = function(n3) {
    return e10(t2, n3);
  }, i2;
};
_e(`Linear,Quad,Cubic,Quart,Quint,Strong`, function(e21, t2) {
  var n2 = t2 < 5 ? t2 + 1 : t2;
  Zt(e21 + `,Power` + (n2 - 1), t2 ? function(e22) {
    return e22 ** +n2;
  } : function(e22) {
    return e22;
  }, function(e22) {
    return 1 - (1 - e22) ** n2;
  }, function(e22) {
    return e22 < 0.5 ? (e22 * 2) ** n2 / 2 : 1 - ((1 - e22) * 2) ** n2 / 2;
  });
}), K.Linear.easeNone = K.none = K.Linear.easeIn, Zt(`Elastic`, $t(`in`), $t(`out`), $t()), (function(e21, t2) {
  var n2 = 1 / t2, r2 = 2 * n2, i2 = 2.5 * n2, a2 = function(a3) {
    return a3 < n2 ? e21 * a3 * a3 : a3 < r2 ? e21 * (a3 - 1.5 / t2) ** 2 + 0.75 : a3 < i2 ? e21 * (a3 -= 2.25 / t2) * a3 + 0.9375 : e21 * (a3 - 2.625 / t2) ** 2 + 0.984375;
  };
  Zt(`Bounce`, function(e22) {
    return 1 - a2(1 - e22);
  }, a2);
})(7.5625, 2.75), Zt(`Expo`, function(e21) {
  return 2 ** (10 * (e21 - 1)) * e21 + e21 * e21 * e21 * e21 * e21 * e21 * (1 - e21);
}), Zt(`Circ`, function(e21) {
  return -(f(1 - e21 * e21) - 1);
}), Zt(`Sine`, function(e21) {
  return e21 === 1 ? 1 : -p(e21 * u) + 1;
}), Zt(`Back`, en(`in`), en(`out`), en()), K.SteppedEase = K.steps = R.SteppedEase = { config: function(e21, t2) {
  e21 === void 0 && (e21 = 1);
  var n2 = 1 / e21, r2 = e21 + +!t2, i2 = +!!t2, a2 = 1 - c;
  return function(e22) {
    return ((r2 * it(0, a2, e22) | 0) + i2) * n2;
  };
} }, r.ease = K[`quad.out`], _e(`onComplete,onUpdate,onStart,onRepeat,onReverseComplete,onInterrupt`, function(e21) {
  return me += e21 + `,` + e21 + `Params,`;
});
var tn = function(e21, t2) {
  this.id = d++, e21._gsap = this, this.target = e21, this.harness = t2, this.get = t2 ? t2.get : U, this.set = t2 ? t2.getSetter : Cn;
}, nn = (function() {
  function e21(e22) {
    this.vars = e22, this._delay = +e22.delay || 0, (this._repeat = e22.repeat === 1 / 0 ? -2 : e22.repeat || 0) && (this._rDelay = e22.repeatDelay || 0, this._yoyo = !!e22.yoyo || !!e22.yoyoEase), this._ts = 1, Qe(this, +e22.duration, 1, 1), this.data = e22.data, o && (this._ctx = o, o.data.push(this)), Vt || Ht.wake();
  }
  var t2 = e21.prototype;
  return t2.delay = function(e22) {
    return e22 || e22 === 0 ? (this.parent && this.parent.smoothChildTiming && this.startTime(this._start + e22 - this._delay), this._delay = e22, this) : this._delay;
  }, t2.duration = function(e22) {
    return arguments.length ? this.totalDuration(this._repeat > 0 ? e22 + (e22 + this._rDelay) * this._repeat : e22) : this.totalDuration() && this._dur;
  }, t2.totalDuration = function(e22) {
    return arguments.length ? (this._dirty = 0, Qe(this, this._repeat < 0 ? e22 : (e22 - this._repeat * this._rDelay) / (this._repeat + 1))) : this._tDur;
  }, t2.totalTime = function(e22, t3) {
    if (Ut(), !arguments.length) return this._tTime;
    var n2 = this._dp;
    if (n2 && n2.smoothChildTiming && this._ts) {
      for (Ue(this, e22), !n2._dp || n2.parent || We(n2, this); n2 && n2.parent; ) n2.parent._time !== n2._start + (n2._ts >= 0 ? n2._tTime / n2._ts : (n2.totalDuration() - n2._tTime) / -n2._ts) && n2.totalTime(n2._tTime, true), n2 = n2.parent;
      !this.parent && this._dp.autoRemoveChildren && (this._ts > 0 && e22 < this._tDur || this._ts < 0 && e22 > 0 || !this._tDur && !e22) && Ge(this._dp, this, this._start - this._delay);
    }
    return (this._tTime !== e22 || !this._dur && !t3 || this._initted && Math.abs(this._zTime) === c || !this._initted && this._dur && e22 || !e22 && !this._initted && (this.add || this._ptLookup)) && (this._ts || (this._pTime = e22), Ce(this, e22, t3)), this;
  }, t2.time = function(e22, t3) {
    return arguments.length ? this.totalTime(Math.min(this.totalDuration(), e22 + ze(this)) % (this._dur + this._rDelay) || (e22 ? this._dur : 0), t3) : this._time;
  }, t2.totalProgress = function(e22, t3) {
    return arguments.length ? this.totalTime(this.totalDuration() * e22, t3) : this.totalDuration() ? Math.min(1, this._tTime / this._tDur) : this.rawTime() >= 0 && this._initted ? 1 : 0;
  }, t2.progress = function(e22, t3) {
    return arguments.length ? this.totalTime(this.duration() * (this._yoyo && !(this.iteration() & 1) ? 1 - e22 : e22) + ze(this), t3) : this.duration() ? Math.min(1, this._time / this._dur) : +(this.rawTime() > 0);
  }, t2.iteration = function(e22, t3) {
    var n2 = this.duration() + this._rDelay;
    return arguments.length ? this.totalTime(this._time + (e22 - 1) * n2, t3) : this._repeat ? Be(this._tTime, n2) + 1 : 1;
  }, t2.timeScale = function(e22, t3) {
    if (!arguments.length) return this._rts === -c ? 0 : this._rts;
    if (this._rts === e22) return this;
    var n2 = this.parent && this._ts ? Ve(this.parent._time, this) : this._tTime;
    return this._rts = +e22 || 0, this._ts = this._ps || e22 === -c ? 0 : this._rts, this.totalTime(it(-Math.abs(this._delay), this.totalDuration(), n2), t3 !== false), He(this), Ie(this);
  }, t2.paused = function(e22) {
    return arguments.length ? (this._ps !== e22 && (this._ps = e22, e22 ? (this._pTime = this._tTime || Math.max(-this._delay, this.rawTime()), this._ts = this._act = 0) : (Ut(), this._ts = this._rts, this.totalTime(this.parent && !this.parent.smoothChildTiming ? this.rawTime() : this._tTime || this._pTime, this.progress() === 1 && Math.abs(this._zTime) !== c && (this._tTime -= c)))), this) : this._ps;
  }, t2.startTime = function(e22) {
    if (arguments.length) {
      this._start = ve(e22);
      var t3 = this.parent || this._dp;
      return t3 && (t3._sort || !this.parent) && Ge(t3, this, this._start - this._delay), this;
    }
    return this._start;
  }, t2.endTime = function(e22) {
    return this._start + (b(e22) ? this.totalDuration() : this.duration()) / Math.abs(this._ts || 1);
  }, t2.rawTime = function(e22) {
    var t3 = this.parent || this._dp;
    return t3 ? e22 && (!this._ts || this._repeat && this._time && this.totalProgress() < 1) ? this._tTime % (this._dur + this._rDelay) : this._ts ? Ve(t3.rawTime(e22), this) : this._tTime : this._tTime;
  }, t2.revert = function(e22) {
    e22 === void 0 && (e22 = oe);
    var t3 = a;
    return a = e22, Se(this) && (this.timeline && this.timeline.revert(e22), this.totalTime(-0.01, e22.suppressEvents)), this.data !== `nested` && e22.kill !== false && this.kill(), a = t3, this;
  }, t2.globalTime = function(e22) {
    for (var t3 = this, n2 = arguments.length ? e22 : t3.rawTime(); t3; ) n2 = t3._start + n2 / (Math.abs(t3._ts) || 1), t3 = t3._dp;
    return !this.parent && this._sat ? this._sat.globalTime(e22) : n2;
  }, t2.repeat = function(e22) {
    return arguments.length ? (this._repeat = e22 === 1 / 0 ? -2 : e22, $e(this)) : this._repeat === -2 ? 1 / 0 : this._repeat;
  }, t2.repeatDelay = function(e22) {
    if (arguments.length) {
      var t3 = this._time;
      return this._rDelay = e22, $e(this), t3 ? this.time(t3) : this;
    }
    return this._rDelay;
  }, t2.yoyo = function(e22) {
    return arguments.length ? (this._yoyo = e22, this) : this._yoyo;
  }, t2.seek = function(e22, t3) {
    return this.totalTime(tt(this, e22), b(t3));
  }, t2.restart = function(e22, t3) {
    return this.play().totalTime(e22 ? -this._delay : 0, b(t3)), this._dur || (this._zTime = -c), this;
  }, t2.play = function(e22, t3) {
    return e22 != null && this.seek(e22, t3), this.reversed(false).paused(false);
  }, t2.reverse = function(e22, t3) {
    return e22 != null && this.seek(e22 || this.totalDuration(), t3), this.reversed(true).paused(false);
  }, t2.pause = function(e22, t3) {
    return e22 != null && this.seek(e22, t3), this.paused(true);
  }, t2.resume = function() {
    return this.paused(false);
  }, t2.reversed = function(e22) {
    return arguments.length ? (!!e22 !== this.reversed() && this.timeScale(-this._rts || (e22 ? -c : 0)), this) : this._rts < 0;
  }, t2.invalidate = function() {
    return this._initted = this._act = 0, this._zTime = -c, this;
  }, t2.isActive = function() {
    var e22 = this.parent || this._dp, t3 = this._start, n2;
    return !!(!e22 || this._ts && this._initted && e22.isActive() && (n2 = e22.rawTime(true)) >= t3 && n2 < this.endTime(true) - c);
  }, t2.eventCallback = function(e22, t3, n2) {
    var r2 = this.vars;
    return arguments.length > 1 ? (t3 ? (r2[e22] = t3, n2 && (r2[e22 + `Params`] = n2), e22 === `onUpdate` && (this._onUpdate = t3)) : delete r2[e22], this) : r2[e22];
  }, t2.then = function(e22) {
    var t3 = this, n2 = t3._prom;
    return new Promise(function(r2) {
      var i2 = g(e22) ? e22 : Te, a2 = function() {
        var e23 = t3.then;
        t3.then = null, n2 && n2(), g(i2) && (i2 = i2(t3)) && (i2.then || i2 === t3) && (t3.then = e23), r2(i2), t3.then = e23;
      };
      t3._initted && t3.totalProgress() === 1 && t3._ts >= 0 || !t3._tTime && t3._ts < 0 ? a2() : t3._prom = a2;
    });
  }, t2.kill = function() {
    Ot(this);
  }, e21;
})();
Ee(nn.prototype, { _time: 0, _start: 0, _end: 0, _tTime: 0, _tDur: 0, _dirty: 0, _repeat: 0, _yoyo: false, parent: null, _initted: false, _rDelay: 0, _ts: 1, _dp: 0, ratio: 0, _zTime: -c, _prom: 0, _ps: false, _rts: 1 });
var rn = (function(r2) {
  t(i2, r2);
  function i2(t2, n2) {
    var i3;
    return t2 === void 0 && (t2 = {}), i3 = r2.call(this, t2) || this, i3.labels = {}, i3.smoothChildTiming = !!t2.smoothChildTiming, i3.autoRemoveChildren = !!t2.autoRemoveChildren, i3._sort = b(t2.sortChildren), P && Ge(t2.parent || P, e(i3), n2), t2.reversed && i3.reverse(), t2.paused && i3.paused(true), t2.scrollTrigger && Ke(e(i3), t2.scrollTrigger), i3;
  }
  var o2 = i2.prototype;
  return o2.to = function(e21, t2, n2) {
    return nt(0, arguments, this), this;
  }, o2.from = function(e21, t2, n2) {
    return nt(1, arguments, this), this;
  }, o2.fromTo = function(e21, t2, n2, r3) {
    return nt(2, arguments, this), this;
  }, o2.set = function(e21, t2, n2) {
    return t2.duration = 0, t2.parent = this, Ae(t2).repeatDelay || (t2.repeat = 0), t2.immediateRender = !!t2.immediateRender, new vn(e21, t2, tt(this, n2), 1), this;
  }, o2.call = function(e21, t2, n2) {
    return Ge(this, vn.delayedCall(0, e21, t2), n2);
  }, o2.staggerTo = function(e21, t2, n2, r3, i3, a2, o3) {
    return n2.duration = t2, n2.stagger = n2.stagger || r3, n2.onComplete = a2, n2.onCompleteParams = o3, n2.parent = this, new vn(e21, n2, tt(this, i3)), this;
  }, o2.staggerFrom = function(e21, t2, n2, r3, i3, a2, o3) {
    return n2.runBackwards = 1, Ae(n2).immediateRender = b(n2.immediateRender), this.staggerTo(e21, t2, n2, r3, i3, a2, o3);
  }, o2.staggerFromTo = function(e21, t2, n2, r3, i3, a2, o3, s2) {
    return r3.startAt = n2, Ae(r3).immediateRender = b(r3.immediateRender), this.staggerTo(e21, t2, r3, i3, a2, o3, s2);
  }, o2.render = function(e21, t2, n2) {
    var r3 = this._time, i3 = this._dirty ? this.totalDuration() : this._tDur, o3 = this._dur, s2 = e21 <= 0 ? 0 : ve(e21), l2 = this._zTime < 0 != e21 < 0 && (this._initted || !o3), u2, d2, f2, p2, m2, h2, g2, _2, v2, y2, b2, x2;
    if (this !== P && s2 > i3 && e21 >= 0 && (s2 = i3), s2 !== this._tTime || n2 || l2) {
      if (r3 !== this._time && o3 && (s2 += this._time - r3, e21 += this._time - r3), u2 = s2, v2 = this._start, _2 = this._ts, h2 = !_2, l2 && (o3 || (r3 = this._zTime), (e21 || !t2) && (this._zTime = e21)), this._repeat) {
        if (b2 = this._yoyo, m2 = o3 + this._rDelay, this._repeat < -1 && e21 < 0) return this.totalTime(m2 * 100 + e21, t2, n2);
        if (u2 = ve(s2 % m2), s2 === i3 ? (p2 = this._repeat, u2 = o3) : (y2 = ve(s2 / m2), p2 = ~~y2, p2 && p2 === y2 && (u2 = o3, p2--), u2 > o3 && (u2 = o3)), y2 = Be(this._tTime, m2), !r3 && this._tTime && y2 !== p2 && this._tTime - y2 * m2 - this._dur <= 0 && (y2 = p2), b2 && p2 & 1 && (u2 = o3 - u2, x2 = 1), p2 !== y2 && !this._lock) {
          var S2 = b2 && y2 & 1, C2 = S2 === (b2 && p2 & 1);
          if (p2 < y2 && (S2 = !S2), r3 = S2 ? 0 : s2 % o3 ? o3 : s2, this._lock = 1, this.render(r3 || (x2 ? 0 : ve(p2 * m2)), t2, !o3)._lock = 0, this._tTime = s2, !t2 && this.parent && Dt(this, `onRepeat`), this.vars.repeatRefresh && !x2 && (this.invalidate()._lock = 1, y2 = p2), r3 && r3 !== this._time || h2 !== !this._ts || this.vars.onRepeat && !this.parent && !this._act || (o3 = this._dur, i3 = this._tDur, C2 && (this._lock = 2, r3 = S2 ? o3 : -1e-4, this.render(r3, true), this.vars.repeatRefresh && !x2 && this.invalidate()), this._lock = 0, !this._ts && !h2)) return this;
        }
      }
      if (this._hasPause && !this._forcing && this._lock < 2 && (g2 = Ze(this, ve(r3), ve(u2)), g2 && (s2 -= u2 - (u2 = g2._start))), this._tTime = s2, this._time = u2, this._act = !!_2, this._initted || (this._onUpdate = this.vars.onUpdate, this._initted = 1, this._zTime = e21, r3 = 0), !r3 && s2 && o3 && !t2 && !y2 && (Dt(this, `onStart`), this._tTime !== s2)) return this;
      if (u2 >= r3 && e21 >= 0) for (d2 = this._first; d2; ) {
        if (f2 = d2._next, (d2._act || u2 >= d2._start) && d2._ts && g2 !== d2) {
          if (d2.parent !== this) return this.render(e21, t2, n2);
          if (d2.render(d2._ts > 0 ? (u2 - d2._start) * d2._ts : (d2._dirty ? d2.totalDuration() : d2._tDur) + (u2 - d2._start) * d2._ts, t2, n2), u2 !== this._time || !this._ts && !h2) {
            g2 = 0, f2 && (s2 += this._zTime = -c);
            break;
          }
        }
        d2 = f2;
      }
      else {
        d2 = this._last;
        for (var w2 = e21 < 0 ? e21 : u2; d2; ) {
          if (f2 = d2._prev, (d2._act || w2 <= d2._end) && d2._ts && g2 !== d2) {
            if (d2.parent !== this) return this.render(e21, t2, n2);
            if (d2.render(d2._ts > 0 ? (w2 - d2._start) * d2._ts : (d2._dirty ? d2.totalDuration() : d2._tDur) + (w2 - d2._start) * d2._ts, t2, n2 || a && Se(d2)), u2 !== this._time || !this._ts && !h2) {
              g2 = 0, f2 && (s2 += this._zTime = w2 ? -c : c);
              break;
            }
          }
          d2 = f2;
        }
      }
      if (g2 && !t2 && (this.pause(), g2.render(u2 >= r3 ? 0 : -c)._zTime = u2 >= r3 ? 1 : -1, this._ts)) return this._start = v2, He(this), this.render(e21, t2, n2);
      this._onUpdate && !t2 && Dt(this, `onUpdate`, true), (s2 === i3 && this._tTime >= this.totalDuration() || !s2 && r3) && (v2 !== this._start && Math.abs(_2) === Math.abs(this._ts) || this._lock || ((e21 || !o3) && (s2 === i3 && this._ts > 0 || !s2 && this._ts < 0) && Pe(this, 1), t2 || e21 < 0 && !r3 || !s2 && !r3 && i3 || (Dt(this, s2 === i3 && e21 >= 0 ? `onComplete` : `onReverseComplete`, true), this._prom && !(s2 < i3 && this.timeScale() > 0) && this._prom())));
    }
    return this;
  }, o2.add = function(e21, t2) {
    var n2 = this;
    if (_(t2) || (t2 = tt(this, t2, e21)), !(e21 instanceof nn)) {
      if (w(e21)) return e21.forEach(function(e22) {
        return n2.add(e22, t2);
      }), this;
      if (h(e21)) return this.addLabel(e21, t2);
      if (g(e21)) e21 = vn.delayedCall(0, e21);
      else return this;
    }
    return this === e21 ? this : Ge(this, e21, t2);
  }, o2.getChildren = function(e21, t2, n2, r3) {
    e21 === void 0 && (e21 = true), t2 === void 0 && (t2 = true), n2 === void 0 && (n2 = true), r3 === void 0 && (r3 = -s);
    for (var i3 = [], a2 = this._first; a2; ) a2._start >= r3 && (a2 instanceof vn ? t2 && i3.push(a2) : (n2 && i3.push(a2), e21 && i3.push.apply(i3, a2.getChildren(true, t2, n2)))), a2 = a2._next;
    return i3;
  }, o2.getById = function(e21) {
    for (var t2 = this.getChildren(1, 1, 1), n2 = t2.length; n2--; ) if (t2[n2].vars.id === e21) return t2[n2];
  }, o2.remove = function(e21) {
    return h(e21) ? this.removeLabel(e21) : g(e21) ? this.killTweensOf(e21) : (e21.parent === this && Ne(this, e21), e21 === this._recent && (this._recent = this._last), Fe(this));
  }, o2.totalTime = function(e21, t2) {
    return arguments.length ? (this._forcing = 1, !this._dp && this._ts && (this._start = ve(Ht.time - (this._ts > 0 ? e21 / this._ts : (this.totalDuration() - e21) / -this._ts))), r2.prototype.totalTime.call(this, e21, t2), this._forcing = 0, this) : this._tTime;
  }, o2.addLabel = function(e21, t2) {
    return this.labels[e21] = tt(this, t2), this;
  }, o2.removeLabel = function(e21) {
    return delete this.labels[e21], this;
  }, o2.addPause = function(e21, t2, n2) {
    var r3 = vn.delayedCall(0, t2 || ie, n2);
    return r3.data = `isPause`, this._hasPause = 1, Ge(this, r3, tt(this, e21));
  }, o2.removePause = function(e21) {
    var t2 = this._first;
    for (e21 = tt(this, e21); t2; ) t2._start === e21 && t2.data === `isPause` && Pe(t2), t2 = t2._next;
  }, o2.killTweensOf = function(e21, t2, n2) {
    for (var r3 = this.getTweensOf(e21, n2), i3 = r3.length; i3--; ) ln !== r3[i3] && r3[i3].kill(e21, t2);
    return this;
  }, o2.getTweensOf = function(e21, t2) {
    for (var n2 = [], r3 = ut(e21), i3 = this._first, a2 = _(t2), o3; i3; ) i3 instanceof vn ? be(i3._targets, r3) && (a2 ? (!ln || i3._initted && i3._ts) && i3.globalTime(0) <= t2 && i3.globalTime(i3.totalDuration()) > t2 : !t2 || i3.isActive()) && n2.push(i3) : (o3 = i3.getTweensOf(r3, t2)).length && n2.push.apply(n2, o3), i3 = i3._next;
    return n2;
  }, o2.tweenTo = function(e21, t2) {
    t2 = t2 || {};
    var n2 = this, r3 = tt(n2, e21), i3 = t2, a2 = i3.startAt, o3 = i3.onStart, s2 = i3.onStartParams, l2 = i3.immediateRender, u2, d2 = vn.to(n2, Ee({ ease: t2.ease || `none`, lazy: false, immediateRender: false, time: r3, overwrite: `auto`, duration: t2.duration || Math.abs((r3 - (a2 && `time` in a2 ? a2.time : n2._time)) / n2.timeScale()) || c, onStart: function() {
      if (n2.pause(), !u2) {
        var e22 = t2.duration || Math.abs((r3 - (a2 && `time` in a2 ? a2.time : n2._time)) / n2.timeScale());
        d2._dur !== e22 && Qe(d2, e22, 0, 1).render(d2._time, true, true), u2 = 1;
      }
      o3 && o3.apply(d2, s2 || []);
    } }, t2));
    return l2 ? d2.render(0) : d2;
  }, o2.tweenFromTo = function(e21, t2, n2) {
    return this.tweenTo(t2, Ee({ startAt: { time: tt(this, e21) } }, n2));
  }, o2.recent = function() {
    return this._recent;
  }, o2.nextLabel = function(e21) {
    return e21 === void 0 && (e21 = this._time), Et(this, tt(this, e21));
  }, o2.previousLabel = function(e21) {
    return e21 === void 0 && (e21 = this._time), Et(this, tt(this, e21), 1);
  }, o2.currentLabel = function(e21) {
    return arguments.length ? this.seek(e21, true) : this.previousLabel(this._time + c);
  }, o2.shiftChildren = function(e21, t2, n2) {
    n2 === void 0 && (n2 = 0);
    var r3 = this._first, i3 = this.labels, a2;
    for (e21 = ve(e21); r3; ) r3._start >= n2 && (r3._start += e21, r3._end += e21), r3 = r3._next;
    if (t2) for (a2 in i3) i3[a2] >= n2 && (i3[a2] += e21);
    return Fe(this);
  }, o2.invalidate = function(e21) {
    var t2 = this._first;
    for (this._lock = 0; t2; ) t2.invalidate(e21), t2 = t2._next;
    return r2.prototype.invalidate.call(this, e21);
  }, o2.clear = function(e21) {
    e21 === void 0 && (e21 = true);
    for (var t2 = this._first, n2; t2; ) n2 = t2._next, this.remove(t2), t2 = n2;
    return this._dp && (this._time = this._tTime = this._pTime = 0), e21 && (this.labels = {}), Fe(this);
  }, o2.totalDuration = function(e21) {
    var t2 = 0, n2 = this, r3 = n2._last, i3 = s, a2, o3, c2;
    if (arguments.length) return n2.timeScale((n2._repeat < 0 ? n2.duration() : n2.totalDuration()) / (n2.reversed() ? -e21 : e21));
    if (n2._dirty) {
      for (c2 = n2.parent; r3; ) a2 = r3._prev, r3._dirty && r3.totalDuration(), o3 = r3._start, o3 > i3 && n2._sort && r3._ts && !n2._lock ? (n2._lock = 1, Ge(n2, r3, o3 - r3._delay, 1)._lock = 0) : i3 = o3, o3 < 0 && r3._ts && (t2 -= o3, (!c2 && !n2._dp || c2 && c2.smoothChildTiming) && (n2._start += ve(o3 / n2._ts), n2._time -= o3, n2._tTime -= o3), n2.shiftChildren(-o3, false, -1 / 0), i3 = 0), r3._end > t2 && r3._ts && (t2 = r3._end), r3 = a2;
      Qe(n2, n2 === P && n2._time > t2 ? n2._time : t2, 1, 1), n2._dirty = 0;
    }
    return n2._tDur;
  }, i2.updateRoot = function(e21) {
    if (P._ts && (Ce(P, Ve(e21, P)), le = Ht.frame), Ht.frame >= fe) {
      fe += n.autoSleep || 120;
      var t2 = P._first;
      if ((!t2 || !t2._ts) && n.autoSleep && Ht._listeners.length < 2) {
        for (; t2 && !t2._ts; ) t2 = t2._next;
        t2 || Ht.sleep();
      }
    }
  }, i2;
})(nn);
Ee(rn.prototype, { _lock: 0, _hasPause: 0, _forcing: 0 });
var an = function(e21, t2, n2, r2, i2, a2, o2) {
  var s2 = new Mn(this._pt, e21, t2, 0, 1, En, null, i2), c2 = 0, l2 = 0, u2, d2, f2, p2, m2, h2, g2, _2;
  for (s2.b = n2, s2.e = r2, n2 += ``, r2 += ``, (g2 = ~r2.indexOf(`random(`)) && (r2 = Ct(r2)), a2 && (_2 = [n2, r2], a2(_2, e21, t2), n2 = _2[0], r2 = _2[1]), d2 = n2.match(A) || []; u2 = A.exec(r2); ) p2 = u2[0], m2 = r2.substring(c2, u2.index), f2 ? f2 = (f2 + 1) % 5 : m2.substr(-5) === `rgba(` && (f2 = 1), p2 !== d2[l2++] && (h2 = parseFloat(d2[l2 - 1]) || 0, s2._pt = { _next: s2._pt, p: m2 || l2 === 1 ? m2 : `,`, s: h2, c: p2.charAt(1) === `=` ? ye(h2, p2) - h2 : parseFloat(p2) - h2, m: f2 && f2 < 4 ? Math.round : 0 }, c2 = A.lastIndex);
  return s2.c = c2 < r2.length ? r2.substring(c2, r2.length) : ``, s2.fp = o2, (j.test(r2) || g2) && (s2.e = 0), this._pt = s2, s2;
}, on = function(e21, t2, r2, i2, a2, o2, s2, c2, l2, u2) {
  g(i2) && (i2 = i2(a2 || 0, e21, o2));
  var d2 = e21[t2], f2 = r2 === `get` ? g(d2) ? l2 ? e21[t2.indexOf(`set`) || !g(e21[`get` + t2.substr(3)]) ? t2 : `get` + t2.substr(3)](l2) : e21[t2]() : d2 : r2, p2 = g(d2) ? l2 ? xn : bn : yn, m2;
  if (h(i2) && (~i2.indexOf(`random(`) && (i2 = Ct(i2)), i2.charAt(1) === `=` && (m2 = ye(f2, i2) + (at(f2) || 0), (m2 || m2 === 0) && (i2 = m2))), !u2 || f2 !== i2 || un) return !isNaN(f2 * i2) && i2 !== `` ? (m2 = new Mn(this._pt, e21, t2, +f2 || 0, i2 - (f2 || 0), typeof d2 == `boolean` ? Tn : wn, 0, p2), l2 && (m2.fp = l2), s2 && m2.modifier(s2, this, e21), this._pt = m2) : (!d2 && !(t2 in e21) && ne(t2, i2), an.call(this, e21, t2, f2, i2, p2, c2 || n.stringFilter, l2));
}, sn = function(e21, t2, n2, r2, i2) {
  if (g(e21) && (e21 = hn(e21, i2, t2, n2, r2)), !y(e21) || e21.style && e21.nodeType || w(e21) || C(e21)) return h(e21) ? hn(e21, i2, t2, n2, r2) : e21;
  var a2 = {}, o2;
  for (o2 in e21) a2[o2] = hn(e21[o2], i2, t2, n2, r2);
  return a2;
}, cn = function(e21, t2, n2, r2, i2, a2) {
  var o2, s2, c2, l2;
  if (ue[e21] && (o2 = new ue[e21]()).init(i2, o2.rawVars ? t2[e21] : sn(t2[e21], r2, i2, a2, n2), n2, r2, a2) !== false && (n2._pt = s2 = new Mn(n2._pt, i2, e21, 0, 1, o2.render, o2, 0, o2.priority), n2 !== kt)) for (c2 = n2._ptLookup[n2._targets.indexOf(i2)], l2 = o2._props.length; l2--; ) c2[o2._props[l2]] = s2;
  return o2;
}, ln, un, dn = function e11(t2, n2, o2) {
  var l2 = t2.vars, u2 = l2.ease, d2 = l2.startAt, f2 = l2.immediateRender, p2 = l2.lazy, m2 = l2.onUpdate, h2 = l2.runBackwards, g2 = l2.yoyoEase, _2 = l2.keyframes, v2 = l2.autoRevert, y2 = t2._dur, x2 = t2._startAt, S2 = t2._targets, C2 = t2.parent, w2 = C2 && C2.data === `nested` ? C2.vars.targets : S2, T2 = t2._overwrite === `auto` && !i, E2 = t2.timeline, D2 = l2.easeReverse || g2, O2, k2, A2, j2, M2, N2, F2, I2, L2, R2, ee2, te2, z2;
  if (!E2 || _2 && u2 || (u2 = `none`), t2._ease = Xt(u2, r.ease), t2._rEase = D2 && (Xt(D2) || t2._ease), t2._from = !E2 && !!l2.runBackwards, t2._from && (t2.ratio = 1), !E2 || _2 && !l2.stagger) {
    if (I2 = S2[0] ? ge(S2[0]).harness : 0, te2 = I2 && l2[I2.prop], O2 = ke(l2, se), x2 && (x2._zTime < 0 && x2.progress(1), n2 < 0 && h2 && f2 && !v2 ? x2.render(-1, true) : x2.revert(h2 && y2 ? V : ae), x2._lazy = 0), d2) {
      if (Pe(t2._startAt = vn.set(S2, Ee({ data: `isStart`, overwrite: false, parent: C2, immediateRender: true, lazy: !x2 && b(p2), startAt: null, delay: 0, onUpdate: m2 && function() {
        return Dt(t2, `onUpdate`);
      }, stagger: 0 }, d2))), t2._startAt._dp = 0, t2._startAt._sat = t2, n2 < 0 && (a || !f2 && !v2) && t2._startAt.revert(V), f2 && y2 && n2 <= 0 && o2 <= 0) {
        n2 && (t2._zTime = n2);
        return;
      }
    } else if (h2 && y2 && !x2) {
      if (n2 && (f2 = false), A2 = Ee({ overwrite: false, data: `isFromStart`, lazy: f2 && !x2 && b(p2), immediateRender: f2, stagger: 0, parent: C2 }, O2), te2 && (A2[I2.prop] = te2), Pe(t2._startAt = vn.set(S2, A2)), t2._startAt._dp = 0, t2._startAt._sat = t2, n2 < 0 && (a ? t2._startAt.revert(V) : t2._startAt.render(-1, true)), t2._zTime = n2, !f2) e11(t2._startAt, c, c);
      else if (!n2) return;
    }
    for (t2._pt = t2._ptCache = 0, p2 = y2 && b(p2) || p2 && !y2, k2 = 0; k2 < S2.length; k2++) {
      if (M2 = S2[k2], F2 = M2._gsap || he(S2)[k2]._gsap, t2._ptLookup[k2] = R2 = {}, ce[F2.id] && H.length && xe(), ee2 = w2 === S2 ? k2 : w2.indexOf(M2), I2 && (L2 = new I2()).init(M2, te2 || O2, t2, ee2, w2) !== false && (t2._pt = j2 = new Mn(t2._pt, M2, L2.name, 0, 1, L2.render, L2, 0, L2.priority), L2._props.forEach(function(e21) {
        R2[e21] = j2;
      }), L2.priority && (N2 = 1)), !I2 || te2) for (A2 in O2) ue[A2] && (L2 = cn(A2, O2, t2, ee2, M2, w2)) ? L2.priority && (N2 = 1) : R2[A2] = j2 = on.call(t2, M2, A2, `get`, O2[A2], ee2, w2, 0, l2.stringFilter);
      t2._op && t2._op[k2] && t2.kill(M2, t2._op[k2]), T2 && t2._pt && (ln = t2, P.killTweensOf(M2, R2, t2.globalTime(n2)), z2 = !t2.parent, ln = 0), t2._pt && p2 && (ce[F2.id] = 1);
    }
    N2 && jn(t2), t2._onInit && t2._onInit(t2);
  }
  t2._onUpdate = m2, t2._initted = (!t2._op || t2._pt) && !z2, _2 && n2 <= 0 && E2.render(s, true, true);
}, fn = function(e21, t2, n2, r2, i2, a2, o2, s2) {
  var c2 = (e21._pt && e21._ptCache || (e21._ptCache = {}))[t2], l2, u2, d2, f2;
  if (!c2) for (c2 = e21._ptCache[t2] = [], d2 = e21._ptLookup, f2 = e21._targets.length; f2--; ) {
    if (l2 = d2[f2][t2], l2 && l2.d && l2.d._pt) for (l2 = l2.d._pt; l2 && l2.p !== t2 && l2.fp !== t2; ) l2 = l2._next;
    if (!l2) return un = 1, e21.vars[t2] = `+=0`, dn(e21, o2), un = 0, s2 ? B(t2 + ` not eligible for reset. Try splitting into individual properties`) : 1;
    c2.push(l2);
  }
  for (f2 = c2.length; f2--; ) u2 = c2[f2], l2 = u2._pt || u2, l2.s = (r2 || r2 === 0) && !i2 ? r2 : l2.s + (r2 || 0) + a2 * l2.c, l2.c = n2 - l2.s, u2.e && (u2.e = W(n2) + at(u2.e)), u2.b && (u2.b = l2.s + at(u2.b));
}, pn = function(e21, t2) {
  var n2 = e21[0] ? ge(e21[0]).harness : 0, r2 = n2 && n2.aliases, i2, a2, o2, s2;
  if (!r2) return t2;
  for (a2 in i2 = G({}, t2), r2) if (a2 in i2) for (s2 = r2[a2].split(`,`), o2 = s2.length; o2--; ) i2[s2[o2]] = i2[a2];
  return i2;
}, mn = function(e21, t2, n2, r2) {
  var i2 = t2.ease || r2 || `power1.inOut`, a2, o2;
  if (w(t2)) o2 = n2[e21] || (n2[e21] = []), t2.forEach(function(e22, n3) {
    return o2.push({ t: n3 / (t2.length - 1) * 100, v: e22, e: i2 });
  });
  else for (a2 in t2) o2 = n2[a2] || (n2[a2] = []), a2 === `ease` || o2.push({ t: parseFloat(e21), v: t2[a2], e: i2 });
}, hn = function(e21, t2, n2, r2, i2) {
  return g(e21) ? e21.call(t2, n2, r2, i2) : h(e21) && ~e21.indexOf(`random(`) ? Ct(e21) : e21;
}, gn = me + `repeat,repeatDelay,yoyo,repeatRefresh,yoyoEase,easeReverse,autoRevert`, _n = {};
_e(gn + `,id,stagger,delay,duration,paused,scrollTrigger`, function(e21) {
  return _n[e21] = 1;
});
var vn = (function(r2) {
  t(o2, r2);
  function o2(t2, a2, o3, s3) {
    var l2;
    typeof a2 == `number` && (o3.duration = a2, a2 = o3, o3 = null), l2 = r2.call(this, s3 ? a2 : Ae(a2)) || this;
    var u2 = l2.vars, d2 = u2.duration, f2 = u2.delay, p2 = u2.immediateRender, m2 = u2.stagger, h2 = u2.overwrite, g2 = u2.keyframes, v2 = u2.defaults, x2 = u2.scrollTrigger, T2 = a2.parent || P, E2 = (w(t2) || C(t2) ? _(t2[0]) : `length` in a2) ? [t2] : ut(t2), D2, O2, k2, A2, j2, M2, N2, F2;
    if (l2._targets = E2.length ? he(E2) : B(`GSAP target ` + t2 + ` not found. https://gsap.com`, !n.nullTargetWarn) || [], l2._ptLookup = [], l2._overwrite = h2, g2 || m2 || S(d2) || S(f2)) {
      a2 = l2.vars;
      var I2 = a2.easeReverse || a2.yoyoEase;
      if (D2 = l2.timeline = new rn({ data: `nested`, defaults: v2 || {}, targets: T2 && T2.data === `nested` ? T2.vars.targets : E2 }), D2.kill(), D2.parent = D2._dp = e(l2), D2._start = 0, m2 || S(d2) || S(f2)) {
        if (A2 = E2.length, N2 = m2 && pt(m2), y(m2)) for (j2 in m2) ~gn.indexOf(j2) && (F2 || (F2 = {}), F2[j2] = m2[j2]);
        for (O2 = 0; O2 < A2; O2++) k2 = ke(a2, _n), k2.stagger = 0, I2 && (k2.easeReverse = I2), F2 && G(k2, F2), M2 = E2[O2], k2.duration = +hn(d2, e(l2), O2, M2, E2), k2.delay = (+hn(f2, e(l2), O2, M2, E2) || 0) - l2._delay, !m2 && A2 === 1 && k2.delay && (l2._delay = f2 = k2.delay, l2._start += f2, k2.delay = 0), D2.to(M2, k2, N2 ? N2(O2, M2, E2) : 0), D2._ease = K.none;
        D2.duration() ? d2 = f2 = 0 : l2.timeline = 0;
      } else if (g2) {
        Ae(Ee(D2.vars.defaults, { ease: `none` })), D2._ease = Xt(g2.ease || a2.ease || `none`);
        var L2 = 0, R2, ee2, te2;
        if (w(g2)) g2.forEach(function(e21) {
          return D2.to(E2, e21, `>`);
        }), D2.duration();
        else {
          for (j2 in k2 = {}, g2) j2 === `ease` || j2 === `easeEach` || mn(j2, g2[j2], k2, g2.easeEach);
          for (j2 in k2) for (R2 = k2[j2].sort(function(e21, t3) {
            return e21.t - t3.t;
          }), L2 = 0, O2 = 0; O2 < R2.length; O2++) ee2 = R2[O2], te2 = { ease: ee2.e, duration: (ee2.t - (O2 ? R2[O2 - 1].t : 0)) / 100 * d2 }, te2[j2] = ee2.v, D2.to(E2, te2, L2), L2 += te2.duration;
          D2.duration() < d2 && D2.to({}, { duration: d2 - D2.duration() });
        }
      }
      d2 || l2.duration(d2 = D2.duration());
    } else l2.timeline = 0;
    return h2 === true && !i && (ln = e(l2), P.killTweensOf(E2), ln = 0), Ge(T2, e(l2), o3), a2.reversed && l2.reverse(), a2.paused && l2.paused(true), (p2 || !d2 && !g2 && l2._start === ve(T2._time) && b(p2) && Re(e(l2)) && T2.data !== `nested`) && (l2._tTime = -c, l2.render(Math.max(0, -f2) || 0)), x2 && Ke(e(l2), x2), l2;
  }
  var s2 = o2.prototype;
  return s2.render = function(e21, t2, n2) {
    var r3 = this._time, i2 = this._tDur, a2 = this._dur, o3 = e21 < 0, s3 = e21 > i2 - c && !o3 ? i2 : e21 < c ? 0 : e21, l2, u2, d2, f2, p2, m2, h2, g2;
    if (!a2) Xe(this, e21, t2, n2);
    else if (s3 !== this._tTime || !e21 || n2 || !this._initted && this._tTime || this._startAt && this._zTime < 0 !== o3 || this._lazy) {
      if (l2 = s3, g2 = this.timeline, this._repeat) {
        if (f2 = a2 + this._rDelay, this._repeat < -1 && o3) return this.totalTime(f2 * 100 + e21, t2, n2);
        if (l2 = ve(s3 % f2), s3 === i2 ? (d2 = this._repeat, l2 = a2) : (p2 = ve(s3 / f2), d2 = ~~p2, d2 && d2 === p2 ? (l2 = a2, d2--) : l2 > a2 && (l2 = a2)), m2 = this._yoyo && d2 & 1, m2 && (l2 = a2 - l2), p2 = Be(this._tTime, f2), l2 === r3 && !n2 && this._initted && d2 === p2) return this._tTime = s3, this;
        d2 !== p2 && this.vars.repeatRefresh && !m2 && !this._lock && l2 !== f2 && this._initted && (this._lock = n2 = 1, this.render(ve(f2 * d2), true).invalidate()._lock = 0);
      }
      if (!this._initted) {
        if (qe(this, o3 ? e21 : l2, n2, t2, s3)) return this._tTime = 0, this;
        if (r3 !== this._time && !(n2 && this.vars.repeatRefresh && d2 !== p2)) return this;
        if (a2 !== this._dur) return this.render(e21, t2, n2);
      }
      if (this._rEase) {
        var _2 = l2 < r3;
        if (_2 !== this._inv) {
          var v2 = _2 ? r3 : a2 - r3;
          this._inv = _2, this._from && (this.ratio = 1 - this.ratio), this._invRatio = this.ratio, this._invTime = r3, this._invRecip = v2 ? (_2 ? -1 : 1) / v2 : 0, this._invScale = _2 ? -this.ratio : 1 - this.ratio, this._invEase = _2 ? this._rEase : this._ease;
        }
        this.ratio = h2 = this._invRatio + this._invScale * this._invEase((l2 - this._invTime) * this._invRecip);
      } else this.ratio = h2 = this._ease(l2 / a2);
      if (this._from && (this.ratio = h2 = 1 - h2), this._tTime = s3, this._time = l2, !this._act && this._ts && (this._act = 1, this._lazy = 0), !r3 && s3 && !t2 && !p2 && (Dt(this, `onStart`), this._tTime !== s3)) return this;
      for (u2 = this._pt; u2; ) u2.r(h2, u2.d), u2 = u2._next;
      g2 && g2.render(e21 < 0 ? e21 : g2._dur * g2._ease(l2 / this._dur), t2, n2) || this._startAt && (this._zTime = e21), this._onUpdate && !t2 && (o3 && Le(this, e21, t2, n2), Dt(this, `onUpdate`)), this._repeat && d2 !== p2 && this.vars.onRepeat && !t2 && this.parent && Dt(this, `onRepeat`), s3 !== this._tDur && s3 || this._tTime !== s3 || (o3 && !this._onUpdate && Le(this, e21, true, true), (e21 || !a2) && (s3 === this._tDur && this._ts > 0 || !s3 && this._ts < 0) && Pe(this, 1), !t2 && (!o3 || r3) && (s3 || r3 || m2) && (Dt(this, s3 === i2 ? `onComplete` : `onReverseComplete`, true), this._prom && !(s3 < i2 && this.timeScale() > 0) && this._prom()));
    }
    return this;
  }, s2.targets = function() {
    return this._targets;
  }, s2.invalidate = function(e21) {
    return e21 && this.vars.runBackwards || (this._startAt = 0), this._pt = this._op = this._onUpdate = this._lazy = this.ratio = 0, this._ptLookup = [], this.timeline && this.timeline.invalidate(e21), r2.prototype.invalidate.call(this, e21);
  }, s2.resetTo = function(e21, t2, n2, r3, i2) {
    Vt || Ht.wake(), this._ts || this.play();
    var a2 = Math.min(this._dur, (this._dp._time - this._start) * this._ts), o3;
    return this._initted || dn(this, a2), o3 = this._ease(a2 / this._dur), fn(this, e21, t2, n2, r3, o3, a2, i2) ? this.resetTo(e21, t2, n2, r3, 1) : (Ue(this, 0), this.parent || Me(this._dp, this, `_first`, `_last`, this._dp._sort ? `_start` : 0), this.render(0));
  }, s2.kill = function(e21, t2) {
    if (t2 === void 0 && (t2 = `all`), !e21 && (!t2 || t2 === `all`)) return this._lazy = this._pt = 0, this.parent ? Ot(this) : this.scrollTrigger && this.scrollTrigger.kill(!!a), this;
    if (this.timeline) {
      var n2 = this.timeline.totalDuration();
      return this.timeline.killTweensOf(e21, t2, ln && ln.vars.overwrite !== true)._first || Ot(this), this.parent && n2 !== this.timeline.totalDuration() && Qe(this, this._dur * this.timeline._tDur / n2, 0, 1), this;
    }
    var r3 = this._targets, i2 = e21 ? ut(e21) : r3, o3 = this._ptLookup, s3 = this._pt, c2, l2, u2, d2, f2, p2, m2;
    if ((!t2 || t2 === `all`) && je(r3, i2)) return t2 === `all` && (this._pt = 0), Ot(this);
    for (c2 = this._op = this._op || [], t2 !== `all` && (h(t2) && (f2 = {}, _e(t2, function(e22) {
      return f2[e22] = 1;
    }), t2 = f2), t2 = pn(r3, t2)), m2 = r3.length; m2--; ) if (~i2.indexOf(r3[m2])) for (f2 in l2 = o3[m2], t2 === `all` ? (c2[m2] = t2, d2 = l2, u2 = {}) : (u2 = c2[m2] = c2[m2] || {}, d2 = t2), d2) p2 = l2 && l2[f2], p2 && (`kill` in p2.d && p2.d.kill(f2) !== true || Ne(this, p2, `_pt`), delete l2[f2]), u2 !== `all` && (u2[f2] = 1);
    return this._initted && !this._pt && s3 && Ot(this), this;
  }, o2.to = function(e21, t2) {
    return new o2(e21, t2, arguments[2]);
  }, o2.from = function(e21, t2) {
    return nt(1, arguments);
  }, o2.delayedCall = function(e21, t2, n2, r3) {
    return new o2(t2, 0, { immediateRender: false, lazy: false, overwrite: false, delay: e21, onComplete: t2, onReverseComplete: t2, onCompleteParams: n2, onReverseCompleteParams: n2, callbackScope: r3 });
  }, o2.fromTo = function(e21, t2, n2) {
    return nt(2, arguments);
  }, o2.set = function(e21, t2) {
    return t2.duration = 0, t2.repeatDelay || (t2.repeat = 0), new o2(e21, t2);
  }, o2.killTweensOf = function(e21, t2, n2) {
    return P.killTweensOf(e21, t2, n2);
  }, o2;
})(nn);
Ee(vn.prototype, { _targets: [], _lazy: 0, _startAt: 0, _op: 0, _onInit: 0 }), _e(`staggerTo,staggerFrom,staggerFromTo`, function(e21) {
  vn[e21] = function() {
    var t2 = new rn(), n2 = st.call(arguments, 0);
    return n2.splice(e21 === `staggerFromTo` ? 5 : 4, 0, 0), t2[e21].apply(t2, n2);
  };
});
var yn = function(e21, t2, n2) {
  return e21[t2] = n2;
}, bn = function(e21, t2, n2) {
  return e21[t2](n2);
}, xn = function(e21, t2, n2, r2) {
  return e21[t2](r2.fp, n2);
}, Sn = function(e21, t2, n2) {
  return e21.setAttribute(t2, n2);
}, Cn = function(e21, t2) {
  return g(e21[t2]) ? bn : v(e21[t2]) && e21.setAttribute ? Sn : yn;
}, wn = function(e21, t2) {
  return t2.set(t2.t, t2.p, Math.round((t2.s + t2.c * e21) * 1e6) / 1e6, t2);
}, Tn = function(e21, t2) {
  return t2.set(t2.t, t2.p, !!(t2.s + t2.c * e21), t2);
}, En = function(e21, t2) {
  var n2 = t2._pt, r2 = ``;
  if (!e21 && t2.b) r2 = t2.b;
  else if (e21 === 1 && t2.e) r2 = t2.e;
  else {
    for (; n2; ) r2 = n2.p + (n2.m ? n2.m(n2.s + n2.c * e21) : Math.round((n2.s + n2.c * e21) * 1e4) / 1e4) + r2, n2 = n2._next;
    r2 += t2.c;
  }
  t2.set(t2.t, t2.p, r2, t2);
}, Dn = function(e21, t2) {
  for (var n2 = t2._pt; n2; ) n2.r(e21, n2.d), n2 = n2._next;
}, On = function(e21, t2, n2, r2) {
  for (var i2 = this._pt, a2; i2; ) a2 = i2._next, i2.p === r2 && i2.modifier(e21, t2, n2), i2 = a2;
}, kn = function(e21) {
  for (var t2 = this._pt, n2, r2; t2; ) r2 = t2._next, t2.p === e21 && !t2.op || t2.op === e21 ? Ne(this, t2, `_pt`) : t2.dep || (n2 = 1), t2 = r2;
  return !n2;
}, An = function(e21, t2, n2, r2) {
  r2.mSet(e21, t2, r2.m.call(r2.tween, n2, r2.mt), r2);
}, jn = function(e21) {
  for (var t2 = e21._pt, n2, r2, i2, a2; t2; ) {
    for (n2 = t2._next, r2 = i2; r2 && r2.pr > t2.pr; ) r2 = r2._next;
    (t2._prev = r2 ? r2._prev : a2) ? t2._prev._next = t2 : i2 = t2, (t2._next = r2) ? r2._prev = t2 : a2 = t2, t2 = n2;
  }
  e21._pt = i2;
}, Mn = (function() {
  function e21(e22, t3, n2, r2, i2, a2, o2, s2, c2) {
    this.t = t3, this.s = r2, this.c = i2, this.p = n2, this.r = a2 || wn, this.d = o2 || this, this.set = s2 || yn, this.pr = c2 || 0, this._next = e22, e22 && (e22._prev = this);
  }
  var t2 = e21.prototype;
  return t2.modifier = function(e22, t3, n2) {
    this.mSet = this.mSet || this.set, this.set = An, this.m = e22, this.mt = n2, this.tween = t3;
  }, e21;
})();
_e(me + `parent,duration,ease,delay,overwrite,runBackwards,startAt,yoyo,immediateRender,repeat,repeatDelay,data,paused,reversed,lazy,callbackScope,stringFilter,id,yoyoEase,stagger,inherit,repeatRefresh,keyframes,autoRevert,scrollTrigger,easeReverse`, function(e21) {
  return se[e21] = 1;
}), R.TweenMax = R.TweenLite = vn, R.TimelineLite = R.TimelineMax = rn, P = new rn({ sortChildren: false, defaults: r, autoRemoveChildren: true, id: `root`, smoothChildTiming: true }), n.stringFilter = Bt;
var Nn = [], Pn = {}, Fn = [], In = 0, Ln = 0, Rn = function(e21) {
  return (Pn[e21] || Fn).map(function(e22) {
    return e22();
  });
}, zn = function() {
  var e21 = Date.now(), t2 = [];
  e21 - In > 2 && (Rn(`matchMediaInit`), Nn.forEach(function(e22) {
    var n2 = e22.queries, r2 = e22.conditions, i2, a2, o2, s2;
    for (a2 in n2) i2 = F.matchMedia(n2[a2]).matches, i2 && (o2 = 1), i2 !== r2[a2] && (r2[a2] = i2, s2 = 1);
    s2 && (e22.revert(), o2 && t2.push(e22));
  }), Rn(`matchMediaRevert`), t2.forEach(function(e22) {
    return e22.onMatch(e22, function(t3) {
      return e22.add(null, t3);
    });
  }), In = e21, Rn(`matchMedia`));
}, Bn = (function() {
  function e21(e22, t3) {
    this.selector = t3 && dt(t3), this.data = [], this._r = [], this.isReverted = false, this.id = Ln++, e22 && this.add(e22);
  }
  var t2 = e21.prototype;
  return t2.add = function(e22, t3, n2) {
    g(e22) && (n2 = t3, t3 = e22, e22 = g);
    var r2 = this, i2 = function() {
      var e23 = o, i3 = r2.selector, a2;
      return e23 && e23 !== r2 && e23.data.push(r2), n2 && (r2.selector = dt(n2)), o = r2, a2 = t3.apply(r2, arguments), g(a2) && r2._r.push(a2), o = e23, r2.selector = i3, r2.isReverted = false, a2;
    };
    return r2.last = i2, e22 === g ? i2(r2, function(e23) {
      return r2.add(null, e23);
    }) : e22 ? r2[e22] = i2 : i2;
  }, t2.ignore = function(e22) {
    var t3 = o;
    o = null, e22(this), o = t3;
  }, t2.getTweens = function() {
    var t3 = [];
    return this.data.forEach(function(n2) {
      return n2 instanceof e21 ? t3.push.apply(t3, n2.getTweens()) : n2 instanceof vn && !(n2.parent && n2.parent.data === `nested`) && t3.push(n2);
    }), t3;
  }, t2.clear = function() {
    this._r.length = this.data.length = 0;
  }, t2.kill = function(e22, t3) {
    var n2 = this;
    if (e22 ? (function() {
      for (var t4 = n2.getTweens(), r3 = n2.data.length, i2; r3--; ) i2 = n2.data[r3], i2.data === `isFlip` && (i2.revert(), i2.getChildren(true, true, false).forEach(function(e23) {
        return t4.splice(t4.indexOf(e23), 1);
      }));
      for (t4.map(function(e23) {
        return { g: e23._dur || e23._delay || e23._sat && !e23._sat.vars.immediateRender ? e23.globalTime(0) : -1 / 0, t: e23 };
      }).sort(function(e23, t5) {
        return t5.g - e23.g || -1 / 0;
      }).forEach(function(t5) {
        return t5.t.revert(e22);
      }), r3 = n2.data.length; r3--; ) i2 = n2.data[r3], i2 instanceof rn ? i2.data !== `nested` && (i2.scrollTrigger && i2.scrollTrigger.revert(), i2.kill()) : !(i2 instanceof vn) && i2.revert && i2.revert(e22);
      n2._r.forEach(function(t5) {
        return t5(e22, n2);
      }), n2.isReverted = true;
    })() : this.data.forEach(function(e23) {
      return e23.kill && e23.kill();
    }), this.clear(), t3) for (var r2 = Nn.length; r2--; ) Nn[r2].id === this.id && Nn.splice(r2, 1);
  }, t2.revert = function(e22) {
    this.kill(e22 || {});
  }, e21;
})(), Vn = (function() {
  function e21(e22) {
    this.contexts = [], this.scope = e22, o && o.data.push(this);
  }
  var t2 = e21.prototype;
  return t2.add = function(e22, t3, n2) {
    y(e22) || (e22 = { matches: e22 });
    var r2 = new Bn(0, n2 || this.scope), i2 = r2.conditions = {}, a2, s2, c2;
    for (s2 in o && !r2.selector && (r2.selector = o.selector), this.contexts.push(r2), t3 = r2.add(`onMatch`, t3), r2.queries = e22, e22) s2 === `all` ? c2 = 1 : (a2 = F.matchMedia(e22[s2]), a2 && (Nn.indexOf(r2) < 0 && Nn.push(r2), (i2[s2] = a2.matches) && (c2 = 1), a2.addListener ? a2.addListener(zn) : a2.addEventListener(`change`, zn)));
    return c2 && t3(r2, function(e23) {
      return r2.add(null, e23);
    }), this;
  }, t2.revert = function(e22) {
    this.kill(e22 || {});
  }, t2.kill = function(e22) {
    this.contexts.forEach(function(t3) {
      return t3.kill(e22, true);
    });
  }, e21;
})(), Hn = { registerPlugin: function() {
  [...arguments].forEach(function(e21) {
    return jt(e21);
  });
}, timeline: function(e21) {
  return new rn(e21);
}, getTweensOf: function(e21, t2) {
  return P.getTweensOf(e21, t2);
}, getProperty: function(e21, t2, n2, r2) {
  h(e21) && (e21 = ut(e21)[0]);
  var i2 = ge(e21 || {}).get, a2 = n2 ? Te : we;
  return n2 === `native` && (n2 = ``), e21 && (t2 ? a2((ue[t2] && ue[t2].get || i2)(e21, t2, n2, r2)) : function(t3, n3, r3) {
    return a2((ue[t3] && ue[t3].get || i2)(e21, t3, n3, r3));
  });
}, quickSetter: function(e21, t2, n2) {
  if (e21 = ut(e21), e21.length > 1) {
    var r2 = e21.map(function(e22) {
      return Kn.quickSetter(e22, t2, n2);
    }), i2 = r2.length;
    return function(e22) {
      for (var t3 = i2; t3--; ) r2[t3](e22);
    };
  }
  e21 = e21[0] || {};
  var a2 = ue[t2], o2 = ge(e21), s2 = o2.harness && (o2.harness.aliases || {})[t2] || t2, c2 = a2 ? function(t3) {
    var r3 = new a2();
    kt._pt = 0, r3.init(e21, n2 ? t3 + n2 : t3, kt, 0, [e21]), r3.render(1, r3), kt._pt && Dn(1, kt);
  } : o2.set(e21, s2);
  return a2 ? c2 : function(t3) {
    return c2(e21, s2, n2 ? t3 + n2 : t3, o2, 1);
  };
}, quickTo: function(e21, t2, n2) {
  var r2, i2 = Kn.to(e21, Ee((r2 = {}, r2[t2] = `+=0.1`, r2.paused = true, r2.stagger = 0, r2), n2 || {})), a2 = function(e22, n3, r3) {
    return i2.resetTo(t2, e22, n3, r3);
  };
  return a2.tween = i2, a2;
}, isTweening: function(e21) {
  return P.getTweensOf(e21, true).length > 0;
}, defaults: function(e21) {
  return e21 && e21.ease && (e21.ease = Xt(e21.ease, r.ease)), Oe(r, e21 || {});
}, config: function(e21) {
  return Oe(n, e21 || {});
}, registerEffect: function(e21) {
  var t2 = e21.name, n2 = e21.effect, r2 = e21.plugins, i2 = e21.defaults, a2 = e21.extendTimeline;
  (r2 || ``).split(`,`).forEach(function(e22) {
    return e22 && !ue[e22] && !R[e22] && B(t2 + ` effect requires ` + e22 + ` plugin.`);
  }), de[t2] = function(e22, t3, r3) {
    return n2(ut(e22), Ee(t3 || {}, i2), r3);
  }, a2 && (rn.prototype[t2] = function(e22, n3, r3) {
    return this.add(de[t2](e22, y(n3) ? n3 : (r3 = n3) && {}, this), r3);
  });
}, registerEase: function(e21, t2) {
  K[e21] = Xt(t2);
}, parseEase: function(e21, t2) {
  return arguments.length ? Xt(e21, t2) : K;
}, getById: function(e21) {
  return P.getById(e21);
}, exportRoot: function(e21, t2) {
  e21 === void 0 && (e21 = {});
  var n2 = new rn(e21), r2, i2;
  for (n2.smoothChildTiming = b(e21.smoothChildTiming), P.remove(n2), n2._dp = 0, n2._time = n2._tTime = P._time, r2 = P._first; r2; ) i2 = r2._next, (t2 || !(!r2._dur && r2 instanceof vn && r2.vars.onComplete === r2._targets[0])) && Ge(n2, r2, r2._start - r2._delay), r2 = i2;
  return Ge(P, n2, 0), n2;
}, context: function(e21, t2) {
  return e21 ? new Bn(e21, t2) : o;
}, matchMedia: function(e21) {
  return new Vn(e21);
}, matchMediaRefresh: function() {
  return Nn.forEach(function(e21) {
    var t2 = e21.conditions, n2, r2;
    for (r2 in t2) t2[r2] && (t2[r2] = false, n2 = 1);
    n2 && e21.revert();
  }) || zn();
}, addEventListener: function(e21, t2) {
  var n2 = Pn[e21] || (Pn[e21] = []);
  ~n2.indexOf(t2) || n2.push(t2);
}, removeEventListener: function(e21, t2) {
  var n2 = Pn[e21], r2 = n2 && n2.indexOf(t2);
  r2 >= 0 && n2.splice(r2, 1);
}, utils: { wrap: xt, wrapYoyo: St, distribute: pt, random: gt, snap: ht, normalize: yt, getUnit: at, clamp: ot, splitColor: Ft, toArray: ut, selector: dt, mapRange: wt, pipe: _t, unitize: vt, interpolate: Tt, shuffle: ft }, install: z, effects: de, ticker: Ht, updateRoot: rn.updateRoot, plugins: ue, globalTimeline: P, core: { PropTween: Mn, globals: re, Tween: vn, Timeline: rn, Animation: nn, getCache: ge, _removeLinkedListItem: Ne, reverting: function() {
  return a;
}, context: function(e21) {
  return e21 && o && (o.data.push(e21), e21._ctx = o), o;
}, suppressOverwrites: function(e21) {
  return i = e21;
} } };
_e(`to,from,fromTo,delayedCall,set,killTweensOf`, function(e21) {
  return Hn[e21] = vn[e21];
}), Ht.add(rn.updateRoot), kt = Hn.to({}, { duration: 0 });
var Un = function(e21, t2) {
  for (var n2 = e21._pt; n2 && n2.p !== t2 && n2.op !== t2 && n2.fp !== t2; ) n2 = n2._next;
  return n2;
}, Wn = function(e21, t2) {
  var n2 = e21._targets, r2, i2, a2;
  for (r2 in t2) for (i2 = n2.length; i2--; ) a2 = e21._ptLookup[i2][r2], a2 && (a2 = a2.d) && (a2._pt && (a2 = Un(a2, r2)), a2 && a2.modifier && a2.modifier(t2[r2], e21, n2[i2], r2));
}, Gn = function(e21, t2) {
  return { name: e21, headless: 1, rawVars: 1, init: function(e22, n2, r2) {
    r2._onInit = function(e23) {
      var r3, i2;
      if (h(n2) && (r3 = {}, _e(n2, function(e24) {
        return r3[e24] = 1;
      }), n2 = r3), t2) {
        for (i2 in r3 = {}, n2) r3[i2] = t2(n2[i2]);
        n2 = r3;
      }
      Wn(e23, n2);
    };
  } };
}, Kn = Hn.registerPlugin({ name: `attr`, init: function(e21, t2, n2, r2, i2) {
  var a2, o2, s2;
  for (a2 in this.tween = n2, t2) s2 = e21.getAttribute(a2) || ``, o2 = this.add(e21, `setAttribute`, (s2 || 0) + ``, t2[a2], r2, i2, 0, 0, a2), o2.op = a2, o2.b = s2, this._props.push(a2);
}, render: function(e21, t2) {
  for (var n2 = t2._pt; n2; ) a ? n2.set(n2.t, n2.p, n2.b, n2) : n2.r(e21, n2.d), n2 = n2._next;
} }, { name: `endArray`, headless: 1, init: function(e21, t2) {
  for (var n2 = t2.length; n2--; ) this.add(e21, n2, e21[n2] || 0, t2[n2], 0, 0, 0, 0, 0, 1);
} }, Gn(`roundProps`, mt), Gn(`modifiers`), Gn(`snap`, ht)) || Hn;
vn.version = rn.version = Kn.version = `3.15.0`, te = 1, x() && Ut(), K.Power0, K.Power1, K.Power2, K.Power3, K.Power4, K.Linear, K.Quad, K.Cubic, K.Quart, K.Quint, K.Strong, K.Elastic, K.Back, K.SteppedEase, K.Bounce, K.Sine, K.Expo, K.Circ;
var qn, Jn, Yn, Xn, Zn, Qn, $n, er = function() {
  return typeof window < `u`;
}, tr = {}, nr = 180 / Math.PI, rr = Math.PI / 180, ir = Math.atan2, ar = 1e8, or = /([A-Z])/g, sr = /(left|right|width|margin|padding|x)/i, cr = /[\s,\(]\S/, lr = { autoAlpha: `opacity,visibility`, scale: `scaleX,scaleY`, alpha: `opacity` }, ur = function(e21, t2) {
  return t2.set(t2.t, t2.p, Math.round((t2.s + t2.c * e21) * 1e4) / 1e4 + t2.u, t2);
}, dr = function(e21, t2) {
  return t2.set(t2.t, t2.p, e21 === 1 ? t2.e : Math.round((t2.s + t2.c * e21) * 1e4) / 1e4 + t2.u, t2);
}, fr = function(e21, t2) {
  return t2.set(t2.t, t2.p, e21 ? Math.round((t2.s + t2.c * e21) * 1e4) / 1e4 + t2.u : t2.b, t2);
}, pr = function(e21, t2) {
  return t2.set(t2.t, t2.p, e21 === 1 ? t2.e : e21 ? Math.round((t2.s + t2.c * e21) * 1e4) / 1e4 + t2.u : t2.b, t2);
}, mr = function(e21, t2) {
  var n2 = t2.s + t2.c * e21;
  t2.set(t2.t, t2.p, ~~(n2 + (n2 < 0 ? -0.5 : 0.5)) + t2.u, t2);
}, hr = function(e21, t2) {
  return t2.set(t2.t, t2.p, e21 ? t2.e : t2.b, t2);
}, gr = function(e21, t2) {
  return t2.set(t2.t, t2.p, e21 === 1 ? t2.e : t2.b, t2);
}, _r = function(e21, t2, n2) {
  return e21.style[t2] = n2;
}, vr = function(e21, t2, n2) {
  return e21.style.setProperty(t2, n2);
}, yr = function(e21, t2, n2) {
  return e21._gsap[t2] = n2;
}, br = function(e21, t2, n2) {
  return e21._gsap.scaleX = e21._gsap.scaleY = n2;
}, xr = function(e21, t2, n2, r2, i2) {
  var a2 = e21._gsap;
  a2.scaleX = a2.scaleY = n2, a2.renderTransform(i2, a2);
}, Sr = function(e21, t2, n2, r2, i2) {
  var a2 = e21._gsap;
  a2[t2] = n2, a2.renderTransform(i2, a2);
}, Cr = `transform`, wr = Cr + `Origin`, Tr = function e12(t2, n2) {
  var r2 = this, i2 = this.target, a2 = i2.style, o2 = i2._gsap;
  if (t2 in tr && a2) {
    if (this.tfm = this.tfm || {}, t2 !== `transform`) t2 = lr[t2] || t2, ~t2.indexOf(`,`) ? t2.split(`,`).forEach(function(e21) {
      return r2.tfm[e21] = Wr(i2, e21);
    }) : this.tfm[t2] = o2.x ? o2[t2] : Wr(i2, t2), t2 === wr && (this.tfm.zOrigin = o2.zOrigin);
    else return lr.transform.split(`,`).forEach(function(t3) {
      return e12.call(r2, t3, n2);
    });
    if (this.props.indexOf(Cr) >= 0) return;
    o2.svg && (this.svgo = i2.getAttribute(`data-svg-origin`), this.props.push(wr, n2, ``)), t2 = Cr;
  }
  (a2 || n2) && this.props.push(t2, n2, a2[t2]);
}, Er = function(e21) {
  e21.translate && (e21.removeProperty(`translate`), e21.removeProperty(`scale`), e21.removeProperty(`rotate`));
}, Dr = function() {
  for (var e21 = this.props, t2 = this.target, n2 = t2.style, r2 = t2._gsap, i2 = 0, a2; i2 < e21.length; i2 += 3) e21[i2 + 1] ? e21[i2 + 1] === 2 ? t2[e21[i2]](e21[i2 + 2]) : t2[e21[i2]] = e21[i2 + 2] : e21[i2 + 2] ? n2[e21[i2]] = e21[i2 + 2] : n2.removeProperty(e21[i2].substr(0, 2) === `--` ? e21[i2] : e21[i2].replace(or, `-$1`).toLowerCase());
  if (this.tfm) {
    for (a2 in this.tfm) r2[a2] = this.tfm[a2];
    r2.svg && (r2.renderTransform(), t2.setAttribute(`data-svg-origin`, this.svgo || ``)), i2 = $n(), i2 && i2.isStart || n2[Cr] || (Er(n2), r2.zOrigin && n2[wr] && (n2[wr] += ` ` + r2.zOrigin + `px`, r2.zOrigin = 0, r2.renderTransform()), r2.uncache = 1);
  }
}, Or = function(e21, t2) {
  var n2 = { target: e21, props: [], revert: Dr, save: Tr };
  return e21._gsap || Kn.core.getCache(e21), t2 && e21.style && e21.nodeType && t2.split(`,`).forEach(function(e22) {
    return n2.save(e22);
  }), n2;
}, kr, Ar = function(e21, t2) {
  var n2 = Jn.createElementNS ? Jn.createElementNS((t2 || `http://www.w3.org/1999/xhtml`).replace(/^https/, `http`), e21) : Jn.createElement(e21);
  return n2 && n2.style ? n2 : Jn.createElement(e21);
}, jr = function e13(t2, n2, r2) {
  var i2 = getComputedStyle(t2);
  return i2[n2] || i2.getPropertyValue(n2.replace(or, `-$1`).toLowerCase()) || i2.getPropertyValue(n2) || !r2 && e13(t2, Nr(n2) || n2, 1) || ``;
}, Mr = `O,Moz,ms,Ms,Webkit`.split(`,`), Nr = function(e21, t2, n2) {
  var r2 = (t2 || Zn).style, i2 = 5;
  if (e21 in r2 && !n2) return e21;
  for (e21 = e21.charAt(0).toUpperCase() + e21.substr(1); i2-- && !(Mr[i2] + e21 in r2); ) ;
  return i2 < 0 ? null : (i2 === 3 ? `ms` : i2 >= 0 ? Mr[i2] : ``) + e21;
}, Pr = function() {
  er() && window.document && (qn = window, Jn = qn.document, Yn = Jn.documentElement, Zn = Ar(`div`) || { style: {} }, Ar(`div`), Cr = Nr(Cr), wr = Cr + `Origin`, Zn.style.cssText = `border-width:0;line-height:0;position:absolute;padding:0`, kr = !!Nr(`perspective`), $n = Kn.core.reverting, Xn = 1);
}, Fr = function(e21) {
  var t2 = e21.ownerSVGElement, n2 = Ar(`svg`, t2 && t2.getAttribute(`xmlns`) || `http://www.w3.org/2000/svg`), r2 = e21.cloneNode(true), i2;
  r2.style.display = `block`, n2.appendChild(r2), Yn.appendChild(n2);
  try {
    i2 = r2.getBBox();
  } catch {
  }
  return n2.removeChild(r2), Yn.removeChild(n2), i2;
}, Ir = function(e21, t2) {
  for (var n2 = t2.length; n2--; ) if (e21.hasAttribute(t2[n2])) return e21.getAttribute(t2[n2]);
}, Lr = function(e21) {
  var t2, n2;
  try {
    t2 = e21.getBBox();
  } catch {
    t2 = Fr(e21), n2 = 1;
  }
  return t2 && (t2.width || t2.height) || n2 || (t2 = Fr(e21)), t2 && !t2.width && !t2.x && !t2.y ? { x: +Ir(e21, [`x`, `cx`, `x1`]) || 0, y: +Ir(e21, [`y`, `cy`, `y1`]) || 0, width: 0, height: 0 } : t2;
}, Rr = function(e21) {
  return !(!e21.getCTM || e21.parentNode && !e21.ownerSVGElement || !Lr(e21));
}, zr = function(e21, t2) {
  if (t2) {
    var n2 = e21.style, r2;
    t2 in tr && t2 !== wr && (t2 = Cr), n2.removeProperty ? (r2 = t2.substr(0, 2), (r2 === `ms` || t2.substr(0, 6) === `webkit`) && (t2 = `-` + t2), n2.removeProperty(r2 === `--` ? t2 : t2.replace(or, `-$1`).toLowerCase())) : n2.removeAttribute(t2);
  }
}, Br = function(e21, t2, n2, r2, i2, a2) {
  var o2 = new Mn(e21._pt, t2, n2, 0, 1, a2 ? gr : hr);
  return e21._pt = o2, o2.b = r2, o2.e = i2, e21._props.push(n2), o2;
}, Vr = { deg: 1, rad: 1, turn: 1 }, Hr = { grid: 1, flex: 1 }, Ur = function e14(t2, n2, r2, i2) {
  var a2 = parseFloat(r2) || 0, o2 = (r2 + ``).trim().substr((a2 + ``).length) || `px`, s2 = Zn.style, c2 = sr.test(n2), l2 = t2.tagName.toLowerCase() === `svg`, u2 = (l2 ? `client` : `offset`) + (c2 ? `Width` : `Height`), d2 = 100, f2 = i2 === `px`, p2 = i2 === `%`, m2, h2, g2, _2;
  if (i2 === o2 || !a2 || Vr[i2] || Vr[o2]) return a2;
  if (o2 !== `px` && !f2 && (a2 = e14(t2, n2, r2, `px`)), _2 = t2.getCTM && Rr(t2), (p2 || o2 === `%`) && (tr[n2] || ~n2.indexOf(`adius`))) return m2 = _2 ? t2.getBBox()[c2 ? `width` : `height`] : t2[u2], W(p2 ? a2 / m2 * d2 : a2 / 100 * m2);
  if (s2[c2 ? `width` : `height`] = d2 + (f2 ? o2 : i2), h2 = i2 !== `rem` && ~n2.indexOf(`adius`) || i2 === `em` && t2.appendChild && !l2 ? t2 : t2.parentNode, _2 && (h2 = (t2.ownerSVGElement || {}).parentNode), h2 && h2 !== Jn && h2.appendChild || (h2 = Jn.body), g2 = h2._gsap, g2 && p2 && g2.width && c2 && g2.time === Ht.time && !g2.uncache) return W(a2 / g2.width * d2);
  if (p2 && (n2 === `height` || n2 === `width`)) {
    var v2 = t2.style[n2];
    t2.style[n2] = d2 + i2, m2 = t2[u2], v2 ? t2.style[n2] = v2 : zr(t2, n2);
  } else (p2 || o2 === `%`) && !Hr[jr(h2, `display`)] && (s2.position = jr(t2, `position`)), h2 === t2 && (s2.position = `static`), h2.appendChild(Zn), m2 = Zn[u2], h2.removeChild(Zn), s2.position = `absolute`;
  return c2 && p2 && (g2 = ge(h2), g2.time = Ht.time, g2.width = h2[u2]), W(f2 ? m2 * a2 / d2 : m2 && a2 ? d2 / m2 * a2 : 0);
}, Wr = function(e21, t2, n2, r2) {
  var i2;
  return Xn || Pr(), t2 in lr && t2 !== `transform` && (t2 = lr[t2], ~t2.indexOf(`,`) && (t2 = t2.split(`,`)[0])), tr[t2] && t2 !== `transform` ? (i2 = ni(e21, r2), i2 = t2 === `transformOrigin` ? i2.svg ? i2.origin : ri(jr(e21, wr)) + ` ` + i2.zOrigin + `px` : i2[t2]) : (i2 = e21.style[t2], (!i2 || i2 === `auto` || r2 || ~(i2 + ``).indexOf(`calc(`)) && (i2 = Yr[t2] && Yr[t2](e21, t2, n2) || jr(e21, t2) || U(e21, t2) || +(t2 === `opacity`))), n2 && !~(i2 + ``).trim().indexOf(` `) ? Ur(e21, t2, i2, n2) + n2 : i2;
}, Gr = function(e21, t2, r2, i2) {
  if (!r2 || r2 === `none`) {
    var a2 = Nr(t2, e21, 1), o2 = a2 && jr(e21, a2, 1);
    o2 && o2 !== r2 ? (t2 = a2, r2 = o2) : t2 === `borderColor` && (r2 = jr(e21, `borderTopColor`));
  }
  var s2 = new Mn(this._pt, e21.style, t2, 0, 1, En), c2 = 0, l2 = 0, u2, d2, f2, p2, m2, h2, g2, _2, v2, y2, b2, x2;
  if (s2.b = r2, s2.e = i2, r2 += ``, i2 += ``, i2.substring(0, 6) === `var(--` && (i2 = jr(e21, i2.substring(4, i2.indexOf(`)`)))), i2 === `auto` && (h2 = e21.style[t2], e21.style[t2] = i2, i2 = jr(e21, t2) || i2, h2 ? e21.style[t2] = h2 : zr(e21, t2)), u2 = [r2, i2], Bt(u2), r2 = u2[0], i2 = u2[1], f2 = r2.match(k) || [], x2 = i2.match(k) || [], x2.length) {
    for (; d2 = k.exec(i2); ) g2 = d2[0], v2 = i2.substring(c2, d2.index), m2 ? m2 = (m2 + 1) % 5 : (v2.substr(-5) === `rgba(` || v2.substr(-5) === `hsla(`) && (m2 = 1), g2 !== (h2 = f2[l2++] || ``) && (p2 = parseFloat(h2) || 0, b2 = h2.substr((p2 + ``).length), g2.charAt(1) === `=` && (g2 = ye(p2, g2) + b2), _2 = parseFloat(g2), y2 = g2.substr((_2 + ``).length), c2 = k.lastIndex - y2.length, y2 || (y2 = y2 || n.units[t2] || b2, c2 === i2.length && (i2 += y2, s2.e += y2)), b2 !== y2 && (p2 = Ur(e21, t2, h2, y2) || 0), s2._pt = { _next: s2._pt, p: v2 || l2 === 1 ? v2 : `,`, s: p2, c: _2 - p2, m: m2 && m2 < 4 || t2 === `zIndex` ? Math.round : 0 });
    s2.c = c2 < i2.length ? i2.substring(c2, i2.length) : ``;
  } else s2.r = t2 === `display` && i2 === `none` ? gr : hr;
  return j.test(i2) && (s2.e = 0), this._pt = s2, s2;
}, Kr = { top: `0%`, bottom: `100%`, left: `0%`, right: `100%`, center: `50%` }, qr = function(e21) {
  var t2 = e21.split(` `), n2 = t2[0], r2 = t2[1] || `50%`;
  return (n2 === `top` || n2 === `bottom` || r2 === `left` || r2 === `right`) && (e21 = n2, n2 = r2, r2 = e21), t2[0] = Kr[n2] || n2, t2[1] = Kr[r2] || r2, t2.join(` `);
}, Jr = function(e21, t2) {
  if (t2.tween && t2.tween._time === t2.tween._dur) {
    var n2 = t2.t, r2 = n2.style, i2 = t2.u, a2 = n2._gsap, o2, s2, c2;
    if (i2 === `all` || i2 === true) r2.cssText = ``, s2 = 1;
    else for (i2 = i2.split(`,`), c2 = i2.length; --c2 > -1; ) o2 = i2[c2], tr[o2] && (s2 = 1, o2 = o2 === `transformOrigin` ? wr : Cr), zr(n2, o2);
    s2 && (zr(n2, Cr), a2 && (a2.svg && n2.removeAttribute(`transform`), r2.scale = r2.rotate = r2.translate = `none`, ni(n2, 1), a2.uncache = 1, Er(r2)));
  }
}, Yr = { clearProps: function(e21, t2, n2, r2, i2) {
  if (i2.data !== `isFromStart`) {
    var a2 = e21._pt = new Mn(e21._pt, t2, n2, 0, 0, Jr);
    return a2.u = r2, a2.pr = -10, a2.tween = i2, e21._props.push(n2), 1;
  }
} }, Xr = [1, 0, 0, 1, 0, 0], Zr = {}, Qr = function(e21) {
  return e21 === `matrix(1, 0, 0, 1, 0, 0)` || e21 === `none` || !e21;
}, $r = function(e21) {
  var t2 = jr(e21, Cr);
  return Qr(t2) ? Xr : t2.substr(7).match(O).map(W);
}, ei = function(e21, t2) {
  var n2 = e21._gsap || ge(e21), r2 = e21.style, i2 = $r(e21), a2, o2, s2, c2;
  return n2.svg && e21.getAttribute(`transform`) ? (s2 = e21.transform.baseVal.consolidate().matrix, i2 = [s2.a, s2.b, s2.c, s2.d, s2.e, s2.f], i2.join(`,`) === `1,0,0,1,0,0` ? Xr : i2) : (i2 === Xr && !e21.offsetParent && e21 !== Yn && !n2.svg && (s2 = r2.display, r2.display = `block`, a2 = e21.parentNode, a2 && (e21.offsetParent || e21.getBoundingClientRect().width) || (c2 = 1, o2 = e21.nextElementSibling, Yn.appendChild(e21)), i2 = $r(e21), s2 ? r2.display = s2 : zr(e21, `display`), c2 && (o2 ? a2.insertBefore(e21, o2) : a2 ? a2.appendChild(e21) : Yn.removeChild(e21))), t2 && i2.length > 6 ? [i2[0], i2[1], i2[4], i2[5], i2[12], i2[13]] : i2);
}, ti = function(e21, t2, n2, r2, i2, a2) {
  var o2 = e21._gsap, s2 = i2 || ei(e21, true), c2 = o2.xOrigin || 0, l2 = o2.yOrigin || 0, u2 = o2.xOffset || 0, d2 = o2.yOffset || 0, f2 = s2[0], p2 = s2[1], m2 = s2[2], h2 = s2[3], g2 = s2[4], _2 = s2[5], v2 = t2.split(` `), y2 = parseFloat(v2[0]) || 0, b2 = parseFloat(v2[1]) || 0, x2, S2, C2, w2;
  n2 ? s2 !== Xr && (S2 = f2 * h2 - p2 * m2) && (C2 = h2 / S2 * y2 + b2 * (-m2 / S2) + (m2 * _2 - h2 * g2) / S2, w2 = y2 * (-p2 / S2) + f2 / S2 * b2 - (f2 * _2 - p2 * g2) / S2, y2 = C2, b2 = w2) : (x2 = Lr(e21), y2 = x2.x + (~v2[0].indexOf(`%`) ? y2 / 100 * x2.width : y2), b2 = x2.y + (~(v2[1] || v2[0]).indexOf(`%`) ? b2 / 100 * x2.height : b2)), r2 || r2 !== false && o2.smooth ? (g2 = y2 - c2, _2 = b2 - l2, o2.xOffset = u2 + (g2 * f2 + _2 * m2) - g2, o2.yOffset = d2 + (g2 * p2 + _2 * h2) - _2) : o2.xOffset = o2.yOffset = 0, o2.xOrigin = y2, o2.yOrigin = b2, o2.smooth = !!r2, o2.origin = t2, o2.originIsAbsolute = !!n2, e21.style[wr] = `0px 0px`, a2 && (Br(a2, o2, `xOrigin`, c2, y2), Br(a2, o2, `yOrigin`, l2, b2), Br(a2, o2, `xOffset`, u2, o2.xOffset), Br(a2, o2, `yOffset`, d2, o2.yOffset)), e21.setAttribute(`data-svg-origin`, y2 + ` ` + b2);
}, ni = function(e21, t2) {
  var r2 = e21._gsap || new tn(e21);
  if (`x` in r2 && !t2 && !r2.uncache) return r2;
  var i2 = e21.style, a2 = r2.scaleX < 0, o2 = `px`, s2 = `deg`, c2 = getComputedStyle(e21), l2 = jr(e21, wr) || `0`, u2 = d2 = f2 = h2 = g2 = _2 = v2 = y2 = b2 = 0, d2, f2, p2 = m2 = 1, m2, h2, g2, _2, v2, y2, b2, x2, S2, C2, w2, T2, E2, D2, O2, k2, A2, j2, M2, N2, P2, F2, I2, L2, R2, ee2, te2, z2;
  return r2.svg = !!(e21.getCTM && Rr(e21)), c2.translate && ((c2.translate !== `none` || c2.scale !== `none` || c2.rotate !== `none`) && (i2[Cr] = (c2.translate === `none` ? `` : `translate3d(` + (c2.translate + ` 0 0`).split(` `).slice(0, 3).join(`, `) + `) `) + (c2.rotate === `none` ? `` : `rotate(` + c2.rotate + `) `) + (c2.scale === `none` ? `` : `scale(` + c2.scale.split(` `).join(`,`) + `) `) + (c2[Cr] === `none` ? `` : c2[Cr])), i2.scale = i2.rotate = i2.translate = `none`), C2 = ei(e21, r2.svg), r2.svg && (r2.uncache ? (P2 = e21.getBBox(), l2 = r2.xOrigin - P2.x + `px ` + (r2.yOrigin - P2.y) + `px`, N2 = ``) : N2 = !t2 && e21.getAttribute(`data-svg-origin`), ti(e21, N2 || l2, !!N2 || r2.originIsAbsolute, r2.smooth !== false, C2)), x2 = r2.xOrigin || 0, S2 = r2.yOrigin || 0, C2 !== Xr && (D2 = C2[0], O2 = C2[1], k2 = C2[2], A2 = C2[3], u2 = j2 = C2[4], d2 = M2 = C2[5], C2.length === 6 ? (p2 = Math.sqrt(D2 * D2 + O2 * O2), m2 = Math.sqrt(A2 * A2 + k2 * k2), h2 = D2 || O2 ? ir(O2, D2) * nr : 0, v2 = k2 || A2 ? ir(k2, A2) * nr + h2 : 0, v2 && (m2 *= Math.abs(Math.cos(v2 * rr))), r2.svg && (u2 -= x2 - (x2 * D2 + S2 * k2), d2 -= S2 - (x2 * O2 + S2 * A2))) : (z2 = C2[6], ee2 = C2[7], I2 = C2[8], L2 = C2[9], R2 = C2[10], te2 = C2[11], u2 = C2[12], d2 = C2[13], f2 = C2[14], w2 = ir(z2, R2), g2 = w2 * nr, w2 && (T2 = Math.cos(-w2), E2 = Math.sin(-w2), N2 = j2 * T2 + I2 * E2, P2 = M2 * T2 + L2 * E2, F2 = z2 * T2 + R2 * E2, I2 = j2 * -E2 + I2 * T2, L2 = M2 * -E2 + L2 * T2, R2 = z2 * -E2 + R2 * T2, te2 = ee2 * -E2 + te2 * T2, j2 = N2, M2 = P2, z2 = F2), w2 = ir(-k2, R2), _2 = w2 * nr, w2 && (T2 = Math.cos(-w2), E2 = Math.sin(-w2), N2 = D2 * T2 - I2 * E2, P2 = O2 * T2 - L2 * E2, F2 = k2 * T2 - R2 * E2, te2 = A2 * E2 + te2 * T2, D2 = N2, O2 = P2, k2 = F2), w2 = ir(O2, D2), h2 = w2 * nr, w2 && (T2 = Math.cos(w2), E2 = Math.sin(w2), N2 = D2 * T2 + O2 * E2, P2 = j2 * T2 + M2 * E2, O2 = O2 * T2 - D2 * E2, M2 = M2 * T2 - j2 * E2, D2 = N2, j2 = P2), g2 && Math.abs(g2) + Math.abs(h2) > 359.9 && (g2 = h2 = 0, _2 = 180 - _2), p2 = W(Math.sqrt(D2 * D2 + O2 * O2 + k2 * k2)), m2 = W(Math.sqrt(M2 * M2 + z2 * z2)), w2 = ir(j2, M2), v2 = Math.abs(w2) > 2e-4 ? w2 * nr : 0, b2 = te2 ? 1 / (te2 < 0 ? -te2 : te2) : 0), r2.svg && (N2 = e21.getAttribute(`transform`), r2.forceCSS = e21.setAttribute(`transform`, ``) || !Qr(jr(e21, Cr)), N2 && e21.setAttribute(`transform`, N2))), Math.abs(v2) > 90 && Math.abs(v2) < 270 && (a2 ? (p2 *= -1, v2 += h2 <= 0 ? 180 : -180, h2 += h2 <= 0 ? 180 : -180) : (m2 *= -1, v2 += v2 <= 0 ? 180 : -180)), t2 = t2 || r2.uncache, r2.x = u2 - ((r2.xPercent = u2 && (!t2 && r2.xPercent || (Math.round(e21.offsetWidth / 2) === Math.round(-u2) ? -50 : 0))) ? e21.offsetWidth * r2.xPercent / 100 : 0) + o2, r2.y = d2 - ((r2.yPercent = d2 && (!t2 && r2.yPercent || (Math.round(e21.offsetHeight / 2) === Math.round(-d2) ? -50 : 0))) ? e21.offsetHeight * r2.yPercent / 100 : 0) + o2, r2.z = f2 + o2, r2.scaleX = W(p2), r2.scaleY = W(m2), r2.rotation = W(h2) + s2, r2.rotationX = W(g2) + s2, r2.rotationY = W(_2) + s2, r2.skewX = v2 + s2, r2.skewY = y2 + s2, r2.transformPerspective = b2 + o2, (r2.zOrigin = parseFloat(l2.split(` `)[2]) || !t2 && r2.zOrigin || 0) && (i2[wr] = ri(l2)), r2.xOffset = r2.yOffset = 0, r2.force3D = n.force3D, r2.renderTransform = r2.svg ? ui : kr ? li : ai, r2.uncache = 0, r2;
}, ri = function(e21) {
  return (e21 = e21.split(` `))[0] + ` ` + e21[1];
}, ii = function(e21, t2, n2) {
  var r2 = at(t2);
  return W(parseFloat(t2) + parseFloat(Ur(e21, `x`, n2 + `px`, r2))) + r2;
}, ai = function(e21, t2) {
  t2.z = `0px`, t2.rotationY = t2.rotationX = `0deg`, t2.force3D = 0, li(e21, t2);
}, oi = `0deg`, si = `0px`, ci = `) `, li = function(e21, t2) {
  var n2 = t2 || this, r2 = n2.xPercent, i2 = n2.yPercent, a2 = n2.x, o2 = n2.y, s2 = n2.z, c2 = n2.rotation, l2 = n2.rotationY, u2 = n2.rotationX, d2 = n2.skewX, f2 = n2.skewY, p2 = n2.scaleX, m2 = n2.scaleY, h2 = n2.transformPerspective, g2 = n2.force3D, _2 = n2.target, v2 = n2.zOrigin, y2 = ``, b2 = g2 === `auto` && e21 && e21 !== 1 || g2 === true;
  if (v2 && (u2 !== oi || l2 !== oi)) {
    var x2 = parseFloat(l2) * rr, S2 = Math.sin(x2), C2 = Math.cos(x2), w2;
    x2 = parseFloat(u2) * rr, w2 = Math.cos(x2), a2 = ii(_2, a2, S2 * w2 * -v2), o2 = ii(_2, o2, -Math.sin(x2) * -v2), s2 = ii(_2, s2, C2 * w2 * -v2 + v2);
  }
  h2 !== si && (y2 += `perspective(` + h2 + ci), (r2 || i2) && (y2 += `translate(` + r2 + `%, ` + i2 + `%) `), (b2 || a2 !== si || o2 !== si || s2 !== si) && (y2 += s2 !== si || b2 ? `translate3d(` + a2 + `, ` + o2 + `, ` + s2 + `) ` : `translate(` + a2 + `, ` + o2 + ci), c2 !== oi && (y2 += `rotate(` + c2 + ci), l2 !== oi && (y2 += `rotateY(` + l2 + ci), u2 !== oi && (y2 += `rotateX(` + u2 + ci), (d2 !== oi || f2 !== oi) && (y2 += `skew(` + d2 + `, ` + f2 + ci), (p2 !== 1 || m2 !== 1) && (y2 += `scale(` + p2 + `, ` + m2 + ci), _2.style[Cr] = y2 || `translate(0, 0)`;
}, ui = function(e21, t2) {
  var n2 = t2 || this, r2 = n2.xPercent, i2 = n2.yPercent, a2 = n2.x, o2 = n2.y, s2 = n2.rotation, c2 = n2.skewX, l2 = n2.skewY, u2 = n2.scaleX, d2 = n2.scaleY, f2 = n2.target, p2 = n2.xOrigin, m2 = n2.yOrigin, h2 = n2.xOffset, g2 = n2.yOffset, _2 = n2.forceCSS, v2 = parseFloat(a2), y2 = parseFloat(o2), b2, x2, S2, C2, w2;
  s2 = parseFloat(s2), c2 = parseFloat(c2), l2 = parseFloat(l2), l2 && (l2 = parseFloat(l2), c2 += l2, s2 += l2), s2 || c2 ? (s2 *= rr, c2 *= rr, b2 = Math.cos(s2) * u2, x2 = Math.sin(s2) * u2, S2 = Math.sin(s2 - c2) * -d2, C2 = Math.cos(s2 - c2) * d2, c2 && (l2 *= rr, w2 = Math.tan(c2 - l2), w2 = Math.sqrt(1 + w2 * w2), S2 *= w2, C2 *= w2, l2 && (w2 = Math.tan(l2), w2 = Math.sqrt(1 + w2 * w2), b2 *= w2, x2 *= w2)), b2 = W(b2), x2 = W(x2), S2 = W(S2), C2 = W(C2)) : (b2 = u2, C2 = d2, x2 = S2 = 0), (v2 && !~(a2 + ``).indexOf(`px`) || y2 && !~(o2 + ``).indexOf(`px`)) && (v2 = Ur(f2, `x`, a2, `px`), y2 = Ur(f2, `y`, o2, `px`)), (p2 || m2 || h2 || g2) && (v2 = W(v2 + p2 - (p2 * b2 + m2 * S2) + h2), y2 = W(y2 + m2 - (p2 * x2 + m2 * C2) + g2)), (r2 || i2) && (w2 = f2.getBBox(), v2 = W(v2 + r2 / 100 * w2.width), y2 = W(y2 + i2 / 100 * w2.height)), w2 = `matrix(` + b2 + `,` + x2 + `,` + S2 + `,` + C2 + `,` + v2 + `,` + y2 + `)`, f2.setAttribute(`transform`, w2), _2 && (f2.style[Cr] = w2);
}, di = function(e21, t2, n2, r2, i2) {
  var a2 = 360, o2 = h(i2), s2 = parseFloat(i2) * (o2 && ~i2.indexOf(`rad`) ? nr : 1) - r2, c2 = r2 + s2 + `deg`, l2, u2;
  return o2 && (l2 = i2.split(`_`)[1], l2 === `short` && (s2 %= a2, s2 !== s2 % (a2 / 2) && (s2 += s2 < 0 ? a2 : -a2)), l2 === `cw` && s2 < 0 ? s2 = (s2 + a2 * ar) % a2 - ~~(s2 / a2) * a2 : l2 === `ccw` && s2 > 0 && (s2 = (s2 - a2 * ar) % a2 - ~~(s2 / a2) * a2)), e21._pt = u2 = new Mn(e21._pt, t2, n2, r2, s2, dr), u2.e = c2, u2.u = `deg`, e21._props.push(n2), u2;
}, fi = function(e21, t2) {
  for (var n2 in t2) e21[n2] = t2[n2];
  return e21;
}, pi = function(e21, t2, n2) {
  var r2 = fi({}, n2._gsap), i2 = `perspective,force3D,transformOrigin,svgOrigin`, a2 = n2.style, o2, s2, c2, l2, u2, d2, f2, p2;
  for (s2 in r2.svg ? (c2 = n2.getAttribute(`transform`), n2.setAttribute(`transform`, ``), a2[Cr] = t2, o2 = ni(n2, 1), zr(n2, Cr), n2.setAttribute(`transform`, c2)) : (c2 = getComputedStyle(n2)[Cr], a2[Cr] = t2, o2 = ni(n2, 1), a2[Cr] = c2), tr) c2 = r2[s2], l2 = o2[s2], c2 !== l2 && i2.indexOf(s2) < 0 && (f2 = at(c2), p2 = at(l2), u2 = f2 === p2 ? parseFloat(c2) : Ur(n2, s2, c2, p2), d2 = parseFloat(l2), e21._pt = new Mn(e21._pt, o2, s2, u2, d2 - u2, ur), e21._pt.u = p2 || 0, e21._props.push(s2));
  fi(o2, r2);
};
_e(`padding,margin,Width,Radius`, function(e21, t2) {
  var n2 = `Top`, r2 = `Right`, i2 = `Bottom`, a2 = `Left`, o2 = (t2 < 3 ? [n2, r2, i2, a2] : [n2 + a2, n2 + r2, i2 + r2, i2 + a2]).map(function(n3) {
    return t2 < 2 ? e21 + n3 : `border` + n3 + e21;
  });
  Yr[t2 > 1 ? `border` + e21 : e21] = function(e22, t3, n3, r3, i3) {
    var a3, s2;
    if (arguments.length < 4) return a3 = o2.map(function(t4) {
      return Wr(e22, t4, n3);
    }), s2 = a3.join(` `), s2.split(a3[0]).length === 5 ? a3[0] : s2;
    a3 = (r3 + ``).split(` `), s2 = {}, o2.forEach(function(e23, t4) {
      return s2[e23] = a3[t4] = a3[t4] || a3[(t4 - 1) / 2 | 0];
    }), e22.init(t3, s2, i3);
  };
});
var mi = { name: `css`, register: Pr, targetTest: function(e21) {
  return e21.style && e21.nodeType;
}, init: function(e21, t2, r2, i2, a2) {
  var o2 = this._props, s2 = e21.style, c2 = r2.vars.startAt, l2, u2, d2, f2, p2, m2, g2, _2, v2, y2, b2, x2, S2, C2, w2, T2, E2;
  for (g2 in Xn || Pr(), this.styles = this.styles || Or(e21), T2 = this.styles.props, this.tween = r2, t2) if (g2 !== `autoRound` && (u2 = t2[g2], !(ue[g2] && cn(g2, t2, r2, i2, e21, a2)))) {
    if (p2 = typeof u2, m2 = Yr[g2], p2 === `function` && (u2 = u2.call(r2, i2, e21, a2), p2 = typeof u2), p2 === `string` && ~u2.indexOf(`random(`) && (u2 = Ct(u2)), m2) m2(this, e21, g2, u2, r2) && (w2 = 1);
    else if (g2.substr(0, 2) === `--`) l2 = (getComputedStyle(e21).getPropertyValue(g2) + ``).trim(), u2 += ``, Rt.lastIndex = 0, Rt.test(l2) || (_2 = at(l2), v2 = at(u2), v2 ? _2 !== v2 && (l2 = Ur(e21, g2, l2, v2) + v2) : _2 && (u2 += _2)), this.add(s2, `setProperty`, l2, u2, i2, a2, 0, 0, g2), o2.push(g2), T2.push(g2, 0, s2[g2]);
    else if (p2 !== `undefined`) {
      if (c2 && g2 in c2 ? (l2 = typeof c2[g2] == `function` ? c2[g2].call(r2, i2, e21, a2) : c2[g2], h(l2) && ~l2.indexOf(`random(`) && (l2 = Ct(l2)), at(l2 + ``) || l2 === `auto` || (l2 += n.units[g2] || at(Wr(e21, g2)) || ``), (l2 + ``).charAt(1) === `=` && (l2 = Wr(e21, g2))) : l2 = Wr(e21, g2), f2 = parseFloat(l2), y2 = p2 === `string` && u2.charAt(1) === `=` && u2.substr(0, 2), y2 && (u2 = u2.substr(2)), d2 = parseFloat(u2), g2 in lr && (g2 === `autoAlpha` && (f2 === 1 && Wr(e21, `visibility`) === `hidden` && d2 && (f2 = 0), T2.push(`visibility`, 0, s2.visibility), Br(this, s2, `visibility`, f2 ? `inherit` : `hidden`, d2 ? `inherit` : `hidden`, !d2)), g2 !== `scale` && g2 !== `transform` && (g2 = lr[g2], ~g2.indexOf(`,`) && (g2 = g2.split(`,`)[0]))), b2 = g2 in tr, b2) {
        if (this.styles.save(g2), E2 = u2, p2 === `string` && u2.substring(0, 6) === `var(--`) {
          if (u2 = jr(e21, u2.substring(4, u2.indexOf(`)`))), u2.substring(0, 5) === `calc(`) {
            var D2 = e21.style.perspective;
            e21.style.perspective = u2, u2 = jr(e21, `perspective`), D2 ? e21.style.perspective = D2 : zr(e21, `perspective`);
          }
          d2 = parseFloat(u2);
        }
        if (x2 || (S2 = e21._gsap, S2.renderTransform && !t2.parseTransform || ni(e21, t2.parseTransform), C2 = t2.smoothOrigin !== false && S2.smooth, x2 = this._pt = new Mn(this._pt, s2, Cr, 0, 1, S2.renderTransform, S2, 0, -1), x2.dep = 1), g2 === `scale`) this._pt = new Mn(this._pt, S2, `scaleY`, S2.scaleY, (y2 ? ye(S2.scaleY, y2 + d2) : d2) - S2.scaleY || 0, ur), this._pt.u = 0, o2.push(`scaleY`, g2), g2 += `X`;
        else if (g2 === `transformOrigin`) {
          T2.push(wr, 0, s2[wr]), u2 = qr(u2), S2.svg ? ti(e21, u2, 0, C2, 0, this) : (v2 = parseFloat(u2.split(` `)[2]) || 0, v2 !== S2.zOrigin && Br(this, S2, `zOrigin`, S2.zOrigin, v2), Br(this, s2, g2, ri(l2), ri(u2)));
          continue;
        } else if (g2 === `svgOrigin`) {
          ti(e21, u2, 1, C2, 0, this);
          continue;
        } else if (g2 in Zr) {
          di(this, S2, g2, f2, y2 ? ye(f2, y2 + u2) : u2);
          continue;
        } else if (g2 === `smoothOrigin`) {
          Br(this, S2, `smooth`, S2.smooth, u2);
          continue;
        } else if (g2 === `force3D`) {
          S2[g2] = u2;
          continue;
        } else if (g2 === `transform`) {
          pi(this, u2, e21);
          continue;
        }
      } else g2 in s2 || (g2 = Nr(g2) || g2);
      if (b2 || (d2 || d2 === 0) && (f2 || f2 === 0) && !cr.test(u2) && g2 in s2) _2 = (l2 + ``).substr((f2 + ``).length), d2 || (d2 = 0), v2 = at(u2) || (g2 in n.units ? n.units[g2] : _2), _2 !== v2 && (f2 = Ur(e21, g2, l2, v2)), this._pt = new Mn(this._pt, b2 ? S2 : s2, g2, f2, (y2 ? ye(f2, y2 + d2) : d2) - f2, !b2 && (v2 === `px` || g2 === `zIndex`) && t2.autoRound !== false ? mr : ur), this._pt.u = v2 || 0, b2 && E2 !== u2 ? (this._pt.b = l2, this._pt.e = E2, this._pt.r = pr) : _2 !== v2 && v2 !== `%` && (this._pt.b = l2, this._pt.r = fr);
      else if (g2 in s2) Gr.call(this, e21, g2, l2, y2 ? y2 + u2 : u2);
      else if (g2 in e21) this.add(e21, g2, l2 || e21[g2], y2 ? y2 + u2 : u2, i2, a2);
      else if (g2 !== `parseTransform`) {
        ne(g2, u2);
        continue;
      }
      b2 || (g2 in s2 ? T2.push(g2, 0, s2[g2]) : typeof e21[g2] == `function` ? T2.push(g2, 2, e21[g2]()) : T2.push(g2, 1, l2 || e21[g2])), o2.push(g2);
    }
  }
  w2 && jn(this);
}, render: function(e21, t2) {
  if (t2.tween._time || !$n()) for (var n2 = t2._pt; n2; ) n2.r(e21, n2.d), n2 = n2._next;
  else t2.styles.revert();
}, get: Wr, aliases: lr, getSetter: function(e21, t2, n2) {
  var r2 = lr[t2];
  return r2 && r2.indexOf(`,`) < 0 && (t2 = r2), t2 in tr && t2 !== wr && (e21._gsap.x || Wr(e21, `x`)) ? n2 && Qn === n2 ? t2 === `scale` ? br : yr : (Qn = n2 || {}) && (t2 === `scale` ? xr : Sr) : e21.style && !v(e21.style[t2]) ? _r : ~t2.indexOf(`-`) ? vr : Cn(e21, t2);
}, core: { _removeProperty: zr, _getMatrix: ei } };
Kn.utils.checkPrefix = Nr, Kn.core.getStyleSaver = Or, (function(e21, t2, r2, i2) {
  var a2 = _e(e21 + `,` + t2 + `,` + r2, function(e22) {
    tr[e22] = 1;
  });
  _e(t2, function(e22) {
    n.units[e22] = `deg`, Zr[e22] = 1;
  }), lr[a2[13]] = e21 + `,` + t2, _e(i2, function(e22) {
    var t3 = e22.split(`:`);
    lr[t3[1]] = a2[t3[0]];
  });
})(`x,y,z,scale,scaleX,scaleY,xPercent,yPercent`, `rotation,rotationX,rotationY,skewX,skewY`, `transform,transformOrigin,svgOrigin,force3D,smoothOrigin,transformPerspective`, `0:translateX,1:translateY,2:translateZ,8:rotate,8:rotationZ,8:rotateZ,9:rotateX,10:rotateY`), _e(`x,y,z,top,right,bottom,left,width,height,fontSize,padding,margin,perspective`, function(e21) {
  n.units[e21] = `px`;
}), Kn.registerPlugin(mi);
var hi = Kn.registerPlugin(mi) || Kn;
hi.core.Tween;
/* ---- Site Builder additions -------------------------------------------------
   The builder swaps <img> elements and re-colours the site. So the GL scenes read
   each photo from the <img> on the page (not from data attributes), use the
   template's own depth map only for the template's own photos, make a soft depth
   map for any other photo, and take their colours from the CSS theme. */
var sdCache = {};
function sdColor(prop) {
  if (prop in sdCache) return sdCache[prop];
  let out = null;
  try {
    let p = document.createElement(`span`);
    p.style.cssText = `position:absolute;visibility:hidden;color:var(${prop})`;
    document.body.appendChild(p);
    let c = getComputedStyle(p).color;
    p.remove();
    let cv = document.createElement(`canvas`);
    cv.width = cv.height = 1;
    let x = cv.getContext(`2d`);
    x.fillStyle = `#000`, x.fillStyle = c, x.fillRect(0, 0, 1, 1);
    let d = x.getImageData(0, 0, 1, 1).data;
    out = [d[0], d[1], d[2]];
  } catch {
  }
  return sdCache[prop] = out;
}
function sdCss(prop, fb) {
  let c = sdColor(prop);
  return c ? `rgb(${c[0]},${c[1]},${c[2]})` : fb;
}
function sdRGB(prop, fb) {
  let c = sdColor(prop);
  return c ? [c[0] / 255, c[1] / 255, c[2] / 255] : fb;
}
function sdSrc(el) {
  let i = el.tagName === `IMG` ? el : el.querySelector(`img`);
  return i ? i.currentSrc || i.src : el.dataset.src || ``;
}
function sdText(el, sel) {
  let n = el.querySelector(sel);
  return n ? n.textContent.trim().replace(/\s+/g, ` `) : ``;
}
function sdCors(img, src) {
  try {
    new URL(src, location.href).origin !== location.origin && (img.crossOrigin = `anonymous`);
  } catch {
  }
}
// The template ships a depth map beside each of its own photos: media/x/name.webp -> name-depth.webp.
function sdDepthUrl(src) {
  try {
    let u = new URL(src, location.href);
    if (u.origin !== location.origin || !/\/media\/.+\.webp$/i.test(u.pathname) || /-depth\.webp$/i.test(u.pathname)) return null;
    return u.origin + u.pathname.replace(/\.webp$/i, `-depth.webp`);
  } catch {
    return null;
  }
}
// A stand-in depth map for a photo that has none: far at the top, near at the bottom,
// a little nearer in the middle, with the photo's own light and shade for relief.
function sdFakeDepth(img) {
  let c = document.createElement(`canvas`);
  c.width = c.height = 96;
  let x = c.getContext(`2d`), g = x.createLinearGradient(0, 0, 0, 96);
  g.addColorStop(0, `#404040`), g.addColorStop(1, `#a8a8a8`), x.fillStyle = g, x.fillRect(0, 0, 96, 96);
  let r = x.createRadialGradient(48, 56, 6, 48, 56, 70);
  r.addColorStop(0, `rgba(255,255,255,0.22)`), r.addColorStop(1, `rgba(255,255,255,0)`), x.fillStyle = r, x.fillRect(0, 0, 96, 96);
  try {
    x.globalAlpha = 0.3, x.filter = `grayscale(1) blur(5px)`, x.drawImage(img, 0, 0, 96, 96);
  } catch {
  }
  return c;
}
function gi() {
  let e21 = matchMedia(`(prefers-reduced-motion: reduce)`).matches, t2 = matchMedia(`(pointer: coarse)`).matches, n2 = navigator.connection || {}, r2 = !!n2.saveData, i2 = /(^|[^3-5])2g/.test(n2.effectiveType || ``), a2 = navigator.deviceMemory || 8, o2 = navigator.hardwareConcurrency || 4, s2 = `unknown`, c2 = false;
  try {
    let e22 = document.createElement(`canvas`), t3 = e22.getContext(`webgl2`) || e22.getContext(`webgl`);
    if (t3) {
      c2 = true;
      let e23 = t3.getExtension(`WEBGL_debug_renderer_info`);
      s2 = e23 ? t3.getParameter(e23.UNMASKED_RENDERER_WEBGL) : t3.getParameter(t3.RENDERER), t3.getExtension(`WEBGL_lose_context`)?.loseContext();
    }
  } catch {
  }
  let l2 = /SwiftShader|llvmpipe|Software|Microsoft Basic Render/i.test(s2), u2 = /Intel.*\b(HD|UHD|Iris)\b|Mali-[GT]?[1-6]\d\b|Adreno \(TM\) [1-5]\d\d|Apple A(8|9|10)\b/i.test(s2), d2 = 2;
  e21 || r2 || i2 || !c2 || l2 ? d2 = 0 : (t2 || a2 <= 3 || o2 <= 2) && (d2 = 1);
  let f2 = d2 === 2 ? Math.min(window.devicePixelRatio || 1, u2 ? 1 : 1.5) : 1;
  return { level: d2, gpu: s2, weakGpu: u2, coarse: t2, reduced: e21, dpr: f2, scrub: d2 === 2, dust: d2 === 2, grain: d2 >= 1 };
}
function _i(e21, t2) {
  let n2 = 0, r2 = performance.now(), i2 = [], a2 = [], o2 = (e22, o3) => {
    if (document.hidden) return;
    let s2 = performance.now();
    for (a2.push(s2); a2.length && s2 - a2[0] > 1e3; ) a2.shift();
    if (s2 - r2 < 5e3 || o3 > 120 || o3 <= 0 || a2.length < 20 || (i2.push(o3), i2.length < 150)) return;
    i2.splice(0, i2.length - 150);
    let c2 = i2.slice().sort((e23, t3) => e23 - t3), l2 = c2[c2.length >> 1], u2 = c2[Math.floor(c2.length * 0.9)], d2 = n2 === 0 ? 34 : 68;
    l2 > d2 && u2 > d2 * 1.2 && n2 < 2 && (n2++, i2.length = 0, r2 = s2, t2(n2, { median: Math.round(l2), p90: Math.round(u2) }));
  };
  return e21.add(o2), () => e21.remove(o2);
}
function vi({ el: e21, tier: t2 }) {
  let n2 = e21 ? e21.querySelector(`.hero__video`) : null, r2 = { el: e21, video: n2, tier: t2, ready: false, mode: `idle`, progress: 0, target: 0, duration: 7.2, scrubbed: false, dipAt: -1e9, setProgress() {
  }, tick() {
  } };
  if (t2.level === 0 || !n2) return r2;
  if (t2.scrub) n2.src = n2.dataset.scrub, n2.loop = false;
  else {
    let r3 = document.createElement(`source`);
    r3.src = n2.dataset.loopMp4, r3.type = `video/mp4`, n2.append(r3), n2.loop = true;
  }
  n2.preload = `auto`, n2.load();
  let i2 = () => {
    r2.ready || (r2.ready = true, isFinite(n2.duration) && n2.duration > 0 && (r2.duration = n2.duration), e21.classList.add(`is-video`), r2.mode === `idle` && (n2.playbackRate = t2.scrub ? 0.85 : 1, n2.play().catch(() => {
    }), r2.mode = `play`));
  };
  return n2.addEventListener(`canplaythrough`, i2, { once: true }), n2.addEventListener(`loadeddata`, () => setTimeout(i2, 1200), { once: true }), new IntersectionObserver((e22) => e22.forEach((e23) => {
    r2.ready && (e23.isIntersecting ? r2.mode === `play` && n2.paused && n2.play().catch(() => {
    }) : n2.paused || n2.pause());
  }), { threshold: 0 }).observe(e21), t2.scrub ? (n2.addEventListener(`ended`, () => {
    r2.mode === `play` && (r2.dipAt = performance.now(), setTimeout(() => {
      r2.mode === `play` && (n2.currentTime = 0, n2.play().catch(() => {
      }));
    }, 330));
  }), r2.setProgress = (e22) => {
    if (r2.progress = e22, e22 > 4e-3 && !r2.scrubbed && (r2.scrubbed = true, r2.mode = `scrub`, n2.pause(), r2.anchorP = e22, r2.anchorT = Math.min(n2.currentTime || 0, r2.duration * 0.6)), !r2.scrubbed) {
      r2.target = e22 * r2.duration;
      return;
    }
    let t3 = r2.anchorP, i3 = r2.anchorT, a2 = r2.duration - 0.04;
    r2.target = e22 <= t3 ? t3 > 0 ? e22 / t3 * i3 : 0 : i3 + (e22 - t3) / (1 - t3) * (a2 - i3);
  }, r2.lastSeek = 0, r2.tick = () => {
    if (r2.mode !== `scrub` || !r2.ready || n2.seeking) return;
    let e22 = performance.now();
    if (e22 - r2.lastSeek < 42) return;
    let t3 = n2.currentTime, i3 = r2.target - t3;
    if (Math.abs(i3) < 0.03) return;
    let a2 = Math.abs(i3) > 1.5 ? 0.3 : 0.4, o2 = Math.max(0, Math.min(r2.duration - 0.04, t3 + i3 * a2));
    r2.lastSeek = e22, n2.currentTime = o2;
  }) : r2.setProgress = (e22) => {
    r2.progress = e22;
  }, r2;
}
function yi(e21) {
  let t2 = e21[0], n2 = e21[1], r2 = e21[2];
  return Math.sqrt(t2 * t2 + n2 * n2 + r2 * r2);
}
function bi(e21, t2) {
  return e21[0] = t2[0], e21[1] = t2[1], e21[2] = t2[2], e21;
}
function xi(e21, t2, n2, r2) {
  return e21[0] = t2, e21[1] = n2, e21[2] = r2, e21;
}
function Si(e21, t2, n2) {
  return e21[0] = t2[0] + n2[0], e21[1] = t2[1] + n2[1], e21[2] = t2[2] + n2[2], e21;
}
function Ci(e21, t2, n2) {
  return e21[0] = t2[0] - n2[0], e21[1] = t2[1] - n2[1], e21[2] = t2[2] - n2[2], e21;
}
function wi(e21, t2, n2) {
  return e21[0] = t2[0] * n2[0], e21[1] = t2[1] * n2[1], e21[2] = t2[2] * n2[2], e21;
}
function Ti(e21, t2, n2) {
  return e21[0] = t2[0] / n2[0], e21[1] = t2[1] / n2[1], e21[2] = t2[2] / n2[2], e21;
}
function Ei(e21, t2, n2) {
  return e21[0] = t2[0] * n2, e21[1] = t2[1] * n2, e21[2] = t2[2] * n2, e21;
}
function Di(e21, t2) {
  let n2 = t2[0] - e21[0], r2 = t2[1] - e21[1], i2 = t2[2] - e21[2];
  return Math.sqrt(n2 * n2 + r2 * r2 + i2 * i2);
}
function Oi(e21, t2) {
  let n2 = t2[0] - e21[0], r2 = t2[1] - e21[1], i2 = t2[2] - e21[2];
  return n2 * n2 + r2 * r2 + i2 * i2;
}
function ki(e21) {
  let t2 = e21[0], n2 = e21[1], r2 = e21[2];
  return t2 * t2 + n2 * n2 + r2 * r2;
}
function Ai(e21, t2) {
  return e21[0] = -t2[0], e21[1] = -t2[1], e21[2] = -t2[2], e21;
}
function ji(e21, t2) {
  return e21[0] = 1 / t2[0], e21[1] = 1 / t2[1], e21[2] = 1 / t2[2], e21;
}
function Mi(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = n2 * n2 + r2 * r2 + i2 * i2;
  return a2 > 0 && (a2 = 1 / Math.sqrt(a2)), e21[0] = t2[0] * a2, e21[1] = t2[1] * a2, e21[2] = t2[2] * a2, e21;
}
function Ni(e21, t2) {
  return e21[0] * t2[0] + e21[1] * t2[1] + e21[2] * t2[2];
}
function Pi(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = n2[0], s2 = n2[1], c2 = n2[2];
  return e21[0] = i2 * c2 - a2 * s2, e21[1] = a2 * o2 - r2 * c2, e21[2] = r2 * s2 - i2 * o2, e21;
}
function Fi(e21, t2, n2, r2) {
  let i2 = t2[0], a2 = t2[1], o2 = t2[2];
  return e21[0] = i2 + r2 * (n2[0] - i2), e21[1] = a2 + r2 * (n2[1] - a2), e21[2] = o2 + r2 * (n2[2] - o2), e21;
}
function Ii(e21, t2, n2, r2, i2) {
  let a2 = Math.exp(-r2 * i2), o2 = t2[0], s2 = t2[1], c2 = t2[2];
  return e21[0] = n2[0] + (o2 - n2[0]) * a2, e21[1] = n2[1] + (s2 - n2[1]) * a2, e21[2] = n2[2] + (c2 - n2[2]) * a2, e21;
}
function Li(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = n2[3] * r2 + n2[7] * i2 + n2[11] * a2 + n2[15];
  return o2 = o2 || 1, e21[0] = (n2[0] * r2 + n2[4] * i2 + n2[8] * a2 + n2[12]) / o2, e21[1] = (n2[1] * r2 + n2[5] * i2 + n2[9] * a2 + n2[13]) / o2, e21[2] = (n2[2] * r2 + n2[6] * i2 + n2[10] * a2 + n2[14]) / o2, e21;
}
function Ri(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = n2[3] * r2 + n2[7] * i2 + n2[11] * a2 + n2[15];
  return o2 = o2 || 1, e21[0] = (n2[0] * r2 + n2[4] * i2 + n2[8] * a2) / o2, e21[1] = (n2[1] * r2 + n2[5] * i2 + n2[9] * a2) / o2, e21[2] = (n2[2] * r2 + n2[6] * i2 + n2[10] * a2) / o2, e21;
}
function zi(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2];
  return e21[0] = r2 * n2[0] + i2 * n2[3] + a2 * n2[6], e21[1] = r2 * n2[1] + i2 * n2[4] + a2 * n2[7], e21[2] = r2 * n2[2] + i2 * n2[5] + a2 * n2[8], e21;
}
function Bi(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = n2[0], s2 = n2[1], c2 = n2[2], l2 = n2[3], u2 = s2 * a2 - c2 * i2, d2 = c2 * r2 - o2 * a2, f2 = o2 * i2 - s2 * r2, p2 = s2 * f2 - c2 * d2, m2 = c2 * u2 - o2 * f2, h2 = o2 * d2 - s2 * u2, g2 = l2 * 2;
  return u2 *= g2, d2 *= g2, f2 *= g2, p2 *= 2, m2 *= 2, h2 *= 2, e21[0] = r2 + u2 + p2, e21[1] = i2 + d2 + m2, e21[2] = a2 + f2 + h2, e21;
}
var Vi = /* @__PURE__ */ (function() {
  let e21 = [0, 0, 0], t2 = [0, 0, 0];
  return function(n2, r2) {
    bi(e21, n2), bi(t2, r2), Mi(e21, e21), Mi(t2, t2);
    let i2 = Ni(e21, t2);
    return i2 > 1 ? 0 : i2 < -1 ? Math.PI : Math.acos(i2);
  };
})();
function Hi(e21, t2) {
  return e21[0] === t2[0] && e21[1] === t2[1] && e21[2] === t2[2];
}
var Ui = class e15 extends Array {
  constructor(e21 = 0, t2 = e21, n2 = e21) {
    return super(e21, t2, n2), this;
  }
  get x() {
    return this[0];
  }
  get y() {
    return this[1];
  }
  get z() {
    return this[2];
  }
  set x(e21) {
    this[0] = e21;
  }
  set y(e21) {
    this[1] = e21;
  }
  set z(e21) {
    this[2] = e21;
  }
  set(e21, t2 = e21, n2 = e21) {
    return e21.length ? this.copy(e21) : (xi(this, e21, t2, n2), this);
  }
  copy(e21) {
    return bi(this, e21), this;
  }
  add(e21, t2) {
    return t2 ? Si(this, e21, t2) : Si(this, this, e21), this;
  }
  sub(e21, t2) {
    return t2 ? Ci(this, e21, t2) : Ci(this, this, e21), this;
  }
  multiply(e21) {
    return e21.length ? wi(this, this, e21) : Ei(this, this, e21), this;
  }
  divide(e21) {
    return e21.length ? Ti(this, this, e21) : Ei(this, this, 1 / e21), this;
  }
  inverse(e21 = this) {
    return ji(this, e21), this;
  }
  len() {
    return yi(this);
  }
  distance(e21) {
    return e21 ? Di(this, e21) : yi(this);
  }
  squaredLen() {
    return ki(this);
  }
  squaredDistance(e21) {
    return e21 ? Oi(this, e21) : ki(this);
  }
  negate(e21 = this) {
    return Ai(this, e21), this;
  }
  cross(e21, t2) {
    return t2 ? Pi(this, e21, t2) : Pi(this, this, e21), this;
  }
  scale(e21) {
    return Ei(this, this, e21), this;
  }
  normalize() {
    return Mi(this, this), this;
  }
  dot(e21) {
    return Ni(this, e21);
  }
  equals(e21) {
    return Hi(this, e21);
  }
  applyMatrix3(e21) {
    return zi(this, this, e21), this;
  }
  applyMatrix4(e21) {
    return Li(this, this, e21), this;
  }
  scaleRotateMatrix4(e21) {
    return Ri(this, this, e21), this;
  }
  applyQuaternion(e21) {
    return Bi(this, this, e21), this;
  }
  angle(e21) {
    return Vi(this, e21);
  }
  lerp(e21, t2) {
    return Fi(this, this, e21, t2), this;
  }
  smoothLerp(e21, t2, n2) {
    return Ii(this, this, e21, t2, n2), this;
  }
  clone() {
    return new e15(this[0], this[1], this[2]);
  }
  fromArray(e21, t2 = 0) {
    return this[0] = e21[t2], this[1] = e21[t2 + 1], this[2] = e21[t2 + 2], this;
  }
  toArray(e21 = [], t2 = 0) {
    return e21[t2] = this[0], e21[t2 + 1] = this[1], e21[t2 + 2] = this[2], e21;
  }
  transformDirection(e21) {
    let t2 = this[0], n2 = this[1], r2 = this[2];
    return this[0] = e21[0] * t2 + e21[4] * n2 + e21[8] * r2, this[1] = e21[1] * t2 + e21[5] * n2 + e21[9] * r2, this[2] = e21[2] * t2 + e21[6] * n2 + e21[10] * r2, this.normalize();
  }
}, Wi = new Ui(), Gi = 1, Ki = 1, qi = false, Ji = class {
  constructor(e21, t2 = {}) {
    e21.canvas || console.error(`gl not passed as first argument to Geometry`), this.gl = e21, this.attributes = t2, this.id = Gi++, this.VAOs = {}, this.drawRange = { start: 0, count: 0 }, this.instancedCount = 0, this.gl.renderer.bindVertexArray(null), this.gl.renderer.currentGeometry = null, this.glState = this.gl.renderer.state;
    for (let e22 in t2) this.addAttribute(e22, t2[e22]);
  }
  addAttribute(e21, t2) {
    if (this.attributes[e21] = t2, t2.id = Ki++, t2.size = t2.size || 1, t2.type = t2.type || (t2.data.constructor === Float32Array ? this.gl.FLOAT : t2.data.constructor === Uint16Array ? this.gl.UNSIGNED_SHORT : this.gl.UNSIGNED_INT), t2.target = e21 === `index` ? this.gl.ELEMENT_ARRAY_BUFFER : this.gl.ARRAY_BUFFER, t2.normalized = t2.normalized || false, t2.stride = t2.stride || 0, t2.offset = t2.offset || 0, t2.count = t2.count || (t2.stride ? t2.data.byteLength / t2.stride : t2.data.length / t2.size), t2.divisor = t2.instanced || 0, t2.needsUpdate = false, t2.usage = t2.usage || this.gl.STATIC_DRAW, t2.buffer || this.updateAttribute(t2), t2.divisor) {
      if (this.isInstanced = true, this.instancedCount && this.instancedCount !== t2.count * t2.divisor) return console.warn(`geometry has multiple instanced buffers of different length`), this.instancedCount = Math.min(this.instancedCount, t2.count * t2.divisor);
      this.instancedCount = t2.count * t2.divisor;
    } else e21 === `index` ? this.drawRange.count = t2.count : this.attributes.index || (this.drawRange.count = Math.max(this.drawRange.count, t2.count));
  }
  updateAttribute(e21) {
    let t2 = !e21.buffer;
    t2 && (e21.buffer = this.gl.createBuffer()), this.glState.boundBuffer !== e21.buffer && (this.gl.bindBuffer(e21.target, e21.buffer), this.glState.boundBuffer = e21.buffer), t2 ? this.gl.bufferData(e21.target, e21.data, e21.usage) : this.gl.bufferSubData(e21.target, 0, e21.data), e21.needsUpdate = false;
  }
  setIndex(e21) {
    this.addAttribute(`index`, e21);
  }
  setDrawRange(e21, t2) {
    this.drawRange.start = e21, this.drawRange.count = t2;
  }
  setInstancedCount(e21) {
    this.instancedCount = e21;
  }
  createVAO(e21) {
    this.VAOs[e21.attributeOrder] = this.gl.renderer.createVertexArray(), this.gl.renderer.bindVertexArray(this.VAOs[e21.attributeOrder]), this.bindAttributes(e21);
  }
  bindAttributes(e21) {
    e21.attributeLocations.forEach((e22, { name: t2, type: n2 }) => {
      if (!this.attributes[t2]) {
        console.warn(`active attribute ${t2} not being supplied`);
        return;
      }
      let r2 = this.attributes[t2];
      this.gl.bindBuffer(r2.target, r2.buffer), this.glState.boundBuffer = r2.buffer;
      let i2 = 1;
      n2 === 35674 && (i2 = 2), n2 === 35675 && (i2 = 3), n2 === 35676 && (i2 = 4);
      let a2 = r2.size / i2, o2 = i2 === 1 ? 0 : i2 * i2 * 4, s2 = i2 === 1 ? 0 : i2 * 4;
      for (let t3 = 0; t3 < i2; t3++) this.gl.vertexAttribPointer(e22 + t3, a2, r2.type, r2.normalized, r2.stride + o2, r2.offset + t3 * s2), this.gl.enableVertexAttribArray(e22 + t3), this.gl.renderer.vertexAttribDivisor(e22 + t3, r2.divisor);
    }), this.attributes.index && this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.attributes.index.buffer);
  }
  draw({ program: e21, mode: t2 = this.gl.TRIANGLES }) {
    this.gl.renderer.currentGeometry !== `${this.id}_${e21.attributeOrder}` && (this.VAOs[e21.attributeOrder] || this.createVAO(e21), this.gl.renderer.bindVertexArray(this.VAOs[e21.attributeOrder]), this.gl.renderer.currentGeometry = `${this.id}_${e21.attributeOrder}`), e21.attributeLocations.forEach((e22, { name: t3 }) => {
      let n3 = this.attributes[t3];
      n3.needsUpdate && this.updateAttribute(n3);
    });
    let n2 = 2;
    this.attributes.index?.type === this.gl.UNSIGNED_INT && (n2 = 4), this.isInstanced ? this.attributes.index ? this.gl.renderer.drawElementsInstanced(t2, this.drawRange.count, this.attributes.index.type, this.attributes.index.offset + this.drawRange.start * n2, this.instancedCount) : this.gl.renderer.drawArraysInstanced(t2, this.drawRange.start, this.drawRange.count, this.instancedCount) : this.attributes.index ? this.gl.drawElements(t2, this.drawRange.count, this.attributes.index.type, this.attributes.index.offset + this.drawRange.start * n2) : this.gl.drawArrays(t2, this.drawRange.start, this.drawRange.count);
  }
  getPosition() {
    let e21 = this.attributes.position;
    if (e21.data) return e21;
    if (!qi) return console.warn(`No position buffer data found to compute bounds`), qi = true;
  }
  computeBoundingBox(e21) {
    e21 || (e21 = this.getPosition());
    let t2 = e21.data, n2 = e21.size;
    this.bounds || (this.bounds = { min: new Ui(), max: new Ui(), center: new Ui(), scale: new Ui(), radius: 1 / 0 });
    let r2 = this.bounds.min, i2 = this.bounds.max, a2 = this.bounds.center, o2 = this.bounds.scale;
    r2.set(1 / 0), i2.set(-1 / 0);
    for (let e22 = 0, a3 = t2.length; e22 < a3; e22 += n2) {
      let n3 = t2[e22], a4 = t2[e22 + 1], o3 = t2[e22 + 2];
      r2.x = Math.min(n3, r2.x), r2.y = Math.min(a4, r2.y), r2.z = Math.min(o3, r2.z), i2.x = Math.max(n3, i2.x), i2.y = Math.max(a4, i2.y), i2.z = Math.max(o3, i2.z);
    }
    o2.sub(i2, r2), a2.add(r2, i2).divide(2);
  }
  computeBoundingSphere(e21) {
    e21 || (e21 = this.getPosition());
    let t2 = e21.data, n2 = e21.size;
    this.bounds || this.computeBoundingBox(e21);
    let r2 = 0;
    for (let e22 = 0, i2 = t2.length; e22 < i2; e22 += n2) Wi.fromArray(t2, e22), r2 = Math.max(r2, this.bounds.center.squaredDistance(Wi));
    this.bounds.radius = Math.sqrt(r2);
  }
  remove() {
    for (let e21 in this.VAOs) this.gl.renderer.deleteVertexArray(this.VAOs[e21]), delete this.VAOs[e21];
    for (let e21 in this.attributes) this.gl.deleteBuffer(this.attributes[e21].buffer), delete this.attributes[e21];
  }
}, Yi = 1, Xi = {}, Zi = class {
  constructor(e21, { vertex: t2, fragment: n2, uniforms: r2 = {}, transparent: i2 = false, cullFace: a2 = e21.BACK, frontFace: o2 = e21.CCW, depthTest: s2 = true, depthWrite: c2 = true, depthFunc: l2 = e21.LEQUAL } = {}) {
    e21.canvas || console.error(`gl not passed as first argument to Program`), this.gl = e21, this.uniforms = r2, this.id = Yi++, t2 || console.warn(`vertex shader not supplied`), n2 || console.warn(`fragment shader not supplied`), this.transparent = i2, this.cullFace = a2, this.frontFace = o2, this.depthTest = s2, this.depthWrite = c2, this.depthFunc = l2, this.blendFunc = {}, this.blendEquation = {}, this.stencilFunc = {}, this.stencilOp = {}, this.transparent && !this.blendFunc.src && (this.gl.renderer.premultipliedAlpha ? this.setBlendFunc(this.gl.ONE, this.gl.ONE_MINUS_SRC_ALPHA) : this.setBlendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA)), this.vertexShader = e21.createShader(e21.VERTEX_SHADER), this.fragmentShader = e21.createShader(e21.FRAGMENT_SHADER), this.program = e21.createProgram(), e21.attachShader(this.program, this.vertexShader), e21.attachShader(this.program, this.fragmentShader), this.setShaders({ vertex: t2, fragment: n2 });
  }
  setShaders({ vertex: e21, fragment: t2 }) {
    if (e21 && (this.gl.shaderSource(this.vertexShader, e21), this.gl.compileShader(this.vertexShader), this.gl.getShaderInfoLog(this.vertexShader) !== `` && console.warn(`${this.gl.getShaderInfoLog(this.vertexShader)}
Vertex Shader
${$i(e21)}`)), t2 && (this.gl.shaderSource(this.fragmentShader, t2), this.gl.compileShader(this.fragmentShader), this.gl.getShaderInfoLog(this.fragmentShader) !== `` && console.warn(`${this.gl.getShaderInfoLog(this.fragmentShader)}
Fragment Shader
${$i(t2)}`)), this.gl.linkProgram(this.program), !this.gl.getProgramParameter(this.program, this.gl.LINK_STATUS)) return console.warn(this.gl.getProgramInfoLog(this.program));
    this.uniformLocations = /* @__PURE__ */ new Map();
    let n2 = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_UNIFORMS);
    for (let e22 = 0; e22 < n2; e22++) {
      let t3 = this.gl.getActiveUniform(this.program, e22);
      this.uniformLocations.set(t3, this.gl.getUniformLocation(this.program, t3.name));
      let n3 = t3.name.match(/(\w+)/g);
      t3.uniformName = n3[0], t3.nameComponents = n3.slice(1);
    }
    this.attributeLocations = /* @__PURE__ */ new Map();
    let r2 = [], i2 = this.gl.getProgramParameter(this.program, this.gl.ACTIVE_ATTRIBUTES);
    for (let e22 = 0; e22 < i2; e22++) {
      let t3 = this.gl.getActiveAttrib(this.program, e22), n3 = this.gl.getAttribLocation(this.program, t3.name);
      n3 !== -1 && (r2[n3] = t3.name, this.attributeLocations.set(t3, n3));
    }
    this.attributeOrder = r2.join(``);
  }
  setBlendFunc(e21, t2, n2, r2) {
    this.blendFunc.src = e21, this.blendFunc.dst = t2, this.blendFunc.srcAlpha = n2, this.blendFunc.dstAlpha = r2, e21 && (this.transparent = true);
  }
  setBlendEquation(e21, t2) {
    this.blendEquation.modeRGB = e21, this.blendEquation.modeAlpha = t2;
  }
  setStencilFunc(e21, t2, n2) {
    this.stencilRef = t2, this.stencilFunc.func = e21, this.stencilFunc.ref = t2, this.stencilFunc.mask = n2;
  }
  setStencilOp(e21, t2, n2) {
    this.stencilOp.stencilFail = e21, this.stencilOp.depthFail = t2, this.stencilOp.depthPass = n2;
  }
  applyState() {
    this.depthTest ? this.gl.renderer.enable(this.gl.DEPTH_TEST) : this.gl.renderer.disable(this.gl.DEPTH_TEST), this.cullFace ? this.gl.renderer.enable(this.gl.CULL_FACE) : this.gl.renderer.disable(this.gl.CULL_FACE), this.blendFunc.src ? this.gl.renderer.enable(this.gl.BLEND) : this.gl.renderer.disable(this.gl.BLEND), this.cullFace && this.gl.renderer.setCullFace(this.cullFace), this.gl.renderer.setFrontFace(this.frontFace), this.gl.renderer.setDepthMask(this.depthWrite), this.gl.renderer.setDepthFunc(this.depthFunc), this.blendFunc.src && this.gl.renderer.setBlendFunc(this.blendFunc.src, this.blendFunc.dst, this.blendFunc.srcAlpha, this.blendFunc.dstAlpha), this.gl.renderer.setBlendEquation(this.blendEquation.modeRGB, this.blendEquation.modeAlpha), this.stencilFunc.func || this.stencilOp.stencilFail ? this.gl.renderer.enable(this.gl.STENCIL_TEST) : this.gl.renderer.disable(this.gl.STENCIL_TEST), this.gl.renderer.setStencilFunc(this.stencilFunc.func, this.stencilFunc.ref, this.stencilFunc.mask), this.gl.renderer.setStencilOp(this.stencilOp.stencilFail, this.stencilOp.depthFail, this.stencilOp.depthPass);
  }
  use({ flipFaces: e21 = false } = {}) {
    let t2 = -1;
    this.gl.renderer.state.currentProgram !== this.id && (this.gl.useProgram(this.program), this.gl.renderer.state.currentProgram = this.id), this.uniformLocations.forEach((e22, n2) => {
      let r2 = this.uniforms[n2.uniformName];
      for (let e23 of n2.nameComponents) {
        if (!r2) break;
        if (e23 in r2) r2 = r2[e23];
        else if (Array.isArray(r2.value)) break;
        else {
          r2 = void 0;
          break;
        }
      }
      if (!r2) return ia(`Active uniform ${n2.name} has not been supplied`);
      if (r2 && r2.value === void 0) return ia(`${n2.name} uniform is missing a value parameter`);
      if (r2.value.texture) return t2 += 1, r2.value.update(t2), Qi(this.gl, n2.type, e22, t2);
      if (r2.value.length && r2.value[0].texture) {
        let i2 = [];
        return r2.value.forEach((e23) => {
          t2 += 1, e23.update(t2), i2.push(t2);
        }), Qi(this.gl, n2.type, e22, i2);
      }
      Qi(this.gl, n2.type, e22, r2.value);
    }), this.applyState(), e21 && this.gl.renderer.setFrontFace(this.frontFace === this.gl.CCW ? this.gl.CW : this.gl.CCW);
  }
  remove() {
    this.gl.deleteProgram(this.program);
  }
};
function Qi(e21, t2, n2, r2) {
  r2 = r2.length ? ea(r2) : r2;
  let i2 = e21.renderer.state.uniformLocations.get(n2);
  if (r2.length) {
    if (i2 === void 0 || i2.length !== r2.length) e21.renderer.state.uniformLocations.set(n2, r2.slice(0));
    else {
      if (ta(i2, r2)) return;
      i2.set ? i2.set(r2) : na(i2, r2), e21.renderer.state.uniformLocations.set(n2, i2);
    }
  } else {
    if (i2 === r2) return;
    e21.renderer.state.uniformLocations.set(n2, r2);
  }
  switch (t2) {
    case 5126:
      return r2.length ? e21.uniform1fv(n2, r2) : e21.uniform1f(n2, r2);
    case 35664:
      return e21.uniform2fv(n2, r2);
    case 35665:
      return e21.uniform3fv(n2, r2);
    case 35666:
      return e21.uniform4fv(n2, r2);
    case 35670:
    case 5124:
    case 35678:
    case 36306:
    case 35680:
    case 36289:
      return r2.length ? e21.uniform1iv(n2, r2) : e21.uniform1i(n2, r2);
    case 35671:
    case 35667:
      return e21.uniform2iv(n2, r2);
    case 35672:
    case 35668:
      return e21.uniform3iv(n2, r2);
    case 35673:
    case 35669:
      return e21.uniform4iv(n2, r2);
    case 35674:
      return e21.uniformMatrix2fv(n2, false, r2);
    case 35675:
      return e21.uniformMatrix3fv(n2, false, r2);
    case 35676:
      return e21.uniformMatrix4fv(n2, false, r2);
  }
}
function $i(e21) {
  let t2 = e21.split(`
`);
  for (let e22 = 0; e22 < t2.length; e22++) t2[e22] = e22 + 1 + `: ` + t2[e22];
  return t2.join(`
`);
}
function ea(e21) {
  let t2 = e21.length, n2 = e21[0].length;
  if (n2 === void 0) return e21;
  let r2 = t2 * n2, i2 = Xi[r2];
  i2 || (Xi[r2] = i2 = new Float32Array(r2));
  for (let r3 = 0; r3 < t2; r3++) i2.set(e21[r3], r3 * n2);
  return i2;
}
function ta(e21, t2) {
  if (e21.length !== t2.length) return false;
  for (let n2 = 0, r2 = e21.length; n2 < r2; n2++) if (e21[n2] !== t2[n2]) return false;
  return true;
}
function na(e21, t2) {
  for (let n2 = 0, r2 = e21.length; n2 < r2; n2++) e21[n2] = t2[n2];
}
var ra = 0;
function ia(e21) {
  ra > 100 || (console.warn(e21), ra++, ra > 100 && console.warn(`More than 100 program warnings - stopping logs.`));
}
var aa = new Ui(), oa = 1, sa = class {
  constructor({ canvas: e21 = document.createElement(`canvas`), width: t2 = 300, height: n2 = 150, dpr: r2 = 1, alpha: i2 = false, depth: a2 = true, stencil: o2 = false, antialias: s2 = false, premultipliedAlpha: c2 = false, preserveDrawingBuffer: l2 = false, powerPreference: u2 = `default`, autoClear: d2 = true, webgl: f2 = 2 } = {}) {
    let p2 = { alpha: i2, depth: a2, stencil: o2, antialias: s2, premultipliedAlpha: c2, preserveDrawingBuffer: l2, powerPreference: u2 };
    this.dpr = r2, this.alpha = i2, this.color = true, this.depth = a2, this.stencil = o2, this.premultipliedAlpha = c2, this.autoClear = d2, this.id = oa++, f2 === 2 && (this.gl = e21.getContext(`webgl2`, p2)), this.isWebgl2 = !!this.gl, this.gl || (this.gl = e21.getContext(`webgl`, p2)), this.gl || console.error(`unable to create webgl context`), this.gl.renderer = this, this.setSize(t2, n2), this.state = {}, this.state.blendFunc = { src: this.gl.ONE, dst: this.gl.ZERO }, this.state.blendEquation = { modeRGB: this.gl.FUNC_ADD }, this.state.cullFace = false, this.state.frontFace = this.gl.CCW, this.state.depthMask = true, this.state.depthFunc = this.gl.LEQUAL, this.state.premultiplyAlpha = false, this.state.flipY = false, this.state.unpackAlignment = 4, this.state.framebuffer = null, this.state.viewport = { x: 0, y: 0, width: null, height: null }, this.state.textureUnits = [], this.state.activeTextureUnit = 0, this.state.boundBuffer = null, this.state.uniformLocations = /* @__PURE__ */ new Map(), this.state.currentProgram = null, this.extensions = {}, this.isWebgl2 ? (this.getExtension(`EXT_color_buffer_float`), this.getExtension(`OES_texture_float_linear`)) : (this.getExtension(`OES_texture_float`), this.getExtension(`OES_texture_float_linear`), this.getExtension(`OES_texture_half_float`), this.getExtension(`OES_texture_half_float_linear`), this.getExtension(`OES_element_index_uint`), this.getExtension(`OES_standard_derivatives`), this.getExtension(`EXT_sRGB`), this.getExtension(`WEBGL_depth_texture`), this.getExtension(`WEBGL_draw_buffers`)), this.getExtension(`WEBGL_compressed_texture_astc`), this.getExtension(`EXT_texture_compression_bptc`), this.getExtension(`WEBGL_compressed_texture_s3tc`), this.getExtension(`WEBGL_compressed_texture_etc1`), this.getExtension(`WEBGL_compressed_texture_pvrtc`), this.getExtension(`WEBKIT_WEBGL_compressed_texture_pvrtc`), this.vertexAttribDivisor = this.getExtension(`ANGLE_instanced_arrays`, `vertexAttribDivisor`, `vertexAttribDivisorANGLE`), this.drawArraysInstanced = this.getExtension(`ANGLE_instanced_arrays`, `drawArraysInstanced`, `drawArraysInstancedANGLE`), this.drawElementsInstanced = this.getExtension(`ANGLE_instanced_arrays`, `drawElementsInstanced`, `drawElementsInstancedANGLE`), this.createVertexArray = this.getExtension(`OES_vertex_array_object`, `createVertexArray`, `createVertexArrayOES`), this.bindVertexArray = this.getExtension(`OES_vertex_array_object`, `bindVertexArray`, `bindVertexArrayOES`), this.deleteVertexArray = this.getExtension(`OES_vertex_array_object`, `deleteVertexArray`, `deleteVertexArrayOES`), this.drawBuffers = this.getExtension(`WEBGL_draw_buffers`, `drawBuffers`, `drawBuffersWEBGL`), this.parameters = {}, this.parameters.maxTextureUnits = this.gl.getParameter(this.gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS), this.parameters.maxAnisotropy = this.getExtension(`EXT_texture_filter_anisotropic`) ? this.gl.getParameter(this.getExtension(`EXT_texture_filter_anisotropic`).MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 0;
  }
  setSize(e21, t2) {
    this.width = e21, this.height = t2, this.gl.canvas.width = e21 * this.dpr, this.gl.canvas.height = t2 * this.dpr, this.gl.canvas.style && Object.assign(this.gl.canvas.style, { width: e21 + `px`, height: t2 + `px` });
  }
  setViewport(e21, t2, n2 = 0, r2 = 0) {
    (this.state.viewport.width !== e21 || this.state.viewport.height !== t2) && (this.state.viewport.width = e21, this.state.viewport.height = t2, this.state.viewport.x = n2, this.state.viewport.y = r2, this.gl.viewport(n2, r2, e21, t2));
  }
  setScissor(e21, t2, n2 = 0, r2 = 0) {
    this.gl.scissor(n2, r2, e21, t2);
  }
  enable(e21) {
    this.state[e21] !== true && (this.gl.enable(e21), this.state[e21] = true);
  }
  disable(e21) {
    this.state[e21] !== false && (this.gl.disable(e21), this.state[e21] = false);
  }
  setBlendFunc(e21, t2, n2, r2) {
    (this.state.blendFunc.src !== e21 || this.state.blendFunc.dst !== t2 || this.state.blendFunc.srcAlpha !== n2 || this.state.blendFunc.dstAlpha !== r2) && (this.state.blendFunc.src = e21, this.state.blendFunc.dst = t2, this.state.blendFunc.srcAlpha = n2, this.state.blendFunc.dstAlpha = r2, n2 === void 0 ? this.gl.blendFunc(e21, t2) : this.gl.blendFuncSeparate(e21, t2, n2, r2));
  }
  setBlendEquation(e21, t2) {
    e21 = e21 || this.gl.FUNC_ADD, (this.state.blendEquation.modeRGB !== e21 || this.state.blendEquation.modeAlpha !== t2) && (this.state.blendEquation.modeRGB = e21, this.state.blendEquation.modeAlpha = t2, t2 === void 0 ? this.gl.blendEquation(e21) : this.gl.blendEquationSeparate(e21, t2));
  }
  setCullFace(e21) {
    this.state.cullFace !== e21 && (this.state.cullFace = e21, this.gl.cullFace(e21));
  }
  setFrontFace(e21) {
    this.state.frontFace !== e21 && (this.state.frontFace = e21, this.gl.frontFace(e21));
  }
  setDepthMask(e21) {
    this.state.depthMask !== e21 && (this.state.depthMask = e21, this.gl.depthMask(e21));
  }
  setDepthFunc(e21) {
    this.state.depthFunc !== e21 && (this.state.depthFunc = e21, this.gl.depthFunc(e21));
  }
  setStencilMask(e21) {
    this.state.stencilMask !== e21 && (this.state.stencilMask = e21, this.gl.stencilMask(e21));
  }
  setStencilFunc(e21, t2, n2) {
    (this.state.stencilFunc !== e21 || this.state.stencilRef !== t2 || this.state.stencilFuncMask !== n2) && (this.state.stencilFunc = e21 || this.gl.ALWAYS, this.state.stencilRef = t2 || 0, this.state.stencilFuncMask = n2 || 0, this.gl.stencilFunc(e21 || this.gl.ALWAYS, t2 || 0, n2 || 0));
  }
  setStencilOp(e21, t2, n2) {
    (this.state.stencilFail !== e21 || this.state.stencilDepthFail !== t2 || this.state.stencilDepthPass !== n2) && (this.state.stencilFail = e21, this.state.stencilDepthFail = t2, this.state.stencilDepthPass = n2, this.gl.stencilOp(e21, t2, n2));
  }
  activeTexture(e21) {
    this.state.activeTextureUnit !== e21 && (this.state.activeTextureUnit = e21, this.gl.activeTexture(this.gl.TEXTURE0 + e21));
  }
  bindFramebuffer({ target: e21 = this.gl.FRAMEBUFFER, buffer: t2 = null } = {}) {
    this.state.framebuffer !== t2 && (this.state.framebuffer = t2, this.gl.bindFramebuffer(e21, t2));
  }
  getExtension(e21, t2, n2) {
    return t2 && this.gl[t2] ? this.gl[t2].bind(this.gl) : (this.extensions[e21] || (this.extensions[e21] = this.gl.getExtension(e21)), t2 ? this.extensions[e21] ? this.extensions[e21][n2].bind(this.extensions[e21]) : null : this.extensions[e21]);
  }
  sortOpaque(e21, t2) {
    return e21.renderOrder === t2.renderOrder ? e21.program.id === t2.program.id ? e21.zDepth === t2.zDepth ? t2.id - e21.id : e21.zDepth - t2.zDepth : e21.program.id - t2.program.id : e21.renderOrder - t2.renderOrder;
  }
  sortTransparent(e21, t2) {
    return e21.renderOrder === t2.renderOrder ? e21.zDepth === t2.zDepth ? t2.id - e21.id : t2.zDepth - e21.zDepth : e21.renderOrder - t2.renderOrder;
  }
  sortUI(e21, t2) {
    return e21.renderOrder === t2.renderOrder ? e21.program.id === t2.program.id ? t2.id - e21.id : e21.program.id - t2.program.id : e21.renderOrder - t2.renderOrder;
  }
  getRenderList({ scene: e21, camera: t2, frustumCull: n2, sort: r2 }) {
    let i2 = [];
    if (t2 && n2 && t2.updateFrustum(), e21.traverse((e22) => {
      if (!e22.visible) return true;
      e22.draw && (n2 && e22.frustumCulled && t2 && !t2.frustumIntersectsMesh(e22) || i2.push(e22));
    }), r2) {
      let e22 = [], n3 = [], r3 = [];
      i2.forEach((i3) => {
        i3.program.transparent ? i3.program.depthTest ? n3.push(i3) : r3.push(i3) : e22.push(i3), i3.zDepth = 0, i3.renderOrder === 0 && i3.program.depthTest && t2 && (i3.worldMatrix.getTranslation(aa), aa.applyMatrix4(t2.projectionViewMatrix), i3.zDepth = aa.z);
      }), e22.sort(this.sortOpaque), n3.sort(this.sortTransparent), r3.sort(this.sortUI), i2 = e22.concat(n3, r3);
    }
    return i2;
  }
  render({ scene: e21, camera: t2, target: n2 = null, update: r2 = true, sort: i2 = true, frustumCull: a2 = true, clear: o2 }) {
    n2 === null ? (this.bindFramebuffer(), this.setViewport(this.width * this.dpr, this.height * this.dpr)) : (this.bindFramebuffer(n2), this.setViewport(n2.width, n2.height)), (o2 || this.autoClear && o2 !== false) && (this.depth && (!n2 || n2.depth) && (this.enable(this.gl.DEPTH_TEST), this.setDepthMask(true)), (this.stencil || !n2 || n2.stencil) && (this.enable(this.gl.STENCIL_TEST), this.setStencilMask(255)), this.gl.clear((this.color ? this.gl.COLOR_BUFFER_BIT : 0) | (this.depth ? this.gl.DEPTH_BUFFER_BIT : 0) | (this.stencil ? this.gl.STENCIL_BUFFER_BIT : 0))), r2 && e21.updateMatrixWorld(), t2 && t2.updateMatrixWorld(), this.getRenderList({ scene: e21, camera: t2, frustumCull: a2, sort: i2 }).forEach((e22) => {
      e22.draw({ camera: t2 });
    });
  }
};
function ca(e21, t2) {
  return e21[0] = t2[0], e21[1] = t2[1], e21[2] = t2[2], e21[3] = t2[3], e21;
}
function la(e21, t2, n2, r2, i2) {
  return e21[0] = t2, e21[1] = n2, e21[2] = r2, e21[3] = i2, e21;
}
function ua(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = n2 * n2 + r2 * r2 + i2 * i2 + a2 * a2;
  return o2 > 0 && (o2 = 1 / Math.sqrt(o2)), e21[0] = n2 * o2, e21[1] = r2 * o2, e21[2] = i2 * o2, e21[3] = a2 * o2, e21;
}
function da(e21, t2) {
  return e21[0] * t2[0] + e21[1] * t2[1] + e21[2] * t2[2] + e21[3] * t2[3];
}
function fa(e21) {
  return e21[0] = 0, e21[1] = 0, e21[2] = 0, e21[3] = 1, e21;
}
function pa(e21, t2, n2) {
  n2 *= 0.5;
  let r2 = Math.sin(n2);
  return e21[0] = r2 * t2[0], e21[1] = r2 * t2[1], e21[2] = r2 * t2[2], e21[3] = Math.cos(n2), e21;
}
function ma(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = n2[0], c2 = n2[1], l2 = n2[2], u2 = n2[3];
  return e21[0] = r2 * u2 + o2 * s2 + i2 * l2 - a2 * c2, e21[1] = i2 * u2 + o2 * c2 + a2 * s2 - r2 * l2, e21[2] = a2 * u2 + o2 * l2 + r2 * c2 - i2 * s2, e21[3] = o2 * u2 - r2 * s2 - i2 * c2 - a2 * l2, e21;
}
function ha(e21, t2, n2) {
  n2 *= 0.5;
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = Math.sin(n2), c2 = Math.cos(n2);
  return e21[0] = r2 * c2 + o2 * s2, e21[1] = i2 * c2 + a2 * s2, e21[2] = a2 * c2 - i2 * s2, e21[3] = o2 * c2 - r2 * s2, e21;
}
function ga(e21, t2, n2) {
  n2 *= 0.5;
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = Math.sin(n2), c2 = Math.cos(n2);
  return e21[0] = r2 * c2 - a2 * s2, e21[1] = i2 * c2 + o2 * s2, e21[2] = a2 * c2 + r2 * s2, e21[3] = o2 * c2 - i2 * s2, e21;
}
function _a(e21, t2, n2) {
  n2 *= 0.5;
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = Math.sin(n2), c2 = Math.cos(n2);
  return e21[0] = r2 * c2 + i2 * s2, e21[1] = i2 * c2 - r2 * s2, e21[2] = a2 * c2 + o2 * s2, e21[3] = o2 * c2 - a2 * s2, e21;
}
function va(e21, t2, n2, r2) {
  let i2 = t2[0], a2 = t2[1], o2 = t2[2], s2 = t2[3], c2 = n2[0], l2 = n2[1], u2 = n2[2], d2 = n2[3], f2, p2, m2, h2, g2;
  return p2 = i2 * c2 + a2 * l2 + o2 * u2 + s2 * d2, p2 < 0 && (p2 = -p2, c2 = -c2, l2 = -l2, u2 = -u2, d2 = -d2), 1 - p2 > 1e-6 ? (f2 = Math.acos(p2), m2 = Math.sin(f2), h2 = Math.sin((1 - r2) * f2) / m2, g2 = Math.sin(r2 * f2) / m2) : (h2 = 1 - r2, g2 = r2), e21[0] = h2 * i2 + g2 * c2, e21[1] = h2 * a2 + g2 * l2, e21[2] = h2 * o2 + g2 * u2, e21[3] = h2 * s2 + g2 * d2, e21;
}
function ya(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = n2 * n2 + r2 * r2 + i2 * i2 + a2 * a2, s2 = o2 ? 1 / o2 : 0;
  return e21[0] = -n2 * s2, e21[1] = -r2 * s2, e21[2] = -i2 * s2, e21[3] = a2 * s2, e21;
}
function ba(e21, t2) {
  return e21[0] = -t2[0], e21[1] = -t2[1], e21[2] = -t2[2], e21[3] = t2[3], e21;
}
function xa(e21, t2) {
  let n2 = t2[0] + t2[4] + t2[8], r2;
  if (n2 > 0) r2 = Math.sqrt(n2 + 1), e21[3] = 0.5 * r2, r2 = 0.5 / r2, e21[0] = (t2[5] - t2[7]) * r2, e21[1] = (t2[6] - t2[2]) * r2, e21[2] = (t2[1] - t2[3]) * r2;
  else {
    let n3 = 0;
    t2[4] > t2[0] && (n3 = 1), t2[8] > t2[n3 * 3 + n3] && (n3 = 2);
    let i2 = (n3 + 1) % 3, a2 = (n3 + 2) % 3;
    r2 = Math.sqrt(t2[n3 * 3 + n3] - t2[i2 * 3 + i2] - t2[a2 * 3 + a2] + 1), e21[n3] = 0.5 * r2, r2 = 0.5 / r2, e21[3] = (t2[i2 * 3 + a2] - t2[a2 * 3 + i2]) * r2, e21[i2] = (t2[i2 * 3 + n3] + t2[n3 * 3 + i2]) * r2, e21[a2] = (t2[a2 * 3 + n3] + t2[n3 * 3 + a2]) * r2;
  }
  return e21;
}
function Sa(e21, t2, n2 = `YXZ`) {
  let r2 = Math.sin(t2[0] * 0.5), i2 = Math.cos(t2[0] * 0.5), a2 = Math.sin(t2[1] * 0.5), o2 = Math.cos(t2[1] * 0.5), s2 = Math.sin(t2[2] * 0.5), c2 = Math.cos(t2[2] * 0.5);
  return n2 === `XYZ` ? (e21[0] = r2 * o2 * c2 + i2 * a2 * s2, e21[1] = i2 * a2 * c2 - r2 * o2 * s2, e21[2] = i2 * o2 * s2 + r2 * a2 * c2, e21[3] = i2 * o2 * c2 - r2 * a2 * s2) : n2 === `YXZ` ? (e21[0] = r2 * o2 * c2 + i2 * a2 * s2, e21[1] = i2 * a2 * c2 - r2 * o2 * s2, e21[2] = i2 * o2 * s2 - r2 * a2 * c2, e21[3] = i2 * o2 * c2 + r2 * a2 * s2) : n2 === `ZXY` ? (e21[0] = r2 * o2 * c2 - i2 * a2 * s2, e21[1] = i2 * a2 * c2 + r2 * o2 * s2, e21[2] = i2 * o2 * s2 + r2 * a2 * c2, e21[3] = i2 * o2 * c2 - r2 * a2 * s2) : n2 === `ZYX` ? (e21[0] = r2 * o2 * c2 - i2 * a2 * s2, e21[1] = i2 * a2 * c2 + r2 * o2 * s2, e21[2] = i2 * o2 * s2 - r2 * a2 * c2, e21[3] = i2 * o2 * c2 + r2 * a2 * s2) : n2 === `YZX` ? (e21[0] = r2 * o2 * c2 + i2 * a2 * s2, e21[1] = i2 * a2 * c2 + r2 * o2 * s2, e21[2] = i2 * o2 * s2 - r2 * a2 * c2, e21[3] = i2 * o2 * c2 - r2 * a2 * s2) : n2 === `XZY` && (e21[0] = r2 * o2 * c2 - i2 * a2 * s2, e21[1] = i2 * a2 * c2 - r2 * o2 * s2, e21[2] = i2 * o2 * s2 + r2 * a2 * c2, e21[3] = i2 * o2 * c2 + r2 * a2 * s2), e21;
}
var Ca = ca, wa = la, Ta = da, Ea = ua, Da = class extends Array {
  constructor(e21 = 0, t2 = 0, n2 = 0, r2 = 1) {
    super(e21, t2, n2, r2), this.onChange = () => {
    }, this._target = this;
    let i2 = [`0`, `1`, `2`, `3`];
    return new Proxy(this, { set(e22, t3) {
      let n3 = Reflect.set(...arguments);
      return n3 && i2.includes(t3) && e22.onChange(), n3;
    } });
  }
  get x() {
    return this[0];
  }
  get y() {
    return this[1];
  }
  get z() {
    return this[2];
  }
  get w() {
    return this[3];
  }
  set x(e21) {
    this._target[0] = e21, this.onChange();
  }
  set y(e21) {
    this._target[1] = e21, this.onChange();
  }
  set z(e21) {
    this._target[2] = e21, this.onChange();
  }
  set w(e21) {
    this._target[3] = e21, this.onChange();
  }
  identity() {
    return fa(this._target), this.onChange(), this;
  }
  set(e21, t2, n2, r2) {
    return e21.length ? this.copy(e21) : (wa(this._target, e21, t2, n2, r2), this.onChange(), this);
  }
  rotateX(e21) {
    return ha(this._target, this._target, e21), this.onChange(), this;
  }
  rotateY(e21) {
    return ga(this._target, this._target, e21), this.onChange(), this;
  }
  rotateZ(e21) {
    return _a(this._target, this._target, e21), this.onChange(), this;
  }
  inverse(e21 = this._target) {
    return ya(this._target, e21), this.onChange(), this;
  }
  conjugate(e21 = this._target) {
    return ba(this._target, e21), this.onChange(), this;
  }
  copy(e21) {
    return Ca(this._target, e21), this.onChange(), this;
  }
  normalize(e21 = this._target) {
    return Ea(this._target, e21), this.onChange(), this;
  }
  multiply(e21, t2) {
    return t2 ? ma(this._target, e21, t2) : ma(this._target, this._target, e21), this.onChange(), this;
  }
  dot(e21) {
    return Ta(this._target, e21);
  }
  fromMatrix3(e21) {
    return xa(this._target, e21), this.onChange(), this;
  }
  fromEuler(e21, t2) {
    return Sa(this._target, e21, e21.order), t2 || this.onChange(), this;
  }
  fromAxisAngle(e21, t2) {
    return pa(this._target, e21, t2), this.onChange(), this;
  }
  slerp(e21, t2) {
    return va(this._target, this._target, e21, t2), this.onChange(), this;
  }
  fromArray(e21, t2 = 0) {
    return this._target[0] = e21[t2], this._target[1] = e21[t2 + 1], this._target[2] = e21[t2 + 2], this._target[3] = e21[t2 + 3], this.onChange(), this;
  }
  toArray(e21 = [], t2 = 0) {
    return e21[t2] = this[0], e21[t2 + 1] = this[1], e21[t2 + 2] = this[2], e21[t2 + 3] = this[3], e21;
  }
}, Oa = 1e-6;
function ka(e21, t2) {
  return e21[0] = t2[0], e21[1] = t2[1], e21[2] = t2[2], e21[3] = t2[3], e21[4] = t2[4], e21[5] = t2[5], e21[6] = t2[6], e21[7] = t2[7], e21[8] = t2[8], e21[9] = t2[9], e21[10] = t2[10], e21[11] = t2[11], e21[12] = t2[12], e21[13] = t2[13], e21[14] = t2[14], e21[15] = t2[15], e21;
}
function Aa(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2, m2, h2, g2) {
  return e21[0] = t2, e21[1] = n2, e21[2] = r2, e21[3] = i2, e21[4] = a2, e21[5] = o2, e21[6] = s2, e21[7] = c2, e21[8] = l2, e21[9] = u2, e21[10] = d2, e21[11] = f2, e21[12] = p2, e21[13] = m2, e21[14] = h2, e21[15] = g2, e21;
}
function ja(e21) {
  return e21[0] = 1, e21[1] = 0, e21[2] = 0, e21[3] = 0, e21[4] = 0, e21[5] = 1, e21[6] = 0, e21[7] = 0, e21[8] = 0, e21[9] = 0, e21[10] = 1, e21[11] = 0, e21[12] = 0, e21[13] = 0, e21[14] = 0, e21[15] = 1, e21;
}
function Ma(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = t2[4], s2 = t2[5], c2 = t2[6], l2 = t2[7], u2 = t2[8], d2 = t2[9], f2 = t2[10], p2 = t2[11], m2 = t2[12], h2 = t2[13], g2 = t2[14], _2 = t2[15], v2 = n2 * s2 - r2 * o2, y2 = n2 * c2 - i2 * o2, b2 = n2 * l2 - a2 * o2, x2 = r2 * c2 - i2 * s2, S2 = r2 * l2 - a2 * s2, C2 = i2 * l2 - a2 * c2, w2 = u2 * h2 - d2 * m2, T2 = u2 * g2 - f2 * m2, E2 = u2 * _2 - p2 * m2, D2 = d2 * g2 - f2 * h2, O2 = d2 * _2 - p2 * h2, k2 = f2 * _2 - p2 * g2, A2 = v2 * k2 - y2 * O2 + b2 * D2 + x2 * E2 - S2 * T2 + C2 * w2;
  return A2 ? (A2 = 1 / A2, e21[0] = (s2 * k2 - c2 * O2 + l2 * D2) * A2, e21[1] = (i2 * O2 - r2 * k2 - a2 * D2) * A2, e21[2] = (h2 * C2 - g2 * S2 + _2 * x2) * A2, e21[3] = (f2 * S2 - d2 * C2 - p2 * x2) * A2, e21[4] = (c2 * E2 - o2 * k2 - l2 * T2) * A2, e21[5] = (n2 * k2 - i2 * E2 + a2 * T2) * A2, e21[6] = (g2 * b2 - m2 * C2 - _2 * y2) * A2, e21[7] = (u2 * C2 - f2 * b2 + p2 * y2) * A2, e21[8] = (o2 * O2 - s2 * E2 + l2 * w2) * A2, e21[9] = (r2 * E2 - n2 * O2 - a2 * w2) * A2, e21[10] = (m2 * S2 - h2 * b2 + _2 * v2) * A2, e21[11] = (d2 * b2 - u2 * S2 - p2 * v2) * A2, e21[12] = (s2 * T2 - o2 * D2 - c2 * w2) * A2, e21[13] = (n2 * D2 - r2 * T2 + i2 * w2) * A2, e21[14] = (h2 * y2 - m2 * x2 - g2 * v2) * A2, e21[15] = (u2 * x2 - d2 * y2 + f2 * v2) * A2, e21) : null;
}
function Na(e21) {
  let t2 = e21[0], n2 = e21[1], r2 = e21[2], i2 = e21[3], a2 = e21[4], o2 = e21[5], s2 = e21[6], c2 = e21[7], l2 = e21[8], u2 = e21[9], d2 = e21[10], f2 = e21[11], p2 = e21[12], m2 = e21[13], h2 = e21[14], g2 = e21[15], _2 = t2 * o2 - n2 * a2, v2 = t2 * s2 - r2 * a2, y2 = t2 * c2 - i2 * a2, b2 = n2 * s2 - r2 * o2, x2 = n2 * c2 - i2 * o2, S2 = r2 * c2 - i2 * s2, C2 = l2 * m2 - u2 * p2, w2 = l2 * h2 - d2 * p2, T2 = l2 * g2 - f2 * p2, E2 = u2 * h2 - d2 * m2, D2 = u2 * g2 - f2 * m2;
  return _2 * (d2 * g2 - f2 * h2) - v2 * D2 + y2 * E2 + b2 * T2 - x2 * w2 + S2 * C2;
}
function Pa(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = t2[4], c2 = t2[5], l2 = t2[6], u2 = t2[7], d2 = t2[8], f2 = t2[9], p2 = t2[10], m2 = t2[11], h2 = t2[12], g2 = t2[13], _2 = t2[14], v2 = t2[15], y2 = n2[0], b2 = n2[1], x2 = n2[2], S2 = n2[3];
  return e21[0] = y2 * r2 + b2 * s2 + x2 * d2 + S2 * h2, e21[1] = y2 * i2 + b2 * c2 + x2 * f2 + S2 * g2, e21[2] = y2 * a2 + b2 * l2 + x2 * p2 + S2 * _2, e21[3] = y2 * o2 + b2 * u2 + x2 * m2 + S2 * v2, y2 = n2[4], b2 = n2[5], x2 = n2[6], S2 = n2[7], e21[4] = y2 * r2 + b2 * s2 + x2 * d2 + S2 * h2, e21[5] = y2 * i2 + b2 * c2 + x2 * f2 + S2 * g2, e21[6] = y2 * a2 + b2 * l2 + x2 * p2 + S2 * _2, e21[7] = y2 * o2 + b2 * u2 + x2 * m2 + S2 * v2, y2 = n2[8], b2 = n2[9], x2 = n2[10], S2 = n2[11], e21[8] = y2 * r2 + b2 * s2 + x2 * d2 + S2 * h2, e21[9] = y2 * i2 + b2 * c2 + x2 * f2 + S2 * g2, e21[10] = y2 * a2 + b2 * l2 + x2 * p2 + S2 * _2, e21[11] = y2 * o2 + b2 * u2 + x2 * m2 + S2 * v2, y2 = n2[12], b2 = n2[13], x2 = n2[14], S2 = n2[15], e21[12] = y2 * r2 + b2 * s2 + x2 * d2 + S2 * h2, e21[13] = y2 * i2 + b2 * c2 + x2 * f2 + S2 * g2, e21[14] = y2 * a2 + b2 * l2 + x2 * p2 + S2 * _2, e21[15] = y2 * o2 + b2 * u2 + x2 * m2 + S2 * v2, e21;
}
function Fa(e21, t2, n2) {
  let r2 = n2[0], i2 = n2[1], a2 = n2[2], o2, s2, c2, l2, u2, d2, f2, p2, m2, h2, g2, _2;
  return t2 === e21 ? (e21[12] = t2[0] * r2 + t2[4] * i2 + t2[8] * a2 + t2[12], e21[13] = t2[1] * r2 + t2[5] * i2 + t2[9] * a2 + t2[13], e21[14] = t2[2] * r2 + t2[6] * i2 + t2[10] * a2 + t2[14], e21[15] = t2[3] * r2 + t2[7] * i2 + t2[11] * a2 + t2[15]) : (o2 = t2[0], s2 = t2[1], c2 = t2[2], l2 = t2[3], u2 = t2[4], d2 = t2[5], f2 = t2[6], p2 = t2[7], m2 = t2[8], h2 = t2[9], g2 = t2[10], _2 = t2[11], e21[0] = o2, e21[1] = s2, e21[2] = c2, e21[3] = l2, e21[4] = u2, e21[5] = d2, e21[6] = f2, e21[7] = p2, e21[8] = m2, e21[9] = h2, e21[10] = g2, e21[11] = _2, e21[12] = o2 * r2 + u2 * i2 + m2 * a2 + t2[12], e21[13] = s2 * r2 + d2 * i2 + h2 * a2 + t2[13], e21[14] = c2 * r2 + f2 * i2 + g2 * a2 + t2[14], e21[15] = l2 * r2 + p2 * i2 + _2 * a2 + t2[15]), e21;
}
function Ia(e21, t2, n2) {
  let r2 = n2[0], i2 = n2[1], a2 = n2[2];
  return e21[0] = t2[0] * r2, e21[1] = t2[1] * r2, e21[2] = t2[2] * r2, e21[3] = t2[3] * r2, e21[4] = t2[4] * i2, e21[5] = t2[5] * i2, e21[6] = t2[6] * i2, e21[7] = t2[7] * i2, e21[8] = t2[8] * a2, e21[9] = t2[9] * a2, e21[10] = t2[10] * a2, e21[11] = t2[11] * a2, e21[12] = t2[12], e21[13] = t2[13], e21[14] = t2[14], e21[15] = t2[15], e21;
}
function La(e21, t2, n2, r2) {
  let i2 = r2[0], a2 = r2[1], o2 = r2[2], s2 = Math.hypot(i2, a2, o2), c2, l2, u2, d2, f2, p2, m2, h2, g2, _2, v2, y2, b2, x2, S2, C2, w2, T2, E2, D2, O2, k2, A2, j2;
  return Math.abs(s2) < Oa ? null : (s2 = 1 / s2, i2 *= s2, a2 *= s2, o2 *= s2, c2 = Math.sin(n2), l2 = Math.cos(n2), u2 = 1 - l2, d2 = t2[0], f2 = t2[1], p2 = t2[2], m2 = t2[3], h2 = t2[4], g2 = t2[5], _2 = t2[6], v2 = t2[7], y2 = t2[8], b2 = t2[9], x2 = t2[10], S2 = t2[11], C2 = i2 * i2 * u2 + l2, w2 = a2 * i2 * u2 + o2 * c2, T2 = o2 * i2 * u2 - a2 * c2, E2 = i2 * a2 * u2 - o2 * c2, D2 = a2 * a2 * u2 + l2, O2 = o2 * a2 * u2 + i2 * c2, k2 = i2 * o2 * u2 + a2 * c2, A2 = a2 * o2 * u2 - i2 * c2, j2 = o2 * o2 * u2 + l2, e21[0] = d2 * C2 + h2 * w2 + y2 * T2, e21[1] = f2 * C2 + g2 * w2 + b2 * T2, e21[2] = p2 * C2 + _2 * w2 + x2 * T2, e21[3] = m2 * C2 + v2 * w2 + S2 * T2, e21[4] = d2 * E2 + h2 * D2 + y2 * O2, e21[5] = f2 * E2 + g2 * D2 + b2 * O2, e21[6] = p2 * E2 + _2 * D2 + x2 * O2, e21[7] = m2 * E2 + v2 * D2 + S2 * O2, e21[8] = d2 * k2 + h2 * A2 + y2 * j2, e21[9] = f2 * k2 + g2 * A2 + b2 * j2, e21[10] = p2 * k2 + _2 * A2 + x2 * j2, e21[11] = m2 * k2 + v2 * A2 + S2 * j2, t2 !== e21 && (e21[12] = t2[12], e21[13] = t2[13], e21[14] = t2[14], e21[15] = t2[15]), e21);
}
function Ra(e21, t2) {
  return e21[0] = t2[12], e21[1] = t2[13], e21[2] = t2[14], e21;
}
function za(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[4], o2 = t2[5], s2 = t2[6], c2 = t2[8], l2 = t2[9], u2 = t2[10];
  return e21[0] = Math.hypot(n2, r2, i2), e21[1] = Math.hypot(a2, o2, s2), e21[2] = Math.hypot(c2, l2, u2), e21;
}
function Ba(e21) {
  let t2 = e21[0], n2 = e21[1], r2 = e21[2], i2 = e21[4], a2 = e21[5], o2 = e21[6], s2 = e21[8], c2 = e21[9], l2 = e21[10], u2 = t2 * t2 + n2 * n2 + r2 * r2, d2 = i2 * i2 + a2 * a2 + o2 * o2, f2 = s2 * s2 + c2 * c2 + l2 * l2;
  return Math.sqrt(Math.max(u2, d2, f2));
}
var Va = /* @__PURE__ */ (function() {
  let e21 = [1, 1, 1];
  return function(t2, n2) {
    let r2 = e21;
    za(r2, n2);
    let i2 = 1 / r2[0], a2 = 1 / r2[1], o2 = 1 / r2[2], s2 = n2[0] * i2, c2 = n2[1] * a2, l2 = n2[2] * o2, u2 = n2[4] * i2, d2 = n2[5] * a2, f2 = n2[6] * o2, p2 = n2[8] * i2, m2 = n2[9] * a2, h2 = n2[10] * o2, g2 = s2 + d2 + h2, _2 = 0;
    return g2 > 0 ? (_2 = Math.sqrt(g2 + 1) * 2, t2[3] = 0.25 * _2, t2[0] = (f2 - m2) / _2, t2[1] = (p2 - l2) / _2, t2[2] = (c2 - u2) / _2) : s2 > d2 && s2 > h2 ? (_2 = Math.sqrt(1 + s2 - d2 - h2) * 2, t2[3] = (f2 - m2) / _2, t2[0] = 0.25 * _2, t2[1] = (c2 + u2) / _2, t2[2] = (p2 + l2) / _2) : d2 > h2 ? (_2 = Math.sqrt(1 + d2 - s2 - h2) * 2, t2[3] = (p2 - l2) / _2, t2[0] = (c2 + u2) / _2, t2[1] = 0.25 * _2, t2[2] = (f2 + m2) / _2) : (_2 = Math.sqrt(1 + h2 - s2 - d2) * 2, t2[3] = (c2 - u2) / _2, t2[0] = (p2 + l2) / _2, t2[1] = (f2 + m2) / _2, t2[2] = 0.25 * _2), t2;
  };
})();
function Ha(e21, t2, n2, r2) {
  let i2 = yi([e21[0], e21[1], e21[2]]), a2 = yi([e21[4], e21[5], e21[6]]), o2 = yi([e21[8], e21[9], e21[10]]);
  Na(e21) < 0 && (i2 = -i2), n2[0] = e21[12], n2[1] = e21[13], n2[2] = e21[14];
  let s2 = e21.slice(), c2 = 1 / i2, l2 = 1 / a2, u2 = 1 / o2;
  s2[0] *= c2, s2[1] *= c2, s2[2] *= c2, s2[4] *= l2, s2[5] *= l2, s2[6] *= l2, s2[8] *= u2, s2[9] *= u2, s2[10] *= u2, Va(t2, s2), r2[0] = i2, r2[1] = a2, r2[2] = o2;
}
function Ua(e21, t2, n2, r2) {
  let i2 = e21, a2 = t2[0], o2 = t2[1], s2 = t2[2], c2 = t2[3], l2 = a2 + a2, u2 = o2 + o2, d2 = s2 + s2, f2 = a2 * l2, p2 = a2 * u2, m2 = a2 * d2, h2 = o2 * u2, g2 = o2 * d2, _2 = s2 * d2, v2 = c2 * l2, y2 = c2 * u2, b2 = c2 * d2, x2 = r2[0], S2 = r2[1], C2 = r2[2];
  return i2[0] = (1 - (h2 + _2)) * x2, i2[1] = (p2 + b2) * x2, i2[2] = (m2 - y2) * x2, i2[3] = 0, i2[4] = (p2 - b2) * S2, i2[5] = (1 - (f2 + _2)) * S2, i2[6] = (g2 + v2) * S2, i2[7] = 0, i2[8] = (m2 + y2) * C2, i2[9] = (g2 - v2) * C2, i2[10] = (1 - (f2 + h2)) * C2, i2[11] = 0, i2[12] = n2[0], i2[13] = n2[1], i2[14] = n2[2], i2[15] = 1, i2;
}
function Wa(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = n2 + n2, s2 = r2 + r2, c2 = i2 + i2, l2 = n2 * o2, u2 = r2 * o2, d2 = r2 * s2, f2 = i2 * o2, p2 = i2 * s2, m2 = i2 * c2, h2 = a2 * o2, g2 = a2 * s2, _2 = a2 * c2;
  return e21[0] = 1 - d2 - m2, e21[1] = u2 + _2, e21[2] = f2 - g2, e21[3] = 0, e21[4] = u2 - _2, e21[5] = 1 - l2 - m2, e21[6] = p2 + h2, e21[7] = 0, e21[8] = f2 + g2, e21[9] = p2 - h2, e21[10] = 1 - l2 - d2, e21[11] = 0, e21[12] = 0, e21[13] = 0, e21[14] = 0, e21[15] = 1, e21;
}
function Ga(e21, t2, n2, r2, i2) {
  let a2 = 1 / Math.tan(t2 / 2), o2 = 1 / (r2 - i2);
  return e21[0] = a2 / n2, e21[1] = 0, e21[2] = 0, e21[3] = 0, e21[4] = 0, e21[5] = a2, e21[6] = 0, e21[7] = 0, e21[8] = 0, e21[9] = 0, e21[10] = (i2 + r2) * o2, e21[11] = -1, e21[12] = 0, e21[13] = 0, e21[14] = 2 * i2 * r2 * o2, e21[15] = 0, e21;
}
function Ka(e21, t2, n2, r2, i2, a2, o2) {
  let s2 = 1 / (t2 - n2), c2 = 1 / (r2 - i2), l2 = 1 / (a2 - o2);
  return e21[0] = -2 * s2, e21[1] = 0, e21[2] = 0, e21[3] = 0, e21[4] = 0, e21[5] = -2 * c2, e21[6] = 0, e21[7] = 0, e21[8] = 0, e21[9] = 0, e21[10] = 2 * l2, e21[11] = 0, e21[12] = (t2 + n2) * s2, e21[13] = (i2 + r2) * c2, e21[14] = (o2 + a2) * l2, e21[15] = 1, e21;
}
function qa(e21, t2, n2, r2) {
  let i2 = t2[0], a2 = t2[1], o2 = t2[2], s2 = r2[0], c2 = r2[1], l2 = r2[2], u2 = i2 - n2[0], d2 = a2 - n2[1], f2 = o2 - n2[2], p2 = u2 * u2 + d2 * d2 + f2 * f2;
  p2 === 0 ? f2 = 1 : (p2 = 1 / Math.sqrt(p2), u2 *= p2, d2 *= p2, f2 *= p2);
  let m2 = c2 * f2 - l2 * d2, h2 = l2 * u2 - s2 * f2, g2 = s2 * d2 - c2 * u2;
  return p2 = m2 * m2 + h2 * h2 + g2 * g2, p2 === 0 && (l2 ? s2 += 1e-6 : c2 ? l2 += 1e-6 : c2 += 1e-6, m2 = c2 * f2 - l2 * d2, h2 = l2 * u2 - s2 * f2, g2 = s2 * d2 - c2 * u2, p2 = m2 * m2 + h2 * h2 + g2 * g2), p2 = 1 / Math.sqrt(p2), m2 *= p2, h2 *= p2, g2 *= p2, e21[0] = m2, e21[1] = h2, e21[2] = g2, e21[3] = 0, e21[4] = d2 * g2 - f2 * h2, e21[5] = f2 * m2 - u2 * g2, e21[6] = u2 * h2 - d2 * m2, e21[7] = 0, e21[8] = u2, e21[9] = d2, e21[10] = f2, e21[11] = 0, e21[12] = i2, e21[13] = a2, e21[14] = o2, e21[15] = 1, e21;
}
function Ja(e21, t2, n2) {
  return e21[0] = t2[0] + n2[0], e21[1] = t2[1] + n2[1], e21[2] = t2[2] + n2[2], e21[3] = t2[3] + n2[3], e21[4] = t2[4] + n2[4], e21[5] = t2[5] + n2[5], e21[6] = t2[6] + n2[6], e21[7] = t2[7] + n2[7], e21[8] = t2[8] + n2[8], e21[9] = t2[9] + n2[9], e21[10] = t2[10] + n2[10], e21[11] = t2[11] + n2[11], e21[12] = t2[12] + n2[12], e21[13] = t2[13] + n2[13], e21[14] = t2[14] + n2[14], e21[15] = t2[15] + n2[15], e21;
}
function Ya(e21, t2, n2) {
  return e21[0] = t2[0] - n2[0], e21[1] = t2[1] - n2[1], e21[2] = t2[2] - n2[2], e21[3] = t2[3] - n2[3], e21[4] = t2[4] - n2[4], e21[5] = t2[5] - n2[5], e21[6] = t2[6] - n2[6], e21[7] = t2[7] - n2[7], e21[8] = t2[8] - n2[8], e21[9] = t2[9] - n2[9], e21[10] = t2[10] - n2[10], e21[11] = t2[11] - n2[11], e21[12] = t2[12] - n2[12], e21[13] = t2[13] - n2[13], e21[14] = t2[14] - n2[14], e21[15] = t2[15] - n2[15], e21;
}
function Xa(e21, t2, n2) {
  return e21[0] = t2[0] * n2, e21[1] = t2[1] * n2, e21[2] = t2[2] * n2, e21[3] = t2[3] * n2, e21[4] = t2[4] * n2, e21[5] = t2[5] * n2, e21[6] = t2[6] * n2, e21[7] = t2[7] * n2, e21[8] = t2[8] * n2, e21[9] = t2[9] * n2, e21[10] = t2[10] * n2, e21[11] = t2[11] * n2, e21[12] = t2[12] * n2, e21[13] = t2[13] * n2, e21[14] = t2[14] * n2, e21[15] = t2[15] * n2, e21;
}
var Za = class extends Array {
  constructor(e21 = 1, t2 = 0, n2 = 0, r2 = 0, i2 = 0, a2 = 1, o2 = 0, s2 = 0, c2 = 0, l2 = 0, u2 = 1, d2 = 0, f2 = 0, p2 = 0, m2 = 0, h2 = 1) {
    return super(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2, m2, h2), this;
  }
  get x() {
    return this[12];
  }
  get y() {
    return this[13];
  }
  get z() {
    return this[14];
  }
  get w() {
    return this[15];
  }
  set x(e21) {
    this[12] = e21;
  }
  set y(e21) {
    this[13] = e21;
  }
  set z(e21) {
    this[14] = e21;
  }
  set w(e21) {
    this[15] = e21;
  }
  set(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2, m2, h2) {
    return e21.length ? this.copy(e21) : (Aa(this, e21, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2, m2, h2), this);
  }
  translate(e21, t2 = this) {
    return Fa(this, t2, e21), this;
  }
  rotate(e21, t2, n2 = this) {
    return La(this, n2, e21, t2), this;
  }
  scale(e21, t2 = this) {
    return Ia(this, t2, typeof e21 == `number` ? [e21, e21, e21] : e21), this;
  }
  add(e21, t2) {
    return t2 ? Ja(this, e21, t2) : Ja(this, this, e21), this;
  }
  sub(e21, t2) {
    return t2 ? Ya(this, e21, t2) : Ya(this, this, e21), this;
  }
  multiply(e21, t2) {
    return e21.length ? t2 ? Pa(this, e21, t2) : Pa(this, this, e21) : Xa(this, this, e21), this;
  }
  identity() {
    return ja(this), this;
  }
  copy(e21) {
    return ka(this, e21), this;
  }
  fromPerspective({ fov: e21, aspect: t2, near: n2, far: r2 } = {}) {
    return Ga(this, e21, t2, n2, r2), this;
  }
  fromOrthogonal({ left: e21, right: t2, bottom: n2, top: r2, near: i2, far: a2 }) {
    return Ka(this, e21, t2, n2, r2, i2, a2), this;
  }
  fromQuaternion(e21) {
    return Wa(this, e21), this;
  }
  setPosition(e21) {
    return this.x = e21[0], this.y = e21[1], this.z = e21[2], this;
  }
  inverse(e21 = this) {
    return Ma(this, e21), this;
  }
  compose(e21, t2, n2) {
    return Ua(this, e21, t2, n2), this;
  }
  decompose(e21, t2, n2) {
    return Ha(this, e21, t2, n2), this;
  }
  getRotation(e21) {
    return Va(e21, this), this;
  }
  getTranslation(e21) {
    return Ra(e21, this), this;
  }
  getScaling(e21) {
    return za(e21, this), this;
  }
  getMaxScaleOnAxis() {
    return Ba(this);
  }
  lookAt(e21, t2, n2) {
    return qa(this, e21, t2, n2), this;
  }
  determinant() {
    return Na(this);
  }
  fromArray(e21, t2 = 0) {
    return this[0] = e21[t2], this[1] = e21[t2 + 1], this[2] = e21[t2 + 2], this[3] = e21[t2 + 3], this[4] = e21[t2 + 4], this[5] = e21[t2 + 5], this[6] = e21[t2 + 6], this[7] = e21[t2 + 7], this[8] = e21[t2 + 8], this[9] = e21[t2 + 9], this[10] = e21[t2 + 10], this[11] = e21[t2 + 11], this[12] = e21[t2 + 12], this[13] = e21[t2 + 13], this[14] = e21[t2 + 14], this[15] = e21[t2 + 15], this;
  }
  toArray(e21 = [], t2 = 0) {
    return e21[t2] = this[0], e21[t2 + 1] = this[1], e21[t2 + 2] = this[2], e21[t2 + 3] = this[3], e21[t2 + 4] = this[4], e21[t2 + 5] = this[5], e21[t2 + 6] = this[6], e21[t2 + 7] = this[7], e21[t2 + 8] = this[8], e21[t2 + 9] = this[9], e21[t2 + 10] = this[10], e21[t2 + 11] = this[11], e21[t2 + 12] = this[12], e21[t2 + 13] = this[13], e21[t2 + 14] = this[14], e21[t2 + 15] = this[15], e21;
  }
};
function Qa(e21, t2, n2 = `YXZ`) {
  return n2 === `XYZ` ? (e21[1] = Math.asin(Math.min(Math.max(t2[8], -1), 1)), Math.abs(t2[8]) < 0.99999 ? (e21[0] = Math.atan2(-t2[9], t2[10]), e21[2] = Math.atan2(-t2[4], t2[0])) : (e21[0] = Math.atan2(t2[6], t2[5]), e21[2] = 0)) : n2 === `YXZ` ? (e21[0] = Math.asin(-Math.min(Math.max(t2[9], -1), 1)), Math.abs(t2[9]) < 0.99999 ? (e21[1] = Math.atan2(t2[8], t2[10]), e21[2] = Math.atan2(t2[1], t2[5])) : (e21[1] = Math.atan2(-t2[2], t2[0]), e21[2] = 0)) : n2 === `ZXY` ? (e21[0] = Math.asin(Math.min(Math.max(t2[6], -1), 1)), Math.abs(t2[6]) < 0.99999 ? (e21[1] = Math.atan2(-t2[2], t2[10]), e21[2] = Math.atan2(-t2[4], t2[5])) : (e21[1] = 0, e21[2] = Math.atan2(t2[1], t2[0]))) : n2 === `ZYX` ? (e21[1] = Math.asin(-Math.min(Math.max(t2[2], -1), 1)), Math.abs(t2[2]) < 0.99999 ? (e21[0] = Math.atan2(t2[6], t2[10]), e21[2] = Math.atan2(t2[1], t2[0])) : (e21[0] = 0, e21[2] = Math.atan2(-t2[4], t2[5]))) : n2 === `YZX` ? (e21[2] = Math.asin(Math.min(Math.max(t2[1], -1), 1)), Math.abs(t2[1]) < 0.99999 ? (e21[0] = Math.atan2(-t2[9], t2[5]), e21[1] = Math.atan2(-t2[2], t2[0])) : (e21[0] = 0, e21[1] = Math.atan2(t2[8], t2[10]))) : n2 === `XZY` && (e21[2] = Math.asin(-Math.min(Math.max(t2[4], -1), 1)), Math.abs(t2[4]) < 0.99999 ? (e21[0] = Math.atan2(t2[6], t2[5]), e21[1] = Math.atan2(t2[8], t2[0])) : (e21[0] = Math.atan2(-t2[9], t2[10]), e21[1] = 0)), e21;
}
var $a = new Za(), eo = class extends Array {
  constructor(e21 = 0, t2 = e21, n2 = e21, r2 = `YXZ`) {
    super(e21, t2, n2), this.order = r2, this.onChange = () => {
    }, this._target = this;
    let i2 = [`0`, `1`, `2`];
    return new Proxy(this, { set(e22, t3) {
      let n3 = Reflect.set(...arguments);
      return n3 && i2.includes(t3) && e22.onChange(), n3;
    } });
  }
  get x() {
    return this[0];
  }
  get y() {
    return this[1];
  }
  get z() {
    return this[2];
  }
  set x(e21) {
    this._target[0] = e21, this.onChange();
  }
  set y(e21) {
    this._target[1] = e21, this.onChange();
  }
  set z(e21) {
    this._target[2] = e21, this.onChange();
  }
  set(e21, t2 = e21, n2 = e21) {
    return e21.length ? this.copy(e21) : (this._target[0] = e21, this._target[1] = t2, this._target[2] = n2, this.onChange(), this);
  }
  copy(e21) {
    return this._target[0] = e21[0], this._target[1] = e21[1], this._target[2] = e21[2], this.onChange(), this;
  }
  reorder(e21) {
    return this._target.order = e21, this.onChange(), this;
  }
  fromRotationMatrix(e21, t2 = this.order) {
    return Qa(this._target, e21, t2), this.onChange(), this;
  }
  fromQuaternion(e21, t2 = this.order, n2) {
    return $a.fromQuaternion(e21), this._target.fromRotationMatrix($a, t2), n2 || this.onChange(), this;
  }
  fromArray(e21, t2 = 0) {
    return this._target[0] = e21[t2], this._target[1] = e21[t2 + 1], this._target[2] = e21[t2 + 2], this;
  }
  toArray(e21 = [], t2 = 0) {
    return e21[t2] = this[0], e21[t2 + 1] = this[1], e21[t2 + 2] = this[2], e21;
  }
}, to = class {
  constructor() {
    this.parent = null, this.children = [], this.visible = true, this.matrix = new Za(), this.worldMatrix = new Za(), this.matrixAutoUpdate = true, this.worldMatrixNeedsUpdate = false, this.position = new Ui(), this.quaternion = new Da(), this.scale = new Ui(1), this.rotation = new eo(), this.up = new Ui(0, 1, 0), this.rotation._target.onChange = () => this.quaternion.fromEuler(this.rotation, true), this.quaternion._target.onChange = () => this.rotation.fromQuaternion(this.quaternion, void 0, true);
  }
  setParent(e21, t2 = true) {
    this.parent && e21 !== this.parent && this.parent.removeChild(this, false), this.parent = e21, t2 && e21 && e21.addChild(this, false);
  }
  addChild(e21, t2 = true) {
    ~this.children.indexOf(e21) || this.children.push(e21), t2 && e21.setParent(this, false);
  }
  removeChild(e21, t2 = true) {
    ~this.children.indexOf(e21) && this.children.splice(this.children.indexOf(e21), 1), t2 && e21.setParent(null, false);
  }
  updateMatrixWorld(e21) {
    this.matrixAutoUpdate && this.updateMatrix(), (this.worldMatrixNeedsUpdate || e21) && (this.parent === null ? this.worldMatrix.copy(this.matrix) : this.worldMatrix.multiply(this.parent.worldMatrix, this.matrix), this.worldMatrixNeedsUpdate = false, e21 = true);
    for (let t2 = 0, n2 = this.children.length; t2 < n2; t2++) this.children[t2].updateMatrixWorld(e21);
  }
  updateMatrix() {
    this.matrix.compose(this.quaternion, this.position, this.scale), this.worldMatrixNeedsUpdate = true;
  }
  traverse(e21) {
    if (!e21(this)) for (let t2 = 0, n2 = this.children.length; t2 < n2; t2++) this.children[t2].traverse(e21);
  }
  decompose() {
    this.matrix.decompose(this.quaternion._target, this.position, this.scale), this.rotation.fromQuaternion(this.quaternion);
  }
  lookAt(e21, t2 = false) {
    t2 ? this.matrix.lookAt(this.position, e21, this.up) : this.matrix.lookAt(e21, this.position, this.up), this.matrix.getRotation(this.quaternion._target), this.rotation.fromQuaternion(this.quaternion);
  }
}, no = new Za(), ro = new Ui(), io = new Ui(), ao = class extends to {
  constructor(e21, { near: t2 = 0.1, far: n2 = 100, fov: r2 = 45, aspect: i2 = 1, left: a2, right: o2, bottom: s2, top: c2, zoom: l2 = 1 } = {}) {
    super(), Object.assign(this, { near: t2, far: n2, fov: r2, aspect: i2, left: a2, right: o2, bottom: s2, top: c2, zoom: l2 }), this.projectionMatrix = new Za(), this.viewMatrix = new Za(), this.projectionViewMatrix = new Za(), this.worldPosition = new Ui(), this.type = a2 || o2 ? `orthographic` : `perspective`, this.type === `orthographic` ? this.orthographic() : this.perspective();
  }
  perspective({ near: e21 = this.near, far: t2 = this.far, fov: n2 = this.fov, aspect: r2 = this.aspect } = {}) {
    return Object.assign(this, { near: e21, far: t2, fov: n2, aspect: r2 }), this.projectionMatrix.fromPerspective({ fov: Math.PI / 180 * n2, aspect: r2, near: e21, far: t2 }), this.type = `perspective`, this;
  }
  orthographic({ near: e21 = this.near, far: t2 = this.far, left: n2 = this.left || -1, right: r2 = this.right || 1, bottom: i2 = this.bottom || -1, top: a2 = this.top || 1, zoom: o2 = this.zoom } = {}) {
    return Object.assign(this, { near: e21, far: t2, left: n2, right: r2, bottom: i2, top: a2, zoom: o2 }), n2 /= o2, r2 /= o2, i2 /= o2, a2 /= o2, this.projectionMatrix.fromOrthogonal({ left: n2, right: r2, bottom: i2, top: a2, near: e21, far: t2 }), this.type = `orthographic`, this;
  }
  updateMatrixWorld() {
    return super.updateMatrixWorld(), this.viewMatrix.inverse(this.worldMatrix), this.worldMatrix.getTranslation(this.worldPosition), this.projectionViewMatrix.multiply(this.projectionMatrix, this.viewMatrix), this;
  }
  updateProjectionMatrix() {
    return this.type === `perspective` ? this.perspective() : this.orthographic();
  }
  lookAt(e21) {
    return super.lookAt(e21, true), this;
  }
  project(e21) {
    return e21.applyMatrix4(this.viewMatrix), e21.applyMatrix4(this.projectionMatrix), this;
  }
  unproject(e21) {
    return e21.applyMatrix4(no.inverse(this.projectionMatrix)), e21.applyMatrix4(this.worldMatrix), this;
  }
  updateFrustum() {
    this.frustum || (this.frustum = [new Ui(), new Ui(), new Ui(), new Ui(), new Ui(), new Ui()]);
    let e21 = this.projectionViewMatrix;
    this.frustum[0].set(e21[3] - e21[0], e21[7] - e21[4], e21[11] - e21[8]).constant = e21[15] - e21[12], this.frustum[1].set(e21[3] + e21[0], e21[7] + e21[4], e21[11] + e21[8]).constant = e21[15] + e21[12], this.frustum[2].set(e21[3] + e21[1], e21[7] + e21[5], e21[11] + e21[9]).constant = e21[15] + e21[13], this.frustum[3].set(e21[3] - e21[1], e21[7] - e21[5], e21[11] - e21[9]).constant = e21[15] - e21[13], this.frustum[4].set(e21[3] - e21[2], e21[7] - e21[6], e21[11] - e21[10]).constant = e21[15] - e21[14], this.frustum[5].set(e21[3] + e21[2], e21[7] + e21[6], e21[11] + e21[10]).constant = e21[15] + e21[14];
    for (let e22 = 0; e22 < 6; e22++) {
      let t2 = 1 / this.frustum[e22].distance();
      this.frustum[e22].multiply(t2), this.frustum[e22].constant *= t2;
    }
  }
  frustumIntersectsMesh(e21, t2 = e21.worldMatrix) {
    if (!e21.geometry.attributes.position || (e21.geometry.bounds && e21.geometry.bounds.radius !== 1 / 0 || e21.geometry.computeBoundingSphere(), !e21.geometry.bounds)) return true;
    let n2 = ro;
    n2.copy(e21.geometry.bounds.center), n2.applyMatrix4(t2);
    let r2 = e21.geometry.bounds.radius * t2.getMaxScaleOnAxis();
    return this.frustumIntersectsSphere(n2, r2);
  }
  frustumIntersectsSphere(e21, t2) {
    let n2 = io;
    for (let r2 = 0; r2 < 6; r2++) {
      let i2 = this.frustum[r2];
      if (n2.copy(i2).dot(e21) + i2.constant < -t2) return false;
    }
    return true;
  }
};
function oo(e21, t2) {
  return e21[0] = t2[0], e21[1] = t2[1], e21[2] = t2[2], e21[3] = t2[4], e21[4] = t2[5], e21[5] = t2[6], e21[6] = t2[8], e21[7] = t2[9], e21[8] = t2[10], e21;
}
function so(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = n2 + n2, s2 = r2 + r2, c2 = i2 + i2, l2 = n2 * o2, u2 = r2 * o2, d2 = r2 * s2, f2 = i2 * o2, p2 = i2 * s2, m2 = i2 * c2, h2 = a2 * o2, g2 = a2 * s2, _2 = a2 * c2;
  return e21[0] = 1 - d2 - m2, e21[3] = u2 - _2, e21[6] = f2 + g2, e21[1] = u2 + _2, e21[4] = 1 - l2 - m2, e21[7] = p2 - h2, e21[2] = f2 - g2, e21[5] = p2 + h2, e21[8] = 1 - l2 - d2, e21;
}
function co(e21, t2) {
  return e21[0] = t2[0], e21[1] = t2[1], e21[2] = t2[2], e21[3] = t2[3], e21[4] = t2[4], e21[5] = t2[5], e21[6] = t2[6], e21[7] = t2[7], e21[8] = t2[8], e21;
}
function lo(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2) {
  return e21[0] = t2, e21[1] = n2, e21[2] = r2, e21[3] = i2, e21[4] = a2, e21[5] = o2, e21[6] = s2, e21[7] = c2, e21[8] = l2, e21;
}
function uo(e21) {
  return e21[0] = 1, e21[1] = 0, e21[2] = 0, e21[3] = 0, e21[4] = 1, e21[5] = 0, e21[6] = 0, e21[7] = 0, e21[8] = 1, e21;
}
function fo(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = t2[4], s2 = t2[5], c2 = t2[6], l2 = t2[7], u2 = t2[8], d2 = u2 * o2 - s2 * l2, f2 = -u2 * a2 + s2 * c2, p2 = l2 * a2 - o2 * c2, m2 = n2 * d2 + r2 * f2 + i2 * p2;
  return m2 ? (m2 = 1 / m2, e21[0] = d2 * m2, e21[1] = (-u2 * r2 + i2 * l2) * m2, e21[2] = (s2 * r2 - i2 * o2) * m2, e21[3] = f2 * m2, e21[4] = (u2 * n2 - i2 * c2) * m2, e21[5] = (-s2 * n2 + i2 * a2) * m2, e21[6] = p2 * m2, e21[7] = (-l2 * n2 + r2 * c2) * m2, e21[8] = (o2 * n2 - r2 * a2) * m2, e21) : null;
}
function po(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = t2[4], c2 = t2[5], l2 = t2[6], u2 = t2[7], d2 = t2[8], f2 = n2[0], p2 = n2[1], m2 = n2[2], h2 = n2[3], g2 = n2[4], _2 = n2[5], v2 = n2[6], y2 = n2[7], b2 = n2[8];
  return e21[0] = f2 * r2 + p2 * o2 + m2 * l2, e21[1] = f2 * i2 + p2 * s2 + m2 * u2, e21[2] = f2 * a2 + p2 * c2 + m2 * d2, e21[3] = h2 * r2 + g2 * o2 + _2 * l2, e21[4] = h2 * i2 + g2 * s2 + _2 * u2, e21[5] = h2 * a2 + g2 * c2 + _2 * d2, e21[6] = v2 * r2 + y2 * o2 + b2 * l2, e21[7] = v2 * i2 + y2 * s2 + b2 * u2, e21[8] = v2 * a2 + y2 * c2 + b2 * d2, e21;
}
function mo(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = t2[4], c2 = t2[5], l2 = t2[6], u2 = t2[7], d2 = t2[8], f2 = n2[0], p2 = n2[1];
  return e21[0] = r2, e21[1] = i2, e21[2] = a2, e21[3] = o2, e21[4] = s2, e21[5] = c2, e21[6] = f2 * r2 + p2 * o2 + l2, e21[7] = f2 * i2 + p2 * s2 + u2, e21[8] = f2 * a2 + p2 * c2 + d2, e21;
}
function ho(e21, t2, n2) {
  let r2 = t2[0], i2 = t2[1], a2 = t2[2], o2 = t2[3], s2 = t2[4], c2 = t2[5], l2 = t2[6], u2 = t2[7], d2 = t2[8], f2 = Math.sin(n2), p2 = Math.cos(n2);
  return e21[0] = p2 * r2 + f2 * o2, e21[1] = p2 * i2 + f2 * s2, e21[2] = p2 * a2 + f2 * c2, e21[3] = p2 * o2 - f2 * r2, e21[4] = p2 * s2 - f2 * i2, e21[5] = p2 * c2 - f2 * a2, e21[6] = l2, e21[7] = u2, e21[8] = d2, e21;
}
function go(e21, t2, n2) {
  let r2 = n2[0], i2 = n2[1];
  return e21[0] = r2 * t2[0], e21[1] = r2 * t2[1], e21[2] = r2 * t2[2], e21[3] = i2 * t2[3], e21[4] = i2 * t2[4], e21[5] = i2 * t2[5], e21[6] = t2[6], e21[7] = t2[7], e21[8] = t2[8], e21;
}
function _o(e21, t2) {
  let n2 = t2[0], r2 = t2[1], i2 = t2[2], a2 = t2[3], o2 = t2[4], s2 = t2[5], c2 = t2[6], l2 = t2[7], u2 = t2[8], d2 = t2[9], f2 = t2[10], p2 = t2[11], m2 = t2[12], h2 = t2[13], g2 = t2[14], _2 = t2[15], v2 = n2 * s2 - r2 * o2, y2 = n2 * c2 - i2 * o2, b2 = n2 * l2 - a2 * o2, x2 = r2 * c2 - i2 * s2, S2 = r2 * l2 - a2 * s2, C2 = i2 * l2 - a2 * c2, w2 = u2 * h2 - d2 * m2, T2 = u2 * g2 - f2 * m2, E2 = u2 * _2 - p2 * m2, D2 = d2 * g2 - f2 * h2, O2 = d2 * _2 - p2 * h2, k2 = f2 * _2 - p2 * g2, A2 = v2 * k2 - y2 * O2 + b2 * D2 + x2 * E2 - S2 * T2 + C2 * w2;
  return A2 ? (A2 = 1 / A2, e21[0] = (s2 * k2 - c2 * O2 + l2 * D2) * A2, e21[1] = (c2 * E2 - o2 * k2 - l2 * T2) * A2, e21[2] = (o2 * O2 - s2 * E2 + l2 * w2) * A2, e21[3] = (i2 * O2 - r2 * k2 - a2 * D2) * A2, e21[4] = (n2 * k2 - i2 * E2 + a2 * T2) * A2, e21[5] = (r2 * E2 - n2 * O2 - a2 * w2) * A2, e21[6] = (h2 * C2 - g2 * S2 + _2 * x2) * A2, e21[7] = (g2 * b2 - m2 * C2 - _2 * y2) * A2, e21[8] = (m2 * S2 - h2 * b2 + _2 * v2) * A2, e21) : null;
}
var vo = class extends Array {
  constructor(e21 = 1, t2 = 0, n2 = 0, r2 = 0, i2 = 1, a2 = 0, o2 = 0, s2 = 0, c2 = 1) {
    return super(e21, t2, n2, r2, i2, a2, o2, s2, c2), this;
  }
  set(e21, t2, n2, r2, i2, a2, o2, s2, c2) {
    return e21.length ? this.copy(e21) : (lo(this, e21, t2, n2, r2, i2, a2, o2, s2, c2), this);
  }
  translate(e21, t2 = this) {
    return mo(this, t2, e21), this;
  }
  rotate(e21, t2 = this) {
    return ho(this, t2, e21), this;
  }
  scale(e21, t2 = this) {
    return go(this, t2, e21), this;
  }
  multiply(e21, t2) {
    return t2 ? po(this, e21, t2) : po(this, this, e21), this;
  }
  identity() {
    return uo(this), this;
  }
  copy(e21) {
    return co(this, e21), this;
  }
  fromMatrix4(e21) {
    return oo(this, e21), this;
  }
  fromQuaternion(e21) {
    return so(this, e21), this;
  }
  fromBasis(e21, t2, n2) {
    return this.set(e21[0], e21[1], e21[2], t2[0], t2[1], t2[2], n2[0], n2[1], n2[2]), this;
  }
  inverse(e21 = this) {
    return fo(this, e21), this;
  }
  getNormalMatrix(e21) {
    return _o(this, e21), this;
  }
}, yo = 0, bo = class extends to {
  constructor(e21, { geometry: t2, program: n2, mode: r2 = e21.TRIANGLES, frustumCulled: i2 = true, renderOrder: a2 = 0 } = {}) {
    super(), e21.canvas || console.error(`gl not passed as first argument to Mesh`), this.gl = e21, this.id = yo++, this.geometry = t2, this.program = n2, this.mode = r2, this.frustumCulled = i2, this.renderOrder = a2, this.modelViewMatrix = new Za(), this.normalMatrix = new vo(), this.beforeRenderCallbacks = [], this.afterRenderCallbacks = [];
  }
  onBeforeRender(e21) {
    return this.beforeRenderCallbacks.push(e21), this;
  }
  onAfterRender(e21) {
    return this.afterRenderCallbacks.push(e21), this;
  }
  draw({ camera: e21 } = {}) {
    e21 && (this.program.uniforms.modelMatrix || Object.assign(this.program.uniforms, { modelMatrix: { value: null }, viewMatrix: { value: null }, modelViewMatrix: { value: null }, normalMatrix: { value: null }, projectionMatrix: { value: null }, cameraPosition: { value: null } }), this.program.uniforms.projectionMatrix.value = e21.projectionMatrix, this.program.uniforms.cameraPosition.value = e21.worldPosition, this.program.uniforms.viewMatrix.value = e21.viewMatrix, this.modelViewMatrix.multiply(e21.viewMatrix, this.worldMatrix), this.normalMatrix.getNormalMatrix(this.modelViewMatrix), this.program.uniforms.modelMatrix.value = this.worldMatrix, this.program.uniforms.modelViewMatrix.value = this.modelViewMatrix, this.program.uniforms.normalMatrix.value = this.normalMatrix), this.beforeRenderCallbacks.forEach((t3) => t3 && t3({ mesh: this, camera: e21 }));
    let t2 = this.program.cullFace && this.worldMatrix.determinant() < 0;
    this.program.use({ flipFaces: t2 }), this.geometry.draw({ mode: this.mode, program: this.program }), this.afterRenderCallbacks.forEach((t3) => t3 && t3({ mesh: this, camera: e21 }));
  }
}, xo = new Uint8Array(4);
function So(e21) {
  return !(e21 & e21 - 1);
}
var Co = 1, wo = class {
  constructor(e21, { image: t2, target: n2 = e21.TEXTURE_2D, type: r2 = e21.UNSIGNED_BYTE, format: i2 = e21.RGBA, internalFormat: a2 = i2, wrapS: o2 = e21.CLAMP_TO_EDGE, wrapT: s2 = e21.CLAMP_TO_EDGE, wrapR: c2 = e21.CLAMP_TO_EDGE, generateMipmaps: l2 = n2 === (e21.TEXTURE_2D || e21.TEXTURE_CUBE_MAP), minFilter: u2 = l2 ? e21.NEAREST_MIPMAP_LINEAR : e21.LINEAR, magFilter: d2 = e21.LINEAR, premultiplyAlpha: f2 = false, unpackAlignment: p2 = 4, flipY: m2 = n2 == (e21.TEXTURE_2D || e21.TEXTURE_3D), anisotropy: h2 = 0, level: g2 = 0, width: _2, height: v2 = _2, length: y2 = 1 } = {}) {
    this.gl = e21, this.id = Co++, this.image = t2, this.target = n2, this.type = r2, this.format = i2, this.internalFormat = a2, this.minFilter = u2, this.magFilter = d2, this.wrapS = o2, this.wrapT = s2, this.wrapR = c2, this.generateMipmaps = l2, this.premultiplyAlpha = f2, this.unpackAlignment = p2, this.flipY = m2, this.anisotropy = Math.min(h2, this.gl.renderer.parameters.maxAnisotropy), this.level = g2, this.width = _2, this.height = v2, this.length = y2, this.texture = this.gl.createTexture(), this.store = { image: null }, this.glState = this.gl.renderer.state, this.state = {}, this.state.minFilter = this.gl.NEAREST_MIPMAP_LINEAR, this.state.magFilter = this.gl.LINEAR, this.state.wrapS = this.gl.REPEAT, this.state.wrapT = this.gl.REPEAT, this.state.anisotropy = 0;
  }
  bind() {
    this.glState.textureUnits[this.glState.activeTextureUnit] !== this.id && (this.gl.bindTexture(this.target, this.texture), this.glState.textureUnits[this.glState.activeTextureUnit] = this.id);
  }
  update(e21 = 0) {
    let t2 = !(this.image === this.store.image && !this.needsUpdate);
    if ((t2 || this.glState.textureUnits[e21] !== this.id) && (this.gl.renderer.activeTexture(e21), this.bind()), t2) {
      if (this.needsUpdate = false, this.flipY !== this.glState.flipY && (this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, this.flipY), this.glState.flipY = this.flipY), this.premultiplyAlpha !== this.glState.premultiplyAlpha && (this.gl.pixelStorei(this.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, this.premultiplyAlpha), this.glState.premultiplyAlpha = this.premultiplyAlpha), this.unpackAlignment !== this.glState.unpackAlignment && (this.gl.pixelStorei(this.gl.UNPACK_ALIGNMENT, this.unpackAlignment), this.glState.unpackAlignment = this.unpackAlignment), this.minFilter !== this.state.minFilter && (this.gl.texParameteri(this.target, this.gl.TEXTURE_MIN_FILTER, this.minFilter), this.state.minFilter = this.minFilter), this.magFilter !== this.state.magFilter && (this.gl.texParameteri(this.target, this.gl.TEXTURE_MAG_FILTER, this.magFilter), this.state.magFilter = this.magFilter), this.wrapS !== this.state.wrapS && (this.gl.texParameteri(this.target, this.gl.TEXTURE_WRAP_S, this.wrapS), this.state.wrapS = this.wrapS), this.wrapT !== this.state.wrapT && (this.gl.texParameteri(this.target, this.gl.TEXTURE_WRAP_T, this.wrapT), this.state.wrapT = this.wrapT), this.wrapR !== this.state.wrapR && (this.gl.texParameteri(this.target, this.gl.TEXTURE_WRAP_R, this.wrapR), this.state.wrapR = this.wrapR), this.anisotropy && this.anisotropy !== this.state.anisotropy && (this.gl.texParameterf(this.target, this.gl.renderer.getExtension(`EXT_texture_filter_anisotropic`).TEXTURE_MAX_ANISOTROPY_EXT, this.anisotropy), this.state.anisotropy = this.anisotropy), this.image) {
        if (this.image.width && (this.width = this.image.width, this.height = this.image.height), this.target === this.gl.TEXTURE_CUBE_MAP) for (let e22 = 0; e22 < 6; e22++) this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + e22, this.level, this.internalFormat, this.format, this.type, this.image[e22]);
        else if (ArrayBuffer.isView(this.image)) this.target === this.gl.TEXTURE_2D ? this.gl.texImage2D(this.target, this.level, this.internalFormat, this.width, this.height, 0, this.format, this.type, this.image) : (this.target === this.gl.TEXTURE_2D_ARRAY || this.target === this.gl.TEXTURE_3D) && this.gl.texImage3D(this.target, this.level, this.internalFormat, this.width, this.height, this.length, 0, this.format, this.type, this.image);
        else if (this.image.isCompressedTexture) for (let e22 = 0; e22 < this.image.length; e22++) this.gl.compressedTexImage2D(this.target, e22, this.internalFormat, this.image[e22].width, this.image[e22].height, 0, this.image[e22].data);
        else this.target === this.gl.TEXTURE_2D ? this.gl.texImage2D(this.target, this.level, this.internalFormat, this.format, this.type, this.image) : this.gl.texImage3D(this.target, this.level, this.internalFormat, this.width, this.height, this.length, 0, this.format, this.type, this.image);
        this.generateMipmaps && (!this.gl.renderer.isWebgl2 && (!So(this.image.width) || !So(this.image.height)) ? (this.generateMipmaps = false, this.wrapS = this.wrapT = this.gl.CLAMP_TO_EDGE, this.minFilter = this.gl.LINEAR) : this.gl.generateMipmap(this.target)), this.onUpdate && this.onUpdate();
      } else if (this.target === this.gl.TEXTURE_CUBE_MAP) for (let e22 = 0; e22 < 6; e22++) this.gl.texImage2D(this.gl.TEXTURE_CUBE_MAP_POSITIVE_X + e22, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, xo);
      else this.width ? this.target === this.gl.TEXTURE_2D ? this.gl.texImage2D(this.target, this.level, this.internalFormat, this.width, this.height, 0, this.format, this.type, null) : this.gl.texImage3D(this.target, this.level, this.internalFormat, this.width, this.height, this.length, 0, this.format, this.type, null) : this.gl.texImage2D(this.target, 0, this.gl.RGBA, 1, 1, 0, this.gl.RGBA, this.gl.UNSIGNED_BYTE, xo);
      this.store.image = this.image;
    }
  }
}, To = class {
  constructor(e21, { width: t2 = e21.canvas.width, height: n2 = e21.canvas.height, target: r2 = e21.FRAMEBUFFER, color: i2 = 1, depth: a2 = true, stencil: o2 = false, depthTexture: s2 = false, wrapS: c2 = e21.CLAMP_TO_EDGE, wrapT: l2 = e21.CLAMP_TO_EDGE, wrapR: u2 = e21.CLAMP_TO_EDGE, minFilter: d2 = e21.LINEAR, magFilter: f2 = d2, type: p2 = e21.UNSIGNED_BYTE, format: m2 = e21.RGBA, internalFormat: h2 = m2, unpackAlignment: g2, premultiplyAlpha: _2 } = {}) {
    this.gl = e21, this.width = t2, this.height = n2, this.depth = a2, this.stencil = o2, this.buffer = this.gl.createFramebuffer(), this.target = r2, this.gl.renderer.bindFramebuffer(this), this.textures = [];
    let v2 = [];
    for (let r3 = 0; r3 < i2; r3++) this.textures.push(new wo(e21, { width: t2, height: n2, wrapS: c2, wrapT: l2, wrapR: u2, minFilter: d2, magFilter: f2, type: p2, format: m2, internalFormat: h2, unpackAlignment: g2, premultiplyAlpha: _2, flipY: false, generateMipmaps: false })), this.textures[r3].update(), this.gl.framebufferTexture2D(this.target, this.gl.COLOR_ATTACHMENT0 + r3, this.gl.TEXTURE_2D, this.textures[r3].texture, 0), v2.push(this.gl.COLOR_ATTACHMENT0 + r3);
    v2.length > 1 && this.gl.renderer.drawBuffers(v2), this.texture = this.textures[0], s2 && (this.gl.renderer.isWebgl2 || this.gl.renderer.getExtension(`WEBGL_depth_texture`)) ? (this.depthTexture = new wo(e21, { width: t2, height: n2, minFilter: this.gl.NEAREST, magFilter: this.gl.NEAREST, format: this.stencil ? this.gl.DEPTH_STENCIL : this.gl.DEPTH_COMPONENT, internalFormat: e21.renderer.isWebgl2 ? this.stencil ? this.gl.DEPTH24_STENCIL8 : this.gl.DEPTH_COMPONENT16 : this.gl.DEPTH_COMPONENT, type: this.stencil ? this.gl.UNSIGNED_INT_24_8 : this.gl.UNSIGNED_INT }), this.depthTexture.update(), this.gl.framebufferTexture2D(this.target, this.stencil ? this.gl.DEPTH_STENCIL_ATTACHMENT : this.gl.DEPTH_ATTACHMENT, this.gl.TEXTURE_2D, this.depthTexture.texture, 0)) : (a2 && !o2 && (this.depthBuffer = this.gl.createRenderbuffer(), this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.depthBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.DEPTH_COMPONENT16, t2, n2), this.gl.framebufferRenderbuffer(this.target, this.gl.DEPTH_ATTACHMENT, this.gl.RENDERBUFFER, this.depthBuffer)), o2 && !a2 && (this.stencilBuffer = this.gl.createRenderbuffer(), this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.stencilBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.STENCIL_INDEX8, t2, n2), this.gl.framebufferRenderbuffer(this.target, this.gl.STENCIL_ATTACHMENT, this.gl.RENDERBUFFER, this.stencilBuffer)), a2 && o2 && (this.depthStencilBuffer = this.gl.createRenderbuffer(), this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.depthStencilBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.DEPTH_STENCIL, t2, n2), this.gl.framebufferRenderbuffer(this.target, this.gl.DEPTH_STENCIL_ATTACHMENT, this.gl.RENDERBUFFER, this.depthStencilBuffer))), this.gl.renderer.bindFramebuffer({ target: this.target });
  }
  setSize(e21, t2) {
    if (this.width !== e21 || this.height !== t2) {
      this.width = e21, this.height = t2, this.gl.renderer.bindFramebuffer(this);
      for (let n2 = 0; n2 < this.textures.length; n2++) this.textures[n2].width = e21, this.textures[n2].height = t2, this.textures[n2].needsUpdate = true, this.textures[n2].update(), this.gl.framebufferTexture2D(this.target, this.gl.COLOR_ATTACHMENT0 + n2, this.gl.TEXTURE_2D, this.textures[n2].texture, 0);
      this.depthTexture ? (this.depthTexture.width = e21, this.depthTexture.height = t2, this.depthTexture.needsUpdate = true, this.depthTexture.update(), this.gl.framebufferTexture2D(this.target, this.gl.DEPTH_ATTACHMENT, this.gl.TEXTURE_2D, this.depthTexture.texture, 0)) : (this.depthBuffer && (this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.depthBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.DEPTH_COMPONENT16, e21, t2)), this.stencilBuffer && (this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.stencilBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.STENCIL_INDEX8, e21, t2)), this.depthStencilBuffer && (this.gl.bindRenderbuffer(this.gl.RENDERBUFFER, this.depthStencilBuffer), this.gl.renderbufferStorage(this.gl.RENDERBUFFER, this.gl.DEPTH_STENCIL, e21, t2))), this.gl.renderer.bindFramebuffer({ target: this.target });
    }
  }
}, Eo = class e16 extends Ji {
  constructor(t2, { width: n2 = 1, height: r2 = 1, widthSegments: i2 = 1, heightSegments: a2 = 1, attributes: o2 = {} } = {}) {
    let s2 = i2, c2 = a2, l2 = (s2 + 1) * (c2 + 1), u2 = s2 * c2 * 6, d2 = new Float32Array(l2 * 3), f2 = new Float32Array(l2 * 3), p2 = new Float32Array(l2 * 2), m2 = u2 > 65536 ? new Uint32Array(u2) : new Uint16Array(u2);
    e16.buildPlane(d2, f2, p2, m2, n2, r2, 0, s2, c2), Object.assign(o2, { position: { size: 3, data: d2 }, normal: { size: 3, data: f2 }, uv: { size: 2, data: p2 }, index: { data: m2 } }), super(t2, o2);
  }
  static buildPlane(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2 = 0, u2 = 1, d2 = 2, f2 = 1, p2 = -1, m2 = 0, h2 = 0) {
    let g2 = m2, _2 = i2 / s2, v2 = a2 / c2;
    for (let y2 = 0; y2 <= c2; y2++) {
      let b2 = y2 * v2 - a2 / 2;
      for (let a3 = 0; a3 <= s2; a3++, m2++) {
        let v3 = a3 * _2 - i2 / 2;
        if (e21[m2 * 3 + l2] = v3 * f2, e21[m2 * 3 + u2] = b2 * p2, e21[m2 * 3 + d2] = o2 / 2, t2[m2 * 3 + l2] = 0, t2[m2 * 3 + u2] = 0, t2[m2 * 3 + d2] = o2 >= 0 ? 1 : -1, n2[m2 * 2] = a3 / s2, n2[m2 * 2 + 1] = 1 - y2 / c2, y2 === c2 || a3 === s2) continue;
        let x2 = g2 + a3 + y2 * (s2 + 1), S2 = g2 + a3 + (y2 + 1) * (s2 + 1), C2 = g2 + a3 + (y2 + 1) * (s2 + 1) + 1, w2 = g2 + a3 + y2 * (s2 + 1) + 1;
        r2[h2 * 6] = x2, r2[h2 * 6 + 1] = S2, r2[h2 * 6 + 2] = w2, r2[h2 * 6 + 3] = S2, r2[h2 * 6 + 4] = C2, r2[h2 * 6 + 5] = w2, h2++;
      }
    }
  }
}, Do = class extends Ji {
  constructor(e21, { width: t2 = 1, height: n2 = 1, depth: r2 = 1, widthSegments: i2 = 1, heightSegments: a2 = 1, depthSegments: o2 = 1, attributes: s2 = {} } = {}) {
    let c2 = i2, l2 = a2, u2 = o2, d2 = (c2 + 1) * (l2 + 1) * 2 + (c2 + 1) * (u2 + 1) * 2 + (l2 + 1) * (u2 + 1) * 2, f2 = (c2 * l2 * 2 + c2 * u2 * 2 + l2 * u2 * 2) * 6, p2 = new Float32Array(d2 * 3), m2 = new Float32Array(d2 * 3), h2 = new Float32Array(d2 * 2), g2 = d2 > 65536 ? new Uint32Array(f2) : new Uint16Array(f2), _2 = 0, v2 = 0;
    Eo.buildPlane(p2, m2, h2, g2, r2, n2, t2, u2, l2, 2, 1, 0, -1, -1, _2, v2), _2 += (u2 + 1) * (l2 + 1), v2 += u2 * l2, Eo.buildPlane(p2, m2, h2, g2, r2, n2, -t2, u2, l2, 2, 1, 0, 1, -1, _2, v2), _2 += (u2 + 1) * (l2 + 1), v2 += u2 * l2, Eo.buildPlane(p2, m2, h2, g2, t2, r2, n2, u2, c2, 0, 2, 1, 1, 1, _2, v2), _2 += (c2 + 1) * (u2 + 1), v2 += c2 * u2, Eo.buildPlane(p2, m2, h2, g2, t2, r2, -n2, u2, c2, 0, 2, 1, 1, -1, _2, v2), _2 += (c2 + 1) * (u2 + 1), v2 += c2 * u2, Eo.buildPlane(p2, m2, h2, g2, t2, n2, -r2, c2, l2, 0, 1, 2, -1, -1, _2, v2), _2 += (c2 + 1) * (l2 + 1), v2 += c2 * l2, Eo.buildPlane(p2, m2, h2, g2, t2, n2, r2, c2, l2, 0, 1, 2, 1, -1, _2, v2), Object.assign(s2, { position: { size: 3, data: p2 }, normal: { size: 3, data: m2 }, uv: { size: 2, data: h2 }, index: { data: g2 } }), super(e21, s2);
  }
}, Oo = class extends Ji {
  constructor(e21, { radius: t2 = 0.5, widthSegments: n2 = 16, heightSegments: r2 = Math.ceil(n2 * 0.5), phiStart: i2 = 0, phiLength: a2 = Math.PI * 2, thetaStart: o2 = 0, thetaLength: s2 = Math.PI, attributes: c2 = {} } = {}) {
    let l2 = n2, u2 = r2, d2 = i2, f2 = a2, p2 = o2, m2 = s2, h2 = (l2 + 1) * (u2 + 1), g2 = l2 * u2 * 6, _2 = new Float32Array(h2 * 3), v2 = new Float32Array(h2 * 3), y2 = new Float32Array(h2 * 2), b2 = h2 > 65536 ? new Uint32Array(g2) : new Uint16Array(g2), x2 = 0, S2 = 0, C2 = 0, w2 = p2 + m2, T2 = [], E2 = new Ui();
    for (let e22 = 0; e22 <= u2; e22++) {
      let n3 = [], r3 = e22 / u2;
      for (let e23 = 0; e23 <= l2; e23++, x2++) {
        let i3 = e23 / l2, a3 = -t2 * Math.cos(d2 + i3 * f2) * Math.sin(p2 + r3 * m2), o3 = t2 * Math.cos(p2 + r3 * m2), s3 = t2 * Math.sin(d2 + i3 * f2) * Math.sin(p2 + r3 * m2);
        _2[x2 * 3] = a3, _2[x2 * 3 + 1] = o3, _2[x2 * 3 + 2] = s3, E2.set(a3, o3, s3).normalize(), v2[x2 * 3] = E2.x, v2[x2 * 3 + 1] = E2.y, v2[x2 * 3 + 2] = E2.z, y2[x2 * 2] = i3, y2[x2 * 2 + 1] = 1 - r3, n3.push(S2++);
      }
      T2.push(n3);
    }
    for (let e22 = 0; e22 < u2; e22++) for (let t3 = 0; t3 < l2; t3++) {
      let n3 = T2[e22][t3 + 1], r3 = T2[e22][t3], i3 = T2[e22 + 1][t3], a3 = T2[e22 + 1][t3 + 1];
      (e22 !== 0 || p2 > 0) && (b2[C2 * 3] = n3, b2[C2 * 3 + 1] = r3, b2[C2 * 3 + 2] = a3, C2++), (e22 !== u2 - 1 || w2 < Math.PI) && (b2[C2 * 3] = r3, b2[C2 * 3 + 1] = i3, b2[C2 * 3 + 2] = a3, C2++);
    }
    Object.assign(c2, { position: { size: 3, data: _2 }, normal: { size: 3, data: v2 }, uv: { size: 2, data: y2 }, index: { data: b2 } }), super(e21, c2);
  }
}, ko = `
attribute vec2 uv;
attribute vec3 position;
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(uRect.xy + position.xy * uRect.zw, 0.0, 1.0);
}
`, Ao = `
precision highp float;
varying vec2 vUv;

// object-fit: cover
vec2 coverUv(vec2 uv, vec2 plane, vec2 img) {
  float pr = plane.x / plane.y;
  float ir = img.x / img.y;
  vec2 s = pr > ir ? vec2(1.0, ir / pr) : vec2(pr / ir, 1.0);
  return (uv - 0.5) * s + 0.5;
}
float rrect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float maskRect(vec2 uv, vec2 plane, float radius) {
  vec2 p = (uv - 0.5) * plane;
  float sd = rrect(p, plane * 0.5, radius);
  return 1.0 - smoothstep(-0.75, 0.75, sd);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
// One grade for every image and video so stock from different shoots reads as one firm.
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.06);
  c = (c - 0.5) * 1.05 + 0.5;
  c += vec3(0.02, 0.009, -0.012) * l;
  c = pow(max(c, 0.0), vec3(0.97));
  return clamp(c, 0.0, 1.0);
}
float grain(vec2 fragCoord, float time, float amount) {
  return (hash12(fragCoord + fract(time) * 100.0) - 0.5) * amount;
}
`, jo = `
${Ao}
uniform sampler2D tMap;
uniform sampler2D tDepth;
uniform sampler2D tVideo;
uniform vec2 uPlane;
uniform vec2 uImage;
uniform vec2 uVideoRes;
uniform vec2 uMouse;
uniform vec2 uClip;      // visible band in CSS px from the top of the viewport: x = top, y = bottom
uniform float uViewH;
uniform float uDpr;
uniform float uParallax;
uniform float uZoom;
uniform float uVideoMix;
uniform float uRadius;
uniform float uAlpha;
uniform float uTime;
uniform float uGrain;
uniform float uDim;
uniform float uReveal;

void main() {
  vec2 cuv = coverUv(vUv, uPlane, uImage);
  float z = uZoom * (1.0 + (1.0 - uReveal) * 0.1);
  vec2 uv = (cuv - 0.5) / z + 0.5;

  float d = texture2D(tDepth, uv).r;
  vec2 off = uMouse * uParallax * (d - 0.45);
  vec3 col = texture2D(tMap, uv + off).rgb;

  if (uVideoMix > 0.001) {
    vec2 vuv = (coverUv(vUv, uPlane, uVideoRes) - 0.5) / uZoom + 0.5;
    col = mix(col, texture2D(tVideo, vuv).rgb, uVideoMix);
  }

  col = grade(col);
  float vig = smoothstep(1.25, 0.4, length((vUv - 0.5) * vec2(1.0, 0.9)));
  col *= mix(0.86, 1.0, vig);
  col *= 1.0 - uDim * 0.4;
  col += grain(gl_FragCoord.xy, uTime, uGrain);

  float m = maskRect(vUv, uPlane, uRadius);
  // clip to the band owned by this card (stacking cards slide over each other)
  float py = uViewH - gl_FragCoord.y / uDpr;
  m *= step(uClip.x, py) * step(py, uClip.y);

  float a = m * uAlpha * uReveal;
  gl_FragColor = vec4(col * a, a);
}
`, Mo = `
${Ao}
uniform sampler2D tVideo;
uniform vec2 uPlane;
uniform vec2 uVideoRes;
uniform vec2 uMouse;
uniform float uTime;
uniform float uProgress;
uniform float uAlpha;
uniform float uGrain;
uniform float uDip;
uniform vec4 uHero;     // the hero section in CSS px: left, top, right, bottom
uniform float uViewH;
uniform float uDpr;
uniform float uCorner;

void main() {
  vec2 cuv = coverUv(vUv, uPlane, uVideoRes);
  float z = 1.02 + 0.05 * uProgress;
  vec2 uv = (cuv - 0.5) / z + 0.5 + uMouse * 0.006;
  vec3 col = texture2D(tVideo, uv).rgb;
  col = grade(col);

  vec2 lp = vec2(0.88 + 0.04 * sin(uTime * 0.25), 0.92 + 0.03 * cos(uTime * 0.2));
  float leak = smoothstep(0.8, 0.0, length((vUv - lp) * vec2(1.0, 0.7)));
  col += vec3(1.0, 0.82, 0.55) * leak * 0.14;

  float haze = vnoise(vUv * 3.0 + vec2(uTime * 0.03, -uTime * 0.02)) * 0.05;
  col += haze * vec3(1.0, 0.95, 0.9);

  col *= mix(0.8, 1.0, smoothstep(1.15, 0.35, length((vUv - 0.5) * vec2(1.0, 0.8))));
  col *= 1.0 - 0.18 * smoothstep(0.55, 1.0, uProgress);
  col *= 1.0 - uDip;
  col += grain(gl_FragCoord.xy, uTime, uGrain);

  // stay inside the hero section, with rounded bottom corners so it lifts off the next section like a sheet
  vec2 pxy = vec2(gl_FragCoord.x / uDpr, uViewH - gl_FragCoord.y / uDpr);
  vec2 hc = vec2((uHero.x + uHero.z) * 0.5, (uHero.y + uHero.w) * 0.5 - 600.0);
  vec2 hh = vec2((uHero.z - uHero.x) * 0.5, (uHero.w - uHero.y) * 0.5 + 600.0);
  float m = 1.0 - smoothstep(-0.75, 0.75, rrect(pxy - hc, hh, uCorner));
  float a = uAlpha * m;
  gl_FragColor = vec4(col * a, a);
}
`, No = `
${Ao}
uniform sampler2D tMap;
uniform vec2 uPlane;
uniform vec2 uImage;
uniform vec2 uTexel;
uniform float uProgress;
uniform float uTime;
uniform float uRadius;
uniform float uAlpha;
uniform float uGrain;

float lum(vec2 uv) { return dot(texture2D(tMap, uv).rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  vec2 uv = coverUv(vUv, uPlane, uImage);
  vec2 t = uTexel * 1.6;
  float tl = lum(uv + vec2(-t.x,  t.y)), tc = lum(uv + vec2(0.0,  t.y)), tr = lum(uv + vec2( t.x,  t.y));
  float ml = lum(uv + vec2(-t.x,  0.0)),                                  mr = lum(uv + vec2( t.x,  0.0));
  float bl = lum(uv + vec2(-t.x, -t.y)), bc = lum(uv + vec2(0.0, -t.y)), br = lum(uv + vec2( t.x, -t.y));
  float gx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
  float gy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  float e = smoothstep(0.06, 0.55, length(vec2(gx, gy)) * 2.2);

  vec2 px = vUv * uPlane;
  float gridv = step(0.975, fract(px.x / 48.0)) + step(0.975, fract(px.y / 48.0));
  vec3 paper = vec3(0.05, 0.13, 0.37) + gridv * 0.09 + vnoise(px * 0.06) * 0.035;
  vec3 ink = vec3(0.74, 0.87, 1.0);
  vec3 bp = mix(paper, ink, e * 0.95);

  vec3 photo = grade(texture2D(tMap, uv).rgb);

  float n = vnoise(vUv * 5.0 + uTime * 0.02);
  float wipe = vUv.x * 0.65 + (1.0 - vUv.y) * 0.35 + (n - 0.5) * 0.3;
  float p = uProgress * 1.6 - 0.3;
  float m = smoothstep(p - 0.07, p + 0.07, wipe);
  vec3 col = mix(photo, bp, m);
  float front = exp(-abs(wipe - p) * 26.0) * 0.55 * (1.0 - smoothstep(1.05, 1.3, p)) * smoothstep(-0.3, -0.2, p);
  col += ink * front;
  col += grain(gl_FragCoord.xy, uTime, uGrain);

  float a = maskRect(vUv, uPlane, uRadius) * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`, Po = `
attribute vec2 uv;
attribute vec3 position;
uniform vec4 uRectPx;   // x,y: card centre relative to the pivot in px (y up); z,w: width, height px
uniform vec2 uPivot;    // pivot in viewport px, y down
uniform vec2 uView;     // viewport px
uniform vec2 uRot;      // rotX, rotY in radians
uniform float uZ;       // card depth in px (positive toward the viewer)
uniform float uPersp;   // perspective distance in px
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = vec3(uRectPx.xy + position.xy * uRectPx.zw, uZ);
  float cx = cos(uRot.x), sx = sin(uRot.x), cy = cos(uRot.y), sy = sin(uRot.y);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  float w = 1.0 - p.z / uPersp;
  vec2 screen = uPivot + vec2(p.x, -p.y) / w;
  vec2 ndc = vec2(screen.x / uView.x * 2.0 - 1.0, 1.0 - screen.y / uView.y * 2.0);
  gl_Position = vec4(ndc * w, 0.0, w);
}
`, Fo = `
attribute vec2 uv;
attribute vec3 position;
uniform vec4 uRectPx;   // untransformed quad: left, top, width, height
uniform vec2 uOrigin;   // the face's transform-origin in viewport px
uniform vec2 uPOrigin;  // the parent's perspective-origin in viewport px
uniform vec2 uTrans;    // translateY px, translateZ px
uniform float uAngle;   // rotateX in radians
uniform float uPersp;   // perspective px
uniform vec2 uView;     // viewport px
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = vec3(uRectPx.x + (position.x + 0.5) * uRectPx.z, uRectPx.y + (0.5 - position.y) * uRectPx.w, 0.0);
  vec3 q = p - vec3(uOrigin, 0.0);
  float c = cos(uAngle), s = sin(uAngle);
  q = vec3(q.x, q.y * c - q.z * s, q.y * s + q.z * c);
  q += vec3(0.0, uTrans.x, uTrans.y);
  q.xy += uOrigin;
  float w = 1.0 - q.z / uPersp;
  vec2 screen = uPOrigin + (q.xy - uPOrigin) / w;
  vec2 ndc = vec2(screen.x / uView.x * 2.0 - 1.0, 1.0 - screen.y / uView.y * 2.0);
  gl_Position = vec4(ndc * w, 0.0, w);
}
`, Io = `
${Ao}
uniform sampler2D tMap;
uniform sampler2D tDepth;
uniform vec2 uPlane;
uniform vec2 uImage;
uniform vec2 uMouse;
uniform vec2 uRot;
uniform float uParallax;
uniform float uRadius;
uniform float uFrame;
uniform float uAlpha;
uniform float uTime;
uniform float uGrain;

void main() {
  vec2 px = (vUv - 0.5) * uPlane;
  float outer = 1.0 - smoothstep(-0.75, 0.75, rrect(px, uPlane * 0.5, uRadius));
  vec2 innerHalf = uPlane * 0.5 - uFrame;
  float inner = 1.0 - smoothstep(-0.75, 0.75, rrect(px, innerHalf, max(uRadius - uFrame, 2.0)));

  vec2 iuv = px / (innerHalf * 2.0) + 0.5;
  vec2 cuv = coverUv(iuv, innerHalf * 2.0, uImage);
  cuv = (cuv - 0.5) / 1.07 + 0.5;
  float d = texture2D(tDepth, cuv).r;
  vec2 off = uMouse * uParallax * (d - 0.45);
  vec3 photo = grade(texture2D(tMap, cuv + off).rgb);

  float s = dot(vUv - 0.5, normalize(vec2(1.0, 0.7))) + uRot.y * 2.2 - uRot.x * 1.6;
  photo += exp(-s * s * 16.0) * 0.11;
  photo *= mix(0.92, 1.0, smoothstep(1.3, 0.3, length((vUv - 0.5) * vec2(1.0, 0.9))));
  photo += grain(gl_FragCoord.xy, uTime, uGrain);

  vec3 col = mix(vec3(0.985, 0.98, 0.972), photo, inner);
  float a = outer * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`, Lo = `
precision highp float;
varying vec2 vUv;
uniform vec2 uPlane;
uniform float uRadius;
uniform float uSpread;
uniform float uAlpha;
float rrect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
void main() {
  vec2 px = (vUv - 0.5) * uPlane;
  float sd = rrect(px, uPlane * 0.5 - uSpread, uRadius + uSpread * 0.5);
  float a = (1.0 - smoothstep(-uSpread * 0.35, uSpread, sd)) * uAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`, Ro = `
attribute vec3 position;   // x, y seeds in 0..1, z = size/depth seed
uniform vec4 uRect;
uniform vec2 uMouse;
uniform float uTime;
uniform float uDpr;
varying float vA;
void main() {
  float t = uTime * 0.06;
  float s = position.z;
  vec2 p = position.xy;
  p.x += sin(t * 1.3 + s * 6.2831) * 0.02 + t * 0.02 * (0.3 + s);
  p.y += cos(t * 0.9 + s * 4.0) * 0.02 - t * 0.012 * (0.3 + s);
  p = fract(p);
  p += uMouse * 0.012 * s;
  gl_Position = vec4(uRect.xy + (p - 0.5) * uRect.zw, 0.0, 1.0);
  gl_PointSize = (1.4 + s * 3.2) * uDpr;
  vA = 0.2 + 0.55 * s;
}
`, zo = `
precision mediump float;
uniform float uAlpha;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.12, d) * vA * uAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * a, a);
}
`, Bo = 600, Vo = 440, Ho = 64, Uo = 5, Wo = 96, Go = [-0.5, 0.85, -0.35], Ko = [0.5 / 0.85, 0.35 / 0.85];
function qo(e21, t2, n2, r2, i2, a2 = 4) {
  let o2 = [];
  for (let s2 = 0; s2 < a2; s2++) {
    let c2 = r2 + (i2 - r2) * (s2 / a2), l2 = r2 + (i2 - r2) * ((s2 + 1) / a2);
    o2.push([e21 + n2 * Math.cos(c2), t2 + n2 * Math.sin(c2), e21 + n2 * Math.cos(l2), t2 + n2 * Math.sin(l2)]);
  }
  return o2;
}
var Jo = (e21, t2, n2, r2) => [[e21, t2, n2, t2], [n2, t2, n2, r2], [n2, r2, e21, r2], [e21, r2, e21, t2]], Yo = Math.PI / 180, Xo = [[40, 40, 560, 40], [560, 40, 560, 400], [560, 400, 40, 400], [40, 400, 40, 40]], Zo = [[280, 40, 280, 150], [280, 190, 280, 260], [280, 260, 560, 260], [40, 220, 110, 220], [150, 220, 180, 220], [180, 220, 180, 400], [180, 320, 280, 320]], Qo = [Xo, [...Zo, ...qo(320, 150, 40, 180 * Yo, 90 * Yo), ...qo(150, 220, 40, 180 * Yo, 270 * Yo), ...qo(210, 400, 40, 0, -90 * Yo)], [[40, 24, 560, 24], [40, 18, 40, 30], [280, 18, 280, 30], [560, 18, 560, 30], [24, 40, 24, 400], [18, 40, 30, 40], [18, 220, 30, 220], [18, 400, 30, 400], [576, 260, 576, 400], [570, 260, 582, 260], [570, 400, 582, 400]], [...Jo(100, 58, 262, 86), [160, 58, 160, 86], [220, 58, 220, 86], ...Jo(58, 58, 100, 86), [58, 86, 58, 200], [58, 200, 86, 200], [86, 200, 86, 86], ...Jo(118, 128, 222, 176), ...Jo(58, 246, 110, 300), ...Jo(58, 320, 80, 360), ...Jo(110, 330, 162, 372), ...qo(136, 351, 15, 0, 360 * Yo, 6)], [...Jo(330, 90, 520, 140), [360, 90, 360, 140], ...Jo(390, 170, 470, 210), ...Jo(340, 266, 450, 360), [340, 296, 450, 296], ...Jo(470, 330, 540, 390), ...Jo(200, 240, 260, 300)]], $o = [0.86, 0.83, 0.78], es = [0.88, 0.89, 0.88], ts = [0.72, 0.6, 0.46], ns = [0.8, 0.76, 0.7], rs = [0.56, 0.45, 0.35], is = [0.42, 0.33, 0.25], as = [0.93, 0.92, 0.89], os = [0.7, 0.72, 0.73], ss = [0.9, 0.87, 0.82], cs = [0.96, 0.96, 0.95], ls = [0.7, 0.8, 0.85], us = [0.5, 0.58, 0.44], ds = [0.78, 0.64, 0.42], fs = [{ r: [40, 40, 280, 220], type: 0, c: $o }, { r: [180, 220, 280, 320], type: 1, c: ts }, { r: [180, 320, 280, 400], type: 1, c: ts }, { r: [280, 40, 560, 260], type: 1, c: ts }, { r: [40, 220, 180, 400], type: 0, c: es }, { r: [280, 260, 560, 400], type: 2, c: ns }], q = (e21, t2, n2, r2, i2, a2, o2, s2) => ({ r: [e21, t2, n2, r2], h: i2, base: a2, c: o2, g: s2 }), ps = (e21, t2, n2, r2, i2, a2) => ({ s: [e21, t2, n2], base: r2, c: i2, g: a2 }), ms = [q(100, 58, 262, 86, 24, 1.2, [0.8, 0.78, 0.73], `fit`), q(98, 56, 264, 88, 1.6, 25.2, as, `fit`), q(58, 58, 100, 86, 56, 1.2, os, `fit`), q(58, 86, 86, 200, 56, 1.2, [0.8, 0.78, 0.73], `fit`), q(118, 128, 222, 176, 24, 1.2, [0.7, 0.68, 0.63], `fit`), q(116, 126, 224, 178, 1.6, 25.2, as, `fit`), q(134, 182, 146, 192, 16, 1.2, rs, `furn`), q(164, 182, 176, 192, 16, 1.2, rs, `furn`), q(194, 182, 206, 192, 16, 1.2, rs, `furn`), ps(140, 152, 3.2, 50, ds, `decor`), ps(170, 152, 3.2, 50, ds, `decor`), ps(200, 152, 3.2, 50, ds, `decor`), q(58, 246, 110, 300, 15, 1.2, cs, `fit`), q(56, 244, 112, 302, 2, 16.2, cs, `fit`), q(58, 320, 80, 360, 11, 1.2, cs, `fit`), q(62, 360, 76, 376, 20, 1.2, cs, `fit`), q(110, 330, 162, 372, 22, 1.2, [0.82, 0.8, 0.76], `fit`), q(122, 340, 150, 362, 3, 23.2, cs, `fit`), q(174, 334, 177, 368, 24, 30, [0.78, 0.84, 0.88], `decor`), q(310, 80, 540, 232, 0.8, 1.2, [0.84, 0.8, 0.73], `furn`), q(330, 90, 520, 140, 17, 2, [0.66, 0.61, 0.54], `furn`), q(330, 90, 520, 100, 27, 2, [0.62, 0.57, 0.5], `furn`), q(340, 104, 392, 136, 4, 19, [0.72, 0.67, 0.6], `decor`), q(396, 104, 448, 136, 4, 19, [0.72, 0.67, 0.6], `decor`), q(452, 104, 504, 136, 4, 19, [0.72, 0.67, 0.6], `decor`), q(390, 170, 470, 210, 10, 2, is, `furn`), q(410, 182, 436, 198, 1.4, 12, [0.3, 0.32, 0.4], `decor`), q(330, 60, 360, 80, 15, 1.2, rs, `furn`), q(490, 60, 520, 80, 15, 1.2, rs, `furn`), q(400, 43, 480, 45.5, 30, 24, [0.12, 0.12, 0.13], `decor`), q(540, 46, 552, 58, 10, 1.2, [0.55, 0.5, 0.45], `decor`), ps(546, 52, 9, 16, us, `decor`), q(200, 240, 260, 300, 17, 1.2, rs, `furn`), q(188, 252, 198, 264, 18, 1.2, is, `furn`), q(188, 276, 198, 288, 18, 1.2, is, `furn`), q(262, 252, 272, 264, 18, 1.2, is, `furn`), q(262, 276, 272, 288, 18, 1.2, is, `furn`), q(300, 290, 480, 392, 0.8, 1.2, [0.86, 0.83, 0.78], `furn`), q(340, 266, 450, 360, 13, 2, [0.84, 0.81, 0.76], `furn`), q(340, 263, 450, 267, 28, 2, is, `furn`), q(342, 300, 448, 358, 3, 15, ss, `decor`), q(346, 272, 392, 294, 4, 15, cs, `decor`), q(398, 272, 444, 294, 4, 15, cs, `decor`), q(326, 268, 338, 290, 14, 1.2, rs, `furn`), q(452, 268, 464, 290, 14, 1.2, rs, `furn`), ps(332, 279, 3.5, 18, ss, `decor`), ps(458, 279, 3.5, 18, ss, `decor`), q(470, 330, 540, 390, 21, 1.2, rs, `furn`), q(290, 384, 302, 396, 10, 1.2, [0.55, 0.5, 0.45], `decor`), ps(296, 390, 9, 16, us, `decor`), q(100, 36.5, 180, 43.5, 28, 22, ls, `win`), q(556.5, 80, 563.5, 200, 28, 22, ls, `win`), q(300, 396.5, 380, 403.5, 28, 22, ls, `win`), q(36.5, 300, 43.5, 350, 20, 30, ls, `win`), q(210, 396.5, 250, 403.5, 50, 0, is, `win`), q(200, 404, 260, 418, 3, 0, [0.86, 0.85, 0.82], `win`), q(582, 404, 586, 408, 14, 0, is, `decor`), ps(584, 406, 13, 22, us, `decor`), q(16, 32, 20, 36, 14, 0, is, `decor`), ps(18, 34, 12, 20, us, `decor`)], hs = `
uniform vec4 uCast[16];
uniform float uCastH[16];
uniform int uCastN;
uniform vec2 uShadowDir;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float sdSeg(vec2 p, vec2 a, vec2 b, out float t) {
  vec2 pa = p - a, ba = b - a;
  t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * t);
}
// soft shadow and contact darkening from the walls, in plan coordinates
void wallShade(vec2 p, out float sh, out float ao) {
  sh = 0.0; ao = 0.0;
  for (int i = 0; i < 16; i++) {
    if (i >= uCastN) break;
    float h = uCastH[i];
    if (h <= 0.5) continue;
    vec4 s = uCast[i];
    vec2 off = h * uShadowDir;
    float t;
    for (int k = 1; k <= 4; k++) {
      float f = float(k) / 4.0;
      float d = sdSeg(p - off * f, s.xy, s.zw, t);
      float blur = 2.5 + h * f * 0.3;
      sh = max(sh, (1.0 - smoothstep(0.0, blur, d)) * (1.0 - f * 0.55));
    }
    float d0 = sdSeg(p, s.xy, s.zw, t);
    ao = max(ao, 1.0 - smoothstep(0.0, 7.0, d0));
  }
}
`, gs = `
attribute vec3 position;
attribute vec3 normal;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
uniform mat4 modelMatrix;
uniform mat3 normalMatrix;
uniform mat4 viewMatrix;
varying vec3 vN;
varying vec3 vW;
varying vec3 vV;
void main() {
  vN = normalize(normalMatrix * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vV = -(viewMatrix * wp).xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`, _s = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vV;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uWarm;
uniform float uBase;
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uLight);
  vec3 F = normalize(vec3(0.6, 0.3, 0.6));
  float d = max(dot(N, L), 0.0);
  float f = max(dot(N, F), 0.0);
  vec3 col = uColor * (0.52 + 0.5 * d) + vec3(0.04, 0.045, 0.07) * f;
  col += vec3(0.06, 0.04, 0.015) * d * (0.5 + uWarm);
  col += 0.025 * max(N.y, 0.0);
  col *= 0.76 + 0.24 * smoothstep(0.0, 14.0, vW.y - uBase);
  float rim = pow(1.0 - max(dot(N, normalize(vV)), 0.0), 3.0);
  col += rim * 0.05;
  col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), uWarm);
  gl_FragColor = vec4(col, 1.0);
}
`, vs = `
precision highp float;
varying vec3 vN;
varying vec3 vW;
varying vec3 vV;
uniform vec3 uColor;
uniform vec3 uLight;
uniform float uWarm;
uniform float uType;
uniform float uBase;
${hs}
void main() {
  vec2 p = vec2(vW.x + ${Bo / 2}.0, vW.z + ${Vo / 2}.0);
  vec3 base = uColor;
  if (uType < 0.5) {
    vec2 g = abs(fract(p / 30.0) - 0.5);
    float grout = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y));
    base *= (1.0 - grout * 0.16) * (0.97 + 0.06 * hash12(floor(p / 30.0)));
  } else if (uType < 1.5) {
    float row = floor(p.y / 11.0);
    float off = hash12(vec2(row, 1.0)) * 80.0;
    float plank = floor((p.x + off) / 90.0);
    base *= 0.9 + 0.2 * hash12(vec2(row, plank));
    float ey = 0.5 - abs(fract(p.y / 11.0) - 0.5);
    float ex = 0.5 - abs(fract((p.x + off) / 90.0) - 0.5);
    float seam = max(1.0 - smoothstep(0.0, 0.08, ey), 1.0 - smoothstep(0.0, 0.012, ex));
    base *= 1.0 - seam * 0.22;
    base *= 1.0 + (vnoise(p * vec2(0.08, 0.9)) - 0.5) * 0.08;
  } else {
    base *= 0.96 + 0.08 * vnoise(p * 1.5);
  }
  vec3 N = normalize(vN);
  float d = max(dot(N, normalize(uLight)), 0.0);
  vec3 col = base * (0.56 + 0.44 * d);
  float sh, ao;
  wallShade(p, sh, ao);
  col *= 1.0 - sh * 0.4;
  col *= 1.0 - ao * 0.28;
  col *= mix(vec3(1.0), vec3(1.04, 1.0, 0.94), uWarm);
  gl_FragColor = vec4(col, 1.0);
}
`, ys = `
attribute vec2 uv;
attribute vec3 position;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`, bs = (e21) => `
precision highp float;
varying vec2 vUv;
uniform vec4 uSeg[${Wo}];
uniform int uSegN;
uniform vec4 uLineP;
uniform float uLineP4;
uniform float uWarm;
uniform vec3 uInkA;
uniform vec3 uInkB;
${hs}
void main() {
  vec2 p = vec2(vUv.x * ${Bo}.0, (1.0 - vUv.y) * ${Vo}.0);
  float fib = vnoise(p * 0.9) * 0.5 + vnoise(p * 3.3) * 0.5;
  vec3 paper = vec3(0.995, 0.99, 0.975) - fib * 0.03;
  vec2 g = abs(fract(p / 20.0) - 0.5);
  float grid = 1.0 - smoothstep(0.0, 0.05, min(g.x, g.y));
  paper -= grid * vec3(0.035, 0.025, 0.0);
  float wob = (vnoise(p * 0.9) - 0.5) * 0.7;

  float inkA = 0.0, inkB = 0.0;
  for (int i = 0; i < ${Wo}; i++) {
    if (i >= uSegN) break;
    vec4 s = uSeg[i];
    float idx = floor(s.x / 1024.0);
    float grp = floor(s.z / 1024.0);
    s.x -= idx * 1024.0;
    s.z -= grp * 1024.0;
    float lp = grp < 0.5 ? uLineP.x : grp < 1.5 ? uLineP.y : grp < 2.5 ? uLineP.z : grp < 3.5 ? uLineP.w : uLineP4;
    float m = grp < 0.5 ? ${e21[0]}.0 : grp < 1.5 ? ${e21[1]}.0 : grp < 2.5 ? ${e21[2]}.0 : grp < 3.5 ? ${e21[3]}.0 : ${e21[4]}.0;
    float pr = clamp(lp * m * 1.06 - idx, 0.0, 1.0);
    if (pr <= 0.001) continue;
    float t;
    float d = sdSeg(p, s.xy, s.zw, t);
    float line = step(t, pr) * (1.0 - smoothstep(0.5, 2.0, d + wob));
    line *= 0.85 + 0.15 * smoothstep(0.0, 0.08, pr - t);
    if (grp > 0.5 && grp < 2.5) inkB = max(inkB, line); else inkA = max(inkA, line);
  }
  float sh, ao;
  wallShade(p, sh, ao);
  vec3 col = paper;
  col = mix(col, uInkA, inkA * 0.92);
  col = mix(col, uInkB, inkB * 0.92);   // rooms and dimensions in the accent colour
  col *= 1.0 - sh * 0.42;
  col *= 1.0 - ao * 0.3;
  col *= mix(vec3(1.0), vec3(1.03, 1.0, 0.95), uWarm);
  gl_FragColor = vec4(col, 1.0);
}
`, xs = `
precision highp float;
varying vec2 vUv;
uniform vec2 uPlane;
uniform float uSpread;
uniform float uAlpha;
float rrect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
void main() {
  vec2 px = (vUv - 0.5) * uPlane;
  float sd = rrect(px, uPlane * 0.5 - uSpread, uSpread * 0.6);
  float a = (1.0 - smoothstep(-uSpread * 0.4, uSpread, sd)) * uAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`, Ss = `
precision highp float;
varying vec2 vUv;
uniform float uAlpha;
void main() {
  vec2 d = (vUv - 0.5) * vec2(2.0, 2.2);
  float r = length(d);
  float a = (1.0 - smoothstep(0.15, 1.0, r)) * uAlpha;
  gl_FragColor = vec4(vec3(0.12, 0.10, 0.08) * a, a);
}
`, Cs = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tMap;
uniform float uAlpha;
uniform float uTime;
uniform float uGrain;
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main() {
  vec4 t = texture2D(tMap, vUv);
  float g = (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uGrain * t.a;
  // the desk pool reaches past the target; fade the last few percent so it never ends in a hard edge
  vec2 e = smoothstep(0.0, 0.06, vUv) * smoothstep(0.0, 0.06, 1.0 - vUv);
  gl_FragColor = vec4(t.rgb + g, t.a) * uAlpha * e.x * e.y;
}
`, ws = (e21, t2, n2) => {
  let r2 = Math.min(1, Math.max(0, (n2 - e21) / (t2 - e21)));
  return r2 * r2 * (3 - 2 * r2);
}, Ts = (e21, t2, n2) => e21 + (t2 - e21) * n2, Es = (e21, t2, n2) => Math.min(n2, Math.max(t2, e21));
function Ds({ gl: e21, renderer: t2, el: n2, ctx: r2 }) {
  let { rectOf: i2, near: a2, quad: o2, draw: s2, pointer: c2, vp: l2, state: u2 } = r2, d2 = Qo.map((e22) => e22.length), f2 = Array(384).fill(0), p2 = 0;
  Qo.forEach((e22, t3) => e22.forEach((e23, n3) => {
    p2 >= Wo || (f2[p2 * 4] = e23[0] + 1024 * n3, f2[p2 * 4 + 1] = e23[1], f2[p2 * 4 + 2] = e23[2] + 1024 * t3, f2[p2 * 4 + 3] = e23[3], p2++);
  }));
  let m2 = [...Xo, ...Zo], h2 = Array(64).fill(0);
  m2.forEach((e22, t3) => {
    h2[t3 * 4] = e22[0], h2[t3 * 4 + 1] = e22[1], h2[t3 * 4 + 2] = e22[2], h2[t3 * 4 + 3] = e22[3];
  });
  let g2 = Array(16).fill(0), _2 = () => ({ uCast: { value: h2 }, uCastH: { value: g2 }, uCastN: { value: m2.length }, uShadowDir: { value: Ko } }), v2 = new to(), y2 = new ao(e21, { fov: 26, near: 20, far: 6e3 }), b2 = new bo(e21, { geometry: new Eo(e21, { width: Bo * 2.6, height: Vo * 2.6 }), program: new Zi(e21, { vertex: ys, fragment: Ss, uniforms: { uAlpha: { value: 0.16 } }, transparent: true, depthWrite: false, cullFace: null }) });
  b2.rotation.x = -Math.PI / 2, b2.position.set(40, -4, 30), b2.setParent(v2);
  let x2 = { uPlane: { value: [680, 520] }, uSpread: { value: 40 }, uAlpha: { value: 0.34 } }, S2 = new bo(e21, { geometry: new Eo(e21, { width: 680, height: 520 }), program: new Zi(e21, { vertex: ys, fragment: xs, uniforms: x2, transparent: true, depthWrite: false, cullFace: null }) });
  S2.rotation.x = -Math.PI / 2, S2.setParent(v2);
  let C2 = { uSeg: { value: f2 }, uSegN: { value: p2 }, uLineP: { value: [0, 0, 0, 0] }, uLineP4: { value: 0 }, uWarm: { value: 0 }, uInkA: { value: sdRGB(`--ink`, [0.06, 0.1, 0.18]) }, uInkB: { value: sdRGB(`--accent-text`, [0.73, 0.32, 0.06]) }, ..._2() }, w2 = new to();
  w2.setParent(v2);
  let T2 = new bo(e21, { geometry: new Eo(e21, { width: Bo, height: Vo }), program: new Zi(e21, { vertex: ys, fragment: bs(d2), uniforms: C2, cullFace: null }) });
  T2.rotation.x = -Math.PI / 2, T2.setParent(w2);
  let E2 = [], D2 = (t3, n3 = 0) => {
    let r3 = new Zi(e21, { vertex: gs, fragment: _s, uniforms: { uColor: { value: t3 }, uLight: { value: Go }, uWarm: { value: 0 }, uBase: { value: n3 } } });
    return r3.__base = n3, E2.push(r3), r3;
  }, O2 = new bo(e21, { geometry: new Do(e21, { width: Bo, height: 1.2, depth: Vo }), program: D2([0.93, 0.92, 0.9], -2) });
  O2.position.y = -0.75, O2.setParent(w2);
  let k2 = new Do(e21, { width: 1, height: 1, depth: 1 }), A2 = new Oo(e21, { radius: 1, widthSegments: 16, heightSegments: 12 }), j2 = [], M2 = (e22, t3, n3, r3) => ({ cx: (e22 + n3) / 2 - Bo / 2, cz: (t3 + r3) / 2 - Vo / 2, w: Math.abs(n3 - e22), d: Math.abs(r3 - t3) });
  fs.forEach((t3) => {
    let n3 = new Zi(e21, { vertex: gs, fragment: vs, uniforms: { uColor: { value: t3.c }, uLight: { value: Go }, uWarm: { value: 0 }, uType: { value: t3.type }, uBase: { value: 0 }, ..._2() } });
    E2.push(n3);
    let r3 = new bo(e21, { geometry: k2, program: n3 });
    r3.setParent(w2), j2.push({ m: r3, ...M2(...t3.r), h: 1.2, base: 0, group: `floor`, rotY: 0 });
  });
  let N2 = [0.975, 0.965, 0.945];
  m2.forEach(([t3, n3, r3, i3], a3) => {
    let o3 = Math.hypot(r3 - t3, i3 - n3), s3 = new bo(e21, { geometry: k2, program: D2(N2) });
    s3.setParent(w2), j2.push({ m: s3, cx: (t3 + r3) / 2 - Bo / 2, cz: (n3 + i3) / 2 - Vo / 2, w: o3 + Uo, d: Uo, h: Ho, base: 0, group: `walls`, rotY: Math.atan2(-(i3 - n3), r3 - t3), caster: a3 });
  }), ms.forEach((t3) => {
    if (t3.s) {
      let [n3, r3, i3] = t3.s, a3 = new bo(e21, { geometry: A2, program: D2(t3.c, t3.base) });
      a3.setParent(w2), j2.push({ m: a3, cx: n3 - Bo / 2, cz: r3 - Vo / 2, r: i3, base: t3.base, group: t3.g, sphere: true });
    } else {
      let n3 = new bo(e21, { geometry: k2, program: D2(t3.c, t3.base) });
      n3.setParent(w2), j2.push({ m: n3, ...M2(...t3.r), h: t3.h, base: t3.base, group: t3.g, rotY: 0 });
    }
  });
  let P2 = null, F2 = 0, I2 = 0, L2 = { tMap: { value: null }, uRect: { value: [0, 0, 1, 1] }, uPlane: { value: [1, 1] }, uAlpha: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0 } }, R2 = new Zi(e21, { vertex: ko, fragment: Cs, uniforms: L2, transparent: true, depthTest: false, depthWrite: false });
  R2.setBlendFunc(e21.ONE, e21.ONE_MINUS_SRC_ALPHA);
  let ee2 = new bo(e21, { geometry: o2, program: R2 }), te2 = Array.from(document.querySelectorAll(`[data-step]`)), z2 = { el: n2, steps: [0, 0, 0, 0, 0], targets: [0, 0, 0, 0, 0], alpha: 0, yaw: -0.5, pitch: 0.95, type: `model` };
  n2.__model = z2, n2.__plane = z2, n2.classList.add(`is-gl`);
  let ne2 = matchMedia(`(max-width: 900px)`), B2 = e21.canvas, re2 = false, ie2 = (e22) => {
    e22 !== re2 && (re2 = e22, B2.classList.toggle(`is-high`, e22));
  };
  return z2.update = () => {
    let o3 = i2(n2), s3 = a2(o3, 60) && o3.width >= 10;
    if (ie2(ne2.matches && s3), !a2(o3, l2.h * 0.5) || o3.width < 10) return false;
    let d3 = Math.min(t2.dpr, 1.25), f3 = Math.round(o3.width * d3), p3 = Math.round(o3.height * d3);
    P2 && f3 === F2 && p3 === I2 || (P2 ? P2.setSize(f3, p3) : P2 = new To(e21, { width: f3, height: p3, depth: true, minFilter: e21.LINEAR, magFilter: e21.LINEAR }), F2 = f3, I2 = p3, L2.tMap.value = P2.texture, y2.perspective({ aspect: f3 / p3 }));
    let m3 = z2.steps, h3 = 1 - 0.86 ** ((u2.dt || 16.7) / 16.7);
    for (let e22 = 0; e22 < 5; e22++) {
      let t3 = te2[Math.min(e22, te2.length - 1)];
      t3 && (z2.targets[e22] = Es((l2.h * 0.92 - t3.getBoundingClientRect().top) / (l2.h * 0.54), 0, 1)), m3[e22] = Ts(m3[e22], z2.targets[e22], h3);
    }
    let _3 = (m3[0] + m3[1] + m3[2] + m3[3] + m3[4]) / 5;
    C2.uLineP.value[0] = m3[0], C2.uLineP.value[1] = m3[1], C2.uLineP.value[2] = ws(0, 0.7, m3[2]), C2.uLineP.value[3] = ws(0, 0.42, m3[3]), C2.uLineP4.value = ws(0, 0.4, m3[4]);
    let b3 = 9 * ws(0.45, 1, m3[2]), T3 = { floor: ws(0.05, 0.4, m3[3]), walls: ws(0.2, 0.8, m3[3]), fit: ws(0.55, 1, m3[3]), win: ws(0.7, 1, m3[3]), furn: ws(0.15, 0.8, m3[4]), decor: ws(0.5, 1, m3[4]) }, D3 = ws(0.5, 1, m3[4]);
    w2.position.y = b3, S2.position.set(16 + b3 * 1.2, -1.5, 13 + b3 * 0.9), x2.uSpread.value = 40 + b3 * 2.5, x2.uAlpha.value = 0.34 - b3 * 0.012;
    for (let e22 of j2) {
      let t3 = T3[e22.group];
      if (e22.m.visible = t3 > 2e-3, e22.sphere) {
        let n3 = e22.r * t3;
        e22.m.scale.set(n3, n3, n3), e22.m.position.set(e22.cx, e22.base + n3, e22.cz);
      } else {
        let n3 = e22.h * t3;
        e22.m.scale.set(e22.w, Math.max(n3, 0.01), e22.d), e22.m.position.set(e22.cx, e22.base + n3 / 2, e22.cz), e22.m.rotation.y = e22.rotY;
      }
      e22.caster !== void 0 && (g2[e22.caster] = Ho * t3);
    }
    for (let e22 of E2) e22.uniforms.uWarm.value = D3, e22.uniforms.uBase.value = b3 + (e22.__base || 0);
    C2.uWarm.value = D3;
    let O3 = r2.coarse ? 0 : c2.sx, k3 = r2.coarse ? 0 : c2.sy;
    z2.yaw = Ts(z2.yaw, -0.5 + _3 * 0.5 + O3 * 0.07, 0.06), z2.pitch = Ts(z2.pitch, 0.95 - k3 * 0.05 - _3 * 0.2, 0.06);
    let A3 = 1330;
    return y2.position.set(Math.sin(z2.yaw) * Math.cos(z2.pitch) * A3, Math.sin(z2.pitch) * A3, Math.cos(z2.yaw) * Math.cos(z2.pitch) * A3), y2.lookAt([0, 6, 0]), e21.bindFramebuffer(e21.FRAMEBUFFER, P2.buffer), e21.viewport(0, 0, F2, I2), t2.setDepthMask(true), e21.clearColor(0, 0, 0, 0), e21.clear(e21.COLOR_BUFFER_BIT | e21.DEPTH_BUFFER_BIT), t2.render({ scene: v2, camera: y2, target: P2, clear: false }), L2.uRect.value[0] = (o3.left + o3.width / 2) / l2.w * 2 - 1, L2.uRect.value[1] = 1 - (o3.top + o3.height / 2) / l2.h * 2, L2.uRect.value[2] = o3.width / l2.w * 2, L2.uRect.value[3] = o3.height / l2.h * 2, z2.alpha = Ts(z2.alpha, +(o3.top < l2.h * 0.95), 0.08), L2.uAlpha.value = z2.alpha, L2.uTime.value = u2.time, L2.uGrain.value = u2.grain * 0.7, z2.alpha > 4e-3;
  }, z2.draw = () => s2(ee2), z2;
}
var Os = `
attribute vec2 uv;
attribute vec3 position;
uniform vec2 uSize;      // card size in px
uniform vec3 uOffset;    // card centre relative to the pivot, px, y up, z toward viewer
uniform float uLocal;    // the card's own turn about its vertical axis
uniform float uScale;
uniform float uFlip;     // 1 = draw the reflection
uniform float uFloor;    // floor line relative to the card centre (local px, scaled)
uniform vec2 uRot;       // stack tilt
uniform vec2 uPivot;
uniform vec2 uView;
uniform float uPersp;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec2 lp = position.xy * uSize * uScale;
  if (uFlip > 0.5) lp.y = 2.0 * uFloor - lp.y;
  float c = cos(uLocal), s = sin(uLocal);
  vec3 p = vec3(lp.x * c, lp.y, -lp.x * s) + uOffset;
  float cx = cos(uRot.x), sx = sin(uRot.x), cy = cos(uRot.y), sy = sin(uRot.y);
  p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
  float w = 1.0 - p.z / uPersp;
  vec2 screen = uPivot + vec2(p.x, -p.y) / w;
  vec2 ndc = vec2(screen.x / uView.x * 2.0 - 1.0, 1.0 - screen.y / uView.y * 2.0);
  gl_Position = vec4(ndc * w, 0.0, w);
}
`, ks = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPhoto;
uniform sampler2D tDepth;
uniform sampler2D tText;
uniform vec2 uPlane;
uniform vec2 uImage;
uniform vec2 uMouse;
uniform float uPhotoFrac;
uniform float uFrame;
uniform float uRadius;
uniform float uAlpha;
uniform float uDim;
uniform float uFlip;
uniform float uTime;
uniform float uGrain;
uniform float uParallax;
uniform float uHasText;
vec2 coverUv(vec2 uv, vec2 plane, vec2 img) {
  float pr = plane.x / plane.y, ir = img.x / img.y;
  vec2 s = pr > ir ? vec2(1.0, ir / pr) : vec2(pr / ir, 1.0);
  return (uv - 0.5) * s + 0.5;
}
float rrect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.06);
  c = (c - 0.5) * 1.05 + 0.5;
  c += vec3(0.02, 0.009, -0.012) * l;
  return clamp(pow(max(c, 0.0), vec3(0.97)), 0.0, 1.0);
}
void main() {
  vec2 px = (vUv - 0.5) * uPlane;
  float outer = 1.0 - smoothstep(-0.75, 0.75, rrect(px, uPlane * 0.5, uRadius));
  vec2 innerHalf = uPlane * 0.5 - uFrame;
  float inner = 1.0 - smoothstep(-0.75, 0.75, rrect(px, innerHalf, max(uRadius - uFrame, 2.0)));
  vec2 iuv = px / (innerHalf * 2.0) + 0.5;
  float split = 1.0 - uPhotoFrac;
  vec3 col;
  if (iuv.y >= split) {
    vec2 puv = vec2(iuv.x, (iuv.y - split) / uPhotoFrac);
    vec2 region = vec2(innerHalf.x * 2.0, innerHalf.y * 2.0 * uPhotoFrac);
    vec2 cuv = coverUv(puv, region, uImage);
    cuv = (cuv - 0.5) / 1.06 + 0.5;
    float d = texture2D(tDepth, cuv).r;
    col = grade(texture2D(tPhoto, cuv + uMouse * uParallax * (d - 0.45)).rgb);
    col *= mix(0.88, 1.0, smoothstep(1.25, 0.3, length((puv - 0.5) * vec2(1.0, 0.8))));
  } else {
    vec2 tuv = vec2(iuv.x, iuv.y / split);
    vec3 paper = vec3(0.968, 0.96, 0.942) - vnoise(px * 0.6) * 0.025;
    vec4 t = texture2D(tText, tuv);
    col = mix(paper, t.rgb, t.a * uHasText);
    col *= 1.0 - 0.07 * (1.0 - smoothstep(0.0, 0.012, split - iuv.y));
  }
  col = mix(vec3(0.99, 0.985, 0.975), col, inner);
  col *= 1.0 - uDim * 0.5;
  float a = outer * uAlpha;
  if (uFlip > 0.5) { a *= pow(max(0.0, 1.0 - vUv.y * 1.6), 2.0) * 0.4; col *= 0.9; }
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col * a, a);
}
`, As = `
precision highp float;
varying vec2 vUv;
uniform float uAlpha;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  float a = (1.0 - smoothstep(0.3, 1.0, r)) * uAlpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}
`, js = (e21, t2, n2) => e21 + (t2 - e21) * n2, Ms = (e21, t2, n2) => Math.min(n2, Math.max(t2, e21)), Ns = (e21, t2, n2) => {
  let r2 = Ms((n2 - e21) / (t2 - e21), 0, 1);
  return r2 * r2 * (3 - 2 * r2);
};
function Ps(e21, { quote: t2, name: n2, project: r2, rating: i2, mark: a2 }, o2, s2) {
  e21.width = Math.round(o2 * 2), e21.height = Math.round(s2 * 2);
  let c2 = e21.getContext(`2d`);
  c2.scale(2, 2), c2.clearRect(0, 0, o2, s2);
  let l2 = Math.round(o2 * 0.085), u2 = Math.max(15, Math.round(o2 * 0.066)), d2 = (e22, t3, n3, r3) => {
    c2.font = `${n3} ${t3}px "Instrument Serif", Georgia, serif`;
    let i3 = e22.split(` `), a3 = [], o3 = ``;
    for (let e23 of i3) {
      let t4 = o3 ? o3 + ` ` + e23 : e23;
      c2.measureText(t4).width > r3 && o3 ? (a3.push(o3), o3 = e23) : o3 = t4;
    }
    return o3 && a3.push(o3), a3;
  }, f2 = d2(t2, u2, `400`, o2 - l2 * 2);
  for (; f2.length * u2 * 1.2 > s2 - l2 - 58 - 30 && u2 > 13; ) --u2, f2 = d2(t2, u2, `400`, o2 - l2 * 2);
  c2.fillStyle = sdCss(`--accent-text`, `#b9520f`), a2 ? (c2.font = `italic 400 ${Math.round(u2 * 1.5)}px "Instrument Serif", Georgia, serif`, c2.fillText(a2, l2, l2 + u2 * 0.9)) : (c2.font = `italic 400 ${Math.round(u2 * 2.6)}px "Instrument Serif", Georgia, serif`, c2.fillText(`\u201C`, l2 - 2, l2 + u2 * 1.1)), c2.fillStyle = sdCss(`--ink`, `#0e1726`), c2.font = `400 ${u2}px "Instrument Serif", Georgia, serif`;
  let p2 = l2 + u2 * 1.25 + u2 * 0.5;
  for (let e22 of f2) c2.fillText(e22, l2, p2), p2 += u2 * 1.2;
  c2.font = `600 ${Math.round(o2 * 0.038)}px Inter, system-ui, sans-serif`, c2.fillStyle = sdCss(`--ink`, `#0e1726`), c2.fillText(n2, l2, s2 - l2 - 16), c2.font = `400 ${Math.round(o2 * 0.036)}px Inter, system-ui, sans-serif`, c2.fillStyle = sdCss(`--mute`, `#5d6474`), c2.fillText(r2, l2, s2 - l2);
  let m2 = (e22, t3, n3) => {
    c2.beginPath();
    for (let r3 = 0; r3 < 10; r3++) {
      let i3 = r3 % 2 ? n3 * 0.45 : n3, a3 = -Math.PI / 2 + r3 * Math.PI / 5;
      c2.lineTo(e22 + Math.cos(a3) * i3, t3 + Math.sin(a3) * i3);
    }
    c2.closePath(), c2.fill();
  }, h2 = o2 * 0.02;
  if (i2 > 0) for (let e22 = 0; e22 < 5; e22++) c2.fillStyle = e22 < i2 ? sdCss(`--brand`, `#f07f2e`) : sdCss(`--bone-3`, `#dbd3c5`), m2(o2 - l2 - h2 - (4 - e22) * h2 * 2.6, s2 - l2 - 10, h2);
}
function Fs({ gl: e21, el: t2, ctx: n2 }) {
  let { rectOf: r2, near: i2, loadImage: a2, imageTex: o2, makeTex: s2, quad: c2, draw: l2, stackFor: u2, pointer: d2, vp: f2, state: p2, coarse: m2 } = n2, h2 = t2.closest(`[data-voices]`) || t2, g2 = Array.from(t2.querySelectorAll(`[data-voice]`)), _2 = g2.length;
  if (!_2) return null;
  let v2 = u2(t2), y2 = { uSize: { value: [1, 1] }, uOffset: { value: [0, 0, 0] }, uLocal: { value: 0 }, uScale: { value: 1 }, uFlip: { value: 0 }, uFloor: { value: 0 }, uRot: { value: [0, 0] }, uPivot: { value: [0, 0] }, uView: { value: [f2.w, f2.h] }, uPersp: { value: 1400 }, uAlpha: { value: 0 } }, b2 = new Zi(e21, { vertex: Os, fragment: As, uniforms: y2, transparent: true, depthTest: false, depthWrite: false, cullFace: null });
  b2.setBlendFunc(e21.ONE, e21.ONE_MINUS_SRC_ALPHA);
  let x2 = new bo(e21, { geometry: c2, program: b2 }), S2 = g2.map((t3) => {
    let n3 = o2(), r3 = s2(), i3 = document.createElement(`canvas`), a3 = new wo(e21, { image: i3, generateMipmaps: true, minFilter: e21.LINEAR_MIPMAP_LINEAR }), l3 = { tPhoto: { value: n3 }, tDepth: { value: r3 }, tText: { value: a3 }, uSize: { value: [1, 1] }, uOffset: { value: [0, 0, 0] }, uLocal: { value: 0 }, uScale: { value: 1 }, uFlip: { value: 0 }, uFloor: { value: 0 }, uRot: { value: [0, 0] }, uPivot: { value: [0, 0] }, uView: { value: [f2.w, f2.h] }, uPersp: { value: 1400 }, uPlane: { value: [1, 1] }, uImage: { value: [16, 9] }, uMouse: { value: [0, 0] }, uPhotoFrac: { value: 0.56 }, uFrame: { value: 8 }, uRadius: { value: 16 }, uAlpha: { value: 0 }, uDim: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0 }, uParallax: { value: m2 ? 0.025 : 0.035 }, uHasText: { value: 0 } }, u3 = new Zi(e21, { vertex: Os, fragment: ks, uniforms: l3, transparent: true, depthTest: false, depthWrite: false, cullFace: null });
    return u3.setBlendFunc(e21.ONE, e21.ONE_MINUS_SRC_ALPHA), { item: t3, u: l3, mesh: new bo(e21, { geometry: c2, program: u3 }), canvas: i3, tText: a3, tPhoto: n3, tDepth: r3, data: { quote: (t3.querySelector(`blockquote`) || t3).textContent.trim().replace(/\s+/g, ` `).replace(/^[“"]|[”"]$/g, ``), name: sdText(t3, `footer strong`) || t3.dataset.name || ``, project: sdText(t3, `footer span`) || t3.dataset.project || ``, rating: parseInt(t3.dataset.rating || `0`, 10), mark: t3.dataset.mark || `` }, loaded: 0, textW: 0, z: 0 };
  }), C2 = { el: t2, type: `voices`, cur: 0, target: 0, alpha: 0, hover: false, lastAuto: performance.now(), loading: false, cardW: 300, cardH: 400 };
  t2.__voices = C2, t2.__plane = C2;
  let w2 = h2.querySelector(`[data-voices-count]`), T2 = Array.from(h2.querySelectorAll(`[data-voices-dots] button`)), E2 = (e22) => (e22 % _2 + _2) % _2;
  C2.go = (e22) => {
    C2.target = e22, C2.lastAuto = performance.now();
    let t3 = E2(e22);
    w2 && (w2.textContent = String(t3 + 1).padStart(2, `0`) + ` / ` + String(_2).padStart(2, `0`)), T2.forEach((e23, n3) => e23.classList.toggle(`is-on`, n3 === t3));
  }, h2.querySelectorAll(`[data-voices-next]`).forEach((e22) => e22.addEventListener(`click`, () => C2.go(C2.target + 1))), h2.querySelectorAll(`[data-voices-prev]`).forEach((e22) => e22.addEventListener(`click`, () => C2.go(C2.target - 1))), T2.forEach((e22, t3) => e22.addEventListener(`click`, () => {
    let e23 = t3 - E2(C2.target);
    e23 > _2 / 2 && (e23 -= _2), e23 < -_2 / 2 && (e23 += _2), C2.go(C2.target + e23);
  }));
  let D2 = null, O2 = 0;
  t2.addEventListener(`pointerdown`, (e22) => {
    D2 = e22.clientX, O2 = performance.now();
  }), t2.addEventListener(`pointerup`, (e22) => {
    if (D2 === null) return;
    let n3 = e22.clientX - D2;
    if (D2 = null, Math.abs(n3) > 40 && performance.now() - O2 < 800) {
      C2.go(C2.target + (n3 < 0 ? 1 : -1));
      return;
    }
    let i3 = r2(t2), a3 = (e22.clientX - i3.left) / i3.width - 0.5;
    a3 > 0.22 ? C2.go(C2.target + 1) : a3 < -0.22 && C2.go(C2.target - 1);
  }), t2.addEventListener(`pointerleave`, () => {
    D2 = null;
  });
  let k2 = () => {
    C2.loading || (C2.loading = true, S2.forEach((e22) => {
      n2.loadPD(e22.item, e22.tPhoto, e22.tDepth, (t3) => {
        e22.u.uImage.value = [t3.naturalWidth, t3.naturalHeight], e22.loaded++;
      }, () => {
        e22.loaded++;
      });
    }));
  }, A2 = () => {
    let e22 = C2.cardW - 16, t3 = C2.cardH - 16;
    S2.forEach((n3) => {
      Ps(n3.canvas, n3.data, e22, t3 * (1 - 0.56)), n3.tText.image = n3.canvas, n3.tText.needsUpdate = true, n3.u.uHasText.value = 1, n3.textW = e22;
    });
  };
  return (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    C2.cardW > 0 && A2();
  }), C2.update = () => {
    let e22 = r2(t2);
    if (!i2(e22, f2.h)) return C2.alpha = 0, false;
    if (k2(), S2.some((e23) => e23.loaded < 2)) return false;
    t2.classList.contains(`is-gl`) || t2.classList.add(`is-gl`);
    let n3 = Ms(Math.min(e22.width * 0.36, e22.height * 0.62), 220, 380), a3 = n3 * 1.32;
    Math.abs(n3 - C2.cardW) > 4 && (C2.cardW = n3, C2.cardH = a3, A2());
    let o3 = performance.now(), s3 = e22.top < f2.h * 0.8 && e22.bottom > f2.h * 0.2;
    s3 && !C2.wasVisible && (C2.lastAuto = o3), C2.wasVisible = s3, s3 && D2 === null && o3 - C2.lastAuto > 1e3 && C2.go(C2.target + 1), C2.cur = js(C2.cur, C2.target, 0.18), C2.alpha = js(C2.alpha, +(e22.top < f2.h * 0.92), 0.07);
    let c3 = [e22.left + e22.width / 2, e22.top + e22.height / 2], l3 = -a3 * 0.5 + 6, u3 = [v2.rx * 0.6, v2.ry * 0.6], d3 = [-v2.ry / 0.1, v2.rx / 0.075];
    return S2.forEach((e23, t3) => {
      let r3 = t3 + _2 * Math.round((C2.cur - t3) / _2) - C2.cur, i3 = Math.abs(r3), o4 = 1 - Math.min(i3, 2.2) * 0.075, s4 = -i3 * 190, m3 = r3 * n3 * 0.84, h3 = l3 + (a3 * 0.5 + 10) * o4;
      e23.z = s4, e23.s = r3, e23.abs = i3, e23.x = m3, e23.scale = o4, e23.centerY = h3;
      let g3 = e23.u;
      g3.uSize.value[0] = n3, g3.uSize.value[1] = a3, g3.uPlane.value[0] = n3, g3.uPlane.value[1] = a3, g3.uOffset.value[0] = m3, g3.uOffset.value[1] = h3, g3.uOffset.value[2] = s4, g3.uLocal.value = Ms(-r3 * 0.48, -0.8, 0.8), g3.uScale.value = o4, g3.uFloor.value = -(a3 * 0.5 + 10) * o4, g3.uRot.value = u3, g3.uPivot.value = c3, g3.uView.value[0] = f2.w, g3.uView.value[1] = f2.h, g3.uMouse.value[0] = d3[0] * (1 - Math.min(i3, 1) * 0.5), g3.uMouse.value[1] = d3[1] * (1 - Math.min(i3, 1) * 0.5), g3.uDim.value = Math.min(i3, 2) * 0.32, g3.uAlpha.value = C2.alpha * (1 - Ns(1.6, 2.5, i3)), g3.uTime.value = p2.time, g3.uGrain.value = p2.grain;
    }), C2.alpha > 4e-3;
  }, C2.draw = () => {
    let e22 = S2.slice().sort((e23, t4) => e23.z - t4.z), t3 = S2[0].u;
    y2.uRot.value = t3.uRot.value, y2.uPivot.value = t3.uPivot.value, y2.uView.value = t3.uView.value;
    for (let t4 of e22) y2.uSize.value[0] = C2.cardW * 1.2, y2.uSize.value[1] = C2.cardW * 0.26, y2.uOffset.value[0] = t4.x, y2.uOffset.value[1] = t4.centerY - (C2.cardH * 0.5 + 10) * t4.scale - 2, y2.uOffset.value[2] = t4.z, y2.uScale.value = t4.scale, y2.uAlpha.value = t4.u.uAlpha.value * 0.42 * (1 - Math.min(t4.abs, 2) * 0.3), l2(x2);
    for (let t4 of e22) t4.u.uFlip.value = 1, l2(t4.mesh);
    for (let t4 of e22) t4.u.uFlip.value = 0, l2(t4.mesh);
  }, C2.go(0), C2;
}
var Is = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPhoto;
uniform sampler2D tDepth;
uniform sampler2D tCap;
uniform vec2 uPlane;
uniform vec2 uImage;
uniform vec2 uMouse;
uniform float uFrame;
uniform float uRadius;
uniform float uAlpha;
uniform float uLift;
uniform float uTime;
uniform float uGrain;
uniform float uParallax;
uniform float uHasCap;
vec2 coverUv(vec2 uv, vec2 plane, vec2 img) {
  float pr = plane.x / plane.y, ir = img.x / img.y;
  vec2 s = pr > ir ? vec2(1.0, ir / pr) : vec2(pr / ir, 1.0);
  return (uv - 0.5) * s + 0.5;
}
float rrect(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 grade(vec3 c) {
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.06);
  c = (c - 0.5) * 1.05 + 0.5;
  c += vec3(0.02, 0.009, -0.012) * l;
  return clamp(pow(max(c, 0.0), vec3(0.97)), 0.0, 1.0);
}
void main() {
  vec2 px = (vUv - 0.5) * uPlane;
  float outer = 1.0 - smoothstep(-0.75, 0.75, rrect(px, uPlane * 0.5, uRadius));
  vec2 innerHalf = uPlane * 0.5 - uFrame;
  float inner = 1.0 - smoothstep(-0.75, 0.75, rrect(px, innerHalf, max(uRadius - uFrame, 2.0)));
  vec2 iuv = px / (innerHalf * 2.0) + 0.5;
  vec2 cuv = coverUv(iuv, innerHalf * 2.0, uImage);
  cuv = (cuv - 0.5) / (1.06 + uLift * 0.04) + 0.5;
  float d = texture2D(tDepth, cuv).r;
  vec3 col = grade(texture2D(tPhoto, cuv + uMouse * uParallax * (d - 0.45)).rgb);
  col *= mix(0.88, 1.0, smoothstep(1.3, 0.35, length((iuv - 0.5) * vec2(1.0, 0.85))));
  // caption band along the bottom
  float band = 1.0 - smoothstep(0.0, 0.42, iuv.y);
  col *= 1.0 - band * 0.6;
  if (iuv.y < 0.36) {
    vec4 cap = texture2D(tCap, vec2(iuv.x, iuv.y / 0.36));
    col = mix(col, cap.rgb, cap.a * uHasCap);
  }
  col = mix(vec3(0.99, 0.985, 0.975), col, inner);
  col *= 1.0 + uLift * 0.07;
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 100.0) - 0.5) * uGrain;
  float a = outer * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`, Ls = (e21, t2, n2) => e21 + (t2 - e21) * n2, Rs = (e21, t2, n2) => Math.min(n2, Math.max(t2, e21)), zs = (e21, t2, n2) => {
  let r2 = Rs((n2 - e21) / (t2 - e21), 0, 1);
  return r2 * r2 * (3 - 2 * r2);
}, Bs = (e21, t2) => (e21 % t2 + t2) % t2;
function Vs(e21, t2, n2, r2, i2) {
  e21.width = Math.round(r2 * 2), e21.height = Math.round(i2 * 2);
  let a2 = e21.getContext(`2d`);
  a2.scale(2, 2), a2.clearRect(0, 0, r2, i2);
  let o2 = Math.round(r2 * 0.055);
  a2.fillStyle = `rgba(255,255,255,0.97)`, a2.font = `600 ${Math.max(12, Math.round(r2 * 0.046))}px Inter, system-ui, sans-serif`, a2.fillText(t2, o2, i2 - o2 - Math.round(r2 * 0.05)), a2.fillStyle = `rgba(255,255,255,0.72)`, a2.font = `400 ${Math.max(10, Math.round(r2 * 0.037))}px Inter, system-ui, sans-serif`, a2.fillText(n2, o2, i2 - o2);
}
function Hs({ gl: e21, el: t2, ctx: n2 }) {
  let { rectOf: r2, near: i2, loadImage: a2, imageTex: o2, makeTex: s2, quad: c2, draw: l2, stackFor: u2, pointer: d2, vp: f2, state: p2, coarse: m2 } = n2, h2 = Array.from(t2.querySelectorAll(`[data-tile]`));
  if (!h2.length) return null;
  let g2 = u2(t2), _2 = Math.max(...h2.map((e22) => parseInt(e22.dataset.row || `0`, 10))) + 1, v2 = { uSize: { value: [1, 1] }, uOffset: { value: [0, 0, 0] }, uLocal: { value: 0 }, uScale: { value: 1 }, uFlip: { value: 0 }, uFloor: { value: 0 }, uRot: { value: [0, 0] }, uPivot: { value: [0, 0] }, uView: { value: [f2.w, f2.h] }, uPersp: { value: 1600 }, uPlane: { value: [1, 1] }, uRadius: { value: 14 }, uSpread: { value: 34 }, uAlpha: { value: 0 } }, y2 = new Zi(e21, { vertex: Os, fragment: Lo, uniforms: v2, transparent: true, depthTest: false, depthWrite: false, cullFace: null });
  y2.setBlendFunc(e21.ONE, e21.ONE_MINUS_SRC_ALPHA);
  let b2 = new bo(e21, { geometry: c2, program: y2 }), x2 = h2.map((t3, n3) => {
    let r3 = o2(), i3 = s2(), a3 = document.createElement(`canvas`), l3 = new wo(e21, { image: a3, generateMipmaps: true, minFilter: e21.LINEAR_MIPMAP_LINEAR }), u3 = { tPhoto: { value: r3 }, tDepth: { value: i3 }, tCap: { value: l3 }, uSize: { value: [1, 1] }, uOffset: { value: [0, 0, 0] }, uLocal: { value: 0 }, uScale: { value: 1 }, uFlip: { value: 0 }, uFloor: { value: 0 }, uRot: { value: [0, 0] }, uPivot: { value: [0, 0] }, uView: { value: [f2.w, f2.h] }, uPersp: { value: 1600 }, uPlane: { value: [1, 1] }, uImage: { value: [16, 9] }, uMouse: { value: [0, 0] }, uFrame: { value: 5 }, uRadius: { value: 14 }, uAlpha: { value: 0 }, uLift: { value: 0 }, uTime: { value: 0 }, uGrain: { value: 0 }, uParallax: { value: m2 ? 0.025 : 0.035 }, uHasCap: { value: 0 } }, d3 = new Zi(e21, { vertex: Os, fragment: Is, uniforms: u3, transparent: true, depthTest: false, depthWrite: false, cullFace: null });
    d3.setBlendFunc(e21.ONE, e21.ONE_MINUS_SRC_ALPHA);
    let p3 = new bo(e21, { geometry: c2, program: d3 });
    return { item: t3, idx: n3, row: parseInt(t3.dataset.row || `0`, 10), u: u3, mesh: p3, canvas: a3, tCap: l3, tPhoto: r3, tDepth: i3, loaded: 0, lift: 0, x: 0, y: 0, z: 0, scale: 1, alpha: 0, capW: 0 };
  }), S2 = Array.from({ length: _2 }, (e22, t3) => ({ tiles: x2.filter((e23) => e23.row === t3), offset: t3 * 137, dir: t3 % 2 ? 1 : -1, speed: 26 + t3 * 7 }));
  S2.forEach((e22) => e22.tiles.forEach((e23, t3) => {
    e23.col = t3;
  }));
  let C2 = { el: t2, type: `wall`, alpha: 0, hover: -1, loading: false, tileW: 0, tileH: 0, gap: 0, slow: 0 };
  t2.__wall = C2, t2.__plane = C2;
  let w2 = () => {
    C2.loading || (C2.loading = true, x2.forEach((e22) => {
      n2.loadPD(e22.item, e22.tPhoto, e22.tDepth, (t3) => {
        e22.u.uImage.value = [t3.naturalWidth, t3.naturalHeight], e22.loaded++;
      }, () => {
        e22.loaded++;
      });
    }));
  }, T2 = () => {
    x2.forEach((e22) => {
      Vs(e22.canvas, sdText(e22.item, `figcaption strong`) || e22.item.dataset.name || ``, sdText(e22.item, `figcaption span`) || e22.item.dataset.scope || ``, C2.tileW - 10, (C2.tileH - 10) * 0.36), e22.tCap.image = e22.canvas, e22.tCap.needsUpdate = true, e22.u.uHasCap.value = 1, e22.capW = C2.tileW;
    });
  };
  return (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    C2.tileW > 0 && T2();
  }), C2.update = () => {
    let e22 = r2(t2);
    if (i2(e22, f2.h * 1.5) && w2(), !i2(e22, f2.h * 0.2)) return C2.alpha = 0, false;
    if (x2.some((e23) => e23.loaded < 2)) return false;
    t2.classList.contains(`is-gl`) || t2.classList.add(`is-gl`);
    let n3 = Rs(e22.height * 0.028, 10, 22), a3 = Rs((e22.height - n3 * (_2 - 1)) / _2, 110, 240), o3 = a3 * 1.42;
    Math.abs(o3 - C2.tileW) > 3 && (C2.tileW = o3, C2.tileH = a3, C2.gap = n3, T2());
    let s3 = o3 + n3, c3 = e22.width / 2, l3 = [e22.left + e22.width / 2, e22.top + e22.height / 2], u3 = (p2.dt || 16.7) / 1e3;
    C2.alpha = Ls(C2.alpha, +(e22.top < f2.h * 0.92), 0.07), C2.slow = Ls(C2.slow, +(C2.hover >= 0), 0.08);
    let h3 = 1 - C2.slow * 0.8, v3 = Rs(p2.velocity || 0, -60, 60) * 0.35, y3 = [-0.04 + g2.rx * 0.5, -0.2 + g2.ry * 0.6], b3 = [-g2.ry / 0.1, g2.rx / 0.075], E2 = -1;
    for (let e23 of S2) {
      e23.offset += e23.dir * e23.speed * h3 * u3 + v3 * e23.dir * u3 * 6;
      let t3 = e23.tiles.length * s3, r3 = ((_2 - 1) / 2 - S2.indexOf(e23)) * (a3 + n3), i3 = S2.indexOf(e23) % 2 ? s3 * 0.5 : 0;
      for (let n4 of e23.tiles) {
        let u4 = Bs(n4.col * s3 + e23.offset + i3, t3) - t3 / 2, f3 = 1 - zs(c3 * 0.82, c3 * 1 + o3 * 0.6, Math.abs(u4));
        n4.x = u4, n4.y = r3, n4.edge = f3;
        let p3 = l3[0] + u4, h4 = l3[1] - r3;
        !m2 && f3 > 0.3 && Math.abs(d2.x - p3) < o3 / 2 && Math.abs(d2.y - h4) < a3 / 2 && (E2 = n4.idx);
      }
    }
    C2.hover = E2;
    for (let e23 of x2) {
      e23.lift = Ls(e23.lift, +(e23.idx === E2), 0.1), e23.z = e23.lift * 70, e23.scale = 1 + e23.lift * 0.05, e23.alpha = C2.alpha * e23.edge;
      let t3 = e23.u;
      t3.uSize.value[0] = o3, t3.uSize.value[1] = a3, t3.uPlane.value[0] = o3, t3.uPlane.value[1] = a3, t3.uOffset.value[0] = e23.x, t3.uOffset.value[1] = e23.y, t3.uOffset.value[2] = e23.z, t3.uScale.value = e23.scale, t3.uRot.value = y3, t3.uPivot.value = l3, t3.uView.value[0] = f2.w, t3.uView.value[1] = f2.h, t3.uMouse.value[0] = b3[0] * (0.5 + e23.lift * 0.8), t3.uMouse.value[1] = b3[1] * (0.5 + e23.lift * 0.8), t3.uAlpha.value = e23.alpha, t3.uLift.value = e23.lift, t3.uTime.value = p2.time, t3.uGrain.value = p2.grain;
    }
    return C2.alpha > 4e-3;
  }, C2.draw = () => {
    let e22 = x2.filter((e23) => e23.alpha > 3e-3).sort((e23, t4) => e23.z - t4.z), t3 = x2[0].u;
    v2.uRot.value = t3.uRot.value, v2.uPivot.value = t3.uPivot.value, v2.uView.value = t3.uView.value;
    for (let t4 of e22) {
      let e23 = 30 + t4.lift * 26;
      v2.uSize.value[0] = C2.tileW + e23 * 2, v2.uSize.value[1] = C2.tileH + e23 * 2, v2.uPlane.value[0] = v2.uSize.value[0], v2.uPlane.value[1] = v2.uSize.value[1], v2.uSpread.value = e23, v2.uOffset.value[0] = t4.x + 6 + t4.lift * 6, v2.uOffset.value[1] = t4.y - 10 - t4.lift * 16, v2.uOffset.value[2] = t4.z - 2, v2.uScale.value = t4.scale, v2.uAlpha.value = t4.alpha * (0.22 + t4.lift * 0.22), l2(b2);
    }
    for (let t4 of e22) l2(t4.mesh);
  }, C2;
}
var Us = (e21, t2, n2) => e21 + (t2 - e21) * n2, Ws = (e21, t2, n2) => Math.min(n2, Math.max(t2, e21)), Gs = (e21) => 1 - (1 - e21) ** 3;
function Ks({ canvas: e21, tier: t2, hero: n2 }) {
  let r2;
  try {
    r2 = new sa({ canvas: e21, alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, dpr: t2.dpr, webgl: 2, powerPreference: `high-performance` });
  } catch {
    return null;
  }
  let i2 = r2.gl;
  if (!i2) return null;
  i2.clearColor(0, 0, 0, 0), e21.addEventListener(`webglcontextlost`, (e22) => {
    e22.preventDefault(), j2(), document.body.dataset.tier = `0`;
  });
  let a2 = new Eo(i2, { width: 1, height: 1 }), o2 = { w: innerWidth, h: innerHeight }, s2 = { x: o2.w / 2, y: o2.h / 2, sx: 0, sy: 0 }, c2 = { time: 0, velocity: 0, dust: t2.dust, grain: t2.grain ? 0.03 : 0, enabled: true, idle: 0 }, l2 = t2.coarse, u2 = [];
  addEventListener(`pointermove`, (e22) => {
    s2.x = e22.clientX, s2.y = e22.clientY;
  }, { passive: true });
  let d2 = (e22) => e22.getBoundingClientRect(), f2 = (e22, t3) => e22.bottom > -t3 && e22.top < o2.h + t3 && e22.right > -t3 && e22.left < o2.w + t3;
  function p2(e22, t3) {
    e22.uRect.value[0] = (t3.left + t3.width / 2) / o2.w * 2 - 1, e22.uRect.value[1] = 1 - (t3.top + t3.height / 2) / o2.h * 2, e22.uRect.value[2] = t3.width / o2.w * 2, e22.uRect.value[3] = t3.height / o2.h * 2, e22.uPlane.value[0] = t3.width, e22.uPlane.value[1] = t3.height;
  }
  function m2(e22 = {}) {
    return new wo(i2, { generateMipmaps: false, minFilter: i2.LINEAR, magFilter: i2.LINEAR, ...e22 });
  }
  function h2() {
    return m2({ generateMipmaps: true, minFilter: i2.LINEAR_MIPMAP_LINEAR });
  }
  function g2(e22, t3, n3, err) {
    let r3 = new Image(), i3 = false, a3 = () => {
      i3 || (i3 = true, t3 && (t3.image = r3), n3 && n3(r3));
    };
    if (!e22) {
      err && err();
      return;
    }
    sdCors(r3, e22), r3.onload = a3, r3.onerror = () => {
      i3 || (i3 = true, err && err());
    }, r3.src = e22, r3.complete && r3.naturalWidth && a3();
  }
  // A photo slot's photo, then its depth map: the template's own, or a made-up one.
  function g2pd(el, tPhoto, tDepth, onPhoto, onDepth) {
    let src = sdSrc(el);
    g2(src, tPhoto, (img) => {
      onPhoto(img);
      let d = sdDepthUrl(src), fake = () => {
        tDepth.image = sdFakeDepth(img), onDepth();
      };
      d ? g2(d, tDepth, () => onDepth(), fake) : fake();
    });
  }
  function _2(e22, t3) {
    let n3 = new Zi(i2, { vertex: ko, fragment: e22, uniforms: t3, transparent: true, depthTest: false, depthWrite: false });
    return n3.setBlendFunc(i2.ONE, i2.ONE_MINUS_SRC_ALPHA), n3;
  }
  let v2 = (e22) => r2.render({ scene: e22, clear: false, sort: false, frustumCull: false }), y2 = () => ({ uRect: { value: [0, 0, 1, 1] }, uPlane: { value: [1, 1] }, uTime: { value: 0 }, uGrain: { value: c2.grain }, uAlpha: { value: 1 } });
  function b2(e22) {
    let t3 = h2(), n3 = m2(), u3 = m2(), p3 = { ...y2(), tMap: { value: t3 }, tDepth: { value: n3 }, tVideo: { value: u3 }, uImage: { value: [16, 9] }, uVideoRes: { value: [16, 9] }, uMouse: { value: [0, 0] }, uClip: { value: [-1e5, 1e5] }, uViewH: { value: o2.h }, uDpr: { value: r2.dpr }, uParallax: { value: l2 ? 0.03 : 0.045 }, uZoom: { value: 1 }, uVideoMix: { value: 0 }, uRadius: { value: 18 }, uDim: { value: 0 }, uReveal: { value: 0 }, uRectPx: { value: [0, 0, 1, 1] }, uOrigin: { value: [0, 0] }, uPOrigin: { value: [0, 0] }, uTrans: { value: [0, 0] }, uAngle: { value: 0 }, uPersp: { value: 1e3 }, uView: { value: [o2.w, o2.h] } }, _3 = new Zi(i2, { vertex: Fo, fragment: jo, uniforms: p3, transparent: true, depthTest: false, depthWrite: false });
    _3.setBlendFunc(i2.ONE, i2.ONE_MINUS_SRC_ALPHA);
    let b3 = new bo(i2, { geometry: a2, program: _3 }), x3 = e22.closest(`[data-service]`), S3 = x3 && x3.closest(`[data-cube-stage]`), C3 = { el: e22, mesh: b3, u: p3, type: `depth`, loaded: 0, loading: false, hover: false, mx: 0, my: 0, zoom: 1, mix: 0, reveal: 0, dim: 0, video: null };
    e22.__plane = C3;
    let w3 = () => {
      C3.loading || (C3.loading = true, g2pd(e22, t3, n3, (e23) => {
        p3.uImage.value = [e23.naturalWidth, e23.naturalHeight], C3.loaded++;
      }, () => {
        C3.loaded++;
      }));
    }, T3 = () => {
      if (C3.video) return C3.video;
      let t4 = document.createElement(`video`);
      t4.muted = true, t4.loop = true, t4.playsInline = true, t4.preload = `auto`;
      let r3 = document.createElement(`source`);
      return r3.src = e22.dataset.videoMp4, r3.type = `video/mp4`, t4.append(r3), t4.addEventListener(`loadedmetadata`, () => {
        p3.uVideoRes.value = [t4.videoWidth, t4.videoHeight];
      }), C3.video = t4, t4;
    }, E3 = (t4) => {
      C3.hover = t4, t4 && e22.dataset.videoMp4 && T3().play().catch(() => {
      });
    };
    return l2 ? new IntersectionObserver((e23) => e23.forEach((e24) => E3(e24.isIntersecting)), { threshold: 0.6 }).observe(e22) : (e22.addEventListener(`pointerenter`, () => E3(true)), e22.addEventListener(`pointerleave`, () => E3(false))), C3.update = () => {
      let t4 = S3 && S3.__cube, n4;
      if (t4) {
        let r3 = d2(S3), i4 = t4.cards.indexOf(x3), a4 = Math.min(t4.n - 2, Math.max(0, Math.floor(t4.progress))), s3 = i4 === a4 || i4 === a4 + 1;
        if (f2(r3, o2.h * 2.5) && w3(), !f2(r3, o2.h) || !s3) return C3.video && !C3.video.paused && !C3.hover && C3.video.pause(), C3.reveal = s3 ? C3.reveal : 0, false;
        if (C3.loaded < 2) return false;
        n4 = { left: r3.left + e22.offsetLeft, top: r3.top + e22.offsetTop, width: e22.offsetWidth, height: e22.offsetHeight }, n4.right = n4.left + n4.width, n4.bottom = n4.top + n4.height;
        let c3 = t4.progress - a4;
        p3.uRectPx.value[0] = n4.left, p3.uRectPx.value[1] = n4.top, p3.uRectPx.value[2] = n4.width, p3.uRectPx.value[3] = n4.height, p3.uOrigin.value[0] = r3.left + r3.width / 2, p3.uOrigin.value[1] = r3.top + (i4 === a4 ? r3.height : 0), p3.uPOrigin.value[0] = r3.left + r3.width / 2, p3.uPOrigin.value[1] = r3.top + r3.height / 2, p3.uTrans.value[0] = (parseFloat(hi.getProperty(x3, `yPercent`)) || 0) / 100 * r3.height, p3.uTrans.value[1] = parseFloat(hi.getProperty(x3, `z`)) || 0, p3.uAngle.value = (parseFloat(hi.getProperty(x3, `rotateX`)) || 0) * Math.PI / 180, p3.uView.value[0] = o2.w, p3.uView.value[1] = o2.h, p3.uPlane.value[0] = n4.width, p3.uPlane.value[1] = n4.height, C3.dim = i4 === a4 ? c3 * 0.7 : (1 - c3) * 0.7, C3.reveal = Us(C3.reveal, 1, 0.1);
      } else {
        if (n4 = d2(e22), !f2(n4, o2.h * 1.2)) return C3.video && !C3.video.paused && !C3.hover && C3.video.pause(), C3.reveal = 0, false;
        if (w3(), C3.loaded < 2) return false;
        if (!f2(n4, 40)) return C3.reveal = 0, false;
        p3.uRectPx.value[0] = n4.left, p3.uRectPx.value[1] = n4.top, p3.uRectPx.value[2] = n4.width, p3.uRectPx.value[3] = n4.height, p3.uOrigin.value[0] = 0, p3.uOrigin.value[1] = 0, p3.uPOrigin.value[0] = 0, p3.uPOrigin.value[1] = 0, p3.uTrans.value[0] = 0, p3.uTrans.value[1] = 0, p3.uAngle.value = 0, p3.uView.value[0] = o2.w, p3.uView.value[1] = o2.h, p3.uPlane.value[0] = n4.width, p3.uPlane.value[1] = n4.height, C3.reveal = Us(C3.reveal, +(n4.top < o2.h * 0.92), 0.09);
      }
      let i3, a3;
      l2 ? (i3 = 0, a3 = Ws(c2.velocity / 60, -1, 1)) : (i3 = Ws(((s2.x - n4.left) / n4.width - 0.5) * 2, -1.4, 1.4), a3 = Ws(((s2.y - n4.top) / n4.height - 0.5) * 2, -1.4, 1.4), C3.hover || (i3 *= 0.45, a3 *= 0.45)), C3.mx = Us(C3.mx, i3, 0.07), C3.my = Us(C3.my, -a3, 0.07), p3.uMouse.value[0] = C3.mx, p3.uMouse.value[1] = C3.my, C3.zoom = Us(C3.zoom, C3.hover ? 1.06 : 1, 0.06), p3.uZoom.value = C3.zoom;
      let m3 = C3.video, h3 = C3.hover && m3 && m3.readyState >= 2 && !m3.paused;
      return C3.mix = Us(C3.mix, +!!h3, 0.07), C3.mix < 3e-3 && (C3.mix = 0, m3 && !C3.hover && !m3.paused && m3.pause()), C3.mix > 0 && m3 && m3.readyState >= 2 && (u3.image = m3, u3.needsUpdate = true), p3.uVideoMix.value = C3.mix, p3.uViewH.value = o2.h, p3.uDpr.value = r2.dpr, p3.uDim.value = C3.dim, p3.uTime.value = c2.time, p3.uGrain.value = c2.grain, p3.uReveal.value = C3.reveal, C3.reveal > 0.9 && !e22.classList.contains(`is-gl`) && e22.classList.add(`is-gl`), C3.reveal > 4e-3;
    }, C3.draw = () => v2(b3), C3;
  }
  function x2(e22) {
    let t3 = m2(), l3 = { ...y2(), tVideo: { value: t3 }, uVideoRes: { value: [1600, 900] }, uMouse: { value: [0, 0] }, uProgress: { value: 0 }, uDip: { value: 0 }, uHero: { value: [0, 0, 1, 1] }, uViewH: { value: o2.h }, uDpr: { value: r2.dpr }, uCorner: { value: 32 } };
    l3.uAlpha.value = 0;
    let u3 = new bo(i2, { geometry: a2, program: _2(Mo, l3) }), h3 = new Float32Array(270);
    for (let e23 = 0; e23 < 270; e23++) h3[e23] = Math.random();
    let g3 = { uRect: { value: l3.uRect.value }, uMouse: { value: l3.uMouse.value }, uTime: { value: 0 }, uDpr: { value: r2.dpr }, uAlpha: { value: 0 } }, b3 = new Zi(i2, { vertex: Ro, fragment: zo, uniforms: g3, transparent: true, depthTest: false, depthWrite: false });
    b3.setBlendFunc(i2.ONE, i2.ONE);
    let x3 = new bo(i2, { mode: i2.POINTS, geometry: new Ji(i2, { position: { size: 3, data: h3 } }), program: b3 }), S3 = { el: e22, mesh: u3, u: l3, type: `hero`, alpha: 0, lastT: -1, hasFrame: false };
    return e22.__plane = S3, S3.update = () => {
      let i3 = d2(e22);
      if (!f2(i3, 0)) return false;
      let a3 = n2.video;
      if (!n2.ready || !a3 || (a3.readyState >= 2 && !a3.seeking && (a3.currentTime !== S3.lastT || !a3.paused) && (t3.image = a3, t3.needsUpdate = true, S3.lastT = a3.currentTime, S3.hasFrame = true), !S3.hasFrame)) return false;
      a3.videoWidth && l3.uVideoRes.value[0] !== a3.videoWidth && (l3.uVideoRes.value = [a3.videoWidth, a3.videoHeight]), p2(l3, i3);
      let u4 = d2(n2.el);
      l3.uHero.value[0] = u4.left, l3.uHero.value[1] = u4.top, l3.uHero.value[2] = u4.right, l3.uHero.value[3] = u4.bottom, l3.uViewH.value = o2.h, l3.uDpr.value = r2.dpr, S3.alpha = Us(S3.alpha, 1, 0.06), S3.alpha > 0.5 && !n2.el.classList.contains(`is-gl`) && n2.el.classList.add(`is-gl`), l3.uAlpha.value = S3.alpha, l3.uMouse.value[0] = s2.sx, l3.uMouse.value[1] = -s2.sy, l3.uProgress.value = n2.progress, l3.uTime.value = c2.time, l3.uGrain.value = c2.grain;
      let m3 = performance.now() - n2.dipAt;
      return l3.uDip.value = m3 < 700 ? Math.sin(Math.PI * Ws(m3 / 700, 0, 1)) : 0, g3.uTime.value = c2.time, g3.uDpr.value = r2.dpr, g3.uAlpha.value = c2.dust ? S3.alpha * (1 - n2.progress * 0.5) : 0, true;
    }, S3.draw = () => {
      v2(u3), c2.dust && v2(x3);
    }, S3;
  }
  function S2(e22) {
    let t3 = h2(), n3 = { ...y2(), tMap: { value: t3 }, uImage: { value: [16, 9] }, uTexel: { value: [1 / 1600, 1 / 900] }, uProgress: { value: 0 }, uRadius: { value: 18 } }, r3 = new bo(i2, { geometry: a2, program: _2(No, n3) }), s3 = { el: e22, mesh: r3, u: n3, type: `reveal`, loaded: false, loading: false, prog: 0 };
    return e22.__plane = s3, s3.update = () => {
      let r4 = d2(e22);
      if (!f2(r4, o2.w) || (s3.loading || (s3.loading = true, g2(e22.dataset.src, t3, (e23) => {
        n3.uImage.value = [e23.naturalWidth, e23.naturalHeight], n3.uTexel.value = [1 / e23.naturalWidth, 1 / e23.naturalHeight], s3.loaded = true;
      })), !s3.loaded) || (e22.classList.contains(`is-gl`) || e22.classList.add(`is-gl`), !f2(r4, 0))) return false;
      p2(n3, r4);
      let i3 = (r4.left + r4.width / 2) / o2.w, a3 = (r4.top + r4.height / 2) / o2.h, l3 = Ws((0.95 - i3) / 0.5, 0, 1), u3 = a3 < 0.95 && a3 > 0.05 ? l3 : 0;
      return s3.prog = Us(s3.prog, u3, 0.1), n3.uProgress.value = s3.prog, n3.uTime.value = c2.time, n3.uGrain.value = c2.grain, e22.classList.toggle(`is-revealed`, s3.prog > 0.7), true;
    }, s3.draw = () => v2(r3), s3;
  }
  let C2 = /* @__PURE__ */ new Map();
  function w2(e22) {
    let t3 = e22.closest(`[data-stack]`) || e22;
    return C2.has(t3) || C2.set(t3, { el: t3, rx: 0, ry: 0, reveal: 0, rect: null, lastVar: -1 }), C2.get(t3);
  }
  function T2() {
    for (let e22 of C2.values()) {
      let t3 = d2(e22.el);
      if (e22.rect = t3, !f2(t3, o2.h)) {
        e22.reveal = 0;
        continue;
      }
      let n3 = 0, r3 = 0;
      l2 ? r3 = Ws(c2.velocity / 90, -1, 1) : (n3 = Ws((s2.x - (t3.left + t3.width / 2)) / (o2.w * 0.5), -1, 1), r3 = Ws((s2.y - (t3.top + t3.height / 2)) / (o2.h * 0.5), -1, 1)), e22.rx = Us(e22.rx, -r3 * 0.075, 0.06), e22.ry = Us(e22.ry, -n3 * 0.1, 0.06), e22.reveal = Us(e22.reveal, +(t3.top < o2.h * 0.88), 0.05);
      let i3 = +Gs(e22.reveal).toFixed(3);
      (Math.abs(i3 - e22.lastVar) > 1e-3 || !l2) && (e22.lastVar = i3, e22.el.style.setProperty(`--rx`, e22.rx.toFixed(4) + `rad`), e22.el.style.setProperty(`--ry`, e22.ry.toFixed(4) + `rad`), e22.el.style.setProperty(`--rv`, i3));
    }
  }
  function E2(e22) {
    let t3 = h2(), n3 = m2(), r3 = parseFloat(e22.dataset.z || `0`), s3 = parseFloat(e22.dataset.frame || `0`), u3 = parseFloat(e22.dataset.shadow || `0.26`), p3 = { uRectPx: { value: [0, 0, 1, 1] }, uPivot: { value: [0, 0] }, uView: { value: [o2.w, o2.h] }, uRot: { value: [0, 0] }, uZ: { value: r3 }, uPersp: { value: 1400 } }, _3 = { ...y2(), ...p3, tMap: { value: t3 }, tDepth: { value: n3 }, uImage: { value: [16, 9] }, uMouse: { value: [0, 0] }, uParallax: { value: l2 ? 0.025 : 0.035 }, uRadius: { value: 16 }, uFrame: { value: s3 } }, b3 = new Zi(i2, { vertex: Po, fragment: Io, uniforms: _3, transparent: true, depthTest: false, depthWrite: false });
    b3.setBlendFunc(i2.ONE, i2.ONE_MINUS_SRC_ALPHA);
    let x3 = new bo(i2, { geometry: a2, program: b3 }), S3 = { uRectPx: { value: [0, 0, 1, 1] }, uPivot: p3.uPivot, uView: p3.uView, uRot: p3.uRot, uZ: { value: r3 - 2 }, uPersp: p3.uPersp, uPlane: { value: [1, 1] }, uRadius: { value: 16 }, uSpread: { value: 56 }, uAlpha: { value: 0 } }, C3 = new Zi(i2, { vertex: Po, fragment: Lo, uniforms: S3, transparent: true, depthTest: false, depthWrite: false });
    C3.setBlendFunc(i2.ONE, i2.ONE_MINUS_SRC_ALPHA);
    let T3 = new bo(i2, { geometry: a2, program: C3 }), E3 = { el: e22, mesh: x3, shadow: T3, u: _3, type: `card`, loaded: 0, loading: false };
    e22.__plane = E3;
    let D3 = w2(e22);
    return E3.update = () => {
      let i3 = d2(e22);
      if (!f2(i3, o2.h * 1.2) || (E3.loading || (E3.loading = true, g2pd(e22, t3, n3, (e23) => {
        _3.uImage.value = [e23.naturalWidth, e23.naturalHeight], E3.loaded++;
      }, () => {
        E3.loaded++;
      })), E3.loaded < 2)) return false;
      e22.classList.contains(`is-gl`) || e22.classList.add(`is-gl`);
      let a3 = D3.rect || d2(D3.el);
      if (!f2(a3, 0)) return false;
      let s4 = Gs(D3.reveal), l3 = a3.left + a3.width / 2, m3 = a3.top + a3.height / 2;
      p3.uPivot.value[0] = l3, p3.uPivot.value[1] = m3, p3.uView.value[0] = o2.w, p3.uView.value[1] = o2.h, p3.uRot.value[0] = D3.rx + (1 - s4) * 0.14, p3.uRot.value[1] = D3.ry - (1 - s4) * 0.38, p3.uZ.value = r3 * (1 + (1 - s4) * 2.5) + (1 - s4) * 80, S3.uZ.value = p3.uZ.value - 2;
      let h3 = i3.left + i3.width / 2 - l3, v3 = m3 - (i3.top + i3.height / 2);
      return _3.uRectPx.value[0] = h3, _3.uRectPx.value[1] = v3, _3.uRectPx.value[2] = i3.width, _3.uRectPx.value[3] = i3.height, _3.uPlane.value[0] = i3.width, _3.uPlane.value[1] = i3.height, S3.uRectPx.value[0] = h3, S3.uRectPx.value[1] = v3 - 30, S3.uRectPx.value[2] = i3.width + 112, S3.uRectPx.value[3] = i3.height + 112, S3.uPlane.value[0] = i3.width + 112, S3.uPlane.value[1] = i3.height + 112, _3.uMouse.value[0] = -D3.ry / 0.1, _3.uMouse.value[1] = D3.rx / 0.075, _3.uTime.value = c2.time, _3.uGrain.value = c2.grain, _3.uAlpha.value = s4, S3.uAlpha.value = s4 * u3, s4 > 4e-3;
    }, E3.draw = () => {
      v2(T3), v2(x3);
    }, E3;
  }
  document.querySelectorAll(`[data-stack]`).forEach(w2);
  let D2 = { rectOf: d2, near: f2, loadImage: g2, loadPD: g2pd, imageTex: h2, makeTex: m2, quad: a2, draw: v2, stackFor: w2, pointer: s2, vp: o2, state: c2, coarse: l2 };
  document.querySelectorAll(`[data-gl]`).forEach((e22) => {
    let n3 = e22.dataset.gl, a3 = null;
    n3 === `hero` ? t2.scrub && (a3 = x2(e22)) : n3 === `depth` ? a3 = b2(e22) : n3 === `reveal` ? a3 = S2(e22) : n3 === `card` ? a3 = E2(e22) : n3 === `model` ? a3 = Ds({ gl: i2, renderer: r2, el: e22, ctx: D2 }) : n3 === `voices` ? a3 = Fs({ gl: i2, el: e22, ctx: D2 }) : n3 === `wall` && (a3 = Hs({ gl: i2, el: e22, ctx: D2 })), a3 && u2.push(a3);
  });
  function O2() {
    o2.w = innerWidth, o2.h = innerHeight, r2.setSize(o2.w, o2.h);
  }
  O2(), addEventListener(`resize`, O2);
  function k2(e22, t3) {
    if (!c2.enabled) return;
    c2.time = e22, c2.dt = Math.min(t3 || 16.7, 100), s2.sx = Us(s2.sx, (s2.x / Math.max(o2.w, 1) - 0.5) * 2, 0.05) || 0, s2.sy = Us(s2.sy, (s2.y / Math.max(o2.h, 1) - 0.5) * 2, 0.05) || 0, T2();
    let n3 = false, r3 = [];
    for (let e23 of u2) e23.update() && (r3.push(e23), n3 = true);
    if (!(!n3 && c2.idle > 2)) {
      c2.idle = n3 ? 0 : c2.idle + 1, i2.bindFramebuffer(i2.FRAMEBUFFER, null), i2.viewport(0, 0, i2.drawingBufferWidth, i2.drawingBufferHeight), i2.clear(i2.COLOR_BUFFER_BIT);
      for (let e23 of r3) e23.draw();
    }
  }
  function A2({ dpr: e22, dust: t3, grain: n3 }) {
    e22 !== void 0 && (r2.dpr = e22, O2()), t3 !== void 0 && (c2.dust = t3), n3 !== void 0 && (c2.grain = n3);
  }
  function j2() {
    c2.enabled = false, e21.style.display = `none`, document.querySelectorAll(`.is-gl`).forEach((e22) => e22.classList.remove(`is-gl`));
    for (let e22 of u2) e22.video && (e22.video.pause(), e22.video = null);
  }
  return { renderer: r2, render: k2, setQuality: A2, disable: j2, planes: u2, state: c2 };
}
function qs(e21, t2) {
  for (var n2 = 0; n2 < t2.length; n2++) {
    var r2 = t2[n2];
    r2.enumerable = r2.enumerable || false, r2.configurable = true, `value` in r2 && (r2.writable = true), Object.defineProperty(e21, r2.key, r2);
  }
}
function Js(e21, t2, n2) {
  return t2 && qs(e21.prototype, t2), n2 && qs(e21, n2), e21;
}
var Ys, Xs, Zs, Qs, $s, ec, tc, nc, rc, ic, ac, oc, sc, cc = function() {
  return Ys || typeof window < `u` && (Ys = window.gsap) && Ys.registerPlugin && Ys;
}, lc = 1, uc = [], J = [], dc = [], fc = Date.now, pc = function(e21, t2) {
  return t2;
}, mc = function() {
  var e21 = rc.core, t2 = e21.bridge || {}, n2 = e21._scrollers, r2 = e21._proxies;
  n2.push.apply(n2, J), r2.push.apply(r2, dc), J = n2, dc = r2, pc = function(e22, n3) {
    return t2[e22](n3);
  };
}, hc = function(e21, t2) {
  return ~dc.indexOf(e21) && dc[dc.indexOf(e21) + 1][t2];
}, gc = function(e21) {
  return !!~ic.indexOf(e21);
}, _c = function(e21, t2, n2, r2, i2) {
  return e21.addEventListener(t2, n2, { passive: r2 !== false, capture: !!i2 });
}, vc = function(e21, t2, n2, r2) {
  return e21.removeEventListener(t2, n2, !!r2);
}, yc = `scrollLeft`, bc = `scrollTop`, xc = function() {
  return ac && ac.isPressed || J.cache++;
}, Sc = function(e21, t2) {
  var n2 = function n3(r2) {
    if (r2 || r2 === 0) {
      lc && (Zs.history.scrollRestoration = `manual`);
      var i2 = ac && ac.isPressed;
      r2 = n3.v = Math.round(r2) || (ac && ac.iOS ? 1 : 0), e21(r2), n3.cacheID = J.cache, i2 && pc(`ss`, r2);
    } else (t2 || J.cache !== n3.cacheID || pc(`ref`)) && (n3.cacheID = J.cache, n3.v = e21());
    return n3.v + n3.offset;
  };
  return n2.offset = 0, e21 && n2;
}, Cc = { s: yc, p: `left`, p2: `Left`, os: `right`, os2: `Right`, d: `width`, d2: `Width`, a: `x`, sc: Sc(function(e21) {
  return arguments.length ? Zs.scrollTo(e21, wc.sc()) : Zs.pageXOffset || Qs[yc] || $s[yc] || ec[yc] || 0;
}) }, wc = { s: bc, p: `top`, p2: `Top`, os: `bottom`, os2: `Bottom`, d: `height`, d2: `Height`, a: `y`, op: Cc, sc: Sc(function(e21) {
  return arguments.length ? Zs.scrollTo(Cc.sc(), e21) : Zs.pageYOffset || Qs[bc] || $s[bc] || ec[bc] || 0;
}) }, Tc = function(e21, t2) {
  return (t2 && t2._ctx && t2._ctx.selector || Ys.utils.toArray)(e21)[0] || (typeof e21 == `string` && Ys.config().nullTargetWarn !== false ? console.warn(`Element not found:`, e21) : null);
}, Ec = function(e21, t2) {
  for (var n2 = t2.length; n2--; ) if (t2[n2] === e21 || t2[n2].contains(e21)) return true;
  return false;
}, Dc = function(e21, t2) {
  var n2 = t2.s, r2 = t2.sc;
  gc(e21) && (e21 = Qs.scrollingElement || $s);
  var i2 = J.indexOf(e21), a2 = r2 === wc.sc ? 1 : 2;
  !~i2 && (i2 = J.push(e21) - 1), J[i2 + a2] || _c(e21, `scroll`, xc);
  var o2 = J[i2 + a2], s2 = o2 || (J[i2 + a2] = Sc(hc(e21, n2), true) || (gc(e21) ? r2 : Sc(function(t3) {
    return arguments.length ? e21[n2] = t3 : e21[n2];
  })));
  return s2.target = e21, o2 || (s2.smooth = Ys.getProperty(e21, `scrollBehavior`) === `smooth`), s2;
}, Oc = function(e21, t2, n2) {
  var r2 = e21, i2 = e21, a2 = fc(), o2 = a2, s2 = t2 || 50, c2 = Math.max(500, s2 * 3), l2 = function(e22, t3) {
    var c3 = fc();
    t3 || c3 - a2 > s2 ? (i2 = r2, r2 = e22, o2 = a2, a2 = c3) : n2 ? r2 += e22 : r2 = i2 + (e22 - i2) / (c3 - o2) * (a2 - o2);
  };
  return { update: l2, reset: function() {
    i2 = r2 = n2 ? 0 : r2, o2 = a2 = 0;
  }, getVelocity: function(e22) {
    var t3 = o2, s3 = i2, u2 = fc();
    return (e22 || e22 === 0) && e22 !== r2 && l2(e22), a2 === o2 || u2 - o2 > c2 ? 0 : (r2 + (n2 ? s3 : -s3)) / ((n2 ? u2 : a2) - t3) * 1e3;
  } };
}, kc = function(e21, t2) {
  return t2 && !e21._gsapAllow && e21.cancelable !== false && e21.preventDefault(), e21.changedTouches ? e21.changedTouches[0] : e21;
}, Ac = function(e21) {
  var t2 = Math.max.apply(Math, e21), n2 = Math.min.apply(Math, e21);
  return Math.abs(t2) >= Math.abs(n2) ? t2 : n2;
}, jc = function() {
  rc = Ys.core.globals().ScrollTrigger, rc && rc.core && mc();
}, Mc = function(e21) {
  return Ys = e21 || cc(), !Xs && Ys && typeof document < `u` && document.body && (Zs = window, Qs = document, $s = Qs.documentElement, ec = Qs.body, ic = [Zs, Qs, $s, ec], Ys.utils.clamp, sc = Ys.core.context || function() {
  }, nc = `onpointerenter` in ec ? `pointer` : `mouse`, tc = Nc.isTouch = Zs.matchMedia && Zs.matchMedia(`(hover: none), (pointer: coarse)`).matches ? 1 : `ontouchstart` in Zs || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0 ? 2 : 0, oc = Nc.eventTypes = (`ontouchstart` in $s ? `touchstart,touchmove,touchcancel,touchend` : `onpointerdown` in $s ? `pointerdown,pointermove,pointercancel,pointerup` : `mousedown,mousemove,mouseup,mouseup`).split(`,`), setTimeout(function() {
    return lc = 0;
  }, 500), Xs = 1), rc || jc(), Xs;
};
Cc.op = wc, J.cache = 0;
var Nc = (function() {
  function e21(e22) {
    this.init(e22);
  }
  var t2 = e21.prototype;
  return t2.init = function(e22) {
    Xs || Mc(Ys) || console.warn(`Please gsap.registerPlugin(Observer)`), rc || jc();
    var t3 = e22.tolerance, n2 = e22.dragMinimum, r2 = e22.type, i2 = e22.target, a2 = e22.lineHeight, o2 = e22.debounce, s2 = e22.preventDefault, c2 = e22.onStop, l2 = e22.onStopDelay, u2 = e22.ignore, d2 = e22.wheelSpeed, f2 = e22.event, p2 = e22.onDragStart, m2 = e22.onDragEnd, h2 = e22.onDrag, g2 = e22.onPress, _2 = e22.onRelease, v2 = e22.onRight, y2 = e22.onLeft, b2 = e22.onUp, x2 = e22.onDown, S2 = e22.onChangeX, C2 = e22.onChangeY, w2 = e22.onChange, T2 = e22.onToggleX, E2 = e22.onToggleY, D2 = e22.onHover, O2 = e22.onHoverEnd, k2 = e22.onMove, A2 = e22.ignoreCheck, j2 = e22.isNormalizer, M2 = e22.onGestureStart, N2 = e22.onGestureEnd, P2 = e22.onWheel, F2 = e22.onEnable, I2 = e22.onDisable, L2 = e22.onClick, R2 = e22.scrollSpeed, ee2 = e22.capture, te2 = e22.allowClicks, z2 = e22.lockAxis, ne2 = e22.onLockAxis;
    this.target = i2 = Tc(i2) || $s, this.vars = e22, u2 && (u2 = Ys.utils.toArray(u2)), t3 = t3 || 1e-9, n2 = n2 || 0, d2 = d2 || 1, R2 = R2 || 1, r2 = r2 || `wheel,touch,pointer`, o2 = o2 !== false, a2 || (a2 = parseFloat(Zs.getComputedStyle(ec).lineHeight) || 22);
    var B2, re2, ie2, ae2, V2, oe2, se2, H2 = this, ce2 = 0, le2 = 0, ue2 = e22.passive || !s2 && e22.passive !== false, de2 = Dc(i2, Cc), fe2 = Dc(i2, wc), pe2 = de2(), me2 = fe2(), he2 = ~r2.indexOf(`touch`) && !~r2.indexOf(`pointer`) && oc[0] === `pointerdown`, ge2 = gc(i2), U2 = i2.ownerDocument || Qs, _e2 = [0, 0, 0], W2 = [0, 0, 0], ve2 = 0, ye2 = function() {
      return ve2 = fc();
    }, be2 = function(e23, t4) {
      return (H2.event = e23) && u2 && Ec(e23.target, u2) || t4 && he2 && e23.pointerType !== `touch` || A2 && A2(e23, t4);
    }, xe2 = function() {
      H2._vx.reset(), H2._vy.reset(), re2.pause(), c2 && c2(H2);
    }, Se2 = function() {
      var e23 = H2.deltaX = Ac(_e2), n3 = H2.deltaY = Ac(W2), r3 = Math.abs(e23) >= t3, i3 = Math.abs(n3) >= t3;
      w2 && (r3 || i3) && w2(H2, e23, n3, _e2, W2), r3 && (v2 && H2.deltaX > 0 && v2(H2), y2 && H2.deltaX < 0 && y2(H2), S2 && S2(H2), T2 && H2.deltaX < 0 != ce2 < 0 && T2(H2), ce2 = H2.deltaX, _e2[0] = _e2[1] = _e2[2] = 0), i3 && (x2 && H2.deltaY > 0 && x2(H2), b2 && H2.deltaY < 0 && b2(H2), C2 && C2(H2), E2 && H2.deltaY < 0 != le2 < 0 && E2(H2), le2 = H2.deltaY, W2[0] = W2[1] = W2[2] = 0), (ae2 || ie2) && (k2 && k2(H2), ie2 && (p2 && ie2 === 1 && p2(H2), h2 && h2(H2), ie2 = 0), ae2 = false), oe2 && !(oe2 = false) && ne2 && ne2(H2), V2 && (P2(H2), V2 = false), B2 = 0;
    }, Ce2 = function(e23, t4, n3) {
      _e2[n3] += e23, W2[n3] += t4, H2._vx.update(e23), H2._vy.update(t4), o2 ? B2 || (B2 = requestAnimationFrame(Se2)) : Se2();
    }, we2 = function(e23, t4) {
      z2 && !se2 && (H2.axis = se2 = Math.abs(e23) > Math.abs(t4) ? `x` : `y`, oe2 = true), se2 !== `y` && (_e2[2] += e23, H2._vx.update(e23, true)), se2 !== `x` && (W2[2] += t4, H2._vy.update(t4, true)), o2 ? B2 || (B2 = requestAnimationFrame(Se2)) : Se2();
    }, Te2 = function(e23) {
      if (!be2(e23, 1)) {
        e23 = kc(e23, s2);
        var t4 = e23.clientX, r3 = e23.clientY, i3 = t4 - H2.x, a3 = r3 - H2.y, o3 = H2.isDragging;
        H2.x = t4, H2.y = r3, (o3 || (i3 || a3) && (Math.abs(H2.startX - t4) >= n2 || Math.abs(H2.startY - r3) >= n2)) && (ie2 || (ie2 = o3 ? 2 : 1), o3 || (H2.isDragging = true), we2(i3, a3));
      }
    }, Ee2 = H2.onPress = function(e23) {
      be2(e23, 1) || e23 && e23.button || (H2.axis = se2 = null, re2.pause(), H2.isPressed = true, e23 = kc(e23), ce2 = le2 = 0, H2.startX = H2.x = e23.clientX, H2.startY = H2.y = e23.clientY, H2._vx.reset(), H2._vy.reset(), _c(j2 ? i2 : U2, oc[1], Te2, ue2, true), H2.deltaX = H2.deltaY = 0, g2 && g2(H2));
    }, De2 = H2.onRelease = function(e23) {
      if (!be2(e23, 1)) {
        vc(j2 ? i2 : U2, oc[1], Te2, true);
        var t4 = !isNaN(H2.y - H2.startY), n3 = H2.isDragging, r3 = n3 && (Math.abs(H2.x - H2.startX) > 3 || Math.abs(H2.y - H2.startY) > 3), a3 = kc(e23);
        !r3 && t4 && (H2._vx.reset(), H2._vy.reset(), s2 && te2 && Ys.delayedCall(0.08, function() {
          if (fc() - ve2 > 300 && !e23.defaultPrevented) {
            if (e23.target.click) e23.target.click();
            else if (U2.createEvent) {
              var t5 = U2.createEvent(`MouseEvents`);
              t5.initMouseEvent(`click`, true, true, Zs, 1, a3.screenX, a3.screenY, a3.clientX, a3.clientY, false, false, false, false, 0, null), e23.target.dispatchEvent(t5);
            }
          }
        })), H2.isDragging = H2.isGesturing = H2.isPressed = false, c2 && n3 && !j2 && re2.restart(true), ie2 && Se2(), m2 && n3 && m2(H2), _2 && _2(H2, r3);
      }
    }, G2 = function(e23) {
      return e23.touches && e23.touches.length > 1 && (H2.isGesturing = true) && M2(e23, H2.isDragging);
    }, Oe2 = function() {
      return (H2.isGesturing = false) || N2(H2);
    }, ke2 = function(e23) {
      if (!be2(e23)) {
        var t4 = de2(), n3 = fe2();
        Ce2((t4 - pe2) * R2, (n3 - me2) * R2, 1), pe2 = t4, me2 = n3, c2 && re2.restart(true);
      }
    }, Ae2 = function(e23) {
      if (!be2(e23)) {
        e23 = kc(e23, s2), P2 && (V2 = true);
        var t4 = (e23.deltaMode === 1 ? a2 : e23.deltaMode === 2 ? Zs.innerHeight : 1) * d2;
        Ce2(e23.deltaX * t4, e23.deltaY * t4, 0), c2 && !j2 && re2.restart(true);
      }
    }, je2 = function(e23) {
      if (!be2(e23)) {
        var t4 = e23.clientX, n3 = e23.clientY, r3 = t4 - H2.x, i3 = n3 - H2.y;
        H2.x = t4, H2.y = n3, ae2 = true, c2 && re2.restart(true), (r3 || i3) && we2(r3, i3);
      }
    }, Me2 = function(e23) {
      H2.event = e23, D2(H2);
    }, Ne2 = function(e23) {
      H2.event = e23, O2(H2);
    }, Pe2 = function(e23) {
      return be2(e23) || kc(e23, s2) && L2(H2);
    };
    re2 = H2._dc = Ys.delayedCall(l2 || 0.25, xe2).pause(), H2.deltaX = H2.deltaY = 0, H2._vx = Oc(0, 50, true), H2._vy = Oc(0, 50, true), H2.scrollX = de2, H2.scrollY = fe2, H2.isDragging = H2.isGesturing = H2.isPressed = false, sc(this), H2.enable = function(e23) {
      return H2.isEnabled || (_c(ge2 ? U2 : i2, `scroll`, xc), r2.indexOf(`scroll`) >= 0 && _c(ge2 ? U2 : i2, `scroll`, ke2, ue2, ee2), r2.indexOf(`wheel`) >= 0 && _c(i2, `wheel`, Ae2, ue2, ee2), (r2.indexOf(`touch`) >= 0 && tc || r2.indexOf(`pointer`) >= 0) && (_c(i2, oc[0], Ee2, ue2, ee2), _c(U2, oc[2], De2), _c(U2, oc[3], De2), te2 && _c(i2, `click`, ye2, true, true), L2 && _c(i2, `click`, Pe2), M2 && _c(U2, `gesturestart`, G2), N2 && _c(U2, `gestureend`, Oe2), D2 && _c(i2, nc + `enter`, Me2), O2 && _c(i2, nc + `leave`, Ne2), k2 && _c(i2, nc + `move`, je2)), H2.isEnabled = true, H2.isDragging = H2.isGesturing = H2.isPressed = ae2 = ie2 = false, H2._vx.reset(), H2._vy.reset(), pe2 = de2(), me2 = fe2(), e23 && e23.type && Ee2(e23), F2 && F2(H2)), H2;
    }, H2.disable = function() {
      H2.isEnabled && (uc.filter(function(e23) {
        return e23 !== H2 && gc(e23.target);
      }).length || vc(ge2 ? U2 : i2, `scroll`, xc), H2.isPressed && (H2._vx.reset(), H2._vy.reset(), vc(j2 ? i2 : U2, oc[1], Te2, true)), vc(ge2 ? U2 : i2, `scroll`, ke2, ee2), vc(i2, `wheel`, Ae2, ee2), vc(i2, oc[0], Ee2, ee2), vc(U2, oc[2], De2), vc(U2, oc[3], De2), vc(i2, `click`, ye2, true), vc(i2, `click`, Pe2), vc(U2, `gesturestart`, G2), vc(U2, `gestureend`, Oe2), vc(i2, nc + `enter`, Me2), vc(i2, nc + `leave`, Ne2), vc(i2, nc + `move`, je2), H2.isEnabled = H2.isPressed = H2.isDragging = false, I2 && I2(H2));
    }, H2.kill = H2.revert = function() {
      H2.disable();
      var e23 = uc.indexOf(H2);
      e23 >= 0 && uc.splice(e23, 1), ac === H2 && (ac = 0);
    }, uc.push(H2), j2 && gc(i2) && (ac = H2), H2.enable(f2);
  }, Js(e21, [{ key: `velocityX`, get: function() {
    return this._vx.getVelocity();
  } }, { key: `velocityY`, get: function() {
    return this._vy.getVelocity();
  } }]), e21;
})();
Nc.version = `3.15.0`, Nc.create = function(e21) {
  return new Nc(e21);
}, Nc.register = Mc, Nc.getAll = function() {
  return uc.slice();
}, Nc.getById = function(e21) {
  return uc.filter(function(t2) {
    return t2.vars.id === e21;
  })[0];
}, cc() && Ys.registerPlugin(Nc);
var Y, Pc, X, Fc, Ic, Lc, Rc, zc, Bc, Vc, Hc, Uc, Wc, Gc, Kc, qc, Jc, Yc, Xc, Zc, Qc, $c, el, tl, nl, rl, il, al, ol, sl, cl, ll, ul, dl, fl = 1, pl = Date.now, ml = pl(), hl = 0, gl = 0, _l = function(e21, t2, n2) {
  var r2 = Nl(e21) && (e21.substr(0, 6) === `clamp(` || e21.indexOf(`max`) > -1);
  return n2[`_` + t2 + `Clamp`] = r2, r2 ? e21.substr(6, e21.length - 7) : e21;
}, vl = function(e21, t2) {
  return t2 && (!Nl(e21) || e21.substr(0, 6) !== `clamp(`) ? `clamp(` + e21 + `)` : e21;
}, yl = function e17() {
  return gl && requestAnimationFrame(e17);
}, bl = function() {
  return Gc = 1;
}, xl = function() {
  return Gc = 0;
}, Sl = function(e21) {
  return e21;
}, Cl = function(e21) {
  return Math.round(e21 * 1e5) / 1e5 || 0;
}, wl = function() {
  return typeof window < `u`;
}, Tl = function() {
  return Y || wl() && (Y = window.gsap) && Y.registerPlugin && Y;
}, El = function(e21) {
  return !!~Rc.indexOf(e21);
}, Dl = function(e21) {
  return (e21 === `Height` ? cl : X[`inner` + e21]) || Ic[`client` + e21] || Lc[`client` + e21];
}, Ol = function(e21) {
  return hc(e21, `getBoundingClientRect`) || (El(e21) ? function() {
    return ed.width = X.innerWidth, ed.height = cl, ed;
  } : function() {
    return iu(e21);
  });
}, kl = function(e21, t2, n2) {
  var r2 = n2.d, i2 = n2.d2, a2 = n2.a;
  return (a2 = hc(e21, `getBoundingClientRect`)) ? function() {
    return a2()[r2];
  } : function() {
    return (t2 ? Dl(i2) : e21[`client` + i2]) || 0;
  };
}, Al = function(e21, t2) {
  return !t2 || ~dc.indexOf(e21) ? Ol(e21) : function() {
    return ed;
  };
}, jl = function(e21, t2) {
  var n2 = t2.s, r2 = t2.d2, i2 = t2.d, a2 = t2.a;
  return Math.max(0, (n2 = `scroll` + r2) && (a2 = hc(e21, n2)) ? a2() - Ol(e21)()[i2] : El(e21) ? (Ic[n2] || Lc[n2]) - Dl(r2) : e21[n2] - e21[`offset` + r2]);
}, Ml = function(e21, t2) {
  for (var n2 = 0; n2 < Xc.length; n2 += 3) (!t2 || ~t2.indexOf(Xc[n2 + 1])) && e21(Xc[n2], Xc[n2 + 1], Xc[n2 + 2]);
}, Nl = function(e21) {
  return typeof e21 == `string`;
}, Pl = function(e21) {
  return typeof e21 == `function`;
}, Fl = function(e21) {
  return typeof e21 == `number`;
}, Il = function(e21) {
  return typeof e21 == `object`;
}, Ll = function(e21, t2, n2) {
  return e21 && e21.progress(+!t2) && n2 && e21.pause();
}, Rl = function(e21, t2, n2) {
  if (e21.enabled) {
    var r2 = e21._ctx ? e21._ctx.add(function() {
      return t2(e21, n2);
    }) : t2(e21, n2);
    r2 && r2.totalTime && (e21.callbackAnimation = r2);
  }
}, zl = Math.abs, Bl = `left`, Vl = `top`, Hl = `right`, Ul = `bottom`, Wl = `width`, Gl = `height`, Kl = `Right`, ql = `Left`, Jl = `Top`, Yl = `Bottom`, Xl = `padding`, Zl = `margin`, Ql = `Width`, $l = `Height`, eu = `px`, tu = function(e21) {
  return X.getComputedStyle(e21.nodeType === Node.DOCUMENT_NODE ? e21.scrollingElement : e21);
}, nu = function(e21) {
  var t2 = tu(e21).position;
  e21.style.position = t2 === `absolute` || t2 === `fixed` ? t2 : `relative`;
}, ru = function(e21, t2) {
  for (var n2 in t2) n2 in e21 || (e21[n2] = t2[n2]);
  return e21;
}, iu = function(e21, t2) {
  var n2 = t2 && tu(e21)[Kc] !== `matrix(1, 0, 0, 1, 0, 0)` && Y.to(e21, { x: 0, y: 0, xPercent: 0, yPercent: 0, rotation: 0, rotationX: 0, rotationY: 0, scale: 1, skewX: 0, skewY: 0 }).progress(1), r2 = e21.getBoundingClientRect ? e21.getBoundingClientRect() : e21.scrollingElement.getBoundingClientRect();
  return n2 && n2.progress(0).kill(), r2;
}, au = function(e21, t2) {
  var n2 = t2.d2;
  return e21[`offset` + n2] || e21[`client` + n2] || 0;
}, ou = function(e21) {
  var t2 = [], n2 = e21.labels, r2 = e21.duration(), i2;
  for (i2 in n2) t2.push(n2[i2] / r2);
  return t2;
}, su = function(e21) {
  return function(t2) {
    return Y.utils.snap(ou(e21), t2);
  };
}, cu = function(e21) {
  var t2 = Y.utils.snap(e21), n2 = Array.isArray(e21) && e21.slice(0).sort(function(e22, t3) {
    return e22 - t3;
  });
  return n2 ? function(e22, r2, i2) {
    i2 === void 0 && (i2 = 1e-3);
    var a2;
    if (!r2) return t2(e22);
    if (r2 > 0) {
      for (e22 -= i2, a2 = 0; a2 < n2.length; a2++) if (n2[a2] >= e22) return n2[a2];
      return n2[a2 - 1];
    }
    for (a2 = n2.length, e22 += i2; a2--; ) if (n2[a2] <= e22) return n2[a2];
    return n2[0];
  } : function(n3, r2, i2) {
    i2 === void 0 && (i2 = 1e-3);
    var a2 = t2(n3);
    return !r2 || Math.abs(a2 - n3) < i2 || a2 - n3 < 0 == r2 < 0 ? a2 : t2(r2 < 0 ? n3 - e21 : n3 + e21);
  };
}, lu = function(e21) {
  return function(t2, n2) {
    return cu(ou(e21))(t2, n2.direction);
  };
}, uu = function(e21, t2, n2, r2) {
  return n2.split(`,`).forEach(function(n3) {
    return e21(t2, n3, r2);
  });
}, du = function(e21, t2, n2, r2, i2) {
  return e21.addEventListener(t2, n2, { passive: !r2, capture: !!i2 });
}, fu = function(e21, t2, n2, r2) {
  return e21.removeEventListener(t2, n2, !!r2);
}, pu = function(e21, t2, n2) {
  n2 = n2 && n2.wheelHandler, n2 && (e21(t2, `wheel`, n2), e21(t2, `touchmove`, n2));
}, mu = { startColor: `green`, endColor: `red`, indent: 0, fontSize: `16px`, fontWeight: `normal` }, hu = { toggleActions: `play`, anticipatePin: 0 }, gu = { top: 0, left: 0, center: 0.5, bottom: 1, right: 1 }, _u = function(e21, t2) {
  if (Nl(e21)) {
    var n2 = e21.indexOf(`=`), r2 = ~n2 ? +(e21.charAt(n2 - 1) + 1) * parseFloat(e21.substr(n2 + 1)) : 0;
    ~n2 && (e21.indexOf(`%`) > n2 && (r2 *= t2 / 100), e21 = e21.substr(0, n2 - 1)), e21 = r2 + (e21 in gu ? gu[e21] * t2 : ~e21.indexOf(`%`) ? parseFloat(e21) * t2 / 100 : parseFloat(e21) || 0);
  }
  return e21;
}, vu = function(e21, t2, n2, r2, i2, a2, o2, s2) {
  var c2 = i2.startColor, l2 = i2.endColor, u2 = i2.fontSize, d2 = i2.indent, f2 = i2.fontWeight, p2 = Fc.createElement(`div`), m2 = El(n2) || hc(n2, `pinType`) === `fixed`, h2 = e21.indexOf(`scroller`) !== -1, g2 = m2 ? Lc : n2.tagName === `IFRAME` ? n2.contentDocument.body : n2, _2 = e21.indexOf(`start`) !== -1, v2 = _2 ? c2 : l2, y2 = `border-color:` + v2 + `;font-size:` + u2 + `;color:` + v2 + `;font-weight:` + f2 + `;pointer-events:none;white-space:nowrap;font-family:sans-serif,Arial;z-index:1000;padding:4px 8px;border-width:0;border-style:solid;`;
  return y2 += `position:` + ((h2 || s2) && m2 ? `fixed;` : `absolute;`), (h2 || s2 || !m2) && (y2 += (r2 === wc ? Hl : Ul) + `:` + (a2 + parseFloat(d2)) + `px;`), o2 && (y2 += `box-sizing:border-box;text-align:left;width:` + o2.offsetWidth + `px;`), p2._isStart = _2, p2.setAttribute(`class`, `gsap-marker-` + e21 + (t2 ? ` marker-` + t2 : ``)), p2.style.cssText = y2, p2.innerText = t2 || t2 === 0 ? e21 + `-` + t2 : e21, g2.children[0] ? g2.insertBefore(p2, g2.children[0]) : g2.appendChild(p2), p2._offset = p2[`offset` + r2.op.d2], yu(p2, 0, r2, _2), p2;
}, yu = function(e21, t2, n2, r2) {
  var i2 = { display: `block` }, a2 = n2[r2 ? `os2` : `p2`], o2 = n2[r2 ? `p2` : `os2`];
  e21._isFlipped = r2, i2[n2.a + `Percent`] = r2 ? -100 : 0, i2[n2.a] = r2 ? `1px` : 0, i2[`border` + a2 + Ql] = 1, i2[`border` + o2 + Ql] = 0, i2[n2.p] = t2 + `px`, Y.set(e21, i2);
}, Z = [], bu = {}, xu, Su = function() {
  return pl() - hl > 34 && (xu || (xu = requestAnimationFrame(Gu)));
}, Cu = function() {
  (!el || !el.isPressed || el.startX > Lc.clientWidth) && (J.cache++, el ? xu || (xu = requestAnimationFrame(Gu)) : Gu(), hl || ku(`scrollStart`), hl = pl());
}, wu = function() {
  rl = X.innerWidth, nl = X.innerHeight;
}, Tu = function(e21) {
  J.cache++, (e21 === true || !Wc && !$c && !Fc.fullscreenElement && !Fc.webkitFullscreenElement && (!tl || rl !== X.innerWidth || Math.abs(X.innerHeight - nl) > X.innerHeight * 0.25)) && zc.restart(true);
}, Eu = {}, Du = [], Ou = function e18() {
  return fu(Q, `scrollEnd`, e18) || Vu(true);
}, ku = function(e21) {
  return Eu[e21] && Eu[e21].map(function(e22) {
    return e22();
  }) || Du;
}, Au = [], ju = function(e21) {
  for (var t2 = 0; t2 < Au.length; t2 += 5) (!e21 || Au[t2 + 4] && Au[t2 + 4].query === e21) && (Au[t2].style.cssText = Au[t2 + 1], Au[t2].getBBox && Au[t2].setAttribute(`transform`, Au[t2 + 2] || ``), Au[t2 + 3].uncache = 1);
}, Mu = function() {
  return J.forEach(function(e21) {
    return Pl(e21) && ++e21.cacheID && (e21.rec = e21());
  });
}, Nu = function(e21, t2) {
  var n2;
  for (qc = 0; qc < Z.length; qc++) n2 = Z[qc], n2 && (!t2 || n2._ctx === t2) && (e21 ? n2.kill(1) : n2.revert(true, true));
  ll = true, t2 && ju(t2), t2 || ku(`revert`);
}, Pu = function(e21, t2) {
  J.cache++, (t2 || !Fu) && J.forEach(function(e22) {
    return Pl(e22) && e22.cacheID++ && (e22.rec = 0);
  }), Nl(e21) && (X.history.scrollRestoration = ol = e21);
}, Fu, Iu = 0, Lu, Ru = function() {
  if (Lu !== Iu) {
    var e21 = Lu = Iu;
    requestAnimationFrame(function() {
      return e21 === Iu && Vu(true);
    });
  }
}, zu = function() {
  Lc.appendChild(sl), cl = !el && sl.offsetHeight || X.innerHeight, Lc.removeChild(sl);
}, Bu = function(e21) {
  return Bc(`.gsap-marker-start, .gsap-marker-end, .gsap-marker-scroller-start, .gsap-marker-scroller-end`).forEach(function(t2) {
    return t2.style.display = e21 ? `none` : `block`;
  });
}, Vu = function(e21, t2) {
  if (Ic = Fc.documentElement, Lc = Fc.body, Rc = [X, Fc, Ic, Lc], hl && !e21 && !ll) du(Q, `scrollEnd`, Ou);
  else {
    zu(), Fu = Q.isRefreshing = true, ll || Mu();
    var n2 = ku(`refreshInit`);
    Zc && Q.sort(), t2 || Nu(), J.forEach(function(e22) {
      Pl(e22) && (e22.smooth && (e22.target.style.scrollBehavior = `auto`), e22(0));
    }), Z.slice(0).forEach(function(e22) {
      return e22.refresh();
    }), ll = false, Z.forEach(function(e22) {
      if (e22._subPinOffset && e22.pin) {
        var t3 = e22.vars.horizontal ? `offsetWidth` : `offsetHeight`, n3 = e22.pin[t3];
        e22.revert(true, 1), e22.adjustPinSpacing(e22.pin[t3] - n3), e22.refresh();
      }
    }), ul = 1, Bu(true), Z.forEach(function(e22) {
      var t3 = jl(e22.scroller, e22._dir), n3 = e22.vars.end === `max` || e22._endClamp && e22.end > t3, r2 = e22._startClamp && e22.start >= t3;
      (n3 || r2) && e22.setPositions(r2 ? t3 - 1 : e22.start, n3 ? Math.max(r2 ? t3 : e22.start + 1, t3) : e22.end, true);
    }), Bu(false), ul = 0, n2.forEach(function(e22) {
      return e22 && e22.render && e22.render(-1);
    }), J.forEach(function(e22) {
      Pl(e22) && (e22.smooth && requestAnimationFrame(function() {
        return e22.target.style.scrollBehavior = `smooth`;
      }), e22.rec && e22(e22.rec));
    }), Pu(ol, 1), zc.pause(), Iu++, Fu = 2, Gu(2), Z.forEach(function(e22) {
      return Pl(e22.vars.onRefresh) && e22.vars.onRefresh(e22);
    }), Fu = Q.isRefreshing = false, ku(`refresh`);
  }
}, Hu = 0, Uu = 1, Wu, Gu = function(e21) {
  if (e21 === 2 || !Fu && !ll) {
    Q.isUpdating = true, Wu && Wu.update(0);
    var t2 = Z.length, n2 = pl(), r2 = n2 - ml >= 50, i2 = t2 && Z[0].scroll();
    if (Uu = Hu > i2 ? -1 : 1, Fu || (Hu = i2), r2 && (hl && !Gc && n2 - hl > 200 && (hl = 0, ku(`scrollEnd`)), Hc = ml, ml = n2), Uu < 0) {
      for (qc = t2; qc-- > 0; ) Z[qc] && Z[qc].update(0, r2);
      Uu = 1;
    } else for (qc = 0; qc < t2; qc++) Z[qc] && Z[qc].update(0, r2);
    Q.isUpdating = false;
  }
  xu = 0;
}, Ku = [Bl, Vl, Ul, Hl, Zl + Yl, Zl + Kl, Zl + Jl, Zl + ql, `display`, `flexShrink`, `float`, `zIndex`, `gridColumnStart`, `gridColumnEnd`, `gridRowStart`, `gridRowEnd`, `gridArea`, `justifySelf`, `alignSelf`, `placeSelf`, `order`], qu = Ku.concat([Wl, Gl, `boxSizing`, `max` + Ql, `max` + $l, `position`, Zl, Xl, Xl + Jl, Xl + Kl, Xl + Yl, Xl + ql]), Ju = function(e21, t2, n2) {
  Zu(n2);
  var r2 = e21._gsap;
  if (r2.spacerIsNative) Zu(r2.spacerState);
  else if (e21._gsap.swappedIn) {
    var i2 = t2.parentNode;
    i2 && (i2.insertBefore(e21, t2), i2.removeChild(t2));
  }
  e21._gsap.swappedIn = false;
}, Yu = function(e21, t2, n2, r2) {
  if (!e21._gsap.swappedIn) {
    for (var i2 = Ku.length, a2 = t2.style, o2 = e21.style, s2; i2--; ) s2 = Ku[i2], a2[s2] = n2[s2];
    a2.position = n2.position === `absolute` ? `absolute` : `relative`, n2.display === `inline` && (a2.display = `inline-block`), o2[Ul] = o2[Hl] = `auto`, a2.flexBasis = n2.flexBasis || `auto`, a2.overflow = `visible`, a2.boxSizing = `border-box`, a2[Wl] = au(e21, Cc) + eu, a2[Gl] = au(e21, wc) + eu, a2[Xl] = o2[Zl] = o2[Vl] = o2[Bl] = `0`, Zu(r2), o2[Wl] = o2[`max` + Ql] = n2[Wl], o2[Gl] = o2[`max` + $l] = n2[Gl], o2[Xl] = n2[Xl], e21.parentNode !== t2 && (e21.parentNode.insertBefore(t2, e21), t2.appendChild(e21)), e21._gsap.swappedIn = true;
  }
}, Xu = /([A-Z])/g, Zu = function(e21) {
  if (e21) {
    var t2 = e21.t.style, n2 = e21.length, r2 = 0, i2, a2;
    for ((e21.t._gsap || Y.core.getCache(e21.t)).uncache = 1; r2 < n2; r2 += 2) a2 = e21[r2 + 1], i2 = e21[r2], a2 ? t2[i2] = a2 : t2[i2] && t2.removeProperty(i2.replace(Xu, `-$1`).toLowerCase());
  }
}, Qu = function(e21) {
  for (var t2 = qu.length, n2 = e21.style, r2 = [], i2 = 0; i2 < t2; i2++) r2.push(qu[i2], n2[qu[i2]]);
  return r2.t = e21, r2;
}, $u = function(e21, t2, n2) {
  for (var r2 = [], i2 = e21.length, a2 = n2 ? 8 : 0, o2; a2 < i2; a2 += 2) o2 = e21[a2], r2.push(o2, o2 in t2 ? t2[o2] : e21[a2 + 1]);
  return r2.t = e21.t, r2;
}, ed = { left: 0, top: 0 }, td = function(e21, t2, n2, r2, i2, a2, o2, s2, c2, l2, u2, d2, f2, p2) {
  Pl(e21) && (e21 = e21(s2)), Nl(e21) && e21.substr(0, 3) === `max` && (e21 = d2 + (e21.charAt(4) === `=` ? _u(`0` + e21.substr(3), n2) : 0));
  var m2 = f2 ? f2.time() : 0, h2, g2, _2;
  if (f2 && f2.seek(0), isNaN(e21) || (e21 = +e21), Fl(e21)) f2 && (e21 = Y.utils.mapRange(f2.scrollTrigger.start, f2.scrollTrigger.end, 0, d2, e21)), o2 && yu(o2, n2, r2, true);
  else {
    Pl(t2) && (t2 = t2(s2));
    var v2 = (e21 || `0`).split(` `), y2, b2, x2, S2;
    _2 = Tc(t2, s2) || Lc, y2 = iu(_2) || {}, y2 && (y2.left || y2.top) || tu(_2).display !== `none` || (S2 = _2.style.display, _2.style.display = `block`, y2 = iu(_2), S2 ? _2.style.display = S2 : _2.style.removeProperty(`display`)), b2 = _u(v2[0], y2[r2.d]), x2 = _u(v2[1] || `0`, n2), e21 = y2[r2.p] - c2[r2.p] - l2 + b2 + i2 - x2, o2 && yu(o2, x2, r2, n2 - x2 < 20 || o2._isStart && x2 > 20), n2 -= n2 - x2;
  }
  if (p2 && (s2[p2] = e21 || -1e-3, e21 < 0 && (e21 = 0)), a2) {
    var C2 = e21 + n2, w2 = a2._isStart;
    h2 = `scroll` + r2.d2, yu(a2, C2, r2, w2 && C2 > 20 || !w2 && (u2 ? Math.max(Lc[h2], Ic[h2]) : a2.parentNode[h2]) <= C2 + 1), u2 && (c2 = iu(o2), u2 && (a2.style[r2.op.p] = c2[r2.op.p] - r2.op.m - a2._offset + eu));
  }
  return f2 && _2 && (h2 = iu(_2), f2.seek(d2), g2 = iu(_2), f2._caScrollDist = h2[r2.p] - g2[r2.p], e21 = e21 / f2._caScrollDist * d2), f2 && f2.seek(m2), f2 ? e21 : Math.round(e21);
}, nd = /(webkit|moz|length|cssText|inset)/i, rd = function(e21, t2, n2, r2) {
  if (e21.parentNode !== t2) {
    var i2 = e21.style, a2, o2;
    if (t2 === Lc) {
      for (a2 in e21._stOrig = i2.cssText, o2 = tu(e21), o2) !+a2 && !nd.test(a2) && o2[a2] && typeof i2[a2] == `string` && a2 !== `0` && (i2[a2] = o2[a2]);
      i2.top = n2, i2.left = r2;
    } else i2.cssText = e21._stOrig;
    Y.core.getCache(e21).uncache = 1, t2.appendChild(e21);
  }
}, id = function(e21, t2, n2) {
  var r2 = t2, i2 = r2;
  return function(t3) {
    var a2 = Math.round(e21());
    return a2 !== r2 && a2 !== i2 && Math.abs(a2 - r2) > 3 && Math.abs(a2 - i2) > 3 && (t3 = a2, n2 && n2()), i2 = r2, r2 = Math.round(t3), r2;
  };
}, ad = function(e21, t2, n2) {
  var r2 = {};
  r2[t2.p] = `+=` + n2, Y.set(e21, r2);
}, od = function(e21, t2) {
  var n2 = Dc(e21, t2), r2 = `_scroll` + t2.p2, i2 = function t3(i3, a2, o2, s2, c2) {
    var l2 = t3.tween, u2 = a2.onComplete, d2 = {};
    o2 = o2 || n2();
    var f2 = id(n2, o2, function() {
      l2.kill(), t3.tween = 0;
    });
    return c2 = s2 && c2 || 0, s2 = s2 || i3 - o2, l2 && l2.kill(), a2[r2] = i3, a2.inherit = false, a2.modifiers = d2, d2[r2] = function() {
      return f2(o2 + s2 * l2.ratio + c2 * l2.ratio * l2.ratio);
    }, a2.onUpdate = function() {
      J.cache++, t3.tween && Gu();
    }, a2.onComplete = function() {
      t3.tween = 0, u2 && u2.call(l2);
    }, l2 = t3.tween = Y.to(e21, a2), l2;
  };
  return e21[r2] = n2, n2.wheelHandler = function() {
    return i2.tween && i2.tween.kill() && (i2.tween = 0);
  }, du(e21, `wheel`, n2.wheelHandler), Q.isTouch && du(e21, `touchmove`, n2.wheelHandler), i2;
}, Q = (function() {
  function e21(t3, n2) {
    Pc || e21.register(Y) || console.warn(`Please gsap.registerPlugin(ScrollTrigger)`), al(this), this.init(t3, n2);
  }
  var t2 = e21.prototype;
  return t2.init = function(t3, n2) {
    if (this.progress = this.start = 0, this.vars && this.kill(true, true), !gl) this.update = this.refresh = this.kill = Sl;
    else {
      t3 = ru(Nl(t3) || Fl(t3) || t3.nodeType ? { trigger: t3 } : t3, hu);
      var r2 = t3, i2 = r2.onUpdate, a2 = r2.toggleClass, o2 = r2.id, s2 = r2.onToggle, c2 = r2.onRefresh, l2 = r2.scrub, u2 = r2.trigger, d2 = r2.pin, f2 = r2.pinSpacing, p2 = r2.invalidateOnRefresh, m2 = r2.anticipatePin, h2 = r2.onScrubComplete, g2 = r2.onSnapComplete, _2 = r2.once, v2 = r2.snap, y2 = r2.pinReparent, b2 = r2.pinSpacer, x2 = r2.containerAnimation, S2 = r2.fastScrollEnd, C2 = r2.preventOverlaps, w2 = t3.horizontal || t3.containerAnimation && t3.horizontal !== false ? Cc : wc, T2 = !l2 && l2 !== 0, E2 = Tc(t3.scroller || X), D2 = Y.core.getCache(E2), O2 = El(E2), k2 = (`pinType` in t3 ? t3.pinType : hc(E2, `pinType`) || O2 && `fixed`) === `fixed`, A2 = [t3.onEnter, t3.onLeave, t3.onEnterBack, t3.onLeaveBack], j2 = T2 && t3.toggleActions.split(` `), M2 = `markers` in t3 ? t3.markers : hu.markers, N2 = O2 ? 0 : parseFloat(tu(E2)[`border` + w2.p2 + Ql]) || 0, P2 = this, F2 = t3.onRefreshInit && function() {
        return t3.onRefreshInit(P2);
      }, I2 = kl(E2, O2, w2), L2 = Al(E2, O2), R2 = 0, ee2 = 0, te2 = 0, z2 = Dc(E2, w2), ne2, B2, re2, ie2, ae2, V2, oe2, se2, H2, ce2, le2, ue2, de2, fe2, pe2, me2, he2, ge2, U2, _e2, W2, ve2, ye2, be2, xe2, Se2, Ce2, we2, Te2, Ee2, De2, G2, Oe2, ke2, Ae2, je2, Me2, Ne2, Pe2;
      if (P2._startClamp = P2._endClamp = false, P2._dir = w2, m2 *= 45, P2.scroller = E2, P2.scroll = x2 ? x2.time.bind(x2) : z2, ie2 = z2(), P2.vars = t3, n2 = n2 || t3.animation, `refreshPriority` in t3 && (Zc = 1, t3.refreshPriority === -9999 && (Wu = P2)), D2.tweenScroll = D2.tweenScroll || { top: od(E2, wc), left: od(E2, Cc) }, P2.tweenTo = ne2 = D2.tweenScroll[w2.p], P2.scrubDuration = function(e22) {
        Oe2 = Fl(e22) && e22, Oe2 ? G2 ? G2.duration(e22) : G2 = Y.to(n2, { ease: `expo`, totalProgress: `+=0`, inherit: false, duration: Oe2, paused: true, onComplete: function() {
          return h2 && h2(P2);
        } }) : (G2 && G2.progress(1).kill(), G2 = 0);
      }, n2 && (n2.vars.lazy = false, n2._initted && !P2.isReverted || n2.vars.immediateRender !== false && t3.immediateRender !== false && n2.duration() && n2.render(0, true, true), P2.animation = n2.pause(), n2.scrollTrigger = P2, P2.scrubDuration(l2), Ee2 = 0, o2 || (o2 = n2.vars.id)), v2 && ((!Il(v2) || v2.push) && (v2 = { snapTo: v2 }), `scrollBehavior` in Lc.style && Y.set(O2 ? [Lc, Ic] : E2, { scrollBehavior: `auto` }), J.forEach(function(e22) {
        return Pl(e22) && e22.target === (O2 ? Fc.scrollingElement || Ic : E2) && (e22.smooth = false);
      }), re2 = Pl(v2.snapTo) ? v2.snapTo : v2.snapTo === `labels` ? su(n2) : v2.snapTo === `labelsDirectional` ? lu(n2) : v2.directional === false ? Y.utils.snap(v2.snapTo) : function(e22, t4) {
        return cu(v2.snapTo)(e22, pl() - ee2 < 500 ? 0 : t4.direction);
      }, ke2 = v2.duration || { min: 0.1, max: 2 }, ke2 = Il(ke2) ? Vc(ke2.min, ke2.max) : Vc(ke2, ke2), Ae2 = Y.delayedCall(v2.delay || Oe2 / 2 || 0.1, function() {
        var e22 = z2(), t4 = pl() - ee2 < 500, r3 = ne2.tween;
        if ((t4 || Math.abs(P2.getVelocity()) < 10) && !r3 && !Gc && R2 !== e22) {
          var i3 = (e22 - V2) / fe2, a3 = n2 && !T2 ? n2.totalProgress() : i3, o3 = t4 ? 0 : (a3 - De2) / (pl() - Hc) * 1e3 || 0, s3 = Y.utils.clamp(-i3, 1 - i3, zl(o3 / 2) * o3 / 0.185), c3 = i3 + (v2.inertia === false ? 0 : s3), l3, u3, d3 = v2, f3 = d3.onStart, p3 = d3.onInterrupt, m3 = d3.onComplete;
          if (l3 = re2(c3, P2), Fl(l3) || (l3 = c3), u3 = Math.max(0, Math.round(V2 + l3 * fe2)), e22 <= oe2 && e22 >= V2 && u3 !== e22) {
            if (r3 && !r3._initted && r3.data <= zl(u3 - e22)) return;
            v2.inertia === false && (s3 = l3 - i3), ne2(u3, { duration: ke2(zl(Math.max(zl(c3 - a3), zl(l3 - a3)) * 0.185 / o3 / 0.05 || 0)), ease: v2.ease || `power3`, data: zl(u3 - e22), onInterrupt: function() {
              return Ae2.restart(true) && p3 && Rl(P2, p3);
            }, onComplete: function() {
              P2.update(), R2 = z2(), n2 && !T2 && (G2 ? G2.resetTo(`totalProgress`, l3, n2._tTime / n2._tDur) : n2.progress(l3)), Ee2 = De2 = n2 && !T2 ? n2.totalProgress() : P2.progress, g2 && g2(P2), m3 && Rl(P2, m3);
            } }, e22, s3 * fe2, u3 - e22 - s3 * fe2), f3 && Rl(P2, f3, ne2.tween);
          }
        } else P2.isActive && R2 !== e22 && Ae2.restart(true);
      }).pause()), o2 && (bu[o2] = P2), u2 = P2.trigger = Tc(u2 || d2 !== true && d2), Pe2 = u2 && u2._gsap && u2._gsap.stRevert, Pe2 && (Pe2 = Pe2(P2)), d2 = d2 === true ? u2 : Tc(d2), Nl(a2) && (a2 = { targets: u2, className: a2 }), d2 && (f2 === false || f2 === Zl || (f2 = !f2 && d2.parentNode && d2.parentNode.style && tu(d2.parentNode).display === `flex` ? false : Xl), P2.pin = d2, B2 = Y.core.getCache(d2), B2.spacer ? pe2 = B2.pinState : (b2 && (b2 = Tc(b2), b2 && !b2.nodeType && (b2 = b2.current || b2.nativeElement), B2.spacerIsNative = !!b2, b2 && (B2.spacerState = Qu(b2))), B2.spacer = ge2 = b2 || Fc.createElement(`div`), ge2.classList.add(`pin-spacer`), o2 && ge2.classList.add(`pin-spacer-` + o2), B2.pinState = pe2 = Qu(d2)), t3.force3D !== false && Y.set(d2, { force3D: true }), P2.spacer = ge2 = B2.spacer, Te2 = tu(d2), be2 = Te2[f2 + w2.os2], _e2 = Y.getProperty(d2), W2 = Y.quickSetter(d2, w2.a, eu), Yu(d2, ge2, Te2), he2 = Qu(d2)), M2) {
        ue2 = Il(M2) ? ru(M2, mu) : mu, ce2 = vu(`scroller-start`, o2, E2, w2, ue2, 0), le2 = vu(`scroller-end`, o2, E2, w2, ue2, 0, ce2), U2 = ce2[`offset` + w2.op.d2];
        var Fe2 = Tc(hc(E2, `content`) || E2);
        se2 = this.markerStart = vu(`start`, o2, Fe2, w2, ue2, U2, 0, x2), H2 = this.markerEnd = vu(`end`, o2, Fe2, w2, ue2, U2, 0, x2), x2 && (Ne2 = Y.quickSetter([se2, H2], w2.a, eu)), !k2 && !(dc.length && hc(E2, `fixedMarkers`) === true) && (nu(O2 ? Lc : E2), Y.set([ce2, le2], { force3D: true }), Se2 = Y.quickSetter(ce2, w2.a, eu), we2 = Y.quickSetter(le2, w2.a, eu));
      }
      if (x2) {
        var Ie2 = x2.vars.onUpdate, Le2 = x2.vars.onUpdateParams;
        x2.eventCallback(`onUpdate`, function() {
          P2.update(0, 0, 1), Ie2 && Ie2.apply(x2, Le2 || []);
        });
      }
      if (P2.previous = function() {
        return Z[Z.indexOf(P2) - 1];
      }, P2.next = function() {
        return Z[Z.indexOf(P2) + 1];
      }, P2.revert = function(e22, t4) {
        if (!t4) return P2.kill(true);
        var r3 = e22 !== false || !P2.enabled, i3 = Wc;
        r3 !== P2.isReverted && (r3 && (je2 = Math.max(z2(), P2.scroll.rec || 0), te2 = P2.progress, Me2 = n2 && n2.progress()), se2 && [se2, H2, ce2, le2].forEach(function(e23) {
          return e23.style.display = r3 ? `none` : `block`;
        }), r3 && (Wc = P2, P2.update(r3)), !d2 || y2 && P2.isActive || (r3 ? Ju(d2, ge2, pe2) : Yu(d2, ge2, tu(d2), xe2)), r3 || P2.update(r3), Wc = i3, P2.isReverted = r3);
      }, P2.refresh = function(r3, i3, a3, o3) {
        if (!Wc && P2.enabled || i3) {
          if (d2 && r3 && hl) du(e21, `scrollEnd`, Ou);
          else {
            !Fu && F2 && F2(P2), Wc = P2, ne2.tween && !a3 && (ne2.tween.kill(), ne2.tween = 0), G2 && G2.pause(), p2 && n2 && (n2.revert({ kill: false }).invalidate(), n2.getChildren ? n2.getChildren(true, true, false).forEach(function(e22) {
              return e22.vars.immediateRender && e22.render(0, true, true);
            }) : n2.vars.immediateRender && n2.render(0, true, true)), P2.isReverted || P2.revert(true, true), P2._subPinOffset = false;
            var s3 = I2(), l3 = L2(), m3 = x2 ? x2.duration() : jl(E2, w2), h3 = fe2 <= 0.01 || !fe2, g3 = 0, _3 = o3 || 0, v3 = Il(a3) ? a3.end : t3.end, b3 = t3.endTrigger || u2, S3 = Il(a3) ? a3.start : t3.start || (t3.start === 0 || !u2 ? 0 : d2 ? `0 0` : `0 100%`), C3 = P2.pinnedContainer = t3.pinnedContainer && Tc(t3.pinnedContainer, P2), D3 = u2 && Math.max(0, Z.indexOf(P2)) || 0, A3 = D3, j3, B3, re3, ue3, U3, W3, be3, Se3, we3, Te3, Ee3, De3, Oe3;
            for (M2 && Il(a3) && (De3 = Y.getProperty(ce2, w2.p), Oe3 = Y.getProperty(le2, w2.p)); A3-- > 0; ) W3 = Z[A3], W3.end || W3.refresh(0, 1) || (Wc = P2), be3 = W3.pin, be3 && (be3 === u2 || be3 === d2 || be3 === C3) && !W3.isReverted && (Te3 || (Te3 = []), Te3.unshift(W3), W3.revert(true, true)), W3 !== Z[A3] && (D3--, A3--);
            for (Pl(S3) && (S3 = S3(P2)), S3 = _l(S3, `start`, P2), V2 = td(S3, u2, s3, w2, z2(), se2, ce2, P2, l3, N2, k2, m3, x2, P2._startClamp && `_startClamp`) || (d2 ? -1e-3 : 0), Pl(v3) && (v3 = v3(P2)), Nl(v3) && !v3.indexOf(`+=`) && (~v3.indexOf(` `) ? v3 = (Nl(S3) ? S3.split(` `)[0] : ``) + v3 : (g3 = _u(v3.substr(2), s3), v3 = Nl(S3) ? S3 : (x2 ? Y.utils.mapRange(0, x2.duration(), x2.scrollTrigger.start, x2.scrollTrigger.end, V2) : V2) + g3, b3 = u2)), v3 = _l(v3, `end`, P2), oe2 = Math.max(V2, td(v3 || (b3 ? `100% 0` : m3), b3, s3, w2, z2() + g3, H2, le2, P2, l3, N2, k2, m3, x2, P2._endClamp && `_endClamp`)) || -1e-3, g3 = 0, A3 = D3; A3--; ) W3 = Z[A3] || {}, be3 = W3.pin, be3 && W3.start - W3._pinPush <= V2 && !x2 && W3.end > 0 && (j3 = W3.end - (P2._startClamp ? Math.max(0, W3.start) : W3.start), (be3 === u2 && W3.start - W3._pinPush < V2 || be3 === C3) && isNaN(S3) && (g3 += j3 * (1 - W3.progress)), be3 === d2 && (_3 += j3));
            if (V2 += g3, oe2 += g3, P2._startClamp && (P2._startClamp += g3), P2._endClamp && !Fu && (P2._endClamp = oe2 || -1e-3, oe2 = Math.min(oe2, jl(E2, w2))), fe2 = oe2 - V2 || (V2 -= 0.01) && 1e-3, h3 && (te2 = Y.utils.clamp(0, 1, Y.utils.normalize(V2, oe2, je2))), P2._pinPush = _3, se2 && g3 && (j3 = {}, j3[w2.a] = `+=` + g3, C3 && (j3[w2.p] = `-=` + z2()), Y.set([se2, H2], j3)), d2 && !(ul && P2.end >= jl(E2, w2))) j3 = tu(d2), ue3 = w2 === wc, re3 = z2(), ve2 = parseFloat(_e2(w2.a)) + _3, !m3 && oe2 > 1 && (Ee3 = (O2 ? Fc.scrollingElement || Ic : E2).style, Ee3 = { style: Ee3, value: Ee3[`overflow` + w2.a.toUpperCase()] }, O2 && tu(Lc)[`overflow` + w2.a.toUpperCase()] !== `scroll` && (Ee3.style[`overflow` + w2.a.toUpperCase()] = `scroll`)), Yu(d2, ge2, j3), he2 = Qu(d2), B3 = iu(d2, true), Se3 = k2 && Dc(E2, ue3 ? Cc : wc)(), f2 ? (xe2 = [f2 + w2.os2, fe2 + _3 + eu], xe2.t = ge2, A3 = f2 === Xl ? au(d2, w2) + fe2 + _3 : 0, A3 && (xe2.push(w2.d, A3 + eu), ge2.style.flexBasis !== `auto` && (ge2.style.flexBasis = A3 + eu)), Zu(xe2), C3 && Z.forEach(function(e22) {
              e22.pin === C3 && e22.vars.pinSpacing !== false && (e22._subPinOffset = true);
            }), k2 && z2(je2)) : (A3 = au(d2, w2), A3 && ge2.style.flexBasis !== `auto` && (ge2.style.flexBasis = A3 + eu)), k2 && (U3 = { top: B3.top + (ue3 ? re3 - V2 : Se3) + eu, left: B3.left + (ue3 ? Se3 : re3 - V2) + eu, boxSizing: `border-box`, position: `fixed` }, U3[Wl] = U3[`max` + Ql] = Math.ceil(B3.width) + eu, U3[Gl] = U3[`max` + $l] = Math.ceil(B3.height) + eu, U3[Zl] = U3[Zl + Jl] = U3[Zl + Kl] = U3[Zl + Yl] = U3[Zl + ql] = `0`, U3[Xl] = j3[Xl], U3[Xl + Jl] = j3[Xl + Jl], U3[Xl + Kl] = j3[Xl + Kl], U3[Xl + Yl] = j3[Xl + Yl], U3[Xl + ql] = j3[Xl + ql], me2 = $u(pe2, U3, y2), Fu && z2(0)), n2 ? (we3 = n2._initted, Qc(1), n2.render(n2.duration(), true, true), ye2 = _e2(w2.a) - ve2 + fe2 + _3, Ce2 = Math.abs(fe2 - ye2) > 1, k2 && Ce2 && me2.splice(me2.length - 2, 2), n2.render(0, true, true), we3 || n2.invalidate(true), n2.parent || n2.totalTime(n2.totalTime()), Qc(0)) : ye2 = fe2, Ee3 && (Ee3.value ? Ee3.style[`overflow` + w2.a.toUpperCase()] = Ee3.value : Ee3.style.removeProperty(`overflow-` + w2.a));
            else if (u2 && z2() && !x2) for (B3 = u2.parentNode; B3 && B3 !== Lc; ) B3._pinOffset && (V2 -= B3._pinOffset, oe2 -= B3._pinOffset), B3 = B3.parentNode;
            Te3 && Te3.forEach(function(e22) {
              return e22.revert(false, true);
            }), P2.start = V2, P2.end = oe2, ie2 = ae2 = Fu ? je2 : z2(), !x2 && !Fu && (ie2 < je2 && z2(je2), P2.scroll.rec = 0), P2.revert(false, true), ee2 = pl(), Ae2 && (R2 = -1, Ae2.restart(true)), Wc = 0, n2 && T2 && (n2._initted || Me2) && n2.progress() !== Me2 && n2.progress(Me2 || 0, true).render(n2.time(), true, true), (h3 || te2 !== P2.progress || x2 || p2 || n2 && !n2._initted) && (n2 && !T2 && (n2._initted || te2 || n2.vars.immediateRender !== false) && n2.totalProgress(x2 && V2 < -1e-3 && !te2 ? Y.utils.normalize(V2, oe2, 0) : te2, true), P2.progress = h3 || (ie2 - V2) / fe2 === te2 ? 0 : te2), d2 && f2 && (ge2._pinOffset = Math.round(P2.progress * ye2)), G2 && G2.invalidate(), isNaN(De3) || (De3 -= Y.getProperty(ce2, w2.p), Oe3 -= Y.getProperty(le2, w2.p), ad(ce2, w2, De3), ad(se2, w2, De3 - (o3 || 0)), ad(le2, w2, Oe3), ad(H2, w2, Oe3 - (o3 || 0))), h3 && !Fu && P2.update(), c2 && !Fu && !de2 && (de2 = true, c2(P2), de2 = false);
          }
        }
      }, P2.getVelocity = function() {
        return (z2() - ae2) / (pl() - Hc) * 1e3 || 0;
      }, P2.endAnimation = function() {
        Ll(P2.callbackAnimation), n2 && (G2 ? G2.progress(1) : n2.paused() ? T2 || Ll(n2, P2.direction < 0, 1) : Ll(n2, n2.reversed()));
      }, P2.labelToScroll = function(e22) {
        return n2 && n2.labels && (V2 || P2.refresh() || V2) + n2.labels[e22] / n2.duration() * fe2 || 0;
      }, P2.getTrailing = function(e22) {
        var t4 = Z.indexOf(P2), n3 = P2.direction > 0 ? Z.slice(0, t4).reverse() : Z.slice(t4 + 1);
        return (Nl(e22) ? n3.filter(function(t5) {
          return t5.vars.preventOverlaps === e22;
        }) : n3).filter(function(e23) {
          return P2.direction > 0 ? e23.end <= V2 : e23.start >= oe2;
        });
      }, P2.update = function(e22, t4, r3) {
        if (!x2 || r3 || e22) {
          var o3 = Fu === true ? je2 : P2.scroll(), c3 = e22 ? 0 : (o3 - V2) / fe2, u3 = c3 < 0 ? 0 : c3 > 1 ? 1 : c3 || 0, p3 = P2.progress, h3, g3, b3, D3, O3, M3, N3, F3;
          if (t4 && (ae2 = ie2, ie2 = x2 ? z2() : o3, v2 && (De2 = Ee2, Ee2 = n2 && !T2 ? n2.totalProgress() : u3)), m2 && d2 && !Wc && !fl && hl && (!u3 && V2 < o3 + (o3 - ae2) / (pl() - Hc) * m2 ? u3 = 1e-4 : u3 === 1 && oe2 > o3 + (o3 - ae2) / (pl() - Hc) * m2 && (u3 = 0.9999)), u3 !== p3 && P2.enabled) {
            if (h3 = P2.isActive = !!u3 && u3 < 1, g3 = !!p3 && p3 < 1, M3 = h3 !== g3, O3 = M3 || !!u3 != !!p3, P2.direction = u3 > p3 ? 1 : -1, P2.progress = u3, O3 && !Wc && (b3 = u3 && !p3 ? 0 : u3 === 1 ? 1 : p3 === 1 ? 2 : 3, T2 && (D3 = !M3 && j2[b3 + 1] !== `none` && j2[b3 + 1] || j2[b3], F3 = n2 && (D3 === `complete` || D3 === `reset` || D3 in n2))), C2 && (M3 || F3) && (F3 || l2 || !n2) && (Pl(C2) ? C2(P2) : P2.getTrailing(C2).forEach(function(e23) {
              return e23.endAnimation();
            })), T2 || (G2 && !Wc && !fl ? (G2._dp._time - G2._start !== G2._time && G2.render(G2._dp._time - G2._start), G2.resetTo ? G2.resetTo(`totalProgress`, u3, n2._tTime / n2._tDur) : (G2.vars.totalProgress = u3, G2.invalidate().restart())) : n2 && n2.totalProgress(u3, !!(Wc && (ee2 || e22)))), d2) {
              if (e22 && f2 && (ge2.style[f2 + w2.os2] = be2), !k2) W2(Cl(ve2 + ye2 * u3));
              else if (O3) {
                if (N3 = !e22 && u3 > p3 && oe2 + 1 > o3 && o3 + 1 >= jl(E2, w2), y2) {
                  if (!e22 && (h3 || N3)) {
                    var I3 = iu(d2, true), L3 = o3 - V2;
                    rd(d2, Lc, I3.top + (w2 === wc ? L3 : 0) + eu, I3.left + (w2 === wc ? 0 : L3) + eu);
                  } else rd(d2, ge2);
                }
                Zu(h3 || N3 ? me2 : he2), Ce2 && u3 < 1 && h3 || W2(ve2 + (u3 === 1 && !N3 ? ye2 : 0));
              }
            }
            v2 && !ne2.tween && !Wc && !fl && Ae2.restart(true), a2 && (M3 || _2 && u3 && (u3 < 1 || !dl)) && Bc(a2.targets).forEach(function(e23) {
              return e23.classList[h3 || _2 ? `add` : `remove`](a2.className);
            }), i2 && !T2 && !e22 && i2(P2), O3 && !Wc ? (T2 && (F3 && (D3 === `complete` ? n2.pause().totalProgress(1) : D3 === `reset` ? n2.restart(true).pause() : D3 === `restart` ? n2.restart(true) : n2[D3]()), i2 && i2(P2)), (M3 || !dl) && (s2 && M3 && Rl(P2, s2), A2[b3] && Rl(P2, A2[b3]), _2 && (u3 === 1 ? P2.kill(false, 1) : A2[b3] = 0), M3 || (b3 = u3 === 1 ? 1 : 3, A2[b3] && Rl(P2, A2[b3]))), S2 && !h3 && Math.abs(P2.getVelocity()) > (Fl(S2) ? S2 : 2500) && (Ll(P2.callbackAnimation), G2 ? G2.progress(1) : Ll(n2, D3 === `reverse` ? 1 : !u3, 1))) : T2 && i2 && !Wc && i2(P2);
          }
          if (we2) {
            var R3 = x2 ? o3 / x2.duration() * (x2._caScrollDist || 0) : o3;
            Se2(R3 + +!!ce2._isFlipped), we2(R3);
          }
          Ne2 && Ne2(-o3 / x2.duration() * (x2._caScrollDist || 0));
        }
      }, P2.enable = function(t4, n3) {
        P2.enabled || (P2.enabled = true, du(E2, `resize`, Tu), O2 || du(E2, `scroll`, Cu), F2 && du(e21, `refreshInit`, F2), t4 !== false && (P2.progress = te2 = 0, ie2 = ae2 = R2 = z2()), n3 !== false && P2.refresh());
      }, P2.getTween = function(e22) {
        return e22 && ne2 ? ne2.tween : G2;
      }, P2.setPositions = function(e22, t4, n3, r3) {
        if (x2) {
          var i3 = x2.scrollTrigger, a3 = x2.duration(), o3 = i3.end - i3.start;
          e22 = i3.start + o3 * e22 / a3, t4 = i3.start + o3 * t4 / a3;
        }
        P2.refresh(false, false, { start: vl(e22, n3 && !!P2._startClamp), end: vl(t4, n3 && !!P2._endClamp) }, r3), P2.update();
      }, P2.adjustPinSpacing = function(e22) {
        if (xe2 && e22) {
          var t4 = xe2.indexOf(w2.d) + 1;
          xe2[t4] = parseFloat(xe2[t4]) + e22 + eu, xe2[1] = parseFloat(xe2[1]) + e22 + eu, Zu(xe2);
        }
      }, P2.disable = function(t4, n3) {
        if (t4 !== false && P2.revert(true, true), P2.enabled && (P2.enabled = P2.isActive = false, n3 || G2 && G2.pause(), je2 = 0, B2 && (B2.uncache = 1), F2 && fu(e21, `refreshInit`, F2), Ae2 && (Ae2.pause(), ne2.tween && ne2.tween.kill() && (ne2.tween = 0)), !O2)) {
          for (var r3 = Z.length; r3--; ) if (Z[r3].scroller === E2 && Z[r3] !== P2) return;
          fu(E2, `resize`, Tu), O2 || fu(E2, `scroll`, Cu);
        }
      }, P2.kill = function(e22, r3) {
        P2.disable(e22, r3), G2 && !r3 && G2.kill(), o2 && delete bu[o2];
        var i3 = Z.indexOf(P2);
        i3 >= 0 && Z.splice(i3, 1), i3 === qc && Uu > 0 && qc--, i3 = 0, Z.forEach(function(e23) {
          return e23.scroller === P2.scroller && (i3 = 1);
        }), i3 || Fu || (P2.scroll.rec = 0), n2 && (n2.scrollTrigger = null, e22 && n2.revert({ kill: false }), r3 || n2.kill()), se2 && [se2, H2, ce2, le2].forEach(function(e23) {
          return e23.parentNode && e23.parentNode.removeChild(e23);
        }), Wu === P2 && (Wu = 0), d2 && (B2 && (B2.uncache = 1), i3 = 0, Z.forEach(function(e23) {
          return e23.pin === d2 && i3++;
        }), i3 || (B2.spacer = 0)), t3.onKill && t3.onKill(P2);
      }, Z.push(P2), P2.enable(false, false), Pe2 && Pe2(P2), n2 && n2.add && !fe2) {
        var Re2 = P2.update;
        P2.update = function() {
          P2.update = Re2, J.cache++, V2 || oe2 || P2.refresh();
        }, Y.delayedCall(0.01, P2.update), fe2 = 0.01, V2 = oe2 = 0;
      } else P2.refresh();
      d2 && Ru();
    }
  }, e21.register = function(t3) {
    return Pc || (Y = t3 || Tl(), wl() && window.document && e21.enable(), Pc = gl), Pc;
  }, e21.defaults = function(e22) {
    if (e22) for (var t3 in e22) hu[t3] = e22[t3];
    return hu;
  }, e21.disable = function(e22, t3) {
    gl = 0, Z.forEach(function(n3) {
      return n3[t3 ? `kill` : `disable`](e22);
    }), fu(X, `wheel`, Cu), fu(Fc, `scroll`, Cu), clearInterval(Uc), fu(Fc, `touchcancel`, Sl), fu(Lc, `touchstart`, Sl), uu(fu, Fc, `pointerdown,touchstart,mousedown`, bl), uu(fu, Fc, `pointerup,touchend,mouseup`, xl), zc.kill(), Ml(fu);
    for (var n2 = 0; n2 < J.length; n2 += 3) pu(fu, J[n2], J[n2 + 1]), pu(fu, J[n2], J[n2 + 2]);
  }, e21.enable = function() {
    if (X = window, Fc = document, Ic = Fc.documentElement, Lc = Fc.body, Y) {
      if (Bc = Y.utils.toArray, Vc = Y.utils.clamp, al = Y.core.context || Sl, Qc = Y.core.suppressOverwrites || Sl, ol = X.history.scrollRestoration || `auto`, Hu = X.pageYOffset || 0, Y.core.globals(`ScrollTrigger`, e21), Lc) {
        gl = 1, sl = document.createElement(`div`), sl.style.height = `100vh`, sl.style.position = `absolute`, zu(), yl(), Nc.register(Y), e21.isTouch = Nc.isTouch, il = Nc.isTouch && /(iPad|iPhone|iPod|Mac)/g.test(navigator.userAgent), tl = Nc.isTouch === 1, du(X, `wheel`, Cu), Rc = [X, Fc, Ic, Lc], Y.matchMedia ? (e21.matchMedia = function(e22) {
          var t4 = Y.matchMedia(), n3;
          for (n3 in e22) t4.add(n3, e22[n3]);
          return t4;
        }, Y.addEventListener(`matchMediaInit`, function() {
          Mu(), Nu();
        }), Y.addEventListener(`matchMediaRevert`, function() {
          return ju();
        }), Y.addEventListener(`matchMedia`, function() {
          Vu(0, 1), ku(`matchMedia`);
        }), Y.matchMedia().add(`(orientation: portrait)`, function() {
          return wu(), wu;
        })) : console.warn(`Requires GSAP 3.11.0 or later`), wu(), du(Fc, `scroll`, Cu);
        var t3 = Lc.hasAttribute(`style`), n2 = Lc.style, r2 = n2.borderTopStyle, i2 = Y.core.Animation.prototype, a2, o2;
        for (i2.revert || Object.defineProperty(i2, "revert", { value: function() {
          return this.time(-0.01, true);
        } }), n2.borderTopStyle = `solid`, a2 = iu(Lc), wc.m = Math.round(a2.top + wc.sc()) || 0, Cc.m = Math.round(a2.left + Cc.sc()) || 0, r2 ? n2.borderTopStyle = r2 : n2.removeProperty(`border-top-style`), t3 || (Lc.setAttribute(`style`, ``), Lc.removeAttribute(`style`)), Uc = setInterval(Su, 250), Y.delayedCall(0.5, function() {
          return fl = 0;
        }), du(Fc, `touchcancel`, Sl), du(Lc, `touchstart`, Sl), uu(du, Fc, `pointerdown,touchstart,mousedown`, bl), uu(du, Fc, `pointerup,touchend,mouseup`, xl), Kc = Y.utils.checkPrefix(`transform`), qu.push(Kc), Pc = pl(), zc = Y.delayedCall(0.2, Vu).pause(), Xc = [Fc, `visibilitychange`, function() {
          var e22 = X.innerWidth, t4 = X.innerHeight;
          Fc.hidden ? (Jc = e22, Yc = t4) : (Jc !== e22 || Yc !== t4) && Tu();
        }, Fc, `DOMContentLoaded`, Vu, X, `load`, Vu, X, `resize`, Tu], Ml(du), Z.forEach(function(e22) {
          return e22.enable(0, 1);
        }), o2 = 0; o2 < J.length; o2 += 3) pu(fu, J[o2], J[o2 + 1]), pu(fu, J[o2], J[o2 + 2]);
      } else Fc && Fc.addEventListener(`DOMContentLoaded`, function t4() {
        e21.enable(), Fc.removeEventListener(`DOMContentLoaded`, t4);
      });
    }
  }, e21.config = function(t3) {
    `limitCallbacks` in t3 && (dl = !!t3.limitCallbacks);
    var n2 = t3.syncInterval;
    n2 && clearInterval(Uc) || (Uc = n2) && setInterval(Su, n2), `ignoreMobileResize` in t3 && (tl = e21.isTouch === 1 && t3.ignoreMobileResize), `autoRefreshEvents` in t3 && (Ml(fu) || Ml(du, t3.autoRefreshEvents || `none`), $c = (t3.autoRefreshEvents + ``).indexOf(`resize`) === -1);
  }, e21.scrollerProxy = function(e22, t3) {
    var n2 = Tc(e22), r2 = J.indexOf(n2), i2 = El(n2);
    ~r2 && J.splice(r2, i2 ? 6 : 2), t3 && (i2 ? dc.unshift(X, t3, Lc, t3, Ic, t3) : dc.unshift(n2, t3));
  }, e21.clearMatchMedia = function(e22) {
    Z.forEach(function(t3) {
      return t3._ctx && t3._ctx.query === e22 && t3._ctx.kill(true, true);
    });
  }, e21.isInViewport = function(e22, t3, n2) {
    var r2 = (Nl(e22) ? Tc(e22) : e22).getBoundingClientRect(), i2 = r2[n2 ? Wl : Gl] * t3 || 0;
    return n2 ? r2.right - i2 > 0 && r2.left + i2 < X.innerWidth : r2.bottom - i2 > 0 && r2.top + i2 < X.innerHeight;
  }, e21.positionInViewport = function(e22, t3, n2) {
    Nl(e22) && (e22 = Tc(e22));
    var r2 = e22.getBoundingClientRect(), i2 = r2[n2 ? Wl : Gl], a2 = t3 == null ? i2 / 2 : t3 in gu ? gu[t3] * i2 : ~t3.indexOf(`%`) ? parseFloat(t3) * i2 / 100 : parseFloat(t3) || 0;
    return n2 ? (r2.left + a2) / X.innerWidth : (r2.top + a2) / X.innerHeight;
  }, e21.killAll = function(e22) {
    if (Z.slice(0).forEach(function(e23) {
      return e23.vars.id !== `ScrollSmoother` && e23.kill();
    }), e22 !== true) {
      var t3 = Eu.killAll || [];
      Eu = {}, t3.forEach(function(e23) {
        return e23();
      });
    }
  }, e21;
})();
Q.version = `3.15.0`, Q.saveStyles = function(e21) {
  return e21 ? Bc(e21).forEach(function(e22) {
    if (e22 && e22.style) {
      var t2 = Au.indexOf(e22);
      t2 >= 0 && Au.splice(t2, 5), Au.push(e22, e22.style.cssText, e22.getBBox && e22.getAttribute(`transform`), Y.core.getCache(e22), al());
    }
  }) : Au;
}, Q.revert = function(e21, t2) {
  return Nu(!e21, t2);
}, Q.create = function(e21, t2) {
  return new Q(e21, t2);
}, Q.refresh = function(e21) {
  return e21 ? Tu(true) : (Pc || Q.register()) && Vu(true);
}, Q.update = function(e21) {
  return ++J.cache && Gu(e21 === true ? 2 : 0);
}, Q.clearScrollMemory = Pu, Q.maxScroll = function(e21, t2) {
  return jl(e21, t2 ? Cc : wc);
}, Q.getScrollFunc = function(e21, t2) {
  return Dc(Tc(e21), t2 ? Cc : wc);
}, Q.getById = function(e21) {
  return bu[e21];
}, Q.getAll = function() {
  return Z.filter(function(e21) {
    return e21.vars.id !== `ScrollSmoother`;
  });
}, Q.isScrolling = function() {
  return !!hl;
}, Q.snapDirectional = cu, Q.addEventListener = function(e21, t2) {
  var n2 = Eu[e21] || (Eu[e21] = []);
  ~n2.indexOf(t2) || n2.push(t2);
}, Q.removeEventListener = function(e21, t2) {
  var n2 = Eu[e21], r2 = n2 && n2.indexOf(t2);
  r2 >= 0 && n2.splice(r2, 1);
}, Q.batch = function(e21, t2) {
  var n2 = [], r2 = {}, i2 = t2.interval || 0.016, a2 = t2.batchMax || 1e9, o2 = function(e22, t3) {
    var n3 = [], r3 = [], o3 = Y.delayedCall(i2, function() {
      t3(n3, r3), n3 = [], r3 = [];
    }).pause();
    return function(e23) {
      n3.length || o3.restart(true), n3.push(e23.trigger), r3.push(e23), a2 <= n3.length && o3.progress(1);
    };
  }, s2;
  for (s2 in t2) r2[s2] = s2.substr(0, 2) === `on` && Pl(t2[s2]) && s2 !== `onRefreshInit` ? o2(s2, t2[s2]) : t2[s2];
  return Pl(a2) && (a2 = a2(), du(Q, `refresh`, function() {
    return a2 = t2.batchMax();
  })), Bc(e21).forEach(function(e22) {
    var t3 = {};
    for (s2 in r2) t3[s2] = r2[s2];
    t3.trigger = e22, n2.push(Q.create(t3));
  }), n2;
};
var sd = function(e21, t2, n2, r2) {
  return t2 > r2 ? e21(r2) : t2 < 0 && e21(0), n2 > r2 ? (r2 - t2) / (n2 - t2) : n2 < 0 ? t2 / (t2 - n2) : 1;
}, cd = function e19(t2, n2) {
  n2 === true ? t2.style.removeProperty(`touch-action`) : t2.style.touchAction = n2 === true ? `auto` : n2 ? `pan-` + n2 + (Nc.isTouch ? ` pinch-zoom` : ``) : `none`, t2 === Ic && e19(Lc, n2);
}, ld = { auto: 1, scroll: 1 }, ud = function(e21) {
  var t2 = e21.event, n2 = e21.target, r2 = e21.axis, i2 = (t2.changedTouches ? t2.changedTouches[0] : t2).target, a2 = i2._gsap || Y.core.getCache(i2), o2 = pl(), s2;
  if (!a2._isScrollT || o2 - a2._isScrollT > 2e3) {
    for (; i2 && i2 !== Lc && (i2.scrollHeight <= i2.clientHeight && i2.scrollWidth <= i2.clientWidth || !(ld[(s2 = tu(i2)).overflowY] || ld[s2.overflowX])); ) i2 = i2.parentNode;
    a2._isScroll = i2 && i2 !== n2 && !El(i2) && (ld[(s2 = tu(i2)).overflowY] || ld[s2.overflowX]), a2._isScrollT = o2;
  }
  (a2._isScroll || r2 === `x`) && (t2.stopPropagation(), t2._gsapAllow = true);
}, dd = function(e21, t2, n2, r2) {
  return Nc.create({ target: e21, capture: true, debounce: false, lockAxis: true, type: t2, onWheel: r2 = r2 && ud, onPress: r2, onDrag: r2, onScroll: r2, onEnable: function() {
    return n2 && du(Fc, Nc.eventTypes[0], md, false, true);
  }, onDisable: function() {
    return fu(Fc, Nc.eventTypes[0], md, true);
  } });
}, fd = /(input|label|select|textarea)/i, pd, md = function(e21) {
  var t2 = fd.test(e21.target.tagName);
  (t2 || pd) && (e21._gsapAllow = true, pd = t2);
}, hd = function(e21) {
  Il(e21) || (e21 = {}), e21.preventDefault = e21.isNormalizer = e21.allowClicks = true, e21.type || (e21.type = `wheel,touch`), e21.debounce = !!e21.debounce, e21.id = e21.id || `normalizer`;
  var t2 = e21, n2 = t2.normalizeScrollX, r2 = t2.momentum, i2 = t2.allowNestedScroll, a2 = t2.onRelease, o2, s2, c2 = Tc(e21.target) || Ic, l2 = Y.core.globals().ScrollSmoother, u2 = l2 && l2.get(), d2 = il && (e21.content && Tc(e21.content) || u2 && e21.content !== false && !u2.smooth() && u2.content()), f2 = Dc(c2, wc), p2 = Dc(c2, Cc), m2 = 1, h2 = (Nc.isTouch && X.visualViewport ? X.visualViewport.scale * X.visualViewport.width : X.outerWidth) / X.innerWidth, g2 = 0, _2 = Pl(r2) ? function() {
    return r2(o2);
  } : function() {
    return r2 || 2.8;
  }, v2, y2, b2 = dd(c2, e21.type, true, i2), x2 = function() {
    return y2 = false;
  }, S2 = Sl, C2 = Sl, w2 = function() {
    s2 = jl(c2, wc), C2 = Vc(+!!il, s2), n2 && (S2 = Vc(0, jl(c2, Cc))), v2 = Iu;
  }, T2 = function() {
    d2._gsap.y = Cl(parseFloat(d2._gsap.y) + f2.offset) + `px`, d2.style.transform = `matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, ` + parseFloat(d2._gsap.y) + `, 0, 1)`, f2.offset = f2.cacheID = 0;
  }, E2 = function() {
    if (y2) {
      requestAnimationFrame(x2);
      var e22 = Cl(o2.deltaY / 2), t3 = C2(f2.v - e22);
      if (d2 && t3 !== f2.v + f2.offset) {
        f2.offset = t3 - f2.v;
        var n3 = Cl((parseFloat(d2 && d2._gsap.y) || 0) - f2.offset);
        d2.style.transform = `matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, ` + n3 + `, 0, 1)`, d2._gsap.y = n3 + `px`, f2.cacheID = J.cache, Gu();
      }
      return true;
    }
    f2.offset && T2(), y2 = true;
  }, D2, O2, k2, A2, j2 = function() {
    w2(), D2.isActive() && D2.vars.scrollY > s2 && (f2() > s2 ? D2.progress(1) && f2(s2) : D2.resetTo(`scrollY`, s2));
  };
  return d2 && Y.set(d2, { y: `+=0` }), e21.ignoreCheck = function(e22) {
    return il && e22.type === `touchmove` && E2(e22) || m2 > 1.05 && e22.type !== `touchstart` || o2.isGesturing || e22.touches && e22.touches.length > 1;
  }, e21.onPress = function() {
    y2 = false;
    var e22 = m2;
    m2 = Cl((X.visualViewport && X.visualViewport.scale || 1) / h2), D2.pause(), e22 !== m2 && cd(c2, m2 > 1.01 || !n2 && `x`), O2 = p2(), k2 = f2(), w2(), v2 = Iu;
  }, e21.onRelease = e21.onGestureStart = function(e22, t3) {
    if (f2.offset && T2(), !t3) A2.restart(true);
    else {
      J.cache++;
      var r3 = _2(), i3, o3;
      n2 && (i3 = p2(), o3 = i3 + r3 * 0.05 * -e22.velocityX / 0.227, r3 *= sd(p2, i3, o3, jl(c2, Cc)), D2.vars.scrollX = S2(o3)), i3 = f2(), o3 = i3 + r3 * 0.05 * -e22.velocityY / 0.227, r3 *= sd(f2, i3, o3, jl(c2, wc)), D2.vars.scrollY = C2(o3), D2.invalidate().duration(r3).play(0.01), (il && D2.vars.scrollY >= s2 || i3 >= s2 - 1) && Y.to({}, { onUpdate: j2, duration: r3 });
    }
    a2 && a2(e22);
  }, e21.onWheel = function() {
    D2._ts && D2.pause(), pl() - g2 > 1e3 && (v2 = 0, g2 = pl());
  }, e21.onChange = function(e22, t3, r3, i3, a3) {
    if (Iu !== v2 && w2(), t3 && n2 && p2(S2(i3[2] === t3 ? O2 + (e22.startX - e22.x) : p2() + t3 - i3[1])), r3) {
      f2.offset && T2();
      var o3 = a3[2] === r3, s3 = o3 ? k2 + e22.startY - e22.y : f2() + r3 - a3[1], c3 = C2(s3);
      o3 && s3 !== c3 && (k2 += c3 - s3), f2(c3);
    }
    (r3 || t3) && Gu();
  }, e21.onEnable = function() {
    cd(c2, !n2 && `x`), Q.addEventListener(`refresh`, j2), du(X, `resize`, j2), f2.smooth && (f2.target.style.scrollBehavior = `auto`, f2.smooth = p2.smooth = false), b2.enable();
  }, e21.onDisable = function() {
    cd(c2, true), fu(X, `resize`, j2), Q.removeEventListener(`refresh`, j2), b2.kill();
  }, e21.lockAxis = e21.lockAxis !== false, o2 = new Nc(e21), o2.iOS = il, il && !f2() && f2(1), il && Y.ticker.add(Sl), A2 = o2._dc, D2 = Y.to(o2, { ease: `power4`, paused: true, inherit: false, scrollX: n2 ? `+=0.1` : `+=0`, scrollY: `+=0.1`, modifiers: { scrollY: id(f2, f2(), function() {
    return D2.pause();
  }) }, onUpdate: Gu, onComplete: A2.vars.onComplete }), o2;
};
Q.sort = function(e21) {
  if (Pl(e21)) return Z.sort(e21);
  var t2 = X.pageYOffset || 0;
  return Q.getAll().forEach(function(e22) {
    return e22._sortY = e22.trigger ? t2 + e22.trigger.getBoundingClientRect().top : e22.start + X.innerHeight;
  }), Z.sort(e21 || function(e22, t3) {
    return (e22.vars.refreshPriority || 0) * -1e6 + (e22.vars.containerAnimation ? 1e6 : e22._sortY) - ((t3.vars.containerAnimation ? 1e6 : t3._sortY) + (t3.vars.refreshPriority || 0) * -1e6);
  });
}, Q.observe = function(e21) {
  return new Nc(e21);
}, Q.normalizeScroll = function(e21) {
  if (e21 === void 0) return el;
  if (e21 === true && el) return el.enable();
  if (e21 === false) el && el.kill(), el = e21;
  else {
    var t2 = e21 instanceof Nc ? e21 : hd(e21);
    return el && el.target === t2.target && el.kill(), El(t2.target) && (el = t2), t2;
  }
}, Q.core = { _getVelocityProp: Oc, _inputObserver: dd, _scrollers: J, _proxies: dc, bridge: { ss: function() {
  hl || ku(`scrollStart`), hl = pl();
}, ref: function() {
  return Wc;
} } }, Tl() && Y.registerPlugin(Q);
var gd, _d, vd = typeof Symbol == `function` ? /* @__PURE__ */ Symbol() : `_split`, yd, bd = () => yd || zd.register(window.gsap), xd = typeof Intl < `u` && `Segmenter` in Intl ? new Intl.Segmenter() : 0, Sd = (e21) => e21 ? typeof e21 == `string` ? Sd(document.querySelectorAll(e21)) : `length` in e21 ? Array.from(e21).reduce((e22, t2) => (typeof t2 == `string` ? e22.push(...Sd(t2)) : e22.push(t2), e22), []) : [e21] : [], Cd = (e21) => Sd(e21).filter((e22) => e22 && e22.nodeType === 1), wd = [], Td = function() {
}, Ed = { add: (e21) => e21() }, Dd = /\s+/g, Od = RegExp(`\\p{RI}\\p{RI}|\\p{Emoji}(\\p{EMod}|\\u{FE0F}\\u{20E3}?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?(\\u{200D}\\p{Emoji}(\\p{EMod}|\\u{FE0F}\\u{20E3}?|[\\u{E0020}-\\u{E007E}]+\\u{E007F})?)*|.`, `gu`), kd = { left: 0, top: 0, width: 0, height: 0 }, Ad = (e21, t2) => {
  for (; ++t2 < e21.length && e21[t2] === kd; ) ;
  return e21[t2] || kd;
}, jd = ({ element: e21, html: t2, ariaL: n2, ariaH: r2 }) => {
  e21.innerHTML = t2, n2 ? e21.setAttribute(`aria-label`, n2) : e21.removeAttribute(`aria-label`), r2 ? e21.setAttribute(`aria-hidden`, r2) : e21.removeAttribute(`aria-hidden`);
}, Md = (e21, t2) => {
  if (t2) {
    let n2 = new Set(e21.join(``).match(t2) || wd), r2 = e21.length, i2, a2, o2, s2;
    if (n2.size) for (; --r2 > -1; ) {
      a2 = e21[r2];
      for (o2 of n2) if (o2.startsWith(a2) && o2.length > a2.length) {
        for (i2 = 0, s2 = a2; o2.startsWith(s2 += e21[r2 + ++i2]) && s2.length < o2.length; ) ;
        if (i2 && s2.length === o2.length) {
          e21[r2] = o2, e21.splice(r2 + 1, i2);
          break;
        }
      }
    }
  }
  return e21;
}, Nd = (e21) => window.getComputedStyle(e21).display === `inline` && (e21.style.display = `inline-block`), Pd = (e21, t2, n2) => t2.insertBefore(typeof e21 == `string` ? document.createTextNode(e21) : e21, n2), Fd = (e21, t2, n2) => {
  let r2 = t2[e21 + `sClass`] || ``, { tag: i2 = `div`, aria: a2 = `auto`, propIndex: o2 = false } = t2, s2 = e21 === `line` ? `block` : `inline-block`, c2 = r2.indexOf(`++`) > -1, l2 = (t3) => {
    let l3 = document.createElement(i2), u2 = n2.length + 1;
    return r2 && (l3.className = r2 + (c2 ? ` ` + r2 + u2 : ``)), o2 && l3.style.setProperty(`--` + e21, u2 + ``), a2 !== `none` && l3.setAttribute(`aria-hidden`, `true`), i2 !== `span` && (l3.style.position = `relative`, l3.style.display = s2), l3.textContent = t3, n2.push(l3), l3;
  };
  return c2 && (r2 = r2.replace(`++`, ``)), l2.collection = n2, l2;
}, Id = (e21, t2, n2, r2) => {
  let i2 = Fd(`line`, n2, r2), a2 = window.getComputedStyle(e21).textAlign || `left`;
  return (n3, r3) => {
    let o2 = i2(``);
    for (o2.style.textAlign = a2, e21.insertBefore(o2, t2[n3]); n3 < r3; n3++) o2.appendChild(t2[n3]);
    o2.normalize();
  };
}, Ld = (e21, t2, n2, r2, i2, a2, o2, s2, c2, l2) => {
  var u2;
  let d2 = Array.from(e21.childNodes), f2 = 0, { wordDelimiter: p2, reduceWhiteSpace: m2 = true, prepareText: h2 } = t2, g2 = e21.getBoundingClientRect(), _2 = g2, v2 = !m2 && window.getComputedStyle(e21).whiteSpace.substring(0, 3) === `pre`, y2 = 0, b2 = n2.collection, x2, S2, C2, w2, T2, E2, D2, O2, k2, A2, j2, M2, N2, P2, F2, I2, L2, R2;
  for (typeof p2 == `object` ? (C2 = p2.delimiter || p2, S2 = p2.replaceWith || ``) : S2 = p2 === `` ? `` : p2 || ` `, x2 = S2 !== ` `; f2 < d2.length; f2++) if (w2 = d2[f2], w2.nodeType === 3) {
    for (F2 = w2.textContent || ``, m2 ? F2 = F2.replace(Dd, ` `) : v2 && (F2 = F2.replace(/\n/g, S2 + `
`)), h2 && (F2 = h2(F2, e21)), w2.textContent = F2, T2 = S2 || C2 ? F2.split(C2 || S2) : F2.match(s2) || wd, L2 = T2[T2.length - 1], O2 = x2 ? L2.slice(-1) === ` ` : !L2, L2 || T2.pop(), _2 = g2, D2 = x2 ? T2[0].charAt(0) === ` ` : !T2[0], D2 && Pd(` `, e21, w2), T2[0] || T2.shift(), Md(T2, c2), a2 && l2 || (w2.textContent = ``), k2 = 1; k2 <= T2.length; k2++) if (I2 = T2[k2 - 1], !m2 && v2 && I2.charAt(0) === `
` && ((u2 = w2.previousSibling) == null || u2.remove(), Pd(document.createElement(`br`), e21, w2), I2 = I2.slice(1)), !m2 && I2 === ``) Pd(S2, e21, w2);
    else if (I2 === ` `) e21.insertBefore(document.createTextNode(` `), w2);
    else {
      if (x2 && I2.charAt(0) === ` ` && Pd(` `, e21, w2), y2 && k2 === 1 && !D2 && b2.indexOf(y2.parentNode) > -1 ? (E2 = b2[b2.length - 1], E2.appendChild(document.createTextNode(r2 ? `` : I2))) : (E2 = n2(r2 ? `` : I2), Pd(E2, e21, w2), y2 && k2 === 1 && !D2 && E2.insertBefore(y2, E2.firstChild)), r2) for (j2 = xd ? Md([...xd.segment(I2)].map((e22) => e22.segment), c2) : I2.match(s2) || wd, R2 = 0; R2 < j2.length; R2++) E2.appendChild(j2[R2] === ` ` ? document.createTextNode(` `) : r2(j2[R2]));
      if (a2 && l2) {
        if (F2 = w2.textContent = F2.substring(I2.length + 1, F2.length), A2 = E2.getBoundingClientRect(), A2.top > _2.top && A2.left <= _2.left) {
          for (M2 = e21.cloneNode(), N2 = e21.childNodes[0]; N2 && N2 !== E2; ) P2 = N2, N2 = N2.nextSibling, M2.appendChild(P2);
          e21.parentNode.insertBefore(M2, e21), i2 && Nd(M2);
        }
        _2 = A2;
      }
      (k2 < T2.length || O2) && Pd(k2 >= T2.length ? ` ` : x2 && I2.slice(-1) === ` ` ? ` ` + S2 : S2, e21, w2);
    }
    e21.removeChild(w2), y2 = 0;
  } else w2.nodeType === 1 && (o2 && o2.indexOf(w2) > -1 ? (b2.indexOf(w2.previousSibling) > -1 && b2[b2.length - 1].appendChild(w2), y2 = w2) : (Ld(w2, t2, n2, r2, i2, a2, o2, s2, c2, true), y2 = 0), i2 && Nd(w2));
}, Rd = class e20 {
  constructor(e21, t2) {
    this.isSplit = false, bd(), this.elements = Cd(e21), this.chars = [], this.words = [], this.lines = [], this.masks = [], this.vars = t2, this.elements.forEach((e22) => {
      var n3;
      t2.overwrite !== false && ((n3 = e22[vd]) == null || n3._data.orig.filter(({ element: t3 }) => t3 === e22).forEach(jd)), e22[vd] = this;
    }), this._split = () => this.isSplit && this.split(this.vars);
    let n2 = [], r2, i2 = () => {
      let e22 = n2.length, t3;
      for (; e22--; ) {
        t3 = n2[e22];
        let r3 = t3.element.offsetWidth;
        if (r3 !== t3.width) {
          t3.width = r3, this._split();
          return;
        }
      }
    };
    this._data = { orig: n2, obs: typeof ResizeObserver < `u` && new ResizeObserver(() => {
      clearTimeout(r2), r2 = setTimeout(i2, 200);
    }) }, Td(this), this.split(t2);
  }
  split(e21) {
    return (this._ctx || Ed).add(() => {
      this.isSplit && this.revert(), this.vars = e21 = e21 || this.vars || {};
      let { type: t2 = `chars,words,lines`, aria: n2 = `auto`, deepSlice: r2 = true, smartWrap: i2, onSplit: a2, autoSplit: o2 = false, specialChars: s2, mask: c2 } = this.vars, l2 = t2.indexOf(`lines`) > -1, u2 = t2.indexOf(`chars`) > -1, d2 = t2.indexOf(`words`) > -1, f2 = u2 && !d2 && !l2, p2 = s2 && (`push` in s2 ? RegExp(`(?:` + s2.join(`|`) + `)`, `gu`) : s2), m2 = p2 ? RegExp(p2.source + `|` + Od.source, `gu`) : Od, h2 = !!e21.ignore && Cd(e21.ignore), { orig: g2, animTime: _2, obs: v2 } = this._data, y2;
      (u2 || d2 || l2) && (this.elements.forEach((t3, a3) => {
        g2[a3] = { element: t3, html: t3.innerHTML, ariaL: t3.getAttribute(`aria-label`), ariaH: t3.getAttribute(`aria-hidden`) }, n2 === `auto` ? t3.setAttribute(`aria-label`, (t3.textContent || ``).trim()) : n2 === `hidden` && t3.setAttribute(`aria-hidden`, `true`);
        let o3 = [], s3 = [], c3 = [], _3 = u2 ? Fd(`char`, e21, o3) : null, v3 = Fd(`word`, e21, s3), y3, b2, x2, S2;
        if (Ld(t3, e21, v3, _3, f2, r2 && (l2 || f2), h2, m2, p2, false), l2) {
          let n3 = Sd(t3.childNodes), r3 = Id(t3, n3, e21, c3), i3, a4 = [], o4 = 0, s4 = n3.map((e22) => e22.nodeType === 1 ? e22.getBoundingClientRect() : kd), l3 = kd, u3;
          for (y3 = 0; y3 < n3.length; y3++) i3 = n3[y3], i3.nodeType === 1 && (i3.nodeName === `BR` ? (y3 && n3[y3 - 1].nodeName === `BR` || (a4.push(i3), r3(o4, y3 + 1)), o4 = y3 + 1, l3 = Ad(s4, y3)) : (u3 = s4[y3], y3 && u3.top > l3.top && u3.left < l3.left + l3.width - 1 && (r3(o4, y3), o4 = y3), l3 = u3));
          o4 < y3 && r3(o4, y3), a4.forEach((e22) => e22.parentNode?.removeChild(e22));
        }
        if (!d2) {
          for (y3 = 0; y3 < s3.length; y3++) if (b2 = s3[y3], u2 || !b2.nextSibling || b2.nextSibling.nodeType !== 3) {
            if (i2 && !l2) {
              for (x2 = document.createElement(`span`), x2.style.whiteSpace = `nowrap`; b2.firstChild; ) x2.appendChild(b2.firstChild);
              b2.replaceWith(x2);
            } else b2.replaceWith(...b2.childNodes);
          } else S2 = b2.nextSibling, S2 && S2.nodeType === 3 && (S2.textContent = (b2.textContent || ``) + (S2.textContent || ``), b2.remove());
          s3.length = 0, t3.normalize();
        }
        this.lines.push(...c3), this.words.push(...s3), this.chars.push(...o3);
      }), c2 && this[c2] && this.masks.push(...this[c2].map((e22) => {
        let t3 = e22.cloneNode();
        return e22.replaceWith(t3), t3.appendChild(e22), e22.className && (t3.className = e22.className.trim().split(` `).map((e23) => e23 + `-mask`).join(` `)), t3.style.overflow = `clip`, t3;
      }))), this.isSplit = true, _d && l2 && o2 && _d.addEventListener(`loadingdone`, this._split), (y2 = a2 && a2(this)) && y2.totalTime && (this._data.anim = _2 ? y2.totalTime(_2) : y2), l2 && o2 && this.elements.forEach((e22, t3) => {
        g2[t3].width = e22.offsetWidth, v2 && v2.observe(e22);
      });
    }), this;
  }
  kill() {
    let { obs: e21 } = this._data;
    e21 && e21.disconnect(), _d?.removeEventListener(`loadingdone`, this._split);
  }
  revert() {
    var e21, t2;
    if (this.isSplit) {
      let { orig: n2, anim: r2 } = this._data;
      this.kill(), n2.forEach(jd), this.chars.length = this.words.length = this.lines.length = n2.length = this.masks.length = 0, this.isSplit = false, r2 && (this._data.animTime = r2.totalTime(), r2.revert()), (t2 = (e21 = this.vars).onRevert) == null || t2.call(e21, this);
    }
    return this;
  }
  static create(t2, n2) {
    return new e20(t2, n2);
  }
  static register(e21) {
    gd = gd || e21 || window.gsap, gd && (Sd = gd.utils.toArray, Td = gd.core.context || Td), !yd && window.innerWidth > 0 && (_d = document.fonts, yd = true);
  }
};
Rd.version = `3.15.0`;
var zd = Rd, Bd, Vd, Hd, Ud, Wd, Gd, Kd, qd, Jd = function() {
  return typeof window < `u`;
}, Yd = function() {
  return Bd || Jd() && (Bd = window.gsap) && Bd.registerPlugin && Bd;
}, Xd = /[-+=\.]*\d+[\.e\-\+]*\d*[e\-\+]*\d*/gi, Zd = { rect: [`width`, `height`], circle: [`r`, `r`], ellipse: [`rx`, `ry`], line: [`x2`, `y2`] }, Qd = function(e21) {
  return Math.round(e21 * 1e4) / 1e4;
}, $d = function(e21) {
  return parseFloat(e21) || 0;
}, ef = function(e21, t2) {
  var n2 = $d(e21);
  return ~e21.indexOf(`%`) ? n2 / 100 * t2 : n2;
}, tf = function(e21, t2) {
  return $d(e21.getAttribute(t2));
}, nf = Math.sqrt, rf = function(e21, t2, n2, r2, i2, a2) {
  return nf((($d(n2) - $d(e21)) * i2) ** 2 + (($d(r2) - $d(t2)) * a2) ** 2);
}, af = function(e21) {
  return console.warn(e21);
}, of = function(e21) {
  return e21.getAttribute(`vector-effect`) === `non-scaling-stroke`;
}, sf = 1, cf = function(e21, t2, n2) {
  var r2 = e21.indexOf(` `), i2, a2;
  return r2 < 0 ? (i2 = n2 === void 0 ? e21 : n2 + ``, a2 = e21) : (i2 = e21.substr(0, r2), a2 = e21.substr(r2 + 1)), i2 = ef(i2, t2), a2 = ef(a2, t2), i2 > a2 ? [a2, i2] : [i2, a2];
}, lf = function(e21) {
  if (e21 = Vd(e21)[0], !e21) return 0;
  var t2 = e21.tagName.toLowerCase(), n2 = e21.style, r2 = 1, i2 = 1, a2, o2, s2, c2, l2, u2, d2;
  of(e21) && (i2 = e21.getScreenCTM(), r2 = nf(i2.a * i2.a + i2.b * i2.b), i2 = nf(i2.d * i2.d + i2.c * i2.c));
  try {
    o2 = e21.getBBox();
  } catch {
    af(`Some browsers won't measure invisible elements (like display:none or masks inside defs).`);
  }
  var f2 = o2 || { x: 0, y: 0, width: 0, height: 0 }, p2 = f2.x, m2 = f2.y, h2 = f2.width, g2 = f2.height;
  if ((!o2 || !h2 && !g2) && Zd[t2] && (h2 = tf(e21, Zd[t2][0]), g2 = tf(e21, Zd[t2][1]), t2 !== `rect` && t2 !== `line` && (h2 *= 2, g2 *= 2), t2 === `line` && (p2 = tf(e21, `x1`), m2 = tf(e21, `y1`), h2 = Math.abs(h2 - p2), g2 = Math.abs(g2 - m2))), t2 === `path`) c2 = n2.strokeDasharray, n2.strokeDasharray = `none`, a2 = e21.getTotalLength() || 0, Qd(r2) !== Qd(i2) && !Gd && (Gd = 1) && af(`Warning: <path> length cannot be measured when vector-effect is non-scaling-stroke and the element isn't proportionally scaled.`), a2 *= (r2 + i2) / 2, n2.strokeDasharray = c2;
  else if (t2 === `rect`) a2 = h2 * 2 * r2 + g2 * 2 * i2;
  else if (t2 === `line`) a2 = rf(p2, m2, p2 + h2, m2 + g2, r2, i2);
  else if (t2 === `polyline` || t2 === `polygon`) for (s2 = e21.getAttribute(`points`).match(Xd) || [], t2 === `polygon` && s2.push(s2[0], s2[1]), a2 = 0, l2 = 2; l2 < s2.length; l2 += 2) a2 += rf(s2[l2 - 2], s2[l2 - 1], s2[l2], s2[l2 + 1], r2, i2) || 0;
  else (t2 === `circle` || t2 === `ellipse`) && (u2 = h2 / 2 * r2, d2 = g2 / 2 * i2, a2 = Math.PI * (3 * (u2 + d2) - nf((3 * u2 + d2) * (u2 + 3 * d2))));
  return a2 || 0;
}, uf = function(e21, t2) {
  if (e21 = Vd(e21)[0], !e21) return [0, 0];
  t2 || (t2 = lf(e21) + 1);
  var n2 = Hd.getComputedStyle(e21), r2 = n2.strokeDasharray || ``, i2 = $d(n2.strokeDashoffset), a2 = r2.indexOf(`,`);
  return a2 < 0 && (a2 = r2.indexOf(` `)), r2 = a2 < 0 ? t2 : $d(r2.substr(0, a2)), r2 > t2 && (r2 = t2), [-i2 || 0, r2 - i2 || 0];
}, df = function() {
  Jd() && (Hd = window, Wd = Bd = Yd(), Vd = Bd.utils.toArray, Kd = Bd.core.getStyleSaver, qd = Bd.core.reverting || function() {
  }, Ud = ((Hd.navigator || {}).userAgent || ``).indexOf(`Edge`) !== -1);
}, ff = { version: `3.15.0`, name: `drawSVG`, register: function(e21) {
  Bd = e21, df();
}, init: function(e21, t2, n2, r2, i2) {
  if (!e21.getBBox) return false;
  Wd || df();
  var a2 = lf(e21), o2, s2, c2;
  return this.styles = Kd && Kd(e21, `strokeDashoffset,strokeDasharray,strokeMiterlimit`), this.tween = n2, this._style = e21.style, this._target = e21, t2 + `` == `true` ? t2 = `0 100%` : t2 ? (t2 + ``).indexOf(` `) === -1 && (t2 = `0 ` + t2) : t2 = `0 0`, o2 = uf(e21, a2), s2 = cf(t2, a2, o2[0]), this._length = Qd(a2), this._dash = Qd(o2[1] - o2[0]), this._offset = Qd(-o2[0]), this._dashPT = this.add(this, `_dash`, this._dash, Qd(s2[1] - s2[0]), 0, 0, 0, 0, 0, 1), this._offsetPT = this.add(this, `_offset`, this._offset, Qd(-s2[0]), 0, 0, 0, 0, 0, 1), Ud && (c2 = Hd.getComputedStyle(e21), c2.strokeLinecap !== c2.strokeLinejoin && (s2 = $d(c2.strokeMiterlimit), this.add(e21.style, `strokeMiterlimit`, s2, s2 + 0.01))), this._live = of(e21) || ~(t2 + ``).indexOf(`live`), this._nowrap = ~(t2 + ``).indexOf(`nowrap`), this._props.push(`drawSVG`), sf;
}, render: function(e21, t2) {
  if (t2.tween._time || !qd()) {
    var n2 = t2._pt, r2 = t2._style, i2, a2, o2, s2;
    if (n2) {
      for (t2._live && (i2 = lf(t2._target), i2 !== t2._length && (a2 = i2 / t2._length, t2._length = i2, t2._offsetPT && (t2._offsetPT.s *= a2, t2._offsetPT.c *= a2), t2._dashPT ? (t2._dashPT.s *= a2, t2._dashPT.c *= a2) : t2._dash *= a2)); n2; ) n2.r(e21, n2.d), n2 = n2._next;
      o2 = t2._dash || e21 && e21 !== 1 && 1e-4 || 0, i2 = t2._length - o2 + 0.1, s2 = t2._offset, o2 && s2 && o2 + Math.abs(s2 % t2._length) > t2._length - 0.05 && (s2 += s2 < 0 ? 5e-3 : -5e-3) && (i2 += 5e-3), r2.strokeDashoffset = o2 ? s2 : s2 + 1e-3, r2.strokeDasharray = i2 < 0.1 ? `none` : o2 ? o2 + `px,` + (t2._nowrap ? 999999 : i2) + `px` : `0px, 999999px`;
    }
  } else t2.styles.revert();
}, getLength: lf, getPosition: uf };
Yd() && Bd.registerPlugin(ff);
function pf(e21) {
  "@babel/helpers - typeof";
  return pf = typeof Symbol == `function` && typeof Symbol.iterator == `symbol` ? function(e22) {
    return typeof e22;
  } : function(e22) {
    return e22 && typeof Symbol == `function` && e22.constructor === Symbol && e22 !== Symbol.prototype ? `symbol` : typeof e22;
  }, pf(e21);
}
function mf(e21, t2) {
  if (pf(e21) != `object` || !e21) return e21;
  var n2 = e21[Symbol.toPrimitive];
  if (n2 !== void 0) {
    var r2 = n2.call(e21, t2 || `default`);
    if (pf(r2) != `object`) return r2;
    throw TypeError(`@@toPrimitive must return a primitive value.`);
  }
  return (t2 === `string` ? String : Number)(e21);
}
function hf(e21) {
  var t2 = mf(e21, `string`);
  return pf(t2) == `symbol` ? t2 : t2 + ``;
}
function $(e21, t2, n2) {
  return (t2 = hf(t2)) in e21 ? Object.defineProperty(e21, t2, { value: n2, enumerable: true, configurable: true, writable: true }) : e21[t2] = n2, e21;
}
var gf = `1.3.27`;
function _f(e21, t2, n2) {
  return Math.max(e21, Math.min(t2, n2));
}
function vf(e21, t2, n2) {
  return (1 - n2) * e21 + n2 * t2;
}
function yf(e21, t2, n2, r2) {
  return vf(e21, t2, 1 - Math.exp(-n2 * r2));
}
function bf(e21, t2) {
  return (e21 % t2 + t2) % t2;
}
var xf = class {
  constructor() {
    $(this, `isRunning`, false), $(this, `value`, 0), $(this, `from`, 0), $(this, `to`, 0), $(this, `currentTime`, 0), $(this, `lerp`, void 0), $(this, `duration`, void 0), $(this, `easing`, void 0), $(this, `onUpdate`, void 0);
  }
  advance(e21) {
    if (!this.isRunning) return;
    let t2 = false;
    if (this.duration && this.easing) {
      this.currentTime += e21;
      let n2 = _f(0, this.currentTime / this.duration, 1);
      t2 = n2 >= 1;
      let r2 = t2 ? 1 : this.easing(n2);
      this.value = this.from + (this.to - this.from) * r2;
    } else this.lerp ? (this.value = yf(this.value, this.to, this.lerp * 60, e21), Math.round(this.value) === Math.round(this.to) && (this.value = this.to, t2 = true)) : (this.value = this.to, t2 = true);
    t2 && this.stop(), this.onUpdate?.(this.value, t2);
  }
  stop() {
    this.isRunning = false;
  }
  fromTo(e21, t2, { lerp: n2, duration: r2, easing: i2, onStart: a2, onUpdate: o2 }) {
    this.from = this.value = e21, this.to = t2, this.lerp = n2, this.duration = r2, this.easing = i2, this.currentTime = 0, this.isRunning = true, a2?.(), this.onUpdate = o2;
  }
};
function Sf(e21, t2) {
  let n2;
  return function(...r2) {
    clearTimeout(n2), n2 = setTimeout(() => {
      n2 = void 0, e21.apply(this, r2);
    }, t2);
  };
}
var Cf = class {
  constructor(e21, t2, { autoResize: n2 = true, debounce: r2 = 250 } = {}) {
    $(this, `width`, 0), $(this, `height`, 0), $(this, `scrollHeight`, 0), $(this, `scrollWidth`, 0), $(this, `debouncedResize`, void 0), $(this, `wrapperResizeObserver`, void 0), $(this, `contentResizeObserver`, void 0), $(this, `resize`, () => {
      this.onWrapperResize(), this.onContentResize();
    }), $(this, `onWrapperResize`, () => {
      this.wrapper instanceof Window ? (this.width = window.innerWidth, this.height = window.innerHeight) : (this.width = this.wrapper.clientWidth, this.height = this.wrapper.clientHeight);
    }), $(this, `onContentResize`, () => {
      this.wrapper instanceof Window ? (this.scrollHeight = this.content.scrollHeight, this.scrollWidth = this.content.scrollWidth) : (this.scrollHeight = this.wrapper.scrollHeight, this.scrollWidth = this.wrapper.scrollWidth);
    }), this.wrapper = e21, this.content = t2, n2 && (this.debouncedResize = Sf(this.resize, r2), this.wrapper instanceof Window ? window.addEventListener(`resize`, this.debouncedResize) : (this.wrapperResizeObserver = new ResizeObserver(this.debouncedResize), this.wrapperResizeObserver.observe(this.wrapper)), this.contentResizeObserver = new ResizeObserver(this.debouncedResize), this.contentResizeObserver.observe(this.content)), this.resize();
  }
  destroy() {
    this.wrapperResizeObserver?.disconnect(), this.contentResizeObserver?.disconnect(), this.wrapper === window && this.debouncedResize && window.removeEventListener(`resize`, this.debouncedResize);
  }
  get limit() {
    return { x: this.scrollWidth - this.width, y: this.scrollHeight - this.height };
  }
}, wf = class {
  constructor() {
    $(this, `events`, {});
  }
  emit(e21, ...t2) {
    let n2 = this.events[e21] || [];
    for (let e22 = 0, r2 = n2.length; e22 < r2; e22++) n2[e22]?.(...t2);
  }
  on(e21, t2) {
    return this.events[e21] ? this.events[e21].push(t2) : this.events[e21] = [t2], () => {
      this.events[e21] = this.events[e21]?.filter((e22) => t2 !== e22);
    };
  }
  off(e21, t2) {
    this.events[e21] = this.events[e21]?.filter((e22) => t2 !== e22);
  }
  destroy() {
    this.events = {};
  }
}, Tf = 100 / 6, Ef = { passive: false };
function Df(e21, t2) {
  return e21 === 1 ? Tf : e21 === 2 ? t2 : 1;
}
var Of = class {
  constructor(e21, t2 = { wheelMultiplier: 1, touchMultiplier: 1 }) {
    $(this, `touchStart`, { x: 0, y: 0 }), $(this, `lastDelta`, { x: 0, y: 0 }), $(this, `window`, { width: 0, height: 0 }), $(this, `emitter`, new wf()), $(this, `onTouchStart`, (e22) => {
      let { clientX: t3, clientY: n2 } = e22.targetTouches ? e22.targetTouches[0] : e22;
      this.touchStart.x = t3, this.touchStart.y = n2, this.lastDelta = { x: 0, y: 0 }, this.emitter.emit(`scroll`, { deltaX: 0, deltaY: 0, event: e22 });
    }), $(this, `onTouchMove`, (e22) => {
      let { clientX: t3, clientY: n2 } = e22.targetTouches ? e22.targetTouches[0] : e22, r2 = -(t3 - this.touchStart.x) * this.options.touchMultiplier, i2 = -(n2 - this.touchStart.y) * this.options.touchMultiplier;
      this.touchStart.x = t3, this.touchStart.y = n2, this.lastDelta = { x: r2, y: i2 }, this.emitter.emit(`scroll`, { deltaX: r2, deltaY: i2, event: e22 });
    }), $(this, `onTouchEnd`, (e22) => {
      this.emitter.emit(`scroll`, { deltaX: this.lastDelta.x, deltaY: this.lastDelta.y, event: e22 });
    }), $(this, `onWheel`, (e22) => {
      let { deltaX: t3, deltaY: n2, deltaMode: r2 } = e22, i2 = Df(r2, this.window.width), a2 = Df(r2, this.window.height);
      t3 *= i2, n2 *= a2, t3 *= this.options.wheelMultiplier, n2 *= this.options.wheelMultiplier, this.emitter.emit(`scroll`, { deltaX: t3, deltaY: n2, event: e22 });
    }), $(this, `onWindowResize`, () => {
      this.window = { width: window.innerWidth, height: window.innerHeight };
    }), this.element = e21, this.options = t2, window.addEventListener(`resize`, this.onWindowResize), this.onWindowResize(), this.element.addEventListener(`wheel`, this.onWheel, Ef), this.element.addEventListener(`touchstart`, this.onTouchStart, Ef), this.element.addEventListener(`touchmove`, this.onTouchMove, Ef), this.element.addEventListener(`touchend`, this.onTouchEnd, Ef);
  }
  on(e21, t2) {
    return this.emitter.on(e21, t2);
  }
  destroy() {
    this.emitter.destroy(), window.removeEventListener(`resize`, this.onWindowResize), this.element.removeEventListener(`wheel`, this.onWheel, Ef), this.element.removeEventListener(`touchstart`, this.onTouchStart, Ef), this.element.removeEventListener(`touchmove`, this.onTouchMove, Ef), this.element.removeEventListener(`touchend`, this.onTouchEnd, Ef);
  }
}, kf = (e21) => Math.min(1, 1.001 - 2 ** (-10 * e21)), Af = class {
  constructor({ wrapper: e21 = window, content: t2 = document.documentElement, eventsTarget: n2 = e21, smoothWheel: r2 = true, syncTouch: i2 = false, syncTouchLerp: a2 = 0.075, touchInertiaExponent: o2 = 1.7, duration: s2, easing: c2, lerp: l2 = 0.1, infinite: u2 = false, orientation: d2 = `vertical`, gestureOrientation: f2 = d2 === `horizontal` ? `both` : `vertical`, touchMultiplier: p2 = 1, wheelMultiplier: m2 = 1, autoResize: h2 = true, prevent: g2, virtualScroll: _2, overscroll: v2 = true, autoRaf: y2 = false, anchors: b2 = false, autoToggle: x2 = false, allowNestedScroll: S2 = false, __experimental__naiveDimensions: C2 = false, naiveDimensions: w2 = C2, stopInertiaOnNavigate: T2 = false, respectReducedMotion: E2 = true } = {}) {
    $(this, `_isScrolling`, false), $(this, `_isStopped`, false), $(this, `_isLocked`, false), $(this, `_preventNextNativeScrollEvent`, false), $(this, `_resetVelocityTimeout`, null), $(this, `_rafId`, null), $(this, `_isDraggingSelection`, false), $(this, `reducedMotionMediaQuery`, window.matchMedia(`(prefers-reduced-motion: reduce)`)), $(this, `isTouching`, void 0), $(this, `isIos`, void 0), $(this, `time`, 0), $(this, `userData`, {}), $(this, `lastVelocity`, 0), $(this, `velocity`, 0), $(this, `direction`, 0), $(this, `options`, void 0), $(this, `targetScroll`, void 0), $(this, `animatedScroll`, void 0), $(this, `animate`, new xf()), $(this, `emitter`, new wf()), $(this, `dimensions`, void 0), $(this, `virtualScroll`, void 0), $(this, `onScrollEnd`, (e22) => {
      e22 instanceof CustomEvent || (this.isScrolling === `smooth` || this.isScrolling === false) && e22.stopPropagation();
    }), $(this, `dispatchScrollendEvent`, () => {
      this.options.wrapper.dispatchEvent(new CustomEvent(`scrollend`, { bubbles: this.options.wrapper === window, detail: { lenisScrollEnd: true } }));
    }), $(this, `onTransitionEnd`, (e22) => {
      e22.propertyName?.includes(`overflow`) && e22.target === this.rootElement && this.checkOverflow();
    }), $(this, `onClick`, (e22) => {
      let t3 = e22.composedPath().filter((e23) => e23 instanceof HTMLAnchorElement && e23.href).map((e23) => new URL(e23.href)), n3 = new URL(window.location.href);
      if (this.options.anchors) {
        let e23 = t3.find((e24) => n3.host === e24.host && n3.pathname === e24.pathname && e24.hash);
        if (e23) {
          let t4 = typeof this.options.anchors == `object` && this.options.anchors ? this.options.anchors : void 0, n4 = decodeURIComponent(e23.hash);
          this.scrollTo(n4, t4);
          return;
        }
      }
      this.options.stopInertiaOnNavigate && t3.some((e23) => n3.host === e23.host && n3.pathname !== e23.pathname) && this.reset();
    }), $(this, `onPointerDown`, (e22) => {
      e22.button === 1 && this.reset();
    }), $(this, `onVirtualScroll`, (e22) => {
      if (typeof this.options.virtualScroll == `function` && this.options.virtualScroll(e22) === false) return;
      let { deltaX: t3, deltaY: n3, event: r3 } = e22;
      if (this.emitter.emit(`virtual-scroll`, { deltaX: t3, deltaY: n3, event: r3 }), r3.ctrlKey || r3.lenisStopPropagation) return;
      let i3 = r3.type.includes(`touch`), a3 = r3.type.includes(`wheel`);
      if (i3 && this.isIos && (r3.type === `touchstart` && (this._isDraggingSelection = this.isTouchOnSelectionHandle(r3)), this._isDraggingSelection)) {
        r3.type === `touchend` && (this._isDraggingSelection = false);
        return;
      }
      this.isTouching = r3.type === `touchstart` || r3.type === `touchmove`;
      let o3 = t3 === 0 && n3 === 0;
      if (this.options.syncTouch && i3 && r3.type === `touchstart` && o3 && !this.isStopped && !this.isLocked) {
        this.reset();
        return;
      }
      let s3 = this.options.gestureOrientation === `vertical` && n3 === 0 || this.options.gestureOrientation === `horizontal` && t3 === 0;
      if (o3 || s3) return;
      let c3 = r3.composedPath();
      c3 = c3.slice(0, c3.indexOf(this.rootElement));
      let l3 = this.options.prevent, u3 = Math.abs(t3) >= Math.abs(n3) ? `horizontal` : `vertical`;
      if (c3.find((e23) => e23 instanceof HTMLElement && (typeof l3 == `function` && l3?.(e23) || e23.hasAttribute?.(`data-lenis-prevent`) || u3 === `vertical` && e23.hasAttribute?.(`data-lenis-prevent-vertical`) || u3 === `horizontal` && e23.hasAttribute?.(`data-lenis-prevent-horizontal`) || i3 && e23.hasAttribute?.(`data-lenis-prevent-touch`) || a3 && e23.hasAttribute?.(`data-lenis-prevent-wheel`) || this.options.allowNestedScroll && this.hasNestedScroll(e23, { deltaX: t3, deltaY: n3 })))) return;
      if (this.isStopped || this.isLocked) {
        r3.cancelable && r3.preventDefault();
        return;
      }
      if (!(this.options.syncTouch && i3 || this.options.smoothWheel && a3)) {
        this.isScrolling = `native`, this.animate.stop(), r3.lenisStopPropagation = true;
        return;
      }
      let d3 = n3;
      this.options.gestureOrientation === `both` ? d3 = Math.abs(n3) > Math.abs(t3) ? n3 : t3 : this.options.gestureOrientation === `horizontal` && (d3 = t3), (!this.options.overscroll || this.options.infinite || this.options.wrapper !== window && this.limit > 0 && (this.animatedScroll > 0 && this.animatedScroll < this.limit || this.animatedScroll === 0 && n3 > 0 || this.animatedScroll === this.limit && n3 < 0)) && (r3.lenisStopPropagation = true), r3.cancelable && r3.preventDefault();
      let f3 = i3 && this.options.syncTouch, p3 = i3 && r3.type === `touchend`;
      p3 && (d3 = Math.sign(d3) * Math.abs(this.velocity) ** this.options.touchInertiaExponent), this.scrollTo(this.targetScroll + d3, { programmatic: false, ...f3 ? { lerp: p3 ? this.options.syncTouchLerp : 1 } : { lerp: this.options.lerp, duration: this.options.duration, easing: this.options.easing } });
    }), $(this, `onNativeScroll`, () => {
      if (this._resetVelocityTimeout !== null && (clearTimeout(this._resetVelocityTimeout), this._resetVelocityTimeout = null), this._preventNextNativeScrollEvent) this._preventNextNativeScrollEvent = false;
      else if (this.isScrolling === false || this.isScrolling === `native`) {
        let e22 = this.animatedScroll;
        this.animatedScroll = this.targetScroll = this.actualScroll, this.lastVelocity = this.velocity, this.velocity = this.animatedScroll - e22, this.direction = Math.sign(this.animatedScroll - e22), this.isStopped || (this.isScrolling = `native`), this.emit(), this.velocity !== 0 && (this._resetVelocityTimeout = setTimeout(() => {
          this.lastVelocity = this.velocity, this.velocity = 0, this.isScrolling = false, this.emit();
        }, 400));
      }
    }), $(this, `raf`, (e22) => {
      let t3 = e22 - (this.time || e22);
      this.time = e22, this.animate.advance(t3 * 1e-3), this.options.autoRaf && (this._rafId = requestAnimationFrame(this.raf));
    }), window.lenisVersion = gf, window.lenis || (window.lenis = {}), window.lenis.version = gf, d2 === `horizontal` && (window.lenis.horizontal = true), i2 === true && (window.lenis.touch = true), this.isIos = /(iPad|iPhone|iPod)/g.test(navigator.userAgent), e21 && e21 !== document.documentElement || (e21 = window), typeof s2 == `number` && typeof c2 != `function` ? c2 = kf : typeof c2 == `function` && typeof s2 != `number` && (s2 = 1), this.options = { wrapper: e21, content: t2, eventsTarget: n2, smoothWheel: r2, syncTouch: i2, syncTouchLerp: a2, touchInertiaExponent: o2, duration: s2, easing: c2, lerp: l2, infinite: u2, gestureOrientation: f2, orientation: d2, touchMultiplier: p2, wheelMultiplier: m2, autoResize: h2, prevent: g2, virtualScroll: _2, overscroll: v2, autoRaf: y2, anchors: b2, autoToggle: x2, allowNestedScroll: S2, naiveDimensions: w2, stopInertiaOnNavigate: T2, respectReducedMotion: E2 }, this.dimensions = new Cf(e21, t2, { autoResize: h2 }), this.updateClassName(), this.targetScroll = this.animatedScroll = this.actualScroll, this.options.wrapper.addEventListener(`scroll`, this.onNativeScroll), this.options.wrapper.addEventListener(`scrollend`, this.onScrollEnd, { capture: true }), (this.options.anchors || this.options.stopInertiaOnNavigate) && this.options.wrapper.addEventListener(`click`, this.onClick), this.options.wrapper.addEventListener(`pointerdown`, this.onPointerDown), this.virtualScroll = new Of(n2, { touchMultiplier: p2, wheelMultiplier: m2 }), this.virtualScroll.on(`scroll`, this.onVirtualScroll), this.options.autoToggle && (this.checkOverflow(), this.rootElement.addEventListener(`transitionend`, this.onTransitionEnd)), this.options.autoRaf && (this._rafId = requestAnimationFrame(this.raf));
  }
  destroy() {
    this.emitter.destroy(), this._resetVelocityTimeout !== null && (clearTimeout(this._resetVelocityTimeout), this._resetVelocityTimeout = null), this.options.wrapper.removeEventListener(`scroll`, this.onNativeScroll), this.options.wrapper.removeEventListener(`scrollend`, this.onScrollEnd, { capture: true }), this.options.wrapper.removeEventListener(`pointerdown`, this.onPointerDown), (this.options.anchors || this.options.stopInertiaOnNavigate) && this.options.wrapper.removeEventListener(`click`, this.onClick), this.virtualScroll.destroy(), this.dimensions.destroy(), this.cleanUpClassName(), this._rafId && cancelAnimationFrame(this._rafId);
  }
  on(e21, t2) {
    return this.emitter.on(e21, t2);
  }
  off(e21, t2) {
    return this.emitter.off(e21, t2);
  }
  get overflow() {
    let e21 = this.isHorizontal ? `overflow-x` : `overflow-y`;
    return getComputedStyle(this.rootElement)[e21];
  }
  checkOverflow() {
    [`hidden`, `clip`].includes(this.overflow) ? this.internalStop() : this.internalStart();
  }
  setScroll(e21) {
    this.isHorizontal ? this.options.wrapper.scrollTo({ left: e21, behavior: `instant` }) : this.options.wrapper.scrollTo({ top: e21, behavior: `instant` });
  }
  isTouchOnSelectionHandle(e21) {
    let t2 = window.getSelection();
    if (!t2 || t2.isCollapsed || t2.rangeCount === 0) return false;
    let n2 = e21.targetTouches[0] ?? e21.changedTouches[0];
    if (!n2) return false;
    let r2 = t2.getRangeAt(0).getClientRects();
    if (r2.length === 0) return false;
    let i2 = r2[0], a2 = r2[r2.length - 1], o2 = Math.hypot(n2.clientX - i2.left, n2.clientY - i2.top) <= 40, s2 = Math.hypot(n2.clientX - a2.right, n2.clientY - a2.bottom) <= 40;
    return o2 || s2;
  }
  resize() {
    this.dimensions.resize(), this.animatedScroll = this.targetScroll = this.actualScroll, this.emit();
  }
  emit() {
    this.emitter.emit(`scroll`, this);
  }
  reset() {
    this.isLocked = false, this.isScrolling = false, this.animatedScroll = this.targetScroll = this.actualScroll, this.lastVelocity = this.velocity = 0, this.animate.stop();
  }
  start() {
    this.isStopped && (this.options.autoToggle ? this.rootElement.style.removeProperty(`overflow`) : this.internalStart());
  }
  internalStart() {
    this.isStopped && (this.reset(), this.isStopped = false, this.emit());
  }
  stop() {
    this.isStopped || (this.options.autoToggle ? this.rootElement.style.setProperty(`overflow`, `clip`) : this.internalStop());
  }
  internalStop() {
    this.isStopped || (this.reset(), this.isStopped = true, this.emit());
  }
  scrollTo(e21, { offset: t2 = 0, immediate: n2 = false, lock: r2 = false, programmatic: i2 = true, lerp: a2 = i2 ? this.options.lerp : void 0, duration: o2 = i2 ? this.options.duration : void 0, easing: s2 = i2 ? this.options.easing : void 0, onStart: c2, onComplete: l2, force: u2 = false, userData: d2 } = {}) {
    if (this.prefersReducedMotion && (i2 ? n2 = true : (a2 = 1, o2 = void 0, s2 = void 0)), (this.isStopped || this.isLocked) && !u2) return;
    let f2 = e21, p2 = t2;
    if (typeof f2 == `string` && [`top`, `left`, `start`, `#`].includes(f2)) f2 = 0;
    else if (typeof f2 == `string` && [`bottom`, `right`, `end`].includes(f2)) f2 = this.limit;
    else {
      let e22 = null;
      if (typeof f2 == `string` ? (e22 = f2.startsWith(`#`) ? document.getElementById(f2.slice(1)) : document.querySelector(f2), e22 || (f2 === `#top` ? f2 = 0 : console.warn(`Lenis: Target not found`, f2))) : f2 instanceof Element && (e22 = f2), e22) {
        if (this.options.wrapper !== window) {
          let e23 = this.rootElement.getBoundingClientRect();
          p2 -= this.isHorizontal ? e23.left : e23.top;
        }
        let t3 = e22.getBoundingClientRect(), n3 = getComputedStyle(e22), r3 = this.isHorizontal ? Number.parseFloat(n3.scrollMarginLeft) : Number.parseFloat(n3.scrollMarginTop), i3 = getComputedStyle(this.rootElement), a3 = this.isHorizontal ? Number.parseFloat(i3.scrollPaddingLeft) : Number.parseFloat(i3.scrollPaddingTop);
        f2 = (this.isHorizontal ? t3.left : t3.top) + this.animatedScroll - (Number.isNaN(r3) ? 0 : r3) - (Number.isNaN(a3) ? 0 : a3);
      }
    }
    if (typeof f2 == `number`) {
      if (f2 += p2, this.options.infinite) {
        if (i2) {
          this.targetScroll = this.animatedScroll = this.scroll;
          let e22 = f2 - this.animatedScroll;
          e22 > this.limit / 2 ? f2 -= this.limit : e22 < -this.limit / 2 && (f2 += this.limit);
        }
      } else f2 = _f(0, f2, this.limit);
      f2 === this.targetScroll ? (c2?.(this), l2?.(this)) : (this.userData = d2 ?? {}, n2 ? (this.animatedScroll = this.targetScroll = f2, this.setScroll(this.scroll), this.reset(), this.preventNextNativeScrollEvent(), this.emit(), l2?.(this), this.userData = {}, requestAnimationFrame(() => {
        this.dispatchScrollendEvent();
      })) : (i2 || (this.targetScroll = f2), typeof o2 == `number` && typeof s2 != `function` ? s2 = kf : typeof s2 == `function` && typeof o2 != `number` && (o2 = 1), this.animate.fromTo(this.animatedScroll, f2, { duration: o2, easing: s2, lerp: a2, onStart: () => {
        r2 && (this.isLocked = true), this.isScrolling = `smooth`, c2?.(this);
      }, onUpdate: (e22, t3) => {
        this.isScrolling = `smooth`, this.lastVelocity = this.velocity, this.velocity = e22 - this.animatedScroll, this.direction = Math.sign(this.velocity), this.animatedScroll = e22, this.setScroll(this.scroll), i2 && (this.targetScroll = e22), t3 || this.emit(), t3 && (this.reset(), this.emit(), l2?.(this), this.userData = {}, requestAnimationFrame(() => {
          this.dispatchScrollendEvent();
        }), this.preventNextNativeScrollEvent());
      } })));
    }
  }
  preventNextNativeScrollEvent() {
    this._preventNextNativeScrollEvent = true, requestAnimationFrame(() => {
      this._preventNextNativeScrollEvent = false;
    });
  }
  hasNestedScroll(e21, { deltaX: t2, deltaY: n2 }) {
    let r2 = Date.now();
    e21._lenis || (e21._lenis = {});
    let i2 = e21._lenis, a2, o2, s2, c2, l2, u2, d2, f2, p2, m2;
    if (r2 - (i2.time ?? 0) > 2e3) {
      i2.time = Date.now();
      let t3 = window.getComputedStyle(e21);
      if (i2.computedStyle = t3, a2 = [`auto`, `overlay`, `scroll`].includes(t3.overflowX), o2 = [`auto`, `overlay`, `scroll`].includes(t3.overflowY), l2 = [`auto`].includes(t3.overscrollBehaviorX), u2 = [`auto`].includes(t3.overscrollBehaviorY), i2.hasOverflowX = a2, i2.hasOverflowY = o2, !(a2 || o2)) return false;
      d2 = e21.scrollWidth, f2 = e21.scrollHeight, p2 = e21.clientWidth, m2 = e21.clientHeight, s2 = d2 > p2, c2 = f2 > m2, i2.isScrollableX = s2, i2.isScrollableY = c2, i2.scrollWidth = d2, i2.scrollHeight = f2, i2.clientWidth = p2, i2.clientHeight = m2, i2.hasOverscrollBehaviorX = l2, i2.hasOverscrollBehaviorY = u2;
    } else s2 = i2.isScrollableX, c2 = i2.isScrollableY, a2 = i2.hasOverflowX, o2 = i2.hasOverflowY, d2 = i2.scrollWidth, f2 = i2.scrollHeight, p2 = i2.clientWidth, m2 = i2.clientHeight, l2 = i2.hasOverscrollBehaviorX, u2 = i2.hasOverscrollBehaviorY;
    if (!(a2 && s2 || o2 && c2)) return false;
    let h2 = Math.abs(t2) >= Math.abs(n2) ? `horizontal` : `vertical`, g2, _2, v2, y2, b2, x2;
    if (h2 === `horizontal`) g2 = Math.round(e21.scrollLeft), _2 = d2 - p2, v2 = t2, y2 = a2, b2 = s2, x2 = l2;
    else if (h2 === `vertical`) g2 = Math.round(e21.scrollTop), _2 = f2 - m2, v2 = n2, y2 = o2, b2 = c2, x2 = u2;
    else return false;
    return !x2 && (g2 >= _2 || g2 <= 0) || (v2 > 0 ? g2 < _2 : g2 > 0) && y2 && b2;
  }
  get rootElement() {
    return this.options.wrapper === window ? document.documentElement : this.options.wrapper;
  }
  get limit() {
    return this.options.naiveDimensions ? this.isHorizontal ? this.rootElement.scrollWidth - this.rootElement.clientWidth : this.rootElement.scrollHeight - this.rootElement.clientHeight : this.dimensions.limit[this.isHorizontal ? `x` : `y`];
  }
  get isHorizontal() {
    return this.options.orientation === `horizontal`;
  }
  get actualScroll() {
    let e21 = this.options.wrapper;
    return this.isHorizontal ? e21.scrollX ?? e21.scrollLeft : e21.scrollY ?? e21.scrollTop;
  }
  get scroll() {
    return this.options.infinite ? bf(this.animatedScroll, this.limit) : this.animatedScroll;
  }
  get progress() {
    return this.limit === 0 ? 1 : this.scroll / this.limit;
  }
  get isScrolling() {
    return this._isScrolling;
  }
  set isScrolling(e21) {
    this._isScrolling !== e21 && (this._isScrolling = e21, this.updateClassName());
  }
  get isStopped() {
    return this._isStopped;
  }
  set isStopped(e21) {
    this._isStopped !== e21 && (this._isStopped = e21, this.updateClassName());
  }
  get isLocked() {
    return this._isLocked;
  }
  set isLocked(e21) {
    this._isLocked !== e21 && (this._isLocked = e21, this.updateClassName());
  }
  get isSmooth() {
    return this.isScrolling === `smooth`;
  }
  get prefersReducedMotion() {
    return this.options.respectReducedMotion && this.reducedMotionMediaQuery.matches;
  }
  get className() {
    let e21 = `lenis`;
    return this.options.autoToggle && (e21 += ` lenis-autoToggle`), this.isStopped && (e21 += ` lenis-stopped`), this.isLocked && (e21 += ` lenis-locked`), this.isScrolling && (e21 += ` lenis-scrolling`), this.isScrolling === `smooth` && (e21 += ` lenis-smooth`), e21;
  }
  updateClassName() {
    this.cleanUpClassName(), this.className.split(` `).forEach((e21) => {
      this.rootElement.classList.add(e21);
    });
  }
  cleanUpClassName() {
    for (let e21 of Array.from(this.rootElement.classList)) (e21 === `lenis` || e21.startsWith(`lenis-`)) && this.rootElement.classList.remove(e21);
  }
};
hi.registerPlugin(Q, zd, ff);
function jf({ tier: e21, hero: t2 }) {
  let n2 = e21.reduced, r2 = (e22, t3 = document) => t3.querySelector(e22), i2 = (e22, t3 = document) => Array.from(t3.querySelectorAll(e22)), a2 = null;
  n2 || (a2 = new Af({ lerp: 0.1, smoothWheel: true, syncTouch: false }), a2.on(`scroll`, Q.update), hi.ticker.add((e22) => a2.raf(e22 * 1e3)), hi.ticker.lagSmoothing(0)), i2(`a[href^="#"]`).forEach((e22) => {
    e22.addEventListener(`click`, (t3) => {
      let i3 = e22.getAttribute(`href`);
      if (i3.length < 2) return;
      let o3 = r2(i3);
      o3 && (t3.preventDefault(), a2 ? a2.scrollTo(o3, { duration: 1.5, easing: (e23) => 1 - (1 - e23) ** 4 }) : o3.scrollIntoView({ behavior: n2 ? `auto` : `smooth` }));
    });
  }), hi.to(`.progress i`, { scaleX: 1, ease: `none`, scrollTrigger: { start: 0, end: `max`, scrub: 0.3 } });
  let o2 = r2(`[data-nav]`), s2 = 0;
  o2 && Q.create({ start: 0, end: `max`, onUpdate: (e22) => {
    let t3 = e22.scroll(), n3 = t3 > s2 + 2, r3 = t3 < s2 - 2;
    n3 && t3 > 120 ? o2.classList.add(`is-hidden`) : r3 && o2.classList.remove(`is-hidden`), s2 = t3;
  } });
  let c2 = r2(`[data-hero]`), l2 = r2(`[data-hero-foot]`);
  if (c2) {
  e21.scrub && !n2 ? (Q.create({ trigger: c2, start: `top top`, end: `bottom top`, onUpdate: (e22) => t2.setProgress(e22.progress) }), hi.to(r2(`.hero__media`), { yPercent: 24, ease: `none`, scrollTrigger: { trigger: c2, start: `top top`, end: `bottom top`, scrub: true } }), hi.to(r2(`.hero__content`), { y: -60, opacity: 0, ease: `none`, scrollTrigger: { trigger: c2, start: `top top`, end: `55% top`, scrub: true } }), hi.to(l2, { opacity: 0, ease: `none`, scrollTrigger: { trigger: c2, start: `top top`, end: `25% top`, scrub: true } })) : n2 || hi.to(r2(`.hero__content`), { y: 120, opacity: 0, ease: `none`, scrollTrigger: { trigger: c2, start: `top top`, end: `bottom top`, scrub: true } }), hi.set([`[data-hero-title]`, `[data-hero-line]`, l2], { opacity: 0 }), (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    let e22 = r2(`[data-hero-title]`), t3 = i2(`[data-hero-line]`, c2);
    if (n2 || !e22) {
      hi.set([e22, ...t3, l2].filter(Boolean), { opacity: 1 });
      return;
    }
    let a3 = zd.create(e22, { type: `lines,words`, mask: `lines`, linesClass: `line` });
    hi.set(e22, { opacity: 1 }), hi.timeline({ defaults: { ease: `power3.out` }, onComplete: () => a3.revert() }).from(a3.words, { yPercent: 110, duration: 1.2, stagger: 0.035 }, 0.15).fromTo(t3, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.12 }, 0.5).fromTo(l2, { opacity: 0 }, { opacity: 1, duration: 1 }, 1.1);
  });
  }
  let u2 = r2(`[data-split]`);
  if (u2 && !n2) {
    let e22 = zd.create(u2, { type: `words` });
    hi.fromTo(e22.words, { opacity: 0.16 }, { opacity: 1, stagger: 0.04, ease: `none`, scrollTrigger: { trigger: u2, start: `top 78%`, end: `bottom 48%`, scrub: true } });
  }
  let d2 = hi.matchMedia(), f2 = r2(`[data-cube-stage]`), p2 = i2(`[data-service]`);
  d2.add(`(min-width: 320px)`, () => {
    if (n2 || !f2 || p2.length < 2) return;
    let e22 = p2.length, t3 = { progress: 0, n: e22, cards: p2 };
    f2.__cube = t3;
    let o3 = i2(`[data-cube-dots] button`);
    hi.set(p2, { transformOrigin: `50% 0%`, yPercent: 100, rotateX: -90, z: 0, "--dim": 0.7 }), hi.set(p2[0], { transformOrigin: `50% 100%`, yPercent: 0, rotateX: 0, "--dim": 0 });
    let s3 = 0, c3 = false, l3 = null, u3 = (t4, n3) => {
      c3 = true, t4 = Math.max(0, Math.min(e22 - 1, t4));
      let r3 = n3.start + (n3.end - n3.start) * (t4 / (e22 - 1));
      a2 ? a2.scrollTo(r3, { duration: 0.8, easing: (e23) => 1 - (1 - e23) ** 3 }) : window.scrollTo({ top: r3, behavior: `smooth` }), setTimeout(() => {
        c3 = false, l3 = null;
      }, 900);
    }, d3 = hi.timeline({ scrollTrigger: { trigger: f2, start: `top top`, end: () => `+=` + (e22 - 1) * innerHeight, pin: true, scrub: 0.5, anticipatePin: 1, invalidateOnRefresh: true, refreshPriority: 1, onUpdate: (n3) => {
      t3.progress = n3.progress * (e22 - 1);
      let r3 = Math.min(e22 - 2, Math.floor(t3.progress));
      p2.forEach((e23, t4) => {
        e23.classList.toggle(`is-out`, t4 === r3), e23.classList.toggle(`is-in`, t4 === r3 + 1);
      });
      let i3 = Math.round(t3.progress);
      o3.forEach((e23, t4) => e23.classList.toggle(`is-on`, t4 === i3));
      let a3 = t3.progress - Math.floor(t3.progress);
      if (c3) return;
      if (a3 < 2e-3 || a3 > 0.998) {
        l3 = null;
        return;
      }
      l3 === null && (l3 = Math.round(t3.progress)), clearTimeout(s3);
      let d4 = t3.progress, f3;
      f3 = d4 > l3 + 0.01 ? Math.max(l3 + 1, Math.floor(d4 + 0.5)) : d4 < l3 - 0.01 ? Math.min(l3 - 1, Math.floor(d4 + 0.5)) : l3, s3 = setTimeout(() => u3(f3, n3), 140);
    } } }), m3 = { "0%": { yPercent: 0, z: 0, rotateX: 0, "--dim": 0 }, "65%": { yPercent: -55, z: -300, rotateX: 55, "--dim": 0.45, ease: `power2.in` }, "100%": { yPercent: -100, z: 0, rotateX: 90, "--dim": 0.7, ease: `power2.out` } }, h3 = { "0%": { yPercent: 100, z: 0, rotateX: -90, "--dim": 0.7 }, "65%": { yPercent: 45, z: -300, rotateX: -35, "--dim": 0.45, ease: `power2.in` }, "100%": { yPercent: 0, z: 0, rotateX: 0, "--dim": 0, ease: `power2.out` } };
    for (let t4 = 0; t4 < e22 - 1; t4++) {
      let e23 = p2[t4], n3 = p2[t4 + 1];
      d3.set(e23, { transformOrigin: `50% 100%` }, t4).set(n3, { transformOrigin: `50% 0%` }, t4).to(e23, { keyframes: m3, duration: 1, ease: `none` }, t4).to(n3, { keyframes: h3, duration: 1, ease: `none` }, t4);
    }
    return o3.forEach((t4, n3) => t4.addEventListener(`click`, () => {
      let t5 = d3.scrollTrigger, r3 = t5.start + (t5.end - t5.start) * (n3 / (e22 - 1));
      a2 ? a2.scrollTo(r3, { duration: 1.2 }) : window.scrollTo(0, r3);
    })), r2(`.service__body`, p2[0]) && hi.from(Array.from(r2(`.service__body`, p2[0]).children), { y: 36, opacity: 0, duration: 1, stagger: 0.08, ease: `power3.out`, scrollTrigger: { trigger: f2, start: `top 60%`, once: true } }), () => {
      f2.__cube = null;
    };
  });
  let m2 = i2(`[data-plan-step]`), h2 = i2(`[data-step]`), g2 = i2(`[data-plan-legend] span`), _2 = r2(`[data-model]`), v2 = _2 && _2.__model;
  m2.forEach((e22, t3) => {
    let r3 = h2[t3];
    if (!r3) return;
    let a3 = { trigger: r3, start: `top 92%`, end: `top 38%`, onToggle: (e23) => {
      (e23.isActive || e23.progress >= 1) && g2.forEach((e24, n3) => e24.classList.toggle(`is-on`, n3 <= t3));
    } };
    if (v2) Q.create(a3);
    else if (n2) Q.create(a3);
    else {
      let t4 = i2(`path`, e22);
      hi.set(t4, { drawSVG: `0%` }), hi.to(t4, { drawSVG: `100%`, stagger: 0.06, ease: `none`, scrollTrigger: { ...a3, scrub: 0.5 } });
    }
    n2 || hi.from(r3, { opacity: 0.25, x: 20, ease: `none`, scrollTrigger: { trigger: r3, start: `top 85%`, end: `top 55%`, scrub: true } });
  }), e21.coarse || i2(`[data-light]`).forEach((e22) => {
    e22.addEventListener(`pointermove`, (t3) => {
      let n3 = e22.getBoundingClientRect();
      e22.style.setProperty(`--mx`, ((t3.clientX - n3.left) / n3.width * 100).toFixed(1) + `%`), e22.style.setProperty(`--my`, ((t3.clientY - n3.top) / n3.height * 100).toFixed(1) + `%`);
    }, { passive: true });
  }), i2(`[data-count]`).forEach((e22) => {
    let t3 = parseFloat(e22.dataset.count), n3 = parseInt(e22.dataset.decimals || `0`, 10), r3 = e22.dataset.suffix || ``, i3 = { v: 0 };
    hi.to(i3, { v: t3, duration: 2, ease: `power2.out`, scrollTrigger: { trigger: e22, start: `top 85%`, once: true }, onUpdate: () => {
      e22.textContent = i3.v.toFixed(n3) + r3;
    } });
  }), n2 ? i2(`[data-reveal]`).forEach((e22) => e22.classList.add(`is-in`)) : Q.batch(`[data-reveal]`, { start: `top 90%`, once: true, onEnter: (e22) => e22.forEach((e23, t3) => setTimeout(() => e23.classList.add(`is-in`), t3 * 110)) });
  let y2 = r2(`[data-cta-media]`), b2 = y2 && r2(`[data-bg-video]`, y2);
  if (b2 && b2.dataset.mp4 && e21.level >= 1) {
    let e22 = false;
    new IntersectionObserver((t3) => t3.forEach((t4) => {
      if (t4.isIntersecting) {
        if (!e22) {
          e22 = true;
          let n3 = document.createElement(`source`);
          n3.src = b2.dataset.mp4, n3.type = `video/mp4`, b2.append(n3), b2.load();
        }
        b2.play().then(() => y2.classList.add(`is-playing`)).catch(() => {
        });
      } else b2.pause();
    }), { rootMargin: `200px 0px` }).observe(y2);
  }
  let x2 = r2(`[data-theme]`);
  x2 && o2 && o2.classList.toggle(`is-light`, x2.dataset.theme === `dark`), o2 && i2(`[data-theme]`).forEach((e22) => {
    Q.create({ trigger: e22, start: `top 40px`, end: `bottom 40px`, onToggle: (t3) => {
      t3.isActive && o2.classList.toggle(`is-light`, e22.dataset.theme === `dark`);
    } });
  });
  let S2 = r2(`[data-year]`);
  return S2 && (S2.textContent = String((/* @__PURE__ */ new Date()).getFullYear())), Q.sort(), addEventListener(`load`, () => Q.refresh()), location.hash === `#debug` && (window.ST = Q), { lenis: a2 };
}
function Mf() {
  if (!matchMedia(`(pointer: fine)`).matches) return;
  let e21 = document.querySelector(`.cursor`);
  if (!e21) return;
  let t2 = e21.querySelector(`.cursor__label`), n2 = innerWidth / 2, r2 = innerHeight / 2, i2 = n2, a2 = r2, o2 = false;
  addEventListener(`pointermove`, (t3) => {
    n2 = t3.clientX, r2 = t3.clientY, o2 || (o2 = true, e21.classList.add(`is-on`));
  }, { passive: true }), document.documentElement.addEventListener(`mouseleave`, () => {
    o2 = false, e21.classList.remove(`is-on`);
  }), hi.ticker.add(() => {
    i2 += (n2 - i2) * 0.22, a2 += (r2 - a2) * 0.22, e21.style.transform = `translate3d(${i2}px, ${a2}px, 0) translate(-50%, -50%)`;
  }), document.querySelectorAll(`[data-cursor]`).forEach((n3) => {
    let r3 = n3.dataset.cursor;
    n3.addEventListener(`pointerenter`, () => {
      e21.classList.add(`is-` + r3), r3 === `play` && (t2.textContent = `Play`);
    }), n3.addEventListener(`pointerleave`, () => e21.classList.remove(`is-` + r3));
  });
}
function Nf() {
  if (!matchMedia(`(pointer: fine)`).matches) return;
  let e21 = document.body, t2 = null, n2 = () => {
    t2 && (t2.classList.remove(`is-open`), t2 = null, e21.classList.remove(`is-framed`));
  };
  document.querySelectorAll(`[data-shield]`).forEach((r2) => {
    let i2 = 0, a2 = () => {
      clearTimeout(i2), t2 !== r2 && n2(), t2 = r2, r2.classList.add(`is-open`), e21.classList.add(`is-framed`);
    }, o2 = () => {
      clearTimeout(i2), i2 = setTimeout(a2, 320);
    };
    r2.addEventListener(`pointerenter`, o2), r2.addEventListener(`wheel`, o2, { passive: true }), r2.addEventListener(`pointerleave`, () => clearTimeout(i2)), r2.addEventListener(`pointerdown`, a2);
  }), addEventListener(`pointermove`, (e22) => {
    t2 && e22.target.tagName !== `IFRAME` && n2();
  }, { passive: true });
}
function Pf() {
  let e21 = document.querySelector(`form[data-mailto]`);
  if (!e21) return;
  let t2 = e21.querySelector(`.form__note`), n2 = e21.dataset.phone || ``;
  e21.addEventListener(`submit`, (r2) => {
    r2.preventDefault();
    let i2 = new FormData(e21), a2 = (e22) => String(i2.get(e22) || ``).trim(), o2 = `Quote request: ${a2(`project`)}${a2(`name`) ? ` for ` + a2(`name`) : ``}`, s2 = [`Job: ${a2(`project`)}`, `Name: ${a2(`name`)}`, `Phone: ${a2(`phone`)}`, a2(`email`) && `Email: ${a2(`email`)}`, a2(`zip`) && `ZIP code: ${a2(`zip`)}`, a2(`message`) && `
${a2(`message`)}`].filter(Boolean);
    location.href = `mailto:${e21.dataset.mailto}?subject=${encodeURIComponent(o2)}&body=${encodeURIComponent(s2.join(`
`))}`, t2 && (t2.textContent = `Your email app should open with the request ready to send. If it does not, call ${n2}.`);
  });
}
// Started by script.js once the page's builder hooks are in place (see the top of script.js).
function sdStart() {
document.documentElement.classList.add(`js`);
var Ff = gi();
document.body.dataset.tier = String(Ff.level), location.hash === `#debug` && (console.info(`[tier]`, Ff), window.__gsap = hi);
var If = vi({ el: document.querySelector(`[data-hero]`), tier: Ff }), Lf = null;
if (Ff.level > 0) {
  let e21 = performance.now();
  Lf = Ks({ canvas: document.getElementById(`gl`), tier: Ff, hero: If }), Lf || (document.body.dataset.tier = `0`), location.hash === `#debug` && console.info(`[gl init]`, Math.round(performance.now() - e21), `ms`);
}
var { lenis: Rf } = jf({ tier: Ff, hero: If });
Mf(), Nf(), Pf(), hi.ticker.add((e21, t2) => {
  If.tick(), Lf && (Lf.state.velocity = Rf ? Rf.velocity : 0, Lf.render(e21, t2));
}), Lf && _i(hi.ticker, (e21, t2) => {
  e21 === 1 ? (Lf.setQuality({ dpr: 1, dust: false, grain: 0 }), console.info(`[perf] lowered GL quality`, t2)) : (Lf.disable(), document.body.dataset.tier = `0`, console.info(`[perf] GL disabled`, t2));
}), document.addEventListener(`visibilitychange`, () => {
  document.hidden ? hi.ticker.sleep() : hi.ticker.wake();
});
window.SDHomeEngine.lenis = Rf || null;
}
window.SDHomeEngine = { start: sdStart, lenis: null };
