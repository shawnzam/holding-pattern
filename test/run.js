/*
 * Headless check: node test/run.js
 *
 * For every assignment, runs the starter code (which should collide) and the
 * reference tower (which must finish everything with zero collisions).
 *
 * The reference tower (test/solutions.js) and solutions/brute-force.js are working
 * answers to the assignments, so they are kept out of the public repository. Without
 * them the checks that need a solution are skipped and the rest still run.
 */
const createTowerEngine = require('../js/sim.js');
const { levels, makeRandomLevel } = require('../js/levels.js');
const fs = require('fs');
const path = require('path');
const referencePath = path.join(__dirname, 'solutions.js');
const brutePath = path.join(__dirname, '../solutions/brute-force.js');
const reference = fs.existsSync(referencePath) ? require(referencePath).reference : null;
const brute = fs.existsSync(brutePath) ? fs.readFileSync(brutePath, 'utf8') : null;
if (!reference || !brute) {
  console.log('Note: solution files are not present (they are not published), so the ' +
    'solvability checks are skipped.');
}

const engine = createTowerEngine();
const verbose = process.argv.includes('-v');

function run(level, code) {
  const sim = engine.createSim(level, code);
  const lines = [];
  while (!sim.finished) {
    sim.step(100);
    for (const l of sim.drainLogs()) if (l.k === 'crash' || l.k === 'err') lines.push(engine.fmtTime(l.t) + ' ' + l.s);
  }
  return { r: sim.result(), lines };
}

let failed = 0;
const cases = levels.filter(l => !l.free).map(l => [l.name, l, l.starter]);
for (const seed of ['alpha', 'bravo', 'charlie', '1999', 'tower']) {
  cases.push(['Free Flight "' + seed + '"', makeRandomLevel(seed), null]);
}

for (const [name, level, starter] of cases) {
  console.log('\n' + name + '  (' + level.flights.length + ' flights)');
  if (starter) {
    const s = run(level, starter).r;
    const ok = s.collisions > 0;
    if (!ok) failed++;
    console.log('  starter    collisions ' + s.collisions + '  unfinished ' + s.unfinished +
      '  score ' + s.score + (ok ? '' : '   <-- FAIL: starter should collide'));
  }
  if (!reference) continue;
  const { r, lines } = run(level, reference);
  const ok = r.collisions === 0 && r.unfinished === 0 && r.errors === 0;
  // Random schedules are informational: the reference tower is not expected to ace them.
  if (!ok && starter) failed++;
  console.log('  reference  collisions ' + r.collisions + '  unfinished ' + r.unfinished +
    '  delay ' + r.delaySec + 's  extra fuel ' + r.extraFuel + 'kg  score ' + r.score +
    (ok ? '' : (starter ? '   <-- FAIL' : '   (informational)')));
  if (verbose || (!ok && starter)) lines.forEach(l => console.log('      ' + l));
}

// The short brute-force tower in solutions/ must also clear every assignment.
if (brute) {
  console.log('');
  for (const l of levels.filter(l => !l.free)) {
    const r = run(l, brute).r;
    const ok = r.collisions === 0 && r.unfinished === 0 && r.errors === 0;
    if (!ok) failed++;
    console.log('brute force  ' + l.name + '  collisions ' + r.collisions + '  score ' + r.score + (ok ? '' : '   <-- FAIL'));
  }
}

// flyTo: a detour lengthens the trip, shows in eta, and the plane still lands.
{
  const one = { seed: 1, flights: [{ id: 'TST1', kind: 'arrival', t: 0, fix: 'KRANE' }] };
  const direct = run(one, 'class MyTower extends Tower { onArrival(p) { p.clearToLand(); } }').r;
  const sim = engine.createSim(one, `class MyTower extends Tower {
    onArrival(p) { p.clearToLand(); this.before = p.eta; p.flyTo(8, 20); this.after = p.eta; this.p = p; }
    onTick(w) { if (w.time === 1) console.log(this.after > this.before + 60 && this.p.vector.y === 20 ? 'ETA-OK' : 'ETA-BAD'); }
  }`);
  let etaOk = false, reached = false;
  while (!sim.finished) {
    sim.step(1);
    for (const l of sim.drainLogs()) if (l.s === 'ETA-OK') etaOk = true;
    const p = sim.snapshot().planes[0];
    if (p && Math.hypot(p.x - 8, p.y - 20) < 0.8) reached = true;
  }
  const r = sim.result();
  const ok = etaOk && reached && r.unfinished === 0 && r.delaySec > 60 && direct.delaySec === 0;
  if (!ok) failed++;
  console.log('\nflyTo check ' + (ok ? 'passed' : 'FAILED') + '  (detour added ' + r.delaySec + 's of delay)');
}

// Determinism: the same inputs must give the same score.
const sameCode = reference || levels[3].starter;
const a = run(levels[3], sameCode).r, b = run(levels[3], sameCode).r;
if (JSON.stringify(a) !== JSON.stringify(b)) { failed++; console.log('\nFAIL: two identical runs gave different results'); }
else console.log('\nDeterminism check passed.');

process.exit(failed ? 1 : 0);
