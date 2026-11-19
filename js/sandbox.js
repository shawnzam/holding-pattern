/*
 * Runs the simulation and the player's code together in a Web Worker.
 *
 * The worker has no access to the page. If the player's code never returns
 * (an infinite loop, say), the watchdog here kills the worker and reports it.
 * The worker is built from text so the game also works when index.html is
 * opened straight from disk.
 */
var TowerSandbox = (function () {
  'use strict';

  function workerMain() {
    var engine = createTowerEngine();
    var post = self.postMessage.bind(self);
    var sim = null;
    self.onmessage = function (e) {
      var m = e.data;
      try {
        if (m.type === 'init') {
          sim = engine.createSim(m.level, m.code);
          post({ type: 'ready', snap: sim.snapshot(), logs: sim.drainLogs() });
        } else if (m.type === 'step' && sim) {
          sim.step(m.n);
          post({ type: 'state', snap: sim.snapshot(), logs: sim.drainLogs() });
        }
      } catch (err) {
        post({
          type: 'fatal', phase: m.type,
          message: (err && err.name ? err.name + ': ' : '') + (err && err.message !== undefined ? err.message : String(err))
        });
      }
    };
  }

  var INIT_TIMEOUT = 4000, STEP_TIMEOUT = 2500;

  function create(handlers) {
    var src = createTowerEngine.toString() + '\n(' + workerMain.toString() + ')();';
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    var worker = new Worker(url);
    var timer = null, dead = false;

    function arm(ms) {
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (dead) return;
        kill();
        handlers.onTimeout(ms);
      }, ms);
    }
    function kill() {
      dead = true;
      clearTimeout(timer);
      worker.terminate();
      URL.revokeObjectURL(url);
    }

    worker.onmessage = function (e) {
      if (dead) return;
      clearTimeout(timer);
      var m = e.data;
      if (m.type === 'ready') handlers.onReady(m.snap, m.logs);
      else if (m.type === 'state') handlers.onState(m.snap, m.logs);
      else if (m.type === 'fatal') { kill(); handlers.onFatal(m.message, m.phase); }
    };
    worker.onerror = function (e) {
      if (dead) return;
      kill();
      handlers.onFatal(e.message || 'The simulation worker failed to start.', 'worker');
    };

    return {
      init: function (level, code) {
        arm(INIT_TIMEOUT);
        worker.postMessage({ type: 'init', level: { seed: level.seed, flights: level.flights }, code: code });
      },
      step: function (n) {
        if (dead) return;
        arm(STEP_TIMEOUT);
        worker.postMessage({ type: 'step', n: n });
      },
      kill: kill
    };
  }

  return { create: create };
})();
