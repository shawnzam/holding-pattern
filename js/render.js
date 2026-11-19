/*
 * Draws the radar scope. Coordinates in the simulation are nautical miles;
 * `s` converts them to CSS pixels.
 */
function TowerRadar(canvas, engine) {
  'use strict';
  var ctx = canvas.getContext('2d');
  var C = engine.C, RWY = engine.RWY, FAF = engine.FAF, FIXES = engine.FIXES;
  var s = 15, cssW = 720, cssH = 480;

  var COL = {
    bg: '#000000', grid: '#06220f', ring: '#0c4a22', route: '#0f6a30',
    fix: '#2ee66b', label: '#2ee66b', dim: '#17994a',
    arr: '#ffe14d', dep: '#4de1ff', alert: '#ff3b30', rwy: '#e6e6e6'
  };
  var MONO = '"Courier New", Courier, monospace';
  var ABBR = { inbound: 'INB', holding: 'HLD', final: 'FNL', landing: 'LND', takeoff: 'ROLL', outbound: 'DEP' };
  // A simple top-down airplane, nose toward +x, about 2 units long.
  var ICON = [[1, 0], [0.3, 0.2], [-0.05, 0.95], [-0.35, 0.95], [-0.15, 0.2], [-0.7, 0.16],
    [-0.92, 0.5], [-1.1, 0.5], [-0.95, 0], [-1.1, -0.5], [-0.92, -0.5], [-0.7, -0.16],
    [-0.15, -0.2], [-0.35, -0.95], [-0.05, -0.95], [0.3, -0.2]];

  function resize() {
    var r = canvas.getBoundingClientRect();
    if (r.width < 10) return;
    var dpr = window.devicePixelRatio || 1;
    cssW = r.width; cssH = r.width * C.H / C.W;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    s = cssW / C.W;
  }

  function line(x1, y1, x2, y2) {
    ctx.beginPath(); ctx.moveTo(x1 * s, y1 * s); ctx.lineTo(x2 * s, y2 * s); ctx.stroke();
  }

  function labelAt(text, x, y, fix) {
    // Keep labels on the scope: push them inward from whichever edge the fix sits on.
    var px = x * s, py = y * s;
    ctx.textBaseline = 'middle';
    if (fix.x <= 0) { ctx.textAlign = 'left'; px += 10; py -= 11; }
    else if (fix.x >= C.W) { ctx.textAlign = 'right'; px -= 10; py -= 11; }
    else if (fix.y <= 0) { ctx.textAlign = 'left'; px += 9; py += 9; }
    else if (fix.y >= C.H) { ctx.textAlign = 'left'; px += 9; py -= 9; }
    else { ctx.textAlign = 'left'; px += 8; py -= 8; }
    ctx.fillText(text, px, py);
  }

  function drawStatic() {
    var x, y, k, f;
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    ctx.lineWidth = 1;
    ctx.strokeStyle = COL.grid;
    for (x = 4; x < C.W; x += 4) line(x, 0, x, C.H);
    for (y = 4; y < C.H; y += 4) line(0, y, C.W, y);

    ctx.strokeStyle = COL.ring;
    var cx = (RWY.x1 + RWY.x2) / 2, cy = RWY.y1;
    [5, 10, 15].forEach(function (r) {
      ctx.beginPath(); ctx.arc(cx * s, cy * s, r * s, 0, Math.PI * 2); ctx.stroke();
    });

    // published routes
    ctx.strokeStyle = COL.route;
    ctx.setLineDash([2, 5]);
    for (k in FIXES) {
      f = FIXES[k];
      if (f.type === 'entry') {
        var px = f.x, py = f.y;
        (f.via || []).forEach(function (n) { line(px, py, FIXES[n].x, FIXES[n].y); px = FIXES[n].x; py = FIXES[n].y; });
        line(px, py, FAF.x, FAF.y);
      } else if (f.type === 'exit') {
        line(RWY.x2, RWY.y2, f.x, f.y);
      }
    }
    ctx.setLineDash([6, 4]);
    line(FAF.x, FAF.y, RWY.x1, RWY.y1);
    ctx.setLineDash([]);

    // fixes
    ctx.font = 'bold ' + Math.max(9, Math.round(s * 0.7)) + 'px ' + MONO;
    ctx.fillStyle = COL.label; ctx.strokeStyle = COL.fix; ctx.lineWidth = 1.5;
    for (k in FIXES) {
      f = FIXES[k];
      var fx = Math.max(5, Math.min(cssW - 5, f.x * s)), fy = Math.max(5, Math.min(cssH - 5, f.y * s));
      ctx.beginPath();
      if (f.type === 'entry') {
        ctx.moveTo(fx - 5, fy - 4); ctx.lineTo(fx + 5, fy - 4); ctx.lineTo(fx, fy + 5); ctx.closePath();
      } else if (f.type === 'exit') {
        ctx.rect(fx - 4, fy - 4, 8, 8);
      } else {
        ctx.moveTo(fx - 4, fy - 4); ctx.lineTo(fx + 4, fy + 4); ctx.moveTo(fx + 4, fy - 4); ctx.lineTo(fx - 4, fy + 4);
      }
      ctx.stroke();
      labelAt(k, fx / s, fy / s, f);
    }
    ctx.beginPath();
    ctx.moveTo(FAF.x * s - 5, FAF.y * s); ctx.lineTo(FAF.x * s + 5, FAF.y * s);
    ctx.moveTo(FAF.x * s, FAF.y * s - 5); ctx.lineTo(FAF.x * s, FAF.y * s + 5);
    ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(FAF.name, FAF.x * s, FAF.y * s + 14);

    // runway
    ctx.fillStyle = COL.rwy;
    var rh = Math.max(4, s * 0.32);
    ctx.fillRect(RWY.x1 * s, RWY.y1 * s - rh / 2, (RWY.x2 - RWY.x1) * s, rh);
    ctx.fillStyle = COL.label;
    ctx.fillText('RWY ' + RWY.name, cx * s, RWY.y1 * s - rh / 2 - 9);

    // scale and north
    ctx.strokeStyle = COL.dim; ctx.fillStyle = COL.dim; ctx.lineWidth = 1;
    var bx = 1.2 * s, by = cssH - 0.9 * s;
    ctx.beginPath();
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by); ctx.lineTo(bx + 3 * s, by); ctx.lineTo(bx + 3 * s, by - 4);
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.fillText('3 nm', bx + 3 * s + 6, by - 2);
    ctx.textAlign = 'center';
    ctx.fillText('N', cssW - 1.3 * s, 1.0 * s);
    ctx.beginPath(); ctx.moveTo(cssW - 1.3 * s, 1.6 * s); ctx.lineTo(cssW - 1.3 * s, 2.8 * s); ctx.stroke();
  }

  function drawPlane(p, blink) {
    var x = p.x * s, y = p.y * s;
    var base = p.kind === 'arrival' ? COL.arr : COL.dep;
    var col = p.al ? COL.alert : base;
    var airborne = p.st !== 'landing' && p.st !== 'takeoff';
    var i;

    if (airborne) {
      ctx.strokeStyle = col;
      ctx.globalAlpha = p.al ? (blink ? 1 : 0.45) : 0.38;
      ctx.lineWidth = p.al ? 2 : 1;
      if (p.st === 'holding') ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(x, y, C.SEP / 2 * s, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    if (p.v) {
      // where a detour is taking it
      var vx = p.v[0] * s, vy = p.v[1] * s;
      ctx.strokeStyle = base; ctx.globalAlpha = 0.7; ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(vx, vy); ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(vx, vy - 5); ctx.lineTo(vx + 5, vy); ctx.lineTo(vx, vy + 5); ctx.lineTo(vx - 5, vy); ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    var k = Math.max(7, s * 0.6);
    ctx.save();
    ctx.translate(x, y); ctx.rotate(p.h);
    ctx.beginPath();
    ctx.moveTo(ICON[0][0] * k, ICON[0][1] * k);
    for (i = 1; i < ICON.length; i++) ctx.lineTo(ICON[i][0] * k, ICON[i][1] * k);
    ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
    ctx.restore();

    // data tag
    var up = p.y > 3;
    var tx = x + k + 5, ty = up ? y - k - 14 : y + k + 6;
    if (tx + 56 > cssW) tx = x - k - 5 - 52;
    ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x + (tx > x ? k * 0.6 : -k * 0.6), y + (up ? -k * 0.6 : k * 0.6));
    ctx.lineTo(tx > x ? tx - 2 : tx + 54, up ? ty + 16 : ty); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = 'bold ' + Math.max(9, Math.round(s * 0.68)) + 'px ' + MONO;
    ctx.fillText(p.id, tx, ty);
    ctx.fillText((p.v && p.st !== 'holding' ? 'VEC' : ABBR[p.st] || p.st) + ' ' + p.spd, tx, ty + Math.max(10, s * 0.72));
  }

  function draw(snap, trails, opts) {
    opts = opts || {};
    var i, id, t;
    drawStatic();

    if (snap) {
      // where things went wrong
      ctx.strokeStyle = COL.alert; ctx.lineWidth = 2;
      for (i = 0; i < snap.marks.length; i++) {
        var m = snap.marks[i], mx = m.x * s, my = m.y * s;
        ctx.beginPath();
        ctx.moveTo(mx - 5, my - 5); ctx.lineTo(mx + 5, my + 5);
        ctx.moveTo(mx + 5, my - 5); ctx.lineTo(mx - 5, my + 5);
        ctx.stroke();
      }

      // trails
      for (id in trails) {
        t = trails[id];
        ctx.fillStyle = t.kind === 'arrival' ? COL.arr : COL.dep;
        for (i = 0; i < t.pts.length; i++) {
          ctx.globalAlpha = 0.15 + 0.4 * (i / t.pts.length);
          ctx.fillRect(t.pts[i].x * s - 1, t.pts[i].y * s - 1, 2, 2);
        }
      }
      ctx.globalAlpha = 1;

      // gate queue, parked just south of the threshold
      if (snap.gate.length) {
        ctx.fillStyle = COL.dep;
        ctx.font = 'bold ' + Math.max(9, Math.round(s * 0.68)) + 'px ' + MONO;
        ctx.textAlign = 'right'; ctx.textBaseline = 'top';
        var gx = RWY.x1 * s + 4, gy = RWY.y1 * s + 12;
        ctx.fillText('GATE ' + snap.gate.length, gx - 4, gy - 1);
        for (i = 0; i < Math.min(snap.gate.length, 12); i++) ctx.fillRect(gx + i * 8, gy, 5, 9);
      }

      for (i = 0; i < snap.planes.length; i++) drawPlane(snap.planes[i], opts.blink);
    }

    if (opts.banner) {
      ctx.font = 'bold ' + Math.round(s * 1.1) + 'px ' + MONO;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      var w = ctx.measureText(opts.banner).width + 28, h = s * 2.2;
      var bx = cssW / 2 - w / 2, by = cssH * 0.2 - h / 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.85)'; ctx.fillRect(bx, by, w, h);
      ctx.strokeStyle = COL.fix; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, w - 1, h - 1);
      ctx.fillStyle = COL.label;
      ctx.fillText(opts.banner, cssW / 2, cssH * 0.2 + 1);
    }
  }

  resize();
  return { draw: draw, resize: resize };
}
