/*
 * Share links and link previews, used by both servers.
 *
 *   /s?a=a1&t=227          a small page with preview tags, for a shared score
 *   /og/card.png?a=a1&t=227  the picture for that preview
 *   /og.png                the picture for the home page (written into dist/ at build)
 *
 * Optional: c=1 (the coach was used), seed=... (Free Flight).
 *
 * The score in a link is whatever the sender's browser put there. Nothing
 * checks it, the same as the rest of the game for now.
 *
 * The picture is drawn here, pixel by pixel, with a 5x7 font and a 16-colour
 * palette, so there is nothing to install and it runs the same in Node and in
 * a Cloudflare Worker.
 */

const SITE = 'Holding Pattern';
const TAGLINE = 'Write the code for an air traffic control tower.';
const MAX_SCORE = 9999999;

/* ------------------------------------------------------------ the share */

export function parseShare(params, levels) {
  const level = levels.find(l => l.id === params.get('a'));
  const t = params.get('t') || '';
  if (!level || !/^\d{1,7}$/.test(t)) return null;
  const share = { id: level.id, name: level.name, score: Math.min(MAX_SCORE, Number(t)), coach: params.get('c') === '1', seed: '' };
  if (level.free) {
    const seed = (params.get('seed') || '').trim();
    if (!/^[A-Za-z0-9 _.\-]{1,24}$/.test(seed)) return null;
    share.seed = seed;
    share.name = 'Free Flight "' + seed + '"';
  }
  return share;
}

/* The same share, always written the same way, so previews can be cached. */
export function shareQuery(share) {
  return 'a=' + share.id + '&t=' + share.score + (share.coach ? '&c=1' : '') + (share.seed ? '&seed=' + encodeURIComponent(share.seed) : '');
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function sharePage(share, origin) {
  const q = shareQuery(share);
  const star = share.coach ? '*' : '';
  const title = share.score + star + ' penalty points on ' + share.name;
  const desc = SITE + ': ' + TAGLINE + ' Lower is better. Can you beat it?';
  const play = '/?a=' + share.id + (share.seed ? '&seed=' + encodeURIComponent(share.seed) : '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - ${SITE}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="noindex">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${SITE}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(origin + '/s?' + q)}">
<meta property="og:image" content="${esc(origin + '/og/card.png?' + q)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(origin + '/og/card.png?' + q)}">
<link rel="stylesheet" href="/css/metal.css">
<style>
  body { background: var(--p2); min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: Arial, Helvetica, sans-serif; }
  .dialog { width: min(440px, 92%); }
  .dialog a.btn { color: #000; text-decoration: none; padding: 3px 14px; }
</style>
</head>
<body>
<div class="iframe dialog" role="main">
  <div class="titlebar"><span class="ico"></span><span class="ttl">Shared Result</span><span class="grip"></span></div>
  <div class="dbody">
    <div class="verdict good">${esc(share.name)}</div>
    <table>
      <tr class="total"><td>Penalty points</td><td class="num">${share.score}${star}</td></tr>
    </table>
    ${share.coach ? '<p>* The coach was used on this schedule.</p>' : ''}
    <p>${SITE} is a programming game: you write the code for an air traffic control tower, and you are scored on collisions, delay and fuel. Lower is better.</p>
    <p>This score was reported by the player's browser and has not been checked.</p>
  </div>
  <div class="dfoot"><a class="btn" href="${esc(play)}">Play this schedule</a></div>
</div>
</body>
</html>
`;
}

/* ---------------------------------------------------------- the picture */

const W = 1200, H = 630;

const PALETTE = [
  [0x99, 0x99, 0xcc], // 0 desktop (p2)
  [0xcc, 0xcc, 0xcc], // 1 control gray
  [0x66, 0x66, 0x99], // 2 p1
  [0xcc, 0xcc, 0xff], // 3 p3
  [0xff, 0xff, 0xff], // 4 white
  [0x00, 0x00, 0x00], // 5 black
  [0x66, 0x66, 0x66], // 6 dark gray
  [0x99, 0x99, 0x99], // 7 shadow gray
  [0x33, 0xff, 0x66], // 8 radar green
  [0x0c, 0x40, 0x1c], // 9 radar grid
  [0xff, 0xcc, 0x33], // 10 amber
  [0x33, 0x33, 0x66], // 11 navy
  [0xcc, 0xff, 0xcc], // 12 pale green
  [0x66, 0xcc, 0xff]  // 13 departure blue
];
const C = { desk: 0, gray: 1, p1: 2, p3: 3, white: 4, black: 5, dark: 6, shadow: 7, green: 8, grid: 9, amber: 10, navy: 11, pale: 12, blue: 13 };

const GLYPHS = {
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110',
  C: '01110100011000010000100001000101110', D: '11110100011000110001100011000111110',
  E: '11111100001000011110100001000011111', F: '11111100001000011110100001000010000',
  G: '01110100011000010111100011000101111', H: '10001100011000111111100011000110001',
  I: '01110001000010000100001000010001110', J: '00111000100001000010000101001001100',
  K: '10001100101010011000101001001010001', L: '10000100001000010000100001000011111',
  M: '10001110111010110101100011000110001', N: '10001110011010110011100011000110001',
  O: '01110100011000110001100011000101110', P: '11110100011000111110100001000010000',
  Q: '01110100011000110001101011001001101', R: '11110100011000111110101001001010001',
  S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  W: '10001100011000110101101011101110001', X: '10001100010101000100010101000110001',
  Y: '10001100010101000100001000010000100', Z: '11111000010001000100010001000011111',
  0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
  2: '01110100010000100010001000100011111', 3: '11110000010000101110000010000111110',
  4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
  6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
  8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  '.': '00000000000000000000000000110001100', ',': '00000000000000000000011000010001000',
  ':': '00000011000110000000011000110000000', '-': '00000000000000001110000000000000000',
  '*': '00000001001010101110101010010000000', '/': '00001000010001000100010001000010000',
  '?': '01110100010000100010001000000000100', '!': '00100001000010000100001000000000100',
  '"': '01010010100101000000000000000000000', "'": '00100001000000000000000000000000000',
  '(': '00010001000100001000010000010000010', ')': '01000001000001000010000100010001000',
  '_': '00000000000000000000000000000011111', ' ': '00000000000000000000000000000000000'
};

function canvas() {
  const px = new Uint8Array(W * H);
  const rect = (x, y, w, h, c) => {
    const x0 = Math.max(0, x | 0), y0 = Math.max(0, y | 0), x1 = Math.min(W, (x + w) | 0), y1 = Math.min(H, (y + h) | 0);
    for (let yy = y0; yy < y1; yy++) px.fill(c, yy * W + x0, yy * W + x1);
  };
  const textWidth = (s, scale) => s.length * 6 * scale - scale;
  const text = (s, x, y, scale, c) => {
    s = String(s).toUpperCase();
    for (let i = 0; i < s.length; i++) {
      const g = GLYPHS[s[i]] || GLYPHS['?'];
      for (let k = 0; k < 35; k++) {
        if (g[k] === '1') rect(x + (i * 6 + k % 5) * scale, y + ((k / 5) | 0) * scale, scale, scale, c);
      }
    }
    return textWidth(s, scale);
  };
  const line = (x0, y0, x1, y1, t, c, dash) => {
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= n; i++) {
      if (dash && ((i / dash) | 0) % 2) continue;
      rect(x0 + (x1 - x0) * i / n - t / 2, y0 + (y1 - y0) * i / n - t / 2, t, t, c);
    }
  };
  const ring = (cx, cy, r, t, c, clip) => {
    const n = Math.ceil(r * 7);
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      if (clip && (x < clip.x || y < clip.y || x >= clip.x + clip.w - t || y >= clip.y + clip.h - t)) continue;
      rect(x, y, t, t, c);
    }
  };
  return { px, rect, text, textWidth, line, ring };
}

/* A Metal internal frame with a title bar. Returns the area inside it. */
function frame(g, x, y, w, h, title) {
  g.rect(x + 9, y + 9, w, h, C.p1);            // drop shadow
  g.rect(x, y, w, h, C.p1);
  g.rect(x + 3, y + 3, w - 6, h - 6, C.p3);
  g.rect(x + 6, y + 6, w - 12, h - 12, C.p2);
  g.rect(x + 12, y + 12, w - 24, h - 24, C.p1);
  g.rect(x + 15, y + 15, w - 30, h - 30, C.gray);
  const bar = { x: x + 15, y: y + 15, w: w - 30, h: 54 };
  g.rect(bar.x, bar.y, bar.w, bar.h, C.p3);
  g.rect(bar.x, bar.y + bar.h, bar.w, 3, C.p1);
  g.rect(bar.x + 15, bar.y + 15, 24, 24, C.p1); // window icon
  g.rect(bar.x + 18, bar.y + 21, 18, 15, C.white);
  const tw = g.text(title, bar.x + 54, bar.y + 13, 4, C.black);
  // the "bumps" grip that fills the rest of a Metal title bar
  for (let by = bar.y + 9; by < bar.y + bar.h - 12; by += 12) {
    for (let bx = bar.x + 54 + tw + 24; bx < bar.x + bar.w - 18; bx += 12) {
      g.rect(bx, by, 3, 3, C.white); g.rect(bx + 3, by + 3, 3, 3, C.p1);
      g.rect(bx + 6, by + 6, 3, 3, C.white); g.rect(bx + 9, by + 9, 3, 3, C.p1);
    }
  }
  return { x: x + 15, y: y + 72, w: w - 30, h: h - 87 };
}

/* An inset panel: dark edge top-left, white edge bottom-right. */
function inset(g, x, y, w, h, fill) {
  g.rect(x, y, w, h, C.white);
  g.rect(x, y, w - 3, h - 3, C.dark);
  g.rect(x + 3, y + 3, w - 6, h - 6, fill);
}

function plane(g, x, y, dx, dy, c) {
  g.line(x - dx * 46, y - dy * 46, x, y, 3, C.dark, 6); // trail
  g.rect(x - 6, y - 6, 12, 12, c);
  g.line(x, y, x + dx * 16, y + dy * 16, 4, c);
}

function radar(g, x, y, w, h) {
  inset(g, x, y, w, h, C.black);
  const r = { x: x + 3, y: y + 3, w: w - 6, h: h - 6 };
  for (let gx = r.x + 40; gx < r.x + r.w; gx += 40) g.rect(gx, r.y, 1, r.h, C.grid);
  for (let gy = r.y + 40; gy < r.y + r.h; gy += 40) g.rect(r.x, gy, r.w, 1, C.grid);
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  g.ring(cx, cy, 80, 2, C.grid, r);
  g.ring(cx, cy, 160, 2, C.grid, r);
  // routes in to the final fix, then the runway
  const fx = cx - 110;
  g.line(r.x + 4, r.y + 60, fx, cy, 2, C.grid, 8);
  g.line(r.x + 4, r.y + r.h - 60, fx, cy, 2, C.grid, 8);
  g.line(fx, cy, cx - 24, cy, 2, C.grid, 8);
  g.rect(cx - 24, cy - 4, 48, 8, C.white);
  g.rect(fx - 5, cy - 5, 10, 10, C.green);
  g.text('FINAL', fx - 28, cy + 14, 2, C.green);
  g.text('09', cx - 10, cy + 12, 2, C.white);
  // traffic
  plane(g, r.x + 86, r.y + 100, 0.88, 0.47, C.green);
  plane(g, r.x + 150, r.y + r.h - 118, 0.86, -0.5, C.green);
  plane(g, fx + 46, cy, 1, 0, C.green);
  plane(g, cx + 120, cy - 96, 0.6, -0.8, C.blue);
  plane(g, cx + 150, cy + 40, 0.94, 0.34, C.blue);
  g.ring(r.x + 86 - 22, r.y + 100 - 22, 22, 2, C.grid, r);
}

function centred(g, s, cx, y, scale, c) { g.text(s, Math.round(cx - g.textWidth(s, scale) / 2), y, scale, c); }

/* Break text into lines that fit a width, at spaces. */
function wrap(g, s, scale, max) {
  const lines = [];
  let cur = '';
  for (const word of s.split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (cur && g.textWidth(next, scale) > max) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

function draw(share) {
  const g = canvas();
  g.rect(0, 0, W, H, C.desk);
  const body = frame(g, 36, 30, W - 81, H - 69, share ? 'Simulation Complete' : SITE);
  const rw = 460, rh = Math.min(body.h - 36, 400);
  radar(g, body.x + 24, body.y + 18 + (body.h - 36 - rh) / 2, rw, rh);
  const tx = body.x + 24 + rw + 30, tw = body.x + body.w - 24 - tx, cx = tx + tw / 2;
  let y = body.y + 24;

  if (share) {
    const parts = share.name.split(': ');
    for (const part of parts) {
      for (const ln of wrap(g, part, 4, tw)) { g.text(ln, tx, y, 4, C.black); y += 40; }
    }
    y += 8;
    const boxH = 216;
    inset(g, tx, y, tw, boxH, C.white);
    centred(g, 'PENALTY POINTS', cx, y + 20, 3, C.navy);
    const num = String(share.score) + (share.coach ? '*' : '');
    const scale = Math.min(19, Math.floor((tw - 48) / (num.length * 6 - 1)));
    centred(g, num, cx, y + 56 + Math.round((boxH - 72 - scale * 7) / 2), scale, C.black);
    y += boxH + 20;
    g.text('LOWER IS BETTER.', tx, y, 3, C.black);
    g.text('CAN YOU BEAT IT?', tx, y + 32, 3, C.black);
    if (share.coach) g.text('* COACH-ASSISTED', tx, y + 64, 2, C.dark);
  } else {
    for (const ln of ['HOLDING', 'PATTERN']) { g.text(ln, tx, y, 11, C.black); y += 96; }
    y += 10;
    for (const ln of wrap(g, TAGLINE, 4, tw)) { g.text(ln, tx, y, 4, C.navy); y += 40; }
    y += 14;
    g.text('A programming game.', tx, y, 3, C.black);
  }

  // a Metal button with the address, bottom right
  const label = 'HOLDINGPATTERN.DEV', bw = g.textWidth(label, 3) + 36, bh = 45;
  const bx = body.x + body.w - 24 - bw, by = body.y + body.h - 18 - bh;
  g.rect(bx, by, bw + 3, bh + 3, C.white);
  g.rect(bx, by, bw, bh, C.dark);
  g.rect(bx + 3, by + 3, bw - 3, bh - 3, C.white);
  g.rect(bx + 6, by + 6, bw - 9, bh - 9, C.gray);
  g.text(label, bx + 18, by + 12, 3, C.black);
  return g.px;
}

/* ------------------------------------------------------------------ PNG */

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  let c = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) c = CRC[(c ^ out[i]) & 0xff] ^ (c >>> 8);
  view.setUint32(8 + data.length, (c ^ 0xffffffff) >>> 0);
  return out;
}

/* The preview picture as PNG bytes. Pass null for the home page card. */
export async function cardPng(share) {
  const px = draw(share);
  const raw = new Uint8Array(H * (W + 1));      // each row starts with a filter byte (0)
  for (let y = 0; y < H; y++) raw.set(px.subarray(y * W, y * W + W), y * (W + 1) + 1);
  const packed = new Uint8Array(await new Response(
    new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());

  const head = new Uint8Array(13), hv = new DataView(head.buffer);
  hv.setUint32(0, W); hv.setUint32(4, H);
  head[8] = 8; head[9] = 3;                     // 8 bits per pixel, palette
  const parts = [
    Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    chunk('IHDR', head), chunk('PLTE', Uint8Array.from(PALETTE.flat())), chunk('IDAT', packed), chunk('IEND', new Uint8Array(0))
  ];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { png.set(p, at); at += p.length; }
  return png;
}
