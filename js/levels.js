/*
 * Holding Pattern assignments: the schedules, the briefs and the starter code.
 * Loaded by the page and by the Node test runner.
 */
(function (root) {
  'use strict';

  var AIRLINES = ['JVA', 'APL', 'SWG', 'BYT', 'AWT', 'NUL'];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashSeed(s) {
    s = String(s);
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) || 1;
  }

  /* [kind, time, fix] rows become flights with callsigns. */
  function flights(rows) {
    var sorted = rows.slice().sort(function (a, b) { return a[1] - b[1]; });
    return sorted.map(function (r, i) {
      return {
        id: AIRLINES[(i * 5 + (r[0] === 'A' ? 0 : 3)) % AIRLINES.length] + (101 + i * 7),
        kind: r[0] === 'A' ? 'arrival' : 'departure',
        t: r[1], fix: r[2]
      };
    });
  }

  function makeRandomLevel(seed, opts) {
    opts = opts || {};
    var nArr = opts.arrivals || 10, nDep = opts.departures || 8, win = opts.window || 1200;
    var entries = opts.entries || ['KRANE', 'DUSTY', 'NORDO', 'BAYOU', 'ECHOS'];
    var exits = opts.exits || ['SUNUP', 'POLAR', 'TROPC'];
    var numeric = hashSeed(seed);
    var rng = mulberry32(numeric);
    var rows = [], byFix = {}, i, tries, t, fix, ok;
    for (i = 0; i < nArr; i++) {
      for (tries = 0; tries < 200; tries++) {
        t = Math.floor(rng() * win);
        fix = entries[Math.floor(rng() * entries.length)];
        ok = (byFix[fix] || []).every(function (u) { return Math.abs(u - t) >= 80; });
        if (ok) break;
      }
      if (!ok) continue;
      (byFix[fix] = byFix[fix] || []).push(t);
      rows.push(['A', t, fix]);
    }
    for (i = 0; i < nDep; i++) {
      rows.push(['D', 30 + Math.floor(rng() * win), exits[Math.floor(rng() * exits.length)]]);
    }
    return { seed: numeric, flights: flights(rows) };
  }

  /* ------------------------------------------------------------ starters */

  var HEADER = function (title) {
    return '/*\n * MyTower.js  --  ' + title + '\n *\n' +
      ' * The Tower base class calls these methods as things happen.\n' +
      ' * Fill in the stubs, then press Run.\n */\n';
  };

  var STARTER_1 = HEADER('Assignment 1: Runway 101') +
`class MyTower extends Tower {

  // Called once, before the first airplane appears.
  onStart(world) {
    this.queue = [];   // departures waiting for the runway
  }

  // Called when a departure is ready at the gate.
  onDepartureReady(plane, world) {
    // TODO: This clears every airplane the moment it is ready.
    // Two airplanes on one runway is a collision.
    // Put the airplane in this.queue instead.
    plane.clearForTakeoff();
  }

  // Called once per simulated second.
  onTick(world) {
    // TODO: when it is safe, clear the next airplane in this.queue.
    //
    //   world.runway.isClear    true when nobody is using the runway
    //   world.time              seconds since the start
    //   plane.clearForTakeoff() sends the airplane on its way
  }
}
`;

  var STARTER_2 = HEADER('Assignment 2: Mixed Traffic') +
`class MyTower extends Tower {

  onStart(world) {
    this.queue = [];
  }

  // Called when an arrival enters the airspace.
  onArrival(plane, world) {
    // Arrivals fly to the FINAL fix by themselves, but they need
    // clearance to land. Without it they circle at FINAL.
    plane.clearToLand();
  }

  onDepartureReady(plane, world) {
    // TODO: bring your queue over from Assignment 1.
    // (File > Import code from previous assignment)
    plane.clearForTakeoff();
  }

  onTick(world) {
    // TODO: a takeoff needs the runway for 40 seconds. Do not start
    // one when an arrival is about to touch down.
    //
    //   world.arrivals          every arrival now in the airspace
    //   plane.eta               seconds until this arrival touches down
    //   plane.state             "inbound", "holding", "final", "landing"
  }
}
`;

  var STARTER_3 = HEADER('Assignment 3: The Merge') +
`class MyTower extends Tower {

  onStart(world) {
    this.queue = [];
  }

  onArrival(plane, world) {
    // TODO: arrivals now come from four directions and meet at FINAL.
    // Clearing everybody at once puts them there at the same moment.
    //
    //   plane.eta               seconds until touchdown at this speed
    //   plane.setSpeed(knots)   160 to 220; 220 is the default and the top speed
    //   plane.hold()            circle where you are
    //   plane.resume()          stop circling
    //   plane.flyTo(x, y)       detour to a point, then rejoin the route
    //   plane.distanceTo(other) nautical miles to another airplane
    plane.clearToLand();
  }

  onDepartureReady(plane, world) {
    plane.clearForTakeoff();
  }

  onTick(world) {
  }
}
`;

  var STARTER_4 = HEADER('Assignment 4: Rush Hour') +
`class MyTower extends Tower {

  onStart(world) {
    this.queue = [];
  }

  onArrival(plane, world) {
    plane.clearToLand();
  }

  onDepartureReady(plane, world) {
    plane.clearForTakeoff();
  }

  onTick(world) {
    // Arrivals from ECHOS cross the path of departures to POLAR.
  }

  // Called whenever two airplanes get too close. Handy for debugging.
  onConflict(a, b, world) {
    console.log("too close:", a.id, b.id);
  }
}
`;

  var STARTER_FREE = HEADER('Free Flight') +
`class MyTower extends Tower {

  onStart(world) {
  }

  onArrival(plane, world) {
  }

  onDepartureReady(plane, world) {
  }

  onTick(world) {
  }

  onConflict(a, b, world) {
  }
}
`;

  /* -------------------------------------------------------------- levels */

  var levels = [
    {
      id: 'a1', name: 'Assignment 1: Runway 101', file: 'Assignment 1',
      seed: 1,
      flights: flights([
        ['D', 5, 'SUNUP'], ['D', 12, 'POLAR'], ['D', 20, 'TROPC'],
        ['D', 130, 'SUNUP'], ['D', 135, 'SUNUP'],
        ['D', 240, 'POLAR'], ['D', 246, 'TROPC'], ['D', 252, 'SUNUP']
      ]),
      starter: STARTER_1,
      brief:
        '<h3>Assignment 1: Runway 101</h3>' +
        '<p>Eight departures and one runway. Each airplane becomes ready at its scheduled time ' +
        'and waits at the gate until your tower clears it for takeoff.</p>' +
        '<p>The starter code clears every airplane the moment it is ready. Press <b>Run</b> and ' +
        'watch what happens, then fix it.</p>' +
        '<ul><li>A takeoff uses the runway for 40 seconds.</li>' +
        '<li>Two airplanes on the runway at once is a collision.</li>' +
        '<li>Two airplanes in the air closer than 3 nautical miles is also a collision. ' +
        'The circle around each airplane is 1.5 miles, so circles that touch are too close.</li></ul>' +
        '<p><b>Hint:</b> a clear runway is not the whole story. The airplane that just lifted off ' +
        'is still very close to the end of it.</p>'
    },
    {
      id: 'a2', name: 'Assignment 2: Mixed Traffic', file: 'Assignment 2',
      seed: 2,
      flights: flights([
        ['A', 0, 'KRANE'], ['A', 95, 'KRANE'], ['A', 190, 'KRANE'], ['A', 300, 'KRANE'], ['A', 420, 'KRANE'],
        ['D', 330, 'SUNUP'], ['D', 372, 'POLAR'], ['D', 380, 'TROPC'], ['D', 470, 'SUNUP'],
        ['D', 560, 'POLAR'], ['D', 575, 'SUNUP'], ['D', 680, 'TROPC'], ['D', 790, 'SUNUP']
      ]),
      starter: STARTER_2,
      brief:
        '<h3>Assignment 2: Mixed Traffic</h3>' +
        '<p>Arrivals join the departures. They enter at <b>KRANE</b>, fly to the <b>FINAL</b> fix, ' +
        'then straight in to runway 09. The same runway is used for landing and takeoff.</p>' +
        '<ul><li>An arrival needs <code>plane.clearToLand()</code> before it reaches FINAL, ' +
        'or it circles there.</li>' +
        '<li>A landing uses the runway for 45 seconds.</li>' +
        '<li>A departure must not start its roll if an arrival will touch down before it is gone.</li></ul>' +
        '<p>Delay is counted for every second an airplane spends waiting, on the ground or in the air. ' +
        'Waiting at the gate burns far less fuel than circling.</p>'
    },
    {
      id: 'a3', name: 'Assignment 3: The Merge', file: 'Assignment 3',
      seed: 3,
      flights: flights([
        ['A', 0, 'KRANE'], ['A', 4, 'DUSTY'],
        ['A', 224, 'KRANE'], ['A', 237, 'NORDO'],
        ['A', 445, 'DUSTY'], ['A', 457, 'BAYOU'],
        ['A', 660, 'KRANE'], ['A', 676, 'NORDO'], ['A', 690, 'BAYOU'],
        ['D', 100, 'SUNUP'], ['D', 300, 'POLAR'], ['D', 420, 'TROPC'], ['D', 560, 'SUNUP'],
        ['D', 700, 'POLAR']
      ]),
      starter: STARTER_3,
      brief:
        '<h3>Assignment 3: The Merge</h3>' +
        '<p>Arrivals now come in from four fixes: KRANE, DUSTY, NORDO and BAYOU. They all funnel ' +
        'through FINAL, and they are scheduled to get there in bunches.</p>' +
        '<p>Your tower has to put them in a line. You have three tools:</p>' +
        '<ul><li><code>plane.setSpeed(knots)</code> slows an airplane down (160 to 220; 220 is the default and the top speed).</li>' +
        '<li><code>plane.hold()</code> makes it circle in place until <code>plane.resume()</code>. ' +
        'One circle takes a minute.</li>' +
        '<li><code>plane.flyTo(x, y)</code> sends it on a detour, which makes its trip longer. ' +
        'It rejoins its route by itself.</li></ul>' +
        '<p><b>Hint:</b> work out when each arrival would touch down (<code>world.time + plane.eta</code>) ' +
        'and give each one its own landing time, spaced far enough apart.</p>'
    },
    {
      id: 'a4', name: 'Assignment 4: Rush Hour', file: 'Assignment 4',
      seed: makeRandomLevel('rush-hour-1999').seed,
      flights: makeRandomLevel('rush-hour-1999', { arrivals: 12, departures: 10, window: 1300 }).flights,
      starter: STARTER_4,
      brief:
        '<h3>Assignment 4: Rush Hour</h3>' +
        '<p>Everything at once. A fifth arrival stream enters at <b>ECHOS</b> in the north-east and ' +
        'flies west across the field to reach FINAL. That route crosses the path of departures ' +
        'heading to <b>POLAR</b>.</p>' +
        '<p>There is no new machinery here. This one is graded on the score: fewest penalty points wins.</p>' +
        '<ul><li>1 point per second of delay</li><li>1 point per 2 kg of extra fuel</li>' +
        '<li>1000 points per collision</li><li>2000 points per flight that never finishes</li></ul>'
    },
    {
      id: 'free', name: 'Free Flight', file: 'Free Flight', free: true,
      starter: STARTER_FREE,
      brief:
        '<h3>Free Flight</h3>' +
        '<p>No instructions and no starter logic. Type a seed in the toolbar to generate a schedule; ' +
        'the same seed always produces the same traffic, so you can compare towers fairly.</p>' +
        '<p>The full interface is on the <b>API</b> tab.</p>'
    }
  ];

  var api = { levels: levels, makeRandomLevel: makeRandomLevel };
  root.TOWER_LEVELS = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
