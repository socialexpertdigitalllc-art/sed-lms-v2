/**
 * The LMS runs on the COMPANY's timezone (app_settings.work_timezone — Pacific
 * time, America/Los_Angeles) and the SERVER's clock — never on whatever
 * timezone or clock a person's computer happens to have.
 *
 * Why: agents' devices had different timezones and clocks, so the same lead's
 * follow-up read differently on different screens, and "overdue" flipped at
 * different moments for different people.
 *
 * How:
 *   - The server process runs with TZ set to the company timezone
 *     (instrumentation.ts, next.config.ts, ecosystem.config.cjs, and the root
 *     layout keeps it in step with the setting), so everything it renders and
 *     every "today" it computes is company time.
 *   - In the browser, `installCompanyTime` runs before any app code (root
 *     layout, next/script beforeInteractive) and makes the page's own Date and
 *     Intl behave as if the device were in the company timezone with a
 *     correct clock:
 *       · every date shown (toLocaleString, Intl.DateTimeFormat, toString) is
 *         company time unless a timeZone is asked for explicitly (a lead's
 *         own local time keeps its zone);
 *       · a time typed in ("2026-11-13T15:00", new Date(2026, 10, 13, 15))
 *         means that time in the company timezone;
 *       · getHours / setHours / "today" / "end of day" are company time;
 *       · new Date() and Date.now() are the server's clock (the page is
 *         stamped with the server time; ServerClockSync keeps it right).
 *     Daylight saving is handled: offsets come from the browser's own
 *     timezone database for each moment (PST in winter, PDT in summer).
 *
 * `installCompanyTime` is turned into a string and put in the page, so it must
 * stay SELF-CONTAINED: it may reference nothing outside its own body.
 */

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

/* eslint-disable @typescript-eslint/no-explicit-any, prefer-rest-params, prefer-spread, no-var */
export function installCompanyTime(g: any, serverNow?: number | null, timeZone?: string): void {
  var D = g.Date;
  var I = g.Intl;
  if (!D || !I || !I.DateTimeFormat) return;
  if (D.__ctInstalled) {
    // Already on company time: only take the newer server clock.
    if (typeof serverNow === "number" && isFinite(serverNow)) D.__ctSetServerNow(serverNow);
    return;
  }
  var TZ = typeof timeZone === "string" && timeZone ? timeZone : "America/Los_Angeles";
  var DTF = I.DateTimeFormat;
  try {
    new DTF("en-US", { timeZone: TZ });
  } catch {
    return; // an unknown zone: leave the page on device time rather than break it
  }
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

  /* ---- the zone's offset at a moment (ms; wall clock = instant + offset) */
  var partsFmt = new DTF("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  var nameFmt = new DTF("en-US", { timeZone: TZ, timeZoneName: "long" });
  var BUCKET = 900000; // offsets only change on quarter hours, so cache per quarter hour
  var cache: Record<string, number> = {};
  var cached = 0;
  var offsetAt = function (t: number) {
    if (!isFinite(t)) return 0;
    var k = Math.floor(t / BUCKET);
    var hit = cache[k];
    if (hit !== undefined) return hit;
    var base = k * BUCKET;
    var parts = partsFmt.formatToParts(new D(base));
    var f: Record<string, string> = {};
    for (var i = 0; i < parts.length; i++) f[parts[i].type] = parts[i].value;
    var year = Number(f.year);
    if (f.era === "BC" || f.era === "B") year = 1 - year;
    var wall = realUTC(year, Number(f.month) - 1, Number(f.day), Number(f.hour) % 24, Number(f.minute), Number(f.second));
    var off = wall - base;
    if (cached > 20000) {
      cache = {};
      cached = 0;
    }
    cache[k] = off;
    cached++;
    return off;
  };
  // A wall-clock time (as if it were UTC) → the moment it names in the zone.
  // Twice-occurring times (clocks going back) take the earlier; skipped
  // times (clocks going forward) move forward, as the platform does.
  var wallToInstant = function (wall: number) {
    if (!isFinite(wall)) return NaN;
    var before = offsetAt(wall - 86400000);
    var after = offsetAt(wall + 86400000);
    var best = NaN;
    [before, after].forEach(function (o) {
      var t = wall - o;
      if (offsetAt(t) === o && (isNaN(best) || t < best)) best = t;
    });
    return isNaN(best) ? wall - before : best;
  };

  // Company wall time = the UTC fields of (instant + offset). One scratch date, reused.
  var tmp = new D(0);
  var shifted = function (d: any) {
    var t = orig.getTime.call(d);
    orig.setTime.call(tmp, t + offsetAt(t));
    return tmp;
  };
  var def = function (name: string, fn: any) {
    Object.defineProperty(P, name, { value: fn, writable: true, configurable: true, enumerable: false });
  };

  /* ---- reading the wall clock: getHours, getDate… in company time */
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
    var t = orig.getTime.call(this);
    return isNaN(t) ? NaN : -offsetAt(t) / 60000;
  });

  /* ---- setting the wall clock: setHours(23, 59…) is the company's end of day */
  var setters: Record<string, string> = {
    setFullYear: "setUTCFullYear", setMonth: "setUTCMonth", setDate: "setUTCDate", setHours: "setUTCHours",
    setMinutes: "setUTCMinutes", setSeconds: "setUTCSeconds", setMilliseconds: "setUTCMilliseconds",
  };
  Object.keys(setters).forEach(function (k) {
    var u = orig[setters[k]];
    def(k, function (this: any) {
      var t = orig.getTime.call(this);
      var wall: number;
      if (isNaN(t)) {
        if (k !== "setFullYear") return NaN;
        wall = 0; // the spec starts an invalid date's setFullYear at local midnight 1970-01-01
      } else wall = t + offsetAt(t);
      var scratch = new D(wall);
      var r = u.apply(scratch, arguments);
      var next = isNaN(r) ? NaN : wallToInstant(r);
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
  var names: Record<string, string> = {};
  var zoneName = function (t: number) {
    var off = offsetAt(t);
    if (names[off] === undefined) {
      var parts = nameFmt.formatToParts(new D(t));
      var n = "";
      for (var i = 0; i < parts.length; i++) if (parts[i].type === "timeZoneName") n = parts[i].value;
      names[off] = n;
    }
    return names[off];
  };
  var datePart = function (s: any) {
    return DAYS[orig.getUTCDay.call(s)] + " " + MONTHS[orig.getUTCMonth.call(s)] + " " + pad(orig.getUTCDate.call(s)) + " " + pad(orig.getUTCFullYear.call(s), 4);
  };
  var timePart = function (s: any, t: number) {
    var mins = Math.round(offsetAt(t) / 60000);
    var gmt = "GMT" + (mins < 0 ? "-" : "+") + pad(Math.floor(Math.abs(mins) / 60)) + pad(Math.abs(mins) % 60);
    var name = zoneName(t);
    return pad(orig.getUTCHours.call(s)) + ":" + pad(orig.getUTCMinutes.call(s)) + ":" + pad(orig.getUTCSeconds.call(s)) + " " + gmt + (name ? " (" + name + ")" : "");
  };
  def("toString", function (this: any) {
    var t = orig.getTime.call(this);
    if (isNaN(t)) return "Invalid Date";
    var s = shifted(this);
    return datePart(s) + " " + timePart(s, t);
  });
  def("toDateString", function (this: any) {
    return isNaN(orig.getTime.call(this)) ? "Invalid Date" : datePart(shifted(this));
  });
  def("toTimeString", function (this: any) {
    var t = orig.getTime.call(this);
    return isNaN(t) ? "Invalid Date" : timePart(shifted(this), t);
  });

  /* ---- formatting: company time unless a timeZone is asked for */
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
  var PkDTF: any = function DateTimeFormat(locales: any, opts: any) {
    return new DTF(locales, withTz(opts));
  };
  PkDTF.prototype = DTF.prototype;
  PkDTF.supportedLocalesOf = DTF.supportedLocalesOf;
  I.DateTimeFormat = PkDTF;

  /* ---- reading text: a time with no zone means company time */
  var LOCAL_ISO = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)$/;
  var DATE_ONLY_ISO = /^[+-]?\d{4,6}(?:-\d{2}(?:-\d{2})?)?$/;
  var parse = function (input: any) {
    var s = String(input).trim();
    var m = LOCAL_ISO.exec(s);
    if (m) return wallToInstant(realParse(m[1] + "T" + m[2] + "Z"));
    // Date-only ISO is UTC by the standard; anything naming its zone keeps it.
    if (DATE_ONLY_ISO.test(s) || /GMT|UTC/i.test(s) || /\d:\d{2}(?::\d{2}(?:\.\d+)?)?\s*(?:Z|[+-]\d{2}:?\d{2})(?:\s|$)/i.test(s)) return realParse(s);
    // Other text ("Nov 13, 2026 3:00 PM"): the engine read it as device time;
    // take those same wall-clock fields as company time.
    var t = realParse(s);
    if (isNaN(t)) return t;
    return wallToInstant(t - orig.getTimezoneOffset.call(new D(t)) * 60000);
  };

  /* ---- the clock and the constructor */
  var CoDate: any = function Date(this: any) {
    var n = arguments.length;
    if (!new.target) return new CoDate().toString();
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
      // new Date(y, m, d, h, mi, s, ms): those fields in company time
      t = wallToInstant(realUTC.apply(null, arguments));
    }
    return Reflect.construct(D, [t], new.target);
  };
  CoDate.prototype = P;
  Object.setPrototypeOf(CoDate, D);
  CoDate.now = now;
  CoDate.parse = parse;
  CoDate.UTC = realUTC;
  try {
    Object.defineProperty(CoDate, "length", { value: 7 });
  } catch {
    /* cosmetic */
  }
  def("constructor", CoDate);
  CoDate.__ctInstalled = true;
  CoDate.__ctTimeZone = TZ;
  // The server's clock, now (ms). Small differences (< minChangeMs) are left alone.
  CoDate.__ctSetServerNow = function (ms: number, minChangeMs?: number) {
    if (typeof ms !== "number" || !isFinite(ms)) return;
    var next = ms - realNow();
    if (Math.abs(next - skew) >= (minChangeMs || 0)) skew = next;
  };
  CoDate.__ctSkew = function () {
    return skew;
  };
  g.Date = CoDate;
}
/* eslint-enable @typescript-eslint/no-explicit-any, prefer-rest-params, prefer-spread, no-var */

/** The page's first script: company time, stamped with the server's clock. */
export function companyTimeScript(serverNow: number, timeZone: string): string {
  return `try{(${installCompanyTime.toString()})(window,${Math.round(serverNow)},${JSON.stringify(timeZone)})}catch(e){console.error("[company-time]",e)}`;
}

/** Ask the page's clock to follow the server's (see components/time/ServerClockSync.tsx). */
export function setServerNow(ms: number, minChangeMs = 0): void {
  const D = globalThis.Date as unknown as { __ctSetServerNow?: (ms: number, min?: number) => void };
  D.__ctSetServerNow?.(ms, minChangeMs);
}

/** Keep THIS server process on the company timezone (Node applies a TZ change at once). */
export function applyServerTimezone(timeZone: string): void {
  if (process.env.TZ !== timeZone) process.env.TZ = timeZone;
}
