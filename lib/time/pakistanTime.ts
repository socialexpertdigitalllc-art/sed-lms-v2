/**
 * The LMS runs on Pakistan time (Asia/Karachi, UTC+5) and the SERVER's clock —
 * never on whatever timezone or clock a person's computer happens to have.
 *
 * Why: agents' devices had different timezones and clocks, so the same lead's
 * follow-up read 3 PM on one screen and 6 AM on another, and "overdue" flipped
 * at different moments for different people.
 *
 * How:
 *   - The server process runs with TZ=Asia/Karachi (instrumentation.ts,
 *     next.config.ts, ecosystem.config.cjs), so everything it renders and
 *     computes is Pakistan time.
 *   - In the browser, `installPakistanTime` runs before any app code (root
 *     layout, next/script beforeInteractive). It makes the page's own Date and
 *     Intl behave as if the device were in Pakistan with a correct clock:
 *       · every date shown (toLocaleString, Intl.DateTimeFormat, toString)
 *         is Pakistan time unless a timeZone is asked for explicitly;
 *       · a time typed in ("2026-11-13T15:00", new Date(2026, 10, 13, 15))
 *         means 3 PM in Pakistan;
 *       · getHours / setHours / "today" / "end of day" are Pakistan time;
 *       · new Date() and Date.now() are the server's clock (the page is
 *         stamped with the server time; ServerClockSync keeps it right).
 *     Pakistan has had no daylight saving since 2009, so UTC+5 is exact.
 *
 * `installPakistanTime` is turned into a string and put in the page, so it
 * must stay SELF-CONTAINED: it may reference nothing outside its own body.
 */

export const PK_TZ = "Asia/Karachi";
export const PK_OFFSET_MS = 5 * 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any, prefer-rest-params, prefer-spread, no-var */
export function installPakistanTime(g: any, serverNow?: number | null): void {
  var D = g.Date;
  if (!D) return;
  if (D.__pkInstalled) {
    // Already on Pakistan time: only take the newer server clock.
    if (typeof serverNow === "number" && isFinite(serverNow)) D.__pkSetServerNow(serverNow);
    return;
  }
  var TZ = "Asia/Karachi";
  var OFF = 18000000; // UTC+5 in ms; Pakistan keeps no daylight saving
  var P = D.prototype;
  var realNow = function () {
    return D.now();
  };
  var skew = 0;
  if (typeof serverNow === "number" && isFinite(serverNow)) skew = serverNow - realNow();
  var now = function () {
    return realNow() + skew;
  };

  var orig: Record<string, any> = {};
  [
    "getTime", "setTime", "getTimezoneOffset",
    "getUTCFullYear", "getUTCMonth", "getUTCDate", "getUTCDay", "getUTCHours", "getUTCMinutes", "getUTCSeconds", "getUTCMilliseconds",
    "setUTCFullYear", "setUTCMonth", "setUTCDate", "setUTCHours", "setUTCMinutes", "setUTCSeconds", "setUTCMilliseconds",
    "toLocaleString", "toLocaleDateString", "toLocaleTimeString",
  ].forEach(function (k) {
    orig[k] = P[k];
  });
  var realParse = D.parse;
  var realUTC = D.UTC;

  // Pakistan wall time = the UTC fields of (instant + 5h). One scratch date, reused.
  var tmp = new D(0);
  var shifted = function (d: any) {
    orig.setTime.call(tmp, orig.getTime.call(d) + OFF);
    return tmp;
  };
  var def = function (name: string, fn: any) {
    Object.defineProperty(P, name, { value: fn, writable: true, configurable: true, enumerable: false });
  };

  /* ---- reading the wall clock: getHours, getDate… in Pakistan time */
  var getters: Record<string, string> = {
    getFullYear: "getUTCFullYear", getMonth: "getUTCMonth", getDate: "getUTCDate", getDay: "getUTCDay",
    getHours: "getUTCHours", getMinutes: "getUTCMinutes", getSeconds: "getUTCSeconds", getMilliseconds: "getUTCMilliseconds",
  };
  Object.keys(getters).forEach(function (k) {
    var u = orig[getters[k]];
    def(k, function (this: any) {
      return u.call(shifted(this));
    });
  });
  def("getYear", function (this: any) {
    return this.getFullYear() - 1900;
  });
  def("getTimezoneOffset", function (this: any) {
    return isNaN(orig.getTime.call(this)) ? NaN : -300;
  });

  /* ---- setting the wall clock: setHours(23, 59…) is Pakistan's end of day */
  var setters: Record<string, string> = {
    setFullYear: "setUTCFullYear", setMonth: "setUTCMonth", setDate: "setUTCDate", setHours: "setUTCHours",
    setMinutes: "setUTCMinutes", setSeconds: "setUTCSeconds", setMilliseconds: "setUTCMilliseconds",
  };
  Object.keys(setters).forEach(function (k) {
    var u = orig[setters[k]];
    def(k, function (this: any) {
      var t = orig.getTime.call(this);
      if (isNaN(t)) {
        if (k !== "setFullYear") return NaN;
        t = -OFF; // the spec starts an invalid date's setFullYear at local midnight 1970-01-01
      }
      var scratch = new D(t + OFF);
      var r = u.apply(scratch, arguments);
      var next = isNaN(r) ? NaN : r - OFF;
      orig.setTime.call(this, next);
      return next;
    });
  });

  /* ---- words: toString(), toDateString(), toTimeString() */
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var pad = function (n: number, w?: number) {
    var s = String(Math.abs(n));
    while (s.length < (w || 2)) s = "0" + s;
    return n < 0 ? "-" + s : s;
  };
  var datePart = function (s: any) {
    return DAYS[orig.getUTCDay.call(s)] + " " + MONTHS[orig.getUTCMonth.call(s)] + " " + pad(orig.getUTCDate.call(s)) + " " + pad(orig.getUTCFullYear.call(s), 4);
  };
  var timePart = function (s: any) {
    return pad(orig.getUTCHours.call(s)) + ":" + pad(orig.getUTCMinutes.call(s)) + ":" + pad(orig.getUTCSeconds.call(s)) + " GMT+0500 (Pakistan Standard Time)";
  };
  def("toString", function (this: any) {
    if (isNaN(orig.getTime.call(this))) return "Invalid Date";
    var s = shifted(this);
    return datePart(s) + " " + timePart(s);
  });
  def("toDateString", function (this: any) {
    return isNaN(orig.getTime.call(this)) ? "Invalid Date" : datePart(shifted(this));
  });
  def("toTimeString", function (this: any) {
    return isNaN(orig.getTime.call(this)) ? "Invalid Date" : timePart(shifted(this));
  });

  /* ---- formatting: Pakistan time unless a timeZone is asked for */
  var withTz = function (opts: any) {
    if (opts && typeof opts === "object" && opts.timeZone) return opts;
    var o: Record<string, unknown> = {};
    if (opts && typeof opts === "object") for (var key in opts) o[key] = opts[key];
    o.timeZone = TZ;
    return o;
  };
  ["toLocaleString", "toLocaleDateString", "toLocaleTimeString"].forEach(function (k) {
    var f = orig[k];
    def(k, function (this: any, locales: any, opts: any) {
      return f.call(this, locales, withTz(opts));
    });
  });
  var I = g.Intl;
  if (I && I.DateTimeFormat && !I.DateTimeFormat.__pkInstalled) {
    var DTF = I.DateTimeFormat;
    var PkDTF: any = function DateTimeFormat(locales: any, opts: any) {
      return new DTF(locales, withTz(opts));
    };
    PkDTF.prototype = DTF.prototype;
    PkDTF.supportedLocalesOf = DTF.supportedLocalesOf;
    PkDTF.__pkInstalled = true;
    I.DateTimeFormat = PkDTF;
  }

  /* ---- reading text: a time with no zone means Pakistan time */
  var LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/;
  var DATE_ONLY_ISO = /^[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?$/;
  var parse = function (input: any) {
    var s = String(input).trim();
    var m = LOCAL_ISO.exec(s);
    if (m) return realParse(m[1] + "T" + m[2] + "+05:00");
    // Date-only ISO is UTC by the standard; anything naming its zone keeps it.
    if (DATE_ONLY_ISO.test(s) || /GMT|UTC/i.test(s) || /\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})(?:\s|$)/i.test(s)) return realParse(s);
    // Other text ("Nov 13, 2026 3:00 PM"): the engine read it as device time;
    // move those same wall-clock fields to Pakistan.
    var t = realParse(s);
    if (isNaN(t)) return t;
    return t - orig.getTimezoneOffset.call(new D(t)) * 60000 - OFF;
  };

  /* ---- the clock and the constructor */
  var PkDate: any = function Date(this: any) {
    var n = arguments.length;
    if (!new.target) return new PkDate().toString();
    var t: any;
    if (n === 0) t = now();
    else if (n === 1) {
      var a = arguments[0];
      if (a instanceof D) t = orig.getTime.call(a);
      else if (typeof a === "string") t = parse(a);
      else if (a !== null && typeof a === "object") {
        var p = a.valueOf();
        if (p !== null && typeof p === "object") p = String(a);
        t = typeof p === "string" ? parse(p) : p;
      } else t = a;
    } else {
      // new Date(y, m, d, h, mi, s, ms): those fields in Pakistan time
      t = realUTC.apply(null, arguments) - OFF;
    }
    return Reflect.construct(D, [t], new.target);
  };
  PkDate.prototype = P;
  Object.setPrototypeOf(PkDate, D);
  PkDate.now = now;
  PkDate.parse = parse;
  PkDate.UTC = realUTC;
  try {
    Object.defineProperty(PkDate, "length", { value: 7 });
  } catch {
    /* cosmetic */
  }
  def("constructor", PkDate);
  PkDate.__pkInstalled = true;
  // The server's clock, now (ms). Small differences (< minChangeMs) are left alone.
  PkDate.__pkSetServerNow = function (ms: number, minChangeMs?: number) {
    if (typeof ms !== "number" || !isFinite(ms)) return;
    var next = ms - realNow();
    if (Math.abs(next - skew) >= (minChangeMs || 0)) skew = next;
  };
  PkDate.__pkSkew = function () {
    return skew;
  };
  g.Date = PkDate;
}
/* eslint-enable @typescript-eslint/no-explicit-any, prefer-rest-params, prefer-spread, no-var */

/** The page's first script: Pakistan time, stamped with the server's clock. */
export function pakistanTimeScript(serverNow: number): string {
  return `try{(${installPakistanTime.toString()})(window,${Math.round(serverNow)})}catch(e){console.error("[pakistan-time]",e)}`;
}

/** Ask the page's clock to follow the server's (see components/time/ServerClockSync.tsx). */
export function setServerNow(ms: number, minChangeMs = 0): void {
  const D = globalThis.Date as unknown as { __pkSetServerNow?: (ms: number, min?: number) => void };
  D.__pkSetServerNow?.(ms, minChangeMs);
}
