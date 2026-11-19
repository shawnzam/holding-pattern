# Notes for an AI agent picking this project up

Read `README.md` first for what the game is and how to run it. This file is what you
need to change it safely and what the owner has already decided.

## Commands

- `npm start` runs the server on port 8765. `.claude/launch.json` starts the same thing
  for the in-app browser preview (configuration name `tower`).
- `npm test` must pass before you call a change to the engine or the schedules done.
- `npm run deploy` publishes to Cloudflare (Worker `tower-game`,
  https://holdingpattern.dev). `npm run dev:cf` runs the Worker locally on
  port 8787 and picks the key up from `.env`. Deploying is public: ask first.
- There is no build step and no framework. Plain script files, loaded in order by `index.html`.

## What the owner wants

- A recreation of a scaffolded college assignment: the player fills in stubbed methods on
  a base class. Keep that shape.
- One central tower is the player's code. Per-airplane agents may come later.
- Flat 2D and deliberately simple. Resist adding realism (altitude, wind, aircraft types)
  unless asked.
- The look is a 1990s Java applet (Swing "Metal": gray controls, purple-blue desktop,
  internal frames). New UI should use the existing classes in `css/metal.css`.
- Fullscreen app, no page header or marketing text.
- The Coach teaches and must not hand out solutions, and should hold that line when
  pushed. It is trust-based: an asterisk on scores, no accounts. Keystroke or paste
  tracking was mentioned as a possible later step, not wanted now.
- Order of work: get the game right locally first, then Cloudflare and a leaderboard.
- The owner prefers to be asked before larger additions. Several proposals are on hold
  (see the end of this file); do not build them unprompted.

## How it fits together

```
index.html
  js/sim.js      createTowerEngine(): the whole simulation, self-contained
  js/levels.js   TOWER_LEVELS: schedules, briefs, starter code, makeRandomLevel(seed)
  js/sandbox.js  TowerSandbox: builds a Web Worker from sim.js's source text
  js/render.js   TowerRadar: canvas drawing
  js/app.js      UI wiring (one IIFE)
server.mjs       local: static files + POST /api/coach (streams text) + GET /api/coach/status
worker/index.mjs Cloudflare: the same two endpoints; static files come from dist/
coach-core.mjs   shared: buildMessages, requestParams, costOf, describeError
coach-prompt.mjs COACH_SYSTEM, the Coach's instructions
share-card.mjs   shared: parseShare, sharePage, cardPng (share links and their preview pictures)
scripts/build-site.mjs  copies index.html, css/, js/ into dist/ (the only thing published)
```

Each tick (one simulated second) the engine: spawns scheduled flights and calls
`onArrival` / `onDepartureReady`; calls `onTick`; moves every airplane; then checks the
runway and the 3-mile separation rule. The page asks the worker to step N ticks and gets
back a snapshot plus log lines.

## Rules that are easy to break

1. **`js/sim.js` must stay self-contained.** `sandbox.js` calls
   `createTowerEngine.toString()` and runs that text in a worker, so nothing inside the
   function may refer to anything outside it. Node also `require`s the same file.
2. **Keep the simulation deterministic.** No `Date`, no real `Math.random` (the player's
   `Math.random` is replaced with a seeded one). A future leaderboard will re-run
   submissions on a server and compare scores, so the same code must always score the
   same. `npm test` checks this.
3. **The player's API is documented in four places.** If you add or change a method or
   property, update all of them:
   - the API tab in `index.html`,
   - `HINTS` in `js/app.js` (autocomplete),
   - the game facts in `coach-prompt.mjs`,
   - starter code and briefs in `js/levels.js` where relevant.
4. **Changing schedules or physics can make an assignment unsolvable.** Run `npm test`;
   both `test/solutions.js` and `solutions/brute-force.js` must still finish every
   assignment with zero collisions. Those two files exist only on the owner's machine
   (ignored by git); without them `npm test` skips these checks and says so, which is
   not a pass.
5. **Never serve secrets or solutions.** `server.mjs` serves only `index.html`, `css/`
   and `js/`, and `scripts/build-site.mjs` copies only those into `dist/` (plus the generated `og.png`). Do not put solutions under `js/`. Do not print or copy the key in `.env`
   (the variable is `CLAUDE_API_KEY`).
6. **The worker is a guard against accidents, not a security boundary.** It stops
   infinite loops and hides network globals, but a determined player can escape it. That
   is acceptable while code only runs in its author's own browser. It stops being
   acceptable the day players can load each other's code.

## Engine facts worth knowing

- Map 48 x 32 nautical miles, origin top left. Runway 09 from (22.5, 16) to (25.5, 16).
  FINAL fix at (15.5, 16). Fixes and routes are in `FIXES` at the top of `sim.js`;
  ECHOS routes via BASEN.
- Default speed 220 knots, which is also the top speed; range 160 to 220 (capped on
  2026-11-14 so that flying faster than the delay yardstick cannot be used to score). Turn rate 6 degrees a second. A fix counts
  as reached within 0.7 miles; that radius must stay at least as large as the turn radius
  at top speed or airplanes can orbit a fix forever.
- Takeoff roll 40 s, landing roll 45 s. Airplanes at the gate or on the runway are not
  checked for separation.
- Delay is measured against a solo run of the same flight (`idealFor`), and is clamped at
  zero per flight, as is extra fuel.
- An arrival that reaches FINAL uncleared circles there automatically.
- `flyTo` sets one detour point; reaching it or calling `resume()` clears it.

## The Coach

- Model `claude-haiku-5-5` through the official `@anthropic-ai/sdk`, streaming, adaptive
  thinking with `effort: "low"`, `max_tokens` 2000.
- The browser sends the level id, code, recent console lines, last result, schedule and
  up to 16 chat turns. The server wraps the newest question with that context; earlier
  turns are sent as plain text.
- Spend is estimated from token usage. Locally it is kept in `.coach-usage.json` (ignored
  by git). On Cloudflare the `CoachMeter` Durable Object in `worker/index.mjs` counts
  questions per visitor per day and spend per day and in total; visitors are identified
  by a daily-changing hash of `CF-Connecting-IP`, never the address itself. The response
  header `X-Coach-Left` and the status endpoint tell the page how many questions remain.
- Change coach behaviour in `coach-core.mjs` or `coach-prompt.mjs`, not in one server
  only, so local and deployed stay the same.
- The key on Cloudflare is the secret `CLAUDE_API_KEY`. The owner sets it; do not handle it.
- If you change Claude API code, check current model ids and parameters rather than
  relying on memory; they change.

## Share links

- `/s?a=<level id>&t=<score>` (optional `c=1` coach used, `seed=` for Free Flight) is a
  page with Open Graph tags; `/og/card.png` with the same query is its picture. Both
  servers answer them from `share-card.mjs`. The home page's picture is `/og.png`: the
  local server draws it on request, the build writes it into `dist/`.
- The picture is drawn pixel by pixel (5x7 font, 16-colour palette, PNG written by hand)
  so it needs no dependency and runs in a Worker. Check it by eye after changing it.
- Scores in links are not verified. The share page says so. Do not present them as checked.
- On Cloudflare the answers are cached under one canonical spelling of the query.
- `/?a=<level id>` (and `&seed=`) opens the game on that schedule.

## Testing in the browser

- The page saves code, scores and flags in `localStorage` under keys starting `towerjs.`.
  If you drive the page to test something, do not leave your test code in the owner's
  saved slots: save what was there and put it back, or use `?reset` only when they agree
  to losing it.
- The simulation advances on animation frames, so it does not run while the preview pane
  is hidden. Check logic with `npm test` or with `fetch` from the page instead.
- A request for `/.env`, even one expected to return 404, may be refused by the shell
  permission rules. Probe from the page with `fetch`.

## Known gaps

- Cross-browser: built and checked in a Chromium-based browser; the owner tested Safari and Firefox by hand on 2026-11-14. Phones are untested.
- Opening `index.html` from disk has not been re-checked since the server was added.
- The live Delay counter does not include detour time until a flight finishes.
- Syntax errors are found with the Acorn parser loaded from a CDN; if it fails to load,
  errors are reported without a line.
- The result dialog says "Your best on this schedule is N", which reads as if N were the
  best possible. It should say "your previous best", and a par score per assignment
  would help.
- Random Free Flight schedules are not proven solvable.
- Git: public GitHub repository `shawnzam/holding-pattern`, branch `main`, MIT license
  (public since 2026-11-18). `.gitignore` covers `.env`, `node_modules/`, `dist/`, the
  usage file, and the solutions (`solutions/`, `test/solutions.js`). Never commit the
  solutions or anything that amounts to one (a working tower in a doc, a test or an
  example). Everything committed is public. Commit or push only when asked.

## Proposed and on hold (ask before building)

1. **Floating Coach window**: draggable, resizable, non-modal, opening over the radar so
   the editor stays visible; plus making the frames' maximise buttons real.
2. *(Done for Cloudflare on 2026-11-14.)* Coach accounting without sign-up. The per-visitor
   limit has not been exercised end to end; only the counter going from 40 to 39 was seen.
3. *(Done 2026-11-14.)* Renamed to Holding Pattern. Deliberately unchanged: the in-game
   file name `MyTower.js`, the `towerjs.` localStorage prefix (changing it would wipe
   players' saved code), and the Worker name `tower-game` (changing it creates a new
   Worker and loses the secret and the counters).
4. *(Done 2026-11-14.)* Scoring fix: top speed capped at 220, the same speed delay is
   measured against. Keep `SPEED_MAX` equal to `SPEED` unless the yardstick changes too.
5. **Leaderboard**, with server-side re-running of submissions. (The Cloudflare port
   itself is done.) Also still open: a custom domain, and optionally Cloudflare Access to
   keep the site private while testing.
