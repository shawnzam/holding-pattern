# Holding Pattern

https://holdingpattern.dev

A browser programming game modelled on a late-1990s university assignment. You write a
JavaScript class, `MyTower`, that runs an airport control tower. A simulation flies the
airplanes on a radar scope; your code decides who lands, who takes off and who waits.
You are scored on collisions, delay added and extra fuel burned. Lower is better.

It looks like a Java applet from 1999 on purpose.

## Run it

```bash
npm install
npm start
```

Then open http://localhost:8765.

The built-in Coach needs a Claude API key. Put it in a file called `.env` in this folder:

```
CLAUDE_API_KEY=sk-ant-...
```

Without a key the game still works; the Coach tab says it is unavailable. You can also
open `index.html` straight from disk to play without the server (again, no Coach).

Optional settings in `.env`:

| Setting | Default | Meaning |
|---|---|---|
| `PORT` | 8765 | Port the server listens on |
| `COACH_BUDGET_USD` | 20 | The Coach stops answering once the server's own estimate of spend reaches this |
| `COACH_PER_IP` | 30 | Questions allowed per network address per 10 minutes |

## Deploy it (Cloudflare)

The game is deployed as a Cloudflare Worker named `tower-game`:
https://holdingpattern.dev

```bash
npx wrangler login                       # once
npx wrangler secret put CLAUDE_API_KEY   # once; paste the key when asked
npm run deploy
```

`npm run deploy` copies `index.html`, `css/` and `js/` into `dist/` and publishes only
that folder, plus the Worker in `worker/index.mjs` that answers the Coach. Without the
secret the game works and the Coach tab says it is unavailable.

Coach limits on Cloudflare are set in `wrangler.jsonc`:

| Setting | Default | Meaning |
|---|---|---|
| `COACH_PER_IP_DAY` | 100 | Questions per network address per day (resets at midnight UTC) |
| `COACH_DAILY_USD` | 1 | Total spend allowed per day, all players together |
| `COACH_BUDGET_USD` | 20 | Total spend allowed, ever |

These are the Worker's own estimates. Set a spend limit on the key in the Anthropic
console as the hard backstop. `npm run dev:cf` runs the Worker locally on port 8787.

## Test it

```bash
npm test
```

This runs every assignment headless and checks that:

- the starter code collides (so there is something to fix),
- the reference tower and the short brute-force tower both finish with zero collisions
  (only where the solution files are present; see below),
- `flyTo` detours work, and
- two identical runs give identical scores.

Random Free Flight schedules are reported but not required to pass.

## How to play

1. Pick an assignment in the toolbar and read the **Assignment** tab.
2. Edit `MyTower.js`. The stubs are already there. The **API** tab lists everything you can call.
3. Press **Run** (or Ctrl+Enter). Watch the radar, the schedule and the Console.
4. Fix what went wrong and run again.

There are four assignments and a **Free Flight** mode, which builds a schedule from a seed
you type; the same seed always gives the same traffic.

Useful while debugging: `console.log(plane)` prints an object you can click open, and
`console.table(world.arrivals, ["id", "state", "eta"])` prints a table. The editor
suggests names after a dot; Ctrl+Space asks for suggestions anywhere.

The **Coach** tab is an AI (Claude Haiku) that can see your code and console. It teaches
and gives hints and is instructed not to write solutions. Scores on a schedule where you
used it are marked with an asterisk.

The result dialog has a **Copy link** box. The link (`/s?a=a1&t=227`) opens a small page
showing the schedule and the score, and unfurls in chat apps with a picture of both. The
score in a link is whatever the sender's browser reported; nothing checks it. The home
page has its own fixed preview picture, `og.png`, drawn at build time.

To wipe saved code and scores while testing: **Help > About Holding Pattern > Erase saved data**,
or open http://localhost:8765/?reset.

## Scoring

| | Points |
|---|---|
| Each second of delay (against the time the flight would take with the sky to itself) | 1 |
| Each 2 kg of extra fuel | 1 |
| Each collision (two on the runway, or two airborne under 3 miles apart) | 1000 |
| Each flight that never finishes | 2000 |

## What is in the folder

| Path | What it is |
|---|---|
| `index.html`, `css/metal.css` | The page and the Java "Metal" look |
| `js/sim.js` | The simulation engine. Deterministic; runs in a Web Worker and in Node |
| `js/levels.js` | Schedules, assignment briefs, starter code, the random schedule generator |
| `js/sandbox.js` | Runs the engine and the player's code in a worker; kills it if it hangs |
| `js/render.js` | Draws the radar |
| `js/app.js` | Everything else in the page: editor, console, autocomplete, Coach panel, menus |
| `server.mjs` | Local server: serves the game and answers Coach questions |
| `worker/index.mjs`, `wrangler.jsonc` | The same thing for Cloudflare, plus the question and spend counters |
| `coach-core.mjs` | Coach logic shared by both servers |
| `share-card.mjs` | Share links: the page a link opens and its link-preview picture, drawn in code |
| `coach-prompt.mjs` | The Coach's instructions, as plain text. Edit, then restart or redeploy |
| `scripts/build-site.mjs` | Copies the public files into `dist/` for deployment |
| `test/run.js` | Headless tests |

The server only serves `index.html`, `css/` and `js/`. The key and the tests are never
sent to a browser.

Two files are deliberately not in this repository: `test/solutions.js` (a reference
tower) and `solutions/brute-force.js` (a short one). They are working answers to the
assignments, and the game is only worth playing if you write your own. `npm test` uses
them when they exist and skips the solvability checks when they do not. If you change
schedules or physics, write a tower of your own to confirm the assignments can still be
solved.

## Where things stand

Working: the four assignments, Free Flight, the editor with autocomplete and syntax-error
marking, the console with object inspection, steering with `flyTo`, the Coach, the
fullscreen layout, and a Cloudflare deployment.

Not done yet:

- No leaderboard or accounts.
- Tested by hand in Chrome, Safari and Firefox. Phones are untested.
- Random Free Flight schedules have not been shown to be solvable without collisions.

## Credits and license

Made by [Shawn Zamechek](https://zamechek.com/). Adapted from an assignment created by
Chris Murphy for Penn's [MCIT](https://www.cis.upenn.edu/mcit/) program, summer 2013.

MIT license; see `LICENSE`. Source: https://github.com/shawnzam/holding-pattern

If you host your own copy, the Coach needs your own Claude API key and spends your own
budget; see "Deploy it" above. The game works without it.

## Open decisions

- **Name.** Settled: Holding Pattern, at holdingpattern.dev (it was "Tower.js" while
  being built). A game with the same title exists on Steam. The in-game file is still
  `MyTower.js`, saved data still uses the `towerjs.` prefix so nobody loses their code,
  and the Cloudflare Worker is still named `tower-game`.
- **Speed.** Settled: 220 knots is both the default and the top speed, so `setSpeed` only
  slows airplanes down. It used to allow 250, and flying everything fast beat the delay
  yardstick (Assignment 1 scored 227 that way). Scores from before the change that used
  speeds above 220 cannot be reproduced.
- **Coach window.** The chat area is small. A floating, resizable window was proposed; on hold.
- **Coach limits.** Built for the Cloudflare deployment (it needed somewhere to count).
  The local server still uses its simpler per-10-minutes limit.
