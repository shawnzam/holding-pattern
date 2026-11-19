/*
 * Holding Pattern on Cloudflare.
 *
 * Static files (dist/) are served by Cloudflare directly. This Worker answers
 * the Coach: POST /api/coach and GET /api/coach/status, and share links:
 * GET /s and GET /og/card.png (see share-card.mjs).
 *
 * Secret (set with `npx wrangler secret put CLAUDE_API_KEY`): the Claude key.
 * Limits (wrangler.jsonc "vars"):
 *   COACH_PER_IP_DAY   questions per network address per day
 *   COACH_DAILY_USD    total spend allowed per day, all players together
 *   COACH_BUDGET_USD   total spend allowed, ever
 */
import Anthropic from '@anthropic-ai/sdk';
import { DurableObject } from 'cloudflare:workers';
import levelsModule from '../js/levels.js';
import { parseShare, shareQuery, sharePage, cardPng } from '../share-card.mjs';
import { MODEL, MAX_BODY, buildMessages, requestParams, costOf, tailFor, describeError } from '../coach-core.mjs';

const { levels } = levelsModule;

/* The one place that counts questions and money. A Durable Object handles one
   call at a time, so two questions arriving together cannot both slip past a limit. */
export class CoachMeter extends DurableObject {
  async load() {
    const today = new Date().toISOString().slice(0, 10);
    let day = await this.ctx.storage.get('day');
    if (!day || day.date !== today) day = { date: today, usd: 0, who: {} };
    const total = (await this.ctx.storage.get('total')) || { usd: 0, requests: 0 };
    return { day, total };
  }

  /* Is the coach open, and how many questions does this visitor have left today? */
  async peek(who, lim) {
    const { day, total } = await this.load();
    const left = Math.max(0, lim.perDay - (day.who[who] || 0));
    return { enabled: total.usd < lim.budget && day.usd < lim.daily, left };
  }

  /* Uses up one question if the limits allow it. */
  async take(who, lim) {
    const { day, total } = await this.load();
    const used = day.who[who] || 0;
    if (total.usd >= lim.budget) return { ok: false, why: 'budget', left: 0 };
    if (day.usd >= lim.daily) return { ok: false, why: 'day', left: Math.max(0, lim.perDay - used) };
    if (used >= lim.perDay) return { ok: false, why: 'you', left: 0 };
    day.who[who] = used + 1;
    await this.ctx.storage.put('day', day);
    return { ok: true, left: lim.perDay - used - 1 };
  }

  async spend(usd) {
    const { day, total } = await this.load();
    day.usd += usd;
    total.usd += usd;
    total.requests += 1;
    await this.ctx.storage.put({ day, total });
  }

  async report() {
    const { day, total } = await this.load();
    return { date: day.date, todayUsd: day.usd, visitorsToday: Object.keys(day.who).length, totalUsd: total.usd, questions: total.requests };
  }
}

const json = (status, body, headers) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
});

function limits(env) {
  return {
    perDay: Number(env.COACH_PER_IP_DAY) || 100,
    daily: Number(env.COACH_DAILY_USD) || 1,
    budget: Number(env.COACH_BUDGET_USD) || 20
  };
}

/* Visitors are counted by a one-way hash of their address that changes daily;
   the address itself is never stored. */
async function visitor(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const day = new Date().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(day + '|' + ip));
  return Array.from(new Uint8Array(digest).slice(0, 8), b => b.toString(16).padStart(2, '0')).join('');
}

async function coach(request, env, ctx) {
  const key = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  if (!key) return json(503, { error: 'The coach is not set up on this server (no API key).' });

  const length = Number(request.headers.get('Content-Length') || 0);
  if (length > MAX_BODY) return json(400, { error: 'That is too much text for the coach.' });
  let messages;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY) throw new Error('That is too much text for the coach.');
    messages = buildMessages(JSON.parse(text), levels);
  } catch (e) {
    return json(400, { error: e instanceof SyntaxError ? 'Bad request.' : e.message });
  }

  const meter = env.METER.get(env.METER.idFromName('global'));
  const pass = await meter.take(await visitor(request), limits(env));
  if (!pass.ok) {
    const error = pass.why === 'you' ? 'You have used today\'s coaching. It resets at midnight UTC.'
      : pass.why === 'day' ? 'The coach has answered all it can today. It is back tomorrow.'
      : 'The coach has used up its budget for now.';
    return json(pass.why === 'you' ? 429 : 503, { error }, { 'X-Coach-Left': String(pass.left) });
  }

  const client = new Anthropic({ apiKey: key });
  const stream = client.messages.stream(requestParams(messages));
  const events = stream[Symbol.asyncIterator]();

  // Wait for the first event before answering, so a rejected key or an
  // overloaded API becomes a proper error instead of an empty reply.
  let first;
  try {
    first = await events.next();
  } catch (error) {
    const { status, message } = describeError(Anthropic, error);
    console.error('[coach]', error instanceof Anthropic.APIError ? error.status + ' ' + error.message : String(error));
    return json(status, { error: message }, { 'X-Coach-Left': String(pass.left) });
  }

  const encoder = new TextEncoder();
  const textOf = ev => (ev && ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') ? ev.delta.text : '';
  const body = new ReadableStream({
    async start(controller) {
      try {
        let step = first;
        while (!step.done) {
          const t = textOf(step.value);
          if (t) controller.enqueue(encoder.encode(t));
          step = await events.next();
        }
        const final = await stream.finalMessage();
        ctx.waitUntil(meter.spend(costOf(final.usage)));
        const tail = tailFor(final);
        if (tail) controller.enqueue(encoder.encode(tail));
      } catch (error) {
        if (!(error instanceof Anthropic.APIUserAbortError)) {
          console.error('[coach]', String(error));
          controller.enqueue(encoder.encode('\n\n(The coach was cut off. Try again.)'));
        }
      }
      controller.close();
    },
    cancel() { stream.abort(); }
  });

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Coach-Left': String(pass.left)
    }
  });
}

/* Share links: the page with preview tags, and the picture it points at.
   Answers are kept in Cloudflare's cache under one spelling of the link, so a
   popular link is drawn once and odd extra parameters cannot fill the cache. */
async function share(url, ctx) {
  const shared = parseShare(url.searchParams, levels);
  if (!shared) return Response.redirect(url.origin + '/', 302);
  const image = url.pathname === '/og/card.png';
  const key = new Request(url.origin + url.pathname + '?' + shareQuery(shared));
  const hit = await caches.default.match(key);
  if (hit) return hit;
  const response = image
    ? new Response(await cardPng(shared), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } })
    : new Response(sharePage(shared, url.origin), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } });
  ctx.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/coach/status' && request.method === 'GET') {
      const key = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
      if (!key) return json(200, { enabled: false, model: MODEL });
      const meter = env.METER.get(env.METER.idFromName('global'));
      const s = await meter.peek(await visitor(request), limits(env));
      return json(200, { enabled: s.enabled, left: s.left, model: MODEL });
    }
    if (url.pathname === '/api/coach' && request.method === 'POST') return coach(request, env, ctx);
    if (url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
    if ((url.pathname === '/s' || url.pathname === '/og/card.png') && request.method === 'GET') return share(url, ctx);
    return env.ASSETS.fetch(request);
  }
};
