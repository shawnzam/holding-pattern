/*
 * Holding Pattern server: serves the game and answers Coach questions.
 *
 *   node server.mjs            (or: npm start)
 *
 * Reads the Claude API key from .env (CLAUDE_API_KEY or ANTHROPIC_API_KEY).
 * The key never leaves this process. The browser talks to /api/coach, and
 * this server talks to Claude.
 *
 * Optional settings in .env:
 *   PORT=8765
 *   COACH_BUDGET_USD=20        stop answering once this much has been spent
 *   COACH_PER_IP=30            questions allowed per address per 10 minutes
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Anthropic from '@anthropic-ai/sdk';
import { parseShare, sharePage, cardPng } from './share-card.mjs';
import { MODEL, MAX_BODY, buildMessages, requestParams, costOf, tailFor, describeError } from './coach-core.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { levels } = require('./js/levels.js');

/* ------------------------------------------------------------------ config */

function loadEnv() {
  const env = { ...process.env };
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!m || line.trim().startsWith('#')) continue;
      if (env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* no .env file */ }
  return env;
}

const env = loadEnv();
const PORT = Number(env.PORT) || 8765;
const API_KEY = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY || '';
const BUDGET_USD = Number(env.COACH_BUDGET_USD) || 20;
const PER_IP = Number(env.COACH_PER_IP) || 30;
const WINDOW_MS = 10 * 60 * 1000;

const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;

/* ------------------------------------------------------------ spend so far */

const USAGE_FILE = path.join(ROOT, '.coach-usage.json');
let usage = { usd: 0, requests: 0 };
try { usage = { ...usage, ...JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')) }; } catch { /* first run */ }

function recordUsage(u) {
  if (!u) return;
  usage.usd += costOf(u);
  usage.requests++;
  fs.writeFile(USAGE_FILE, JSON.stringify(usage), () => {});
}

/* --------------------------------------------------------------- rate limit */

const hits = new Map();
function allowed(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  if (list.length >= PER_IP) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < WINDOW_MS)) hits.delete(k);
  return true;
}

/* ------------------------------------------------------------ static files */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

// Only the game itself is public. The key, this server, the tests and the
// sample solutions are never served.
function publicFile(urlPath) {
  if (urlPath === '/' || urlPath === '/index.html') return path.join(ROOT, 'index.html');
  if (!/^\/(css|js)\/[A-Za-z0-9_\-./]+$/.test(urlPath) || urlPath.includes('..')) return null;
  const file = path.join(ROOT, urlPath);
  return file.startsWith(path.join(ROOT, 'css') + path.sep) || file.startsWith(path.join(ROOT, 'js') + path.sep) ? file : null;
}

function serveStatic(req, res, urlPath) {
  const file = publicFile(urlPath);
  if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

/* ------------------------------------------------------------------- coach */

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function coach(req, res) {
  if (!client) return json(res, 503, { error: 'The coach is not set up on this server (no API key).' });
  if (usage.usd >= BUDGET_USD) return json(res, 503, { error: 'The coach has used up its budget for now.' });
  const ip = req.socket.remoteAddress || 'unknown';
  if (!allowed(ip)) return json(res, 429, { error: 'Too many questions in a short time. Give it a few minutes.' });

  let messages;
  try {
    messages = buildMessages(JSON.parse(await readBody(req, MAX_BODY)), levels);
  } catch (e) {
    return json(res, 400, { error: e instanceof SyntaxError ? 'Bad request.' : e.message === 'too large' ? 'That is too much text for the coach.' : e.message });
  }

  const stream = client.messages.stream(requestParams(messages));

  let started = false, finished = false;
  res.on('close', () => { if (!finished) stream.abort(); });
  const begin = () => {
    if (started) return;
    started = true;
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  };

  try {
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        begin();
        res.write(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    recordUsage(final.usage);
    begin();
    res.write(tailFor(final));
    finished = true;
    res.end();
  } catch (error) {
    finished = true;
    const { aborted, status, message } = describeError(Anthropic, error);
    if (aborted) { res.end(); return; }
    console.error('[coach]', error instanceof Anthropic.APIError ? error.status + ' ' + error.message : error);
    if (started) res.end('\n\n(The coach was cut off. Try again.)');
    else json(res, status, { error: message });
  }
}

/* ------------------------------------------------------------------- share */

// /s is the page a share link opens; /og/card.png is its preview picture;
// /og.png is the home page's. See share-card.mjs.
async function share(req, res, urlPath) {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const png = body => res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' }).end(body);
  if (urlPath === '/og.png') return png(await cardPng(null));
  const shared = parseShare(url.searchParams, levels);
  if (!shared) { res.writeHead(302, { Location: '/' }).end(); return; }
  if (urlPath === '/og/card.png') return png(await cardPng(shared));
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }).end(sharePage(shared, url.origin));
}

/* ------------------------------------------------------------------ server */

http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/api/coach/status' && req.method === 'GET') {
    return json(res, 200, { enabled: !!client && usage.usd < BUDGET_USD, model: MODEL });
  }
  if (urlPath === '/api/coach' && req.method === 'POST') {
    coach(req, res).catch(e => { console.error('[coach]', e); if (!res.headersSent) json(res, 500, { error: 'Server error.' }); else res.end(); });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (urlPath === '/s' || urlPath === '/og/card.png' || urlPath === '/og.png') {
    share(req, res, urlPath).catch(e => { console.error('[share]', e); if (!res.headersSent) res.writeHead(500).end(); else res.end(); });
    return;
  }
  serveStatic(req, res, urlPath);
}).listen(PORT, () => {
  console.log('Holding Pattern is at http://localhost:' + PORT);
  console.log(client
    ? 'Coach: on (' + MODEL + '), $' + usage.usd.toFixed(4) + ' of $' + BUDGET_USD + ' spent over ' + usage.requests + ' questions.'
    : 'Coach: off. Put CLAUDE_API_KEY=... in .env to turn it on.');
});
