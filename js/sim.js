/*
 * Holding Pattern simulation engine.
 *
 * Everything lives inside createTowerEngine() and refers to nothing outside
 * it. That is deliberate: the browser turns this function into text and runs
 * it inside a Web Worker, and Node can require it for headless test runs.
 *
 * The simulation is deterministic. One tick is one simulated second. The same
 * schedule and the same tower code always produce the same score.
 */
(function (root) {
  function createTowerEngine() {
    'use strict';

    var C = {
      W: 48, H: 32,              // airspace size, nautical miles
      SEP: 3,                    // two airborne planes closer than this = collision
      SPEED: 220,                // default speed, knots
      SPEED_MIN: 160,
      SPEED_MAX: 220,
      TURN: 6 * Math.PI / 180,   // turn rate, radians per second
      CAPTURE: 0.7,              // how close counts as "reached the fix", nm
      LAND_ROLL: 45,             // seconds a landing occupies the runway
      TAKEOFF_ROLL: 40,          // seconds a takeoff occupies the runway
      FUEL_CRUISE: 0.7,          // kg per second at default speed
      FUEL_IDLE: 0.1,            // kg per second waiting at the gate or rolling out
      FUEL_TAKEOFF: 1.4,         // kg per second during the takeoff roll
      PEN_COLLISION: 1000,
      PEN_UNFINISHED: 2000,
      OVERTIME: 1200,            // seconds allowed after the last scheduled flight
      MAX_LOG: 400
    };

    var RWY = { name: '09', x1: 22.5, y1: 16, x2: 25.5, y2: 16 };
    var FAF = { name: 'FINAL', x: 15.5, y: 16 };
    var FIXES = {
      KRANE: { x: 0, y: 8, type: 'entry' },
      DUSTY: { x: 0, y: 24, type: 'entry' },
      NORDO: { x: 12, y: 0, type: 'entry' },
      BAYOU: { x: 12, y: 32, type: 'entry' },
      ECHOS: { x: 48, y: 3, type: 'entry', via: ['BASEN'] },
      BASEN: { x: 16, y: 8.5, type: 'waypoint' },
      SUNUP: { x: 48, y: 16, type: 'exit' },
      POLAR: { x: 36, y: 0, type: 'exit' },
      TROPC: { x: 36, y: 32, type: 'exit' }
    };

    function dist(ax, ay, bx, by) {
      var dx = ax - bx, dy = ay - by;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function angDiff(a, b) {
      var d = a - b;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return d;
    }

    function mulberry32(a) {
      return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    function fmtTime(s) {
      var m = Math.floor(s / 60), r = Math.floor(s % 60);
      return 'T+' + (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
    }

    /* ---------------------------------------------------------------- planes */

    function newPlane(f, idx) {
      var fix = FIXES[f.fix];
      if (!fix) throw new Error('Unknown fix in schedule: ' + f.fix);
      var p = {
        idx: idx, id: f.id, kind: f.kind, fix: f.fix, t0: f.t,
        state: 'scheduled',
        x: 0, y: 0, h: 0, speed: C.SPEED, cmdSpeed: C.SPEED,
        cleared: false, holdCmd: false, autoHold: false, vec: null,
        route: [], leg: 0,
        rollT: 0, ticks: 0, holdSec: 0, gateSec: 0, fuel: 0,
        ideal: null, alertUntil: -1, view: null
      };
      if (p.kind === 'arrival') {
        p.x = fix.x; p.y = fix.y;
        p.route = (fix.via || []).map(function (n) { return { name: n, x: FIXES[n].x, y: FIXES[n].y }; });
        p.route.push({ name: FAF.name, x: FAF.x, y: FAF.y });
        p.h = Math.atan2(p.route[0].y - fix.y, p.route[0].x - fix.x);
      } else {
        p.x = RWY.x1; p.y = RWY.y1; p.h = 0;
      }
      return p;
    }

    function spawn(p) {
      p.state = p.kind === 'arrival' ? 'inbound' : 'gate';
    }

    function steer(p, tx, ty) {
      var d = angDiff(Math.atan2(ty - p.y, tx - p.x), p.h);
      if (d > C.TURN) d = C.TURN; else if (d < -C.TURN) d = -C.TURN;
      p.h += d;
    }

    function fly(p) {
      var v = p.speed / 3600;
      p.x += Math.cos(p.h) * v;
      p.y += Math.sin(p.h) * v;
      var r = p.speed / C.SPEED;
      p.fuel += C.FUEL_CRUISE * r * r;
    }

    function isHolding(p) {
      return (p.state === 'inbound' || p.state === 'outbound') && (p.holdCmd || p.autoHold);
    }

    /* Moves one plane forward one second. Returns an event name or null. */
    function advance(p) {
      var f;
      p.ticks++;
      switch (p.state) {
        case 'gate':
          if (p.cleared) {
            p.state = 'takeoff'; p.rollT = 0;
            p.x = RWY.x1; p.y = RWY.y1; p.h = 0;
            return 'enterRunway';
          }
          p.gateSec++;
          p.fuel += C.FUEL_IDLE;
          return null;

        case 'takeoff':
          p.rollT++;
          f = p.rollT / C.TAKEOFF_ROLL;
          p.x = RWY.x1 + (RWY.x2 - RWY.x1) * f * f;
          p.fuel += C.FUEL_TAKEOFF;
          if (p.rollT >= C.TAKEOFF_ROLL) {
            p.state = 'outbound'; p.x = RWY.x2; p.speed = p.cmdSpeed;
            return 'leaveRunway';
          }
          return null;

        case 'outbound':
          var ex = FIXES[p.fix];
          if (p.holdCmd) { p.h += C.TURN; p.holdSec++; }
          else if (p.vec) steer(p, p.vec.x, p.vec.y);
          else steer(p, ex.x, ex.y);
          fly(p);
          if (p.vec && !p.holdCmd && dist(p.x, p.y, p.vec.x, p.vec.y) < C.CAPTURE) p.vec = null;
          if (dist(p.x, p.y, ex.x, ex.y) < C.CAPTURE ||
              p.x < 0 || p.y < 0 || p.x > C.W || p.y > C.H) {
            p.state = 'done';
            return 'departed';
          }
          return null;

        case 'inbound':
          var wp = p.route[p.leg];
          if (p.holdCmd || p.autoHold) { p.h += C.TURN; p.holdSec++; }
          else if (p.vec) steer(p, p.vec.x, p.vec.y);
          else steer(p, wp.x, wp.y);
          fly(p);
          if (p.vec) {
            // On a detour: the published route waits until the detour point is reached.
            if (!p.holdCmd && dist(p.x, p.y, p.vec.x, p.vec.y) < C.CAPTURE) p.vec = null;
          } else if (!p.holdCmd && dist(p.x, p.y, wp.x, wp.y) < C.CAPTURE) {
            if (p.leg < p.route.length - 1) p.leg++;
            else if (p.cleared) { p.state = 'final'; p.autoHold = false; }
            else if (!p.autoHold) { p.autoHold = true; return 'autoHold'; }
          }
          return null;

        case 'final':
          steer(p, RWY.x1, RWY.y1);
          fly(p);
          if (dist(p.x, p.y, RWY.x1, RWY.y1) < 0.25 ||
              (p.x >= RWY.x1 && Math.abs(p.y - RWY.y1) < 1)) {
            p.state = 'landing'; p.rollT = 0;
            p.x = RWY.x1; p.y = RWY.y1; p.h = 0;
            return 'enterRunway';
          }
          return null;

        case 'landing':
          p.rollT++;
          f = p.rollT / C.LAND_ROLL;
          p.x = RWY.x1 + (RWY.x2 - RWY.x1) * (2 * f - f * f);
          p.fuel += C.FUEL_IDLE;
          if (p.rollT >= C.LAND_ROLL) { p.state = 'done'; return 'landed'; }
          return null;
      }
      return null;
    }

    /* The time and fuel this flight needs with the sky to itself. */
    function idealFor(f) {
      var p = newPlane(f, -1);
      spawn(p);
      p.cleared = true;
      var n = 0;
      while (p.state !== 'done' && n < 20000) { advance(p); n++; }
      return { dur: p.ticks, fuel: p.fuel };
    }

    /* ----------------------------------------------------- the player's API */

    class Tower {
      onStart(world) {}
      onArrival(plane, world) {}
      onDepartureReady(plane, world) {}
      onTick(world) {}
      onConflict(a, b, world) {}
    }

    function fmtArg(a) {
      if (typeof a === 'string') return a;
      if (a === undefined) return 'undefined';
      if (a === null) return 'null';
      if (typeof a === 'function') return '[function]';
      if (typeof a === 'object') {
        if (a && a.__plane) return String(a);
        try { return JSON.stringify(a); } catch (e) { return String(a); }
      }
      return String(a);
    }

    function num(v) {
      if (!isFinite(v) || Math.floor(v) === v) return String(v);
      return String(+v.toFixed(3));
    }

    /* Turns a logged value into a plain tree the Console can show and expand.
       It is a copy taken at the moment of the log, so it never changes later. */
    function serialize(v, depth, st) {
      var t = typeof v;
      if (v === null) return { t: 'null', v: 'null' };
      if (t === 'undefined') return { t: 'undef', v: 'undefined' };
      if (t === 'string') return { t: 'str', v: v.length > 400 ? v.slice(0, 400) + '...' : v };
      if (t === 'number') return { t: 'num', v: num(v) };
      if (t === 'boolean') return { t: 'bool', v: String(v) };
      if (t === 'function') return { t: 'fn', v: 'function ' + (v.name || '') + '()' };
      if (t !== 'object') return { t: 'str', v: String(v) };
      if (st.seen.indexOf(v) >= 0) return { t: 'ref', v: '[circular]' };
      var isArr = Array.isArray(v), isMap = v instanceof Map, isSet = v instanceof Set;
      var cname = v.constructor && v.constructor.name;
      var node = {
        t: 'obj', arr: isArr, props: null,
        label: isArr ? 'Array(' + v.length + ')' : isMap ? 'Map(' + v.size + ')' :
          isSet ? 'Set(' + v.size + ')' : v.__plane ? 'Plane ' + v.id :
          (cname && cname !== 'Object' ? cname : '')
      };
      if (depth <= 0 || st.budget <= 0) return node;
      node.props = [];
      st.seen.push(v);
      function add(k, val) {
        if (typeof val === 'function') return;
        if (node.props.length >= 60 || st.budget <= 0) { node.more = true; return; }
        st.budget--;
        node.props.push([String(k), serialize(val, depth - 1, st)]);
      }
      try {
        if (isArr) { for (var i = 0; i < v.length; i++) add(i, v[i]); }
        else if (isMap) {
          v.forEach(function (val, key) {
            add(key && typeof key === 'object' ? (key.__plane ? key.id : '[object]') : String(key), val);
          });
        } else if (isSet) { var n = 0; v.forEach(function (val) { add(n++, val); }); }
        else {
          Object.keys(v).forEach(function (k) {
            var val;
            try { val = v[k]; } catch (e) { val = '[error reading value]'; }
            add(k, val);
          });
        }
      } catch (e) { /* show what we have */ }
      st.seen.pop();
      return node;
    }

    function cell(v) {
      if (v === null || v === undefined) return '';
      if (typeof v === 'number') return num(v);
      if (typeof v === 'object') return v.__plane ? v.id : (v.name || (Array.isArray(v) ? '[...]' : '{...}'));
      return String(v);
    }

    function errLine(e) {
      var m = e && e.stack && /(?:<anonymous>|Function):(\d+):(\d+)/.exec(e.stack);
      if (!m) return null;
      var line = parseInt(m[1], 10) - 2;   // new Function() adds two header lines
      return line > 0 ? line : null;
    }

    /* ------------------------------------------------------------ simulation */

    function createSim(level, code) {
      var time = 0, finished = false, collisions = 0, errors = 0;
      var logs = [], dropped = 0, marks = [];
      var warned = {};
      var occupants = [];
      var conflictPairs = {};
      var inConflict = {};
      var landed = 0, departed = 0;

      var planes = level.flights.map(function (f, i) { return newPlane(f, i); });
      planes.forEach(function (p, i) { p.ideal = idealFor(level.flights[i]); });
      var order = planes.slice().sort(function (a, b) { return a.t0 - b.t0 || a.idx - b.idx; });
      var next = 0, active = [];
      var lastT = order.length ? order[order.length - 1].t0 : 0;
      var limit = lastT + C.OVERTIME;
      var nArr = planes.filter(function (p) { return p.kind === 'arrival'; }).length;
      var nDep = planes.length - nArr;

      function log(kind, text, parts, line) {
        if (logs.length >= C.MAX_LOG) { dropped++; return; }
        var entry = { t: time, k: kind, s: text };
        if (parts) entry.parts = parts;
        if (line) entry.line = line;
        logs.push(entry);
      }
      function warnOnce(key, text) {
        if (warned[key]) return;
        warned[key] = true;
        log('warn', text);
      }

      function vstate(p) {
        if (p.state === 'done') return p.kind === 'arrival' ? 'landed' : 'departed';
        return isHolding(p) ? 'holding' : p.state;
      }

      function distToRunway(p) {
        if (p.kind !== 'arrival') return null;
        if (p.state === 'inbound' || p.state === 'scheduled') {
          var d = p.vec
            ? dist(p.x, p.y, p.vec.x, p.vec.y) + dist(p.vec.x, p.vec.y, p.route[p.leg].x, p.route[p.leg].y)
            : dist(p.x, p.y, p.route[p.leg].x, p.route[p.leg].y);
          for (var i = p.leg; i < p.route.length - 1; i++) {
            d += dist(p.route[i].x, p.route[i].y, p.route[i + 1].x, p.route[i + 1].y);
          }
          return d + dist(FAF.x, FAF.y, RWY.x1, RWY.y1);
        }
        if (p.state === 'final') return dist(p.x, p.y, RWY.x1, RWY.y1);
        return 0;
      }

      function makeView(p) {
        var v = {};
        function get(name, fn) {
          Object.defineProperty(v, name, { get: fn, enumerable: true });
        }
        Object.defineProperty(v, '__plane', { value: true });
        get('id', function () { return p.id; });
        get('kind', function () { return p.kind; });
        get('state', function () { return vstate(p); });
        get('x', function () { return p.x; });
        get('y', function () { return p.y; });
        get('heading', function () {
          var d = (p.h * 180 / Math.PI + 90) % 360;
          return d < 0 ? d + 360 : d;
        });
        get('speed', function () { return p.speed; });
        get('cleared', function () { return p.cleared; });
        get('isAirborne', function () {
          return p.state === 'inbound' || p.state === 'final' || p.state === 'outbound';
        });
        get('entry', function () { return p.kind === 'arrival' ? p.fix : null; });
        get('exit', function () { return p.kind === 'departure' ? p.fix : null; });
        get('scheduledAt', function () { return p.t0; });
        get('waited', function () { return p.gateSec + p.holdSec; });
        get('fuelBurned', function () { return p.fuel; });
        get('distanceToRunway', function () { return distToRunway(p); });
        get('vector', function () {
          return p.vec ? { x: p.vec.x, y: p.vec.y } : null;
        });
        get('target', function () {
          if (p.vec && (p.state === 'inbound' || p.state === 'outbound')) {
            return { name: 'DETOUR', x: p.vec.x, y: p.vec.y };
          }
          if (p.kind === 'departure') return fixesView[p.fix];
          if (p.state === 'inbound') return fixesView[p.route[p.leg].name] || world.finalFix;
          return runwayView.threshold;
        });
        get('eta', function () {
          var d = distToRunway(p);
          return d === null ? null : d / (p.speed / 3600);
        });

        v.distanceTo = function (o) {
          if (!o || typeof o.x !== 'number' || typeof o.y !== 'number') return NaN;
          return dist(p.x, p.y, o.x, o.y);
        };
        v.clearToLand = function () {
          if (p.kind !== 'arrival') {
            warnOnce('ctl' + p.id, p.id + ' is a departure. clearToLand() ignored.');
            return false;
          }
          if (p.state === 'done') return false;
          if (!p.cleared) {
            p.cleared = true; p.autoHold = false;
            log('radio', p.id + ', cleared to land runway ' + RWY.name);
          }
          return true;
        };
        v.clearForTakeoff = function () {
          if (p.kind !== 'departure') {
            warnOnce('cft' + p.id, p.id + ' is an arrival. clearForTakeoff() ignored.');
            return false;
          }
          if (p.state !== 'gate') return false;
          if (!p.cleared) {
            p.cleared = true;
            log('radio', p.id + ', runway ' + RWY.name + ', cleared for takeoff');
          }
          return true;
        };
        v.hold = function () {
          if (p.state !== 'inbound' && p.state !== 'outbound') return false;
          if (!p.holdCmd) {
            p.holdCmd = true;
            log('radio', p.id + ', hold present position');
          }
          return true;
        };
        v.resume = function () {
          if (p.holdCmd || p.vec) {
            p.holdCmd = false; p.vec = null;
            log('radio', p.id + ', resume own navigation');
          }
          return true;
        };
        v.flyTo = function (x, y) {
          if (x && typeof x === 'object') { y = x.y; x = x.x; }
          x = Number(x); y = Number(y);
          if (!isFinite(x) || !isFinite(y)) {
            warnOnce('fly' + p.id, 'flyTo() needs x and y in miles, or a point such as world.fixes.POLAR.');
            return false;
          }
          if (p.state !== 'inbound' && p.state !== 'outbound') return false;
          x = Math.max(0.5, Math.min(C.W - 0.5, x));
          y = Math.max(0.5, Math.min(C.H - 0.5, y));
          if (!p.vec || dist(p.vec.x, p.vec.y, x, y) > 0.1) {
            log('radio', p.id + ', fly direct ' + x.toFixed(1) + ', ' + y.toFixed(1));
          }
          p.vec = { x: x, y: y };
          p.autoHold = false;
          return true;
        };
        v.setSpeed = function (kts) {
          kts = Number(kts);
          if (!isFinite(kts)) {
            warnOnce('spd' + p.id, 'setSpeed() needs a number of knots.');
            return p.speed;
          }
          kts = Math.max(C.SPEED_MIN, Math.min(C.SPEED_MAX, kts));
          if (Math.abs(kts - p.cmdSpeed) >= 5) {
            log('radio', p.id + ', speed ' + Math.round(kts) + ' knots');
          }
          p.cmdSpeed = kts;
          if (p.state === 'inbound' || p.state === 'final' || p.state === 'outbound') p.speed = kts;
          return kts;
        };
        v.toString = function () { return p.id; };
        v.toJSON = function () {
          return { id: p.id, kind: p.kind, state: vstate(p),
                   x: +p.x.toFixed(2), y: +p.y.toFixed(2), speed: p.speed };
        };
        return v;
      }
      planes.forEach(function (p) { p.view = makeView(p); });

      var cache = { planes: [], arrivals: [], departures: [], waiting: [] };
      function refreshCache() {
        cache.planes = active.map(function (p) { return p.view; });
        cache.arrivals = active.filter(function (p) { return p.kind === 'arrival'; })
          .map(function (p) { return p.view; });
        cache.departures = active.filter(function (p) { return p.kind === 'departure'; })
          .map(function (p) { return p.view; });
        cache.waiting = active.filter(function (p) { return p.state === 'gate' && !p.cleared; })
          .map(function (p) { return p.view; });
      }

      var runwayView = {
        name: RWY.name,
        threshold: Object.freeze({ x: RWY.x1, y: RWY.y1 }),
        end: Object.freeze({ x: RWY.x2, y: RWY.y2 }),
        get isClear() {
          if (occupants.length) return false;
          for (var i = 0; i < active.length; i++) {
            if (active[i].state === 'gate' && active[i].cleared) return false;
          }
          return true;
        },
        get occupiedBy() { return occupants.length ? occupants[0].view : null; }
      };

      var fixesView = {};
      Object.keys(FIXES).forEach(function (k) {
        fixesView[k] = Object.freeze({ name: k, x: FIXES[k].x, y: FIXES[k].y, type: FIXES[k].type });
      });
      Object.freeze(fixesView);

      var world = {
        get time() { return time; },
        get planes() { return cache.planes.slice(); },
        get arrivals() { return cache.arrivals.slice(); },
        get departures() { return cache.departures.slice(); },
        get waiting() { return cache.waiting.slice(); },
        runway: runwayView,
        fixes: fixesView,
        finalFix: Object.freeze({ name: FAF.name, x: FAF.x, y: FAF.y }),
        separation: C.SEP,
        width: C.W, height: C.H,
        find: function (id) {
          for (var i = 0; i < planes.length; i++) if (planes[i].id === id) return planes[i].view;
          return null;
        }
      };

      /* ---- compile the player's tower ---- */
      var consoleProxy = {};
      ['log', 'info', 'warn', 'error', 'debug'].forEach(function (n) {
        consoleProxy[n] = function () {
          var st = { seen: [], budget: 1500 };
          var parts = Array.prototype.map.call(arguments, function (a) {
            return typeof a === 'string' ? a : serialize(a, 4, st);
          });
          log(n === 'warn' ? 'warn' : n === 'error' ? 'err' : 'out',
            Array.prototype.map.call(arguments, fmtArg).join(' '), parts);
        };
      });
      consoleProxy.table = function (data, cols) {
        var list = Array.isArray(data) ? data
          : data instanceof Map || data instanceof Set ? Array.from(data.values())
          : data && typeof data === 'object' && !data.__plane ? Object.keys(data).map(function (k) { return data[k]; })
          : [data];
        list = list.slice(0, 60);
        if (!Array.isArray(cols) || !cols.length) {
          cols = [];
          list.forEach(function (row) {
            if (!row || typeof row !== 'object') return;
            Object.keys(row).forEach(function (k) {
              var val;
              try { val = row[k]; } catch (e) { return; }
              if (typeof val !== 'function' && cols.indexOf(k) < 0 && cols.length < 9) cols.push(k);
            });
          });
        }
        cols = cols.map(String);
        var rows = list.map(function (row) {
          if (!row || typeof row !== 'object') return [cell(row)];
          return cols.map(function (k) {
            try { return cell(row[k]); } catch (e) { return '?'; }
          });
        });
        log('out', '[table: ' + rows.length + ' rows]', [{ t: 'table', cols: cols.length ? cols : ['value'], rows: rows }]);
      };
      var rng = mulberry32((level.seed | 0) || 1);
      var SafeMath = Object.create(Math);
      SafeMath.random = rng;

      var hidden = ['self', 'globalThis', 'window', 'document', 'postMessage', 'fetch',
        'XMLHttpRequest', 'WebSocket', 'importScripts', 'indexedDB', 'caches', 'navigator',
        'location', 'setTimeout', 'setInterval', 'Worker', 'require', 'process', 'onmessage'];
      var factory = new Function(['Tower', 'console', 'Math'].concat(hidden).join(','),
        code + '\n;return (typeof MyTower !== "undefined") ? MyTower : null;');
      var Cls = factory(Tower, consoleProxy, SafeMath);
      if (typeof Cls !== 'function') {
        throw new Error('No class named MyTower found. Your file must contain: ' +
          'class MyTower extends Tower { ... }');
      }
      var tower = new Cls();

      function call(name, a, b, c) {
        var fn = tower[name];
        if (typeof fn !== 'function') return;
        try { fn.call(tower, a, b, c); }
        catch (e) {
          errors++;
          if (errors <= 20) {
            var line = errLine(e);
            log('err', 'Exception in MyTower.' + name + '(): ' +
              (e && e.name ? e.name + ': ' : '') + (e && e.message !== undefined ? e.message : e) +
              (line ? '  (line ' + line + ')' : ''), null, line);
          } else if (errors === 21) {
            log('err', 'Further exceptions are not shown.');
          }
        }
      }

      function mark(x, y) {
        if (marks.length < 200) marks.push({ x: +x.toFixed(2), y: +y.toFixed(2) });
      }

      function tick() {
        var i, j, p, q, ev;

        // 1. scheduled flights appear
        while (next < order.length && order[next].t0 <= time) {
          p = order[next++];
          spawn(p);
          active.push(p);
          refreshCache();
          if (p.kind === 'arrival') {
            log('sys', p.id + ' inbound from ' + p.fix);
            call('onArrival', p.view, world);
          } else {
            log('sys', p.id + ' ready at the gate, departing via ' + p.fix);
            call('onDepartureReady', p.view, world);
          }
        }
        if (time === 0) { refreshCache(); }

        // 2. the tower thinks
        refreshCache();
        call('onTick', world);

        // 3. everything moves
        var finishedNow = false;
        for (i = 0; i < active.length; i++) {
          p = active[i];
          ev = advance(p);
          if (!ev) continue;
          if (ev === 'enterRunway') {
            if (occupants.length) {
              collisions++;
              p.alertUntil = time + 20;
              occupants.forEach(function (o) { o.alertUntil = time + 20; });
              mark(RWY.x1 + 0.4, RWY.y1);
              log('crash', 'COLLISION on runway ' + RWY.name + ': ' + p.id + ' and ' +
                occupants.map(function (o) { return o.id; }).join(', '));
              call('onConflict', p.view, occupants[0].view, world);
            }
            occupants.push(p);
          } else if (ev === 'leaveRunway') {
            occupants.splice(occupants.indexOf(p), 1);
          } else if (ev === 'landed') {
            occupants.splice(occupants.indexOf(p), 1);
            landed++; finishedNow = true;
            log('sys', p.id + ' landed');
          } else if (ev === 'departed') {
            departed++; finishedNow = true;
            log('sys', p.id + ' left the airspace via ' + p.fix);
          } else if (ev === 'autoHold') {
            log('warn', p.id + ' reached FINAL without landing clearance and is circling there.');
          }
        }
        if (finishedNow) active = active.filter(function (a) { return a.state !== 'done'; });

        // 4. separation between everything in the air
        var air = active.filter(function (a) {
          return a.state === 'inbound' || a.state === 'final' || a.state === 'outbound';
        });
        var nowPairs = {};
        inConflict = {};
        for (i = 0; i < air.length; i++) {
          for (j = i + 1; j < air.length; j++) {
            p = air[i]; q = air[j];
            var d = dist(p.x, p.y, q.x, q.y);
            if (d < C.SEP) {
              var key = p.idx < q.idx ? p.idx + '|' + q.idx : q.idx + '|' + p.idx;
              nowPairs[key] = true;
              inConflict[p.idx] = true; inConflict[q.idx] = true;
              if (!conflictPairs[key]) {
                collisions++;
                mark((p.x + q.x) / 2, (p.y + q.y) / 2);
                log('crash', 'COLLISION: ' + p.id + ' and ' + q.id + ' are ' + d.toFixed(1) +
                  ' nm apart (minimum ' + C.SEP + ')');
                call('onConflict', p.view, q.view, world);
              }
            }
          }
        }
        conflictPairs = nowPairs;

        time++;
        if (next >= order.length && active.length === 0) finished = true;
        else if (time >= limit) {
          finished = true;
          log('warn', 'Time limit reached with ' + active.length + ' flight(s) still in the system.');
        }
      }

      function result() {
        var delay = 0, extra = 0, unfinished = 0, fuel = 0;
        planes.forEach(function (p) {
          fuel += p.fuel;
          if (p.state === 'done') {
            delay += Math.max(0, p.ticks - p.ideal.dur);
            extra += Math.max(0, p.fuel - p.ideal.fuel);
          } else unfinished++;
        });
        var delayPts = Math.round(delay), fuelPts = Math.round(extra / 2);
        return {
          flights: planes.length, handled: planes.length - unfinished, unfinished: unfinished,
          collisions: collisions, delaySec: Math.round(delay), extraFuel: Math.round(extra),
          fuel: Math.round(fuel), errors: errors,
          delayPts: delayPts, fuelPts: fuelPts,
          collisionPts: collisions * C.PEN_COLLISION, unfinishedPts: unfinished * C.PEN_UNFINISHED,
          score: delayPts + fuelPts + collisions * C.PEN_COLLISION + unfinished * C.PEN_UNFINISHED,
          time: time
        };
      }

      function snapshot() {
        var delay = 0, fuel = 0;
        var flights = planes.map(function (p) {
          var d;
          fuel += p.fuel;
          if (p.state === 'done') d = Math.max(0, p.ticks - p.ideal.dur);
          else d = p.gateSec + p.holdSec;
          delay += d;
          return [p.state === 'scheduled' ? 'scheduled' : vstate(p), d];
        });
        return {
          time: time, done: finished,
          planes: active.filter(function (p) { return p.state !== 'gate'; }).map(function (p) {
            return {
              id: p.id, kind: p.kind, st: vstate(p),
              x: +p.x.toFixed(3), y: +p.y.toFixed(3), h: +p.h.toFixed(3),
              spd: Math.round(p.speed), cl: p.cleared,
              al: !!inConflict[p.idx] || p.alertUntil > time,
              v: p.vec && (p.state === 'inbound' || p.state === 'outbound') ? [p.vec.x, p.vec.y] : null
            };
          }),
          gate: active.filter(function (p) { return p.state === 'gate'; })
            .map(function (p) { return p.id; }),
          flights: flights,
          marks: marks.slice(),
          stats: {
            landed: landed, departed: departed, arrivals: nArr, departures: nDep,
            collisions: collisions, delaySec: Math.round(delay), fuel: Math.round(fuel)
          },
          result: finished ? result() : null
        };
      }

      refreshCache();
      log('sys', 'Tower online. ' + planes.length + ' flights on the schedule.');
      call('onStart', world);

      return {
        step: function (n) {
          for (var i = 0; i < n && !finished; i++) tick();
        },
        snapshot: snapshot,
        result: result,
        drainLogs: function () {
          var out = logs;
          if (dropped) out.push({ t: time, k: 'warn', s: '(' + dropped + ' more lines not shown)' });
          logs = []; dropped = 0;
          return out;
        },
        get finished() { return finished; }
      };
    }

    return { createSim: createSim, C: C, RWY: RWY, FAF: FAF, FIXES: FIXES, fmtTime: fmtTime };
  }

  root.createTowerEngine = createTowerEngine;
  if (typeof module !== 'undefined' && module.exports) module.exports = createTowerEngine;
})(typeof self !== 'undefined' ? self : this);
