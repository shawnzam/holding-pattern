/* Holding Pattern -- wires the editor, the sandbox and the radar together. */
(function () {
  'use strict';

  var engine = createTowerEngine();
  var LEVELS = TOWER_LEVELS.levels;
  var $ = function (id) { return document.getElementById(id); };

  var store = {
    get: function (k) { try { return localStorage.getItem('towerjs.' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('towerjs.' + k, v); } catch (e) { /* private mode */ } },
    del: function (k) { try { localStorage.removeItem('towerjs.' + k); } catch (e) { /* private mode */ } }
  };

  var radar = TowerRadar($('radar'), engine);
  var levelIdx = 0, level = null;
  var sb = null;
  var phase = 'idle';          // idle | starting | running | paused | done
  var awaiting = false, acc = 0, lastFrame = 0;
  var snap = null, trails = {}, rows = [];
  var loading = false;

  function fmtClock(sec) {
    var m = Math.floor(sec / 60), r = Math.floor(sec % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function esc(t) {
    return String(t).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------------------------------------------------------- autocomplete */

  // What can follow a dot, by the kind of thing on the left of it.
  var HINTS = {
    plane: [
      ['id', 'callsign'], ['kind', '"arrival" or "departure"'], ['state', 'what it is doing now'],
      ['eta', 'seconds until touchdown'], ['distanceToRunway', 'miles left to fly'],
      ['x', 'miles from the left edge'], ['y', 'miles from the top edge'],
      ['heading', 'compass degrees'], ['speed', 'knots'], ['cleared', 'true once cleared'],
      ['isAirborne', 'true while flying'], ['entry', 'fix it came from'], ['exit', 'fix it is going to'],
      ['target', 'next point on its route'], ['waited', 'seconds of delay so far'],
      ['scheduledAt', 'second it appeared'], ['fuelBurned', 'kg so far'],
      ['clearToLand()', 'let an arrival land'], ['clearForTakeoff()', 'send a departure'],
      ['hold()', 'circle here'], ['resume()', 'stop circling'],
      ['flyTo(', 'detour to x, y, then rejoin the route'], ['vector', 'detour point, or null'],
      ['setSpeed(', 'knots, 160 to 220 (slow down only)'], ['distanceTo(', 'miles to an airplane or point']
    ],
    world: [
      ['time', 'seconds since the start'], ['planes', 'every airplane in the system'],
      ['arrivals', 'just the arrivals'], ['departures', 'just the departures'],
      ['waiting', 'departures not yet cleared'], ['runway', 'the runway'],
      ['fixes', 'named points on the map'], ['finalFix', 'the FINAL fix'],
      ['separation', '3 miles'], ['width', '48 miles'], ['height', '32 miles'],
      ['find(', 'look up an airplane by callsign']
    ],
    runway: [
      ['isClear', 'true when nobody is on it'], ['occupiedBy', 'airplane on it, or null'],
      ['threshold', 'where landings touch down'], ['end', 'where takeoffs lift off'], ['name', '"09"']
    ],
    point: [['x', 'miles from the left edge'], ['y', 'miles from the top edge'], ['name', 'name of the fix']],
    fixes: Object.keys(engine.FIXES).map(function (k) { return [k, engine.FIXES[k].type + ' fix']; }),
    console: [['log(', 'print; objects can be opened'], ['table(', 'print a list as a table'],
      ['warn(', 'print in amber'], ['error(', 'print in red']],
    array: [['length', ''], ['push(', 'add to the end'], ['shift()', 'remove the first'], ['filter(', ''],
      ['map(', ''], ['forEach(', ''], ['find(', ''], ['some(', ''], ['every(', ''], ['sort(', ''],
      ['includes(', ''], ['indexOf(', ''], ['slice(', ''], ['splice(', ''], ['pop()', 'remove the last']],
    Math: [['abs(', ''], ['min(', ''], ['max(', ''], ['hypot(', 'distance from dx, dy'], ['sqrt(', ''],
      ['round(', ''], ['floor(', ''], ['ceil(', ''], ['atan2(', ''], ['sin(', ''], ['cos(', ''], ['PI', '']],
    top: [['world', ''], ['plane', ''], ['this', 'your tower'], ['console', ''], ['Math', ''],
      ['const', ''], ['let', ''], ['for', ''], ['if', ''], ['else', ''], ['return', ''], ['while', ''],
      ['true', ''], ['false', ''], ['null', ''], ['Infinity', '']]
  };
  var RECEIVER = {
    world: 'world', w: 'world', runway: 'runway', fixes: 'fixes', finalFix: 'point', threshold: 'point',
    end: 'point', target: 'point', console: 'console', Math: 'Math', planes: 'array', arrivals: 'array',
    departures: 'array', waiting: 'array', occupiedBy: 'plane'
  };
  var RETURNS_ARRAY = { filter: 1, map: 1, slice: 1, sort: 1, concat: 1, splice: 1, reverse: 1 };
  var NOT_METHODS = { if: 1, for: 1, while: 1, switch: 1, catch: 1, function: 1, constructor: 1 };

  function towerHint(cm, options) {
    var cur = cm.getCursor(), line = cm.getLine(cur.line), end = cur.ch, start = end;
    while (start > 0 && /[\w$]/.test(line.charAt(start - 1))) start--;
    var word = line.slice(start, end), src = cm.getValue(), items, m, seen = {};

    if (line.charAt(start - 1) === '.') {
      m = /([\w$]+)\s*(\[[^\]]*\]|\([^)]*\))?\s*$/.exec(line.slice(0, start - 1));
      var recv = m ? m[1] : '', tail = m && m[2] ? m[2].charAt(0) : '';
      var arrays = {};
      src.replace(/this\.([A-Za-z_$][\w$]*)\s*=\s*(\[|new Array)/g, function (_, n) { arrays[n] = 1; });
      var kind;
      if (/^\d+$/.test(recv) || !recv) return null;
      if (recv === 'this' && !tail) {
        items = [];
        src.replace(/this\.([A-Za-z_$][\w$]*)/g, function (_, n) {
          if (!seen[n] && n !== word) { seen[n] = 1; items.push([n, arrays[n] ? 'your list' : 'yours']); }
        });
        src.replace(/^\s*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm, function (_, n) {
          if (!seen[n] && !NOT_METHODS[n]) { seen[n] = 1; items.push([n + '(', 'your method']); }
        });
      } else {
        if (tail === '[') kind = recv === 'fixes' ? 'point' : 'plane';
        else if (tail === '(') kind = RETURNS_ARRAY[recv] ? 'array' : 'plane';
        else kind = RECEIVER[recv] || (arrays[recv] ? 'array' : 'plane');
        items = HINTS[kind];
      }
    } else {
      if (word.length < 2 && !options.explicit) return null;
      items = HINTS.top.slice();
      items.forEach(function (i) { seen[i[0]] = 1; });
      src.replace(/[A-Za-z_$][\w$]{2,}/g, function (n) {
        if (!seen[n] && n !== word) { seen[n] = 1; items.push([n, '']); }
      });
    }

    var lw = word.toLowerCase();
    var list = items.filter(function (i) { return i[0].toLowerCase().indexOf(lw) === 0 && i[0] !== word; });
    if (word) {
      list = list.concat(items.filter(function (i) { return i[0].toLowerCase().indexOf(lw) > 0; }));
    }
    if (!list.length) return null;
    return {
      from: CodeMirror.Pos(cur.line, start), to: CodeMirror.Pos(cur.line, end),
      list: list.slice(0, 40).map(function (i) {
        return {
          text: i[0],
          render: function (li) {
            var a = document.createElement('span'); a.className = 'hn'; a.textContent = i[0].replace(/\($/, '()');
            var b = document.createElement('span'); b.className = 'hd'; b.textContent = i[1];
            li.appendChild(a); li.appendChild(b);
          }
        };
      })
    };
  }

  function suggest(cm, explicit) {
    if (!cm.showHint) return;
    cm.showHint({ hint: towerHint, completeSingle: false, explicit: explicit });
  }

  /* ---------------------------------------------------------------- editor */

  var editor = (function () {
    var ta = $('code'), cm = null;
    var syntaxMarks = [], runtimeLines = [], lintTimer = null, lastSyntax = null;

    // Finds the first syntax error, or null. Uses the Acorn parser when it loaded;
    // without it we cannot say where an error is, so we report nothing here and
    // let the simulation's own compile step complain.
    function findSyntaxError(code) {
      if (!window.acorn) return null;
      try {
        acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
        return null;
      } catch (e) {
        if (!e || !e.loc) return null;
        var msg = String(e.message).replace(/\s*\(\d+:\d+\)\s*$/, '');
        var text = code.split('\n')[e.loc.line - 1] || '';
        if (msg === 'Unexpected token') {
          // The parser only says where it gave up. Say what it found there, and guess why.
          var found = text.charAt(e.loc.column);
          var count = function (str, ch) { return str.split(ch).length - 1; };
          msg = found ? 'Unexpected "' + found + '"' : 'The code ends too soon';
          if (count(text, '(') > count(text, ')')) msg += '. A ")" seems to be missing on this line';
          else if (count(text, '[') > count(text, ']')) msg += '. A "]" seems to be missing on this line';
          else if (!found && count(code, '{') > count(code, '}')) msg += '. A "}" is probably missing';
        }
        return { line: e.loc.line, col: e.loc.column, message: msg };
      }
    }

    function gutterMark(cls, title) {
      var m = document.createElement('div');
      m.className = 'err-mark ' + cls;
      m.textContent = '●';
      m.title = title;
      return m;
    }

    function clearSyntax() {
      if (!cm) return;
      syntaxMarks.forEach(function (m) { m(); });
      syntaxMarks = [];
    }
    function clearRuntime() {
      if (!cm) return;
      runtimeLines.forEach(function (h) {
        cm.removeLineClass(h, 'background', 'line-runtime');
        cm.setGutterMarker(h, 'err-gutter', null);
      });
      runtimeLines = [];
    }

    function showSyntax(err) {
      clearSyntax();
      lastSyntax = err;
      var st = $('status');
      if (!err) {
        if (st.classList.contains('bad')) { st.classList.remove('bad'); st.textContent = 'Applet started.'; }
        return;
      }
      st.classList.add('bad');
      st.textContent = 'Syntax error on line ' + err.line + ': ' + err.message;
      if (!cm) return;
      var ln = Math.min(err.line - 1, cm.lastLine()), text = cm.getLine(ln) || '';
      // Underline the token the parser stopped at; at the end of a line, the last character.
      var from = Math.min(err.col, text.length), to = from + 1;
      var tok = cm.getTokenAt({ line: ln, ch: from + 1 });
      if (tok && tok.string.trim() && tok.start <= from) { from = tok.start; to = tok.end; }
      if (from >= text.length) { from = Math.max(0, text.length - 1); to = text.length; }
      var handle = cm.addLineClass(ln, 'background', 'line-error');
      cm.setGutterMarker(ln, 'err-gutter', gutterMark('', err.message));
      var mark = to > from ? cm.markText({ line: ln, ch: from }, { line: ln, ch: to },
        { className: 'cm-squiggle', title: err.message }) : null;
      syntaxMarks.push(function () {
        cm.removeLineClass(handle, 'background', 'line-error');
        cm.setGutterMarker(handle, 'err-gutter', null);
        if (mark) mark.clear();
      });
    }

    function lint() {
      var err = findSyntaxError(api.get());
      showSyntax(err);
      return err;
    }

    function changed() {
      clearRuntime();
      clearTimeout(lintTimer);
      // Wait for a pause in typing, so half-written lines are not flagged at every key.
      lintTimer = setTimeout(lint, 700);
      if (!loading && level) store.set('code.' + level.id, api.get());
    }

    if (window.CodeMirror) {
      cm = CodeMirror.fromTextArea(ta, {
        mode: 'javascript', lineNumbers: true, indentUnit: 2, tabSize: 2, matchBrackets: true,
        gutters: ['err-gutter', 'CodeMirror-linenumbers'],
        extraKeys: {
          Tab: function (c) {
            if (c.somethingSelected()) c.indentSelection('add');
            else c.replaceSelection('  ', 'end');
          },
          'Shift-Tab': function (c) { c.indentSelection('subtract'); },
          'Ctrl-Enter': function () { run(); },
          'Cmd-Enter': function () { run(); },
          'Ctrl-Space': function (c) { suggest(c, true); },
          'Cmd-/': function () { api.comment(); },
          'Ctrl-/': function () { api.comment(); },
          'Shift-Alt-F': function () { formatCode(); }
        }
      });
      cm.on('change', changed);
      cm.on('inputRead', function (c, change) {
        if (change.origin !== '+input' || !change.text[0]) return;
        if (/[\w$.]/.test(change.text[0].slice(-1))) suggest(c, false);
      });
    } else {
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var a = ta.selectionStart, b = ta.selectionEnd;
          ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(b);
          ta.selectionStart = ta.selectionEnd = a + 2;
          changed();
        }
      });
      ta.addEventListener('input', changed);
    }
    var api = {
      get: function () { return cm ? cm.getValue() : ta.value; },
      set: function (v) {
        if (cm) { cm.setValue(v); cm.clearHistory(); } else ta.value = v;
        clearTimeout(lintTimer);
        lint();
      },
      refresh: function () { if (cm) cm.refresh(); },
      focus: function () { if (cm) cm.focus(); else ta.focus(); },
      // Comments the current line or the selected lines out, or back in.
      comment: function () {
        if (cm && cm.toggleComment) { cm.toggleComment({ indent: true }); cm.focus(); }
      },
      // Replaces the whole text but keeps undo history, the cursor and the scroll position.
      replaceAll: function (text) {
        if (!cm) { ta.value = text; changed(); return; }
        var cur = cm.getCursor(), scroll = cm.getScrollInfo();
        cm.operation(function () {
          cm.replaceRange(text, { line: 0, ch: 0 }, { line: cm.lastLine(), ch: cm.getLine(cm.lastLine()).length });
          cm.setCursor({ line: Math.min(cur.line, cm.lastLine()), ch: cur.ch });
          cm.scrollTo(scroll.left, scroll.top);
        });
      },
      // Fixes indentation only; used when the full formatter is unavailable.
      reindent: function () {
        if (!cm) return;
        cm.operation(function () { for (var i = 0; i <= cm.lastLine(); i++) cm.indentLine(i, 'smart'); });
      },
      // Checks the code now. Returns { line, col, message } or null.
      lint: function () { clearTimeout(lintTimer); return lint(); },
      // Puts the cursor on a line (1-based) and brings it into view.
      goto: function (line, col) {
        if (cm) {
          var ln = Math.max(0, Math.min(line - 1, cm.lastLine()));
          cm.setCursor({ line: ln, ch: col || 0 });
          cm.scrollIntoView({ line: ln, ch: col || 0 }, 80);
          cm.focus();
        } else {
          var lines = ta.value.split('\n'), pos = 0;
          for (var i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
          ta.focus();
          ta.setSelectionRange(pos, pos + (lines[line - 1] || '').length);
        }
      },
      // Marks a line where the running tower threw an error.
      markRuntime: function (line, message) {
        if (!cm || line < 1 || line > cm.lineCount()) return;
        var h = cm.addLineClass(line - 1, 'background', 'line-runtime');
        cm.setGutterMarker(line - 1, 'err-gutter', gutterMark('runtime', message));
        runtimeLines.push(h);
      },
      clearRuntime: clearRuntime
    };
    return api;
  })();

  /* ---------------------------------------------------------------- format */

  // The formatter (Prettier) is large, so it is fetched the first time Format is used.
  var prettierLoading = null;
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  function getPrettier() {
    if (!prettierLoading) {
      var base = 'https://cdn.jsdelivr.net/npm/prettier@3.3.3/';
      prettierLoading = loadScript(base + 'standalone.js').then(function () {
        return Promise.all([loadScript(base + 'plugins/babel.js'), loadScript(base + 'plugins/estree.js')]);
      }).catch(function (e) { prettierLoading = null; throw e; });
    }
    return prettierLoading;
  }

  function formatCode() {
    selectTab('code');
    var bad = editor.lint();
    if (bad) {
      // A formatter cannot lay out code it cannot read.
      editor.goto(bad.line, bad.col);
      return;
    }
    var code = editor.get();
    setStatus('Formatting ...');
    getPrettier().then(function () {
      return prettier.format(code, {
        parser: 'babel', plugins: [prettierPlugins.babel, prettierPlugins.estree], printWidth: 88, tabWidth: 2
      });
    }).then(function (out) {
      if (editor.get() !== code) { setStatus('The code changed while formatting; nothing was altered.'); return; }
      if (out !== code) editor.replaceAll(out);
      setStatus(out !== code ? 'Code formatted.' : 'Code was already tidy.');
    }, function () {
      editor.reindent();
      setStatus('The formatter could not be loaded, so only the indentation was fixed.');
    });
    editor.focus();
  }

  /* --------------------------------------------------------------- console */

  var con = $('console'), conLines = 0;
  var coachLines = [], lastResult = '';
  function conClear() { con.textContent = ''; conLines = 0; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  // One-line summary of an object, shown next to its arrow.
  function brief(n) {
    if (n.t === 'str') return JSON.stringify(n.v.length > 24 ? n.v.slice(0, 24) + '...' : n.v);
    if (n.t !== 'obj') return n.v;
    return n.label || (n.arr ? '[...]' : '{...}');
  }
  function preview(n) {
    if (!n.props) return n.arr ? '[...]' : '{...}';
    var bits = n.props.slice(0, 5).map(function (p) {
      return n.arr ? brief(p[1]) : p[0] + ': ' + brief(p[1]);
    });
    if (n.props.length > 5 || n.more) bits.push('...');
    return n.arr ? '[' + bits.join(', ') + ']' : '{' + bits.join(', ') + '}';
  }

  function renderNode(n, nested) {
    if (n.t === 'table') {
      var tb = el('table', 'ct'), hr = el('tr');
      n.cols.forEach(function (c) { hr.appendChild(el('th', '', c)); });
      tb.appendChild(hr);
      n.rows.forEach(function (r) {
        var tr = el('tr');
        r.forEach(function (c) { tr.appendChild(el('td', '', c)); });
        tb.appendChild(tr);
      });
      return tb;
    }
    if (n.t !== 'obj') return el('span', 'v-' + n.t, n.t === 'str' && nested ? JSON.stringify(n.v) : n.v);

    var wrap = el('span', 'o'), head = el('span', 'oh');
    var arrow = el('span', 'arrow', n.props ? '\u25b8' : '');
    head.appendChild(arrow);
    if (n.label) head.appendChild(el('span', 'ol', n.label + ' '));
    head.appendChild(document.createTextNode(preview(n)));
    wrap.appendChild(head);
    if (n.props) {
      var kids = null;
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', 'false');
      var toggle = function () {
        if (!kids) {
          kids = el('div', 'oc');
          n.props.forEach(function (p) {
            var row = el('div');
            row.appendChild(el('span', 'k', p[0]));
            row.appendChild(document.createTextNode(': '));
            row.appendChild(renderNode(p[1], true));
            kids.appendChild(row);
          });
          if (n.more) kids.appendChild(el('div', 'v-ref', '(more not shown)'));
          kids.hidden = true;
          wrap.appendChild(kids);
        }
        kids.hidden = !kids.hidden;
        arrow.textContent = kids.hidden ? '\u25b8' : '\u25be';
        head.setAttribute('aria-expanded', kids.hidden ? 'false' : 'true');
      };
      head.addEventListener('click', toggle);
      head.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });
    }
    return wrap;
  }

  function conAdd(t, kind, text, parts, line) {
    var div = el('div', kind);
    if (line) {
      // Errors that name a line take you to it.
      div.classList.add('jump');
      div.title = 'Go to line ' + line;
      div.addEventListener('click', function () { selectTab('code'); editor.goto(line); });
    }
    div.appendChild(el('span', 't', (t === null ? '       ' : engine.fmtTime(t)) + '  '));
    if (parts) {
      parts.forEach(function (p, i) {
        if (i) div.appendChild(document.createTextNode(' '));
        div.appendChild(typeof p === 'string' ? document.createTextNode(p) : renderNode(p, false));
      });
    } else {
      div.appendChild(document.createTextNode(text));
    }
    con.appendChild(div);
    if (++conLines > 700) { con.removeChild(con.firstChild); conLines--; }
  }
  function conFlush(logs) {
    if (!logs || !logs.length) return;
    var stick = con.scrollTop + con.clientHeight >= con.scrollHeight - 30;
    for (var i = 0; i < logs.length; i++) {
      conAdd(logs[i].t, logs[i].k, logs[i].s, logs[i].parts, logs[i].line);
      if (logs[i].line) editor.markRuntime(logs[i].line, logs[i].s);
      // The coach gets the player's own output, warnings, errors and collisions; not the radio chatter.
      if (logs[i].k !== 'radio' && logs[i].k !== 'sys') {
        coachLines.push(engine.fmtTime(logs[i].t) + ' ' + logs[i].s);
        if (coachLines.length > 60) coachLines.shift();
      }
    }
    if (stick) con.scrollTop = con.scrollHeight;
  }
  $('conClear').addEventListener('click', conClear);
  $('conMine').addEventListener('change', function () {
    con.classList.toggle('mine', $('conMine').checked);
    con.scrollTop = con.scrollHeight;
  });

  function setStatus(t) { $('status').classList.remove('bad'); $('status').textContent = t; }

  /* ---------------------------------------------------------------- dialog */

  var dialogOnOk = null;
  function showDialog(title, html, opts) {
    opts = opts || {};
    $('dialogTitle').textContent = title;
    $('dialogBody').innerHTML = html;
    $('dialogOk').textContent = opts.okLabel || 'OK';
    $('dialogCancel').hidden = !opts.onOk;
    dialogOnOk = opts.onOk || null;
    $('dialogVeil').classList.add('open');
    $('dialogOk').focus();
  }
  function closeDialog() { $('dialogVeil').classList.remove('open'); dialogOnOk = null; }
  $('dialogOk').addEventListener('click', function () {
    var fn = dialogOnOk;
    closeDialog();
    if (fn) fn();
  });
  $('dialogCancel').addEventListener('click', closeDialog);
  $('dialogVeil').addEventListener('click', function (e) { if (e.target === $('dialogVeil')) closeDialog(); });

  /* ---------------------------------------------------------------- levels */

  function bestKey() { return 'best.' + level.id + (level.free ? '.' + level.seedText : ''); }
  function showBest() {
    var b = store.get(bestKey());
    $('statusBest').textContent = 'Best: ' + (b === null ? 'none' : b + ' pts') +
      (b !== null && b.slice(-1) === '*' ? '  (* coach-assisted)' : '');
  }
  function assistedKey() { return 'assisted.' + level.id + (level.free ? '.' + level.seedText : ''); }
  function isAssisted() { return store.get(assistedKey()) === '1'; }

  function buildLevel(idx) {
    var def = LEVELS[idx];
    if (!def.free) return def;
    var seedText = ($('seed').value || 'tower').trim() || 'tower';
    var gen = TOWER_LEVELS.makeRandomLevel(seedText);
    return {
      id: def.id, name: 'Free Flight "' + seedText + '"', file: def.file, free: true, seedText: seedText,
      seed: gen.seed, flights: gen.flights, starter: def.starter, brief: def.brief
    };
  }

  function buildTable() {
    var tb = $('strips');
    tb.textContent = '';
    rows = level.flights.map(function (f) {
      var tr = document.createElement('tr');
      var arr = f.kind === 'arrival';
      tr.innerHTML = '<td>' + esc(f.id) + '</td>' +
        '<td class="' + (arr ? 'arr' : 'dep') + '">' + (arr ? 'ARR' : 'DEP') + '</td>' +
        '<td>' + (arr ? 'from ' : 'to ') + esc(f.fix) + '</td>' +
        '<td class="num">' + engine.fmtTime(f.t) + '</td><td>-</td><td class="num"></td>';
      tb.appendChild(tr);
      return { tr: tr, st: tr.children[4], dl: tr.children[5], last: '', lastD: -1 };
    });
  }

  var STATUS = {
    scheduled: '-', gate: 'AT GATE', takeoff: 'TAKEOFF ROLL', outbound: 'OUTBOUND', inbound: 'INBOUND',
    holding: 'HOLDING', final: 'FINAL', landing: 'LANDING', landed: 'LANDED', departed: 'DEPARTED'
  };
  function updateTable(s) {
    var alert = {};
    s.planes.forEach(function (p) { if (p.al) alert[p.id] = true; });
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], st = s.flights[i][0], d = s.flights[i][1];
      var key = st + (alert[level.flights[i].id] ? '!' : '');
      if (key !== r.last) {
        r.last = key;
        r.st.textContent = STATUS[st] || st;
        r.tr.className = alert[level.flights[i].id] ? 'alert'
          : (st === 'landed' || st === 'departed') ? 'done'
          : st === 'scheduled' ? '' : 'active';
      }
      if (d !== r.lastD) { r.lastD = d; r.dl.textContent = d > 0 ? fmtClock(d) : ''; }
    }
  }

  function updateStats(s) {
    $('stTime').textContent = engine.fmtTime(s ? s.time : 0);
    var nA = level.flights.filter(function (f) { return f.kind === 'arrival'; }).length;
    var nD = level.flights.length - nA;
    $('stLanded').textContent = (s ? s.stats.landed : 0) + '/' + nA;
    $('stDeparted').textContent = (s ? s.stats.departed : 0) + '/' + nD;
    $('stColl').textContent = s ? s.stats.collisions : 0;
    $('stCollBox').classList.toggle('bad', !!(s && s.stats.collisions));
    $('stDelay').textContent = fmtClock(s ? s.stats.delaySec : 0);
    $('stFuel').textContent = (s ? s.stats.fuel : 0) + ' kg';
  }

  function loadLevel(idx) {
    stopSim();
    levelIdx = idx;
    level = buildLevel(idx);
    store.set('level', String(idx));
    $('freeBox').hidden = !level.free;
    $('radarTitle').textContent = 'Radar - ' + level.name;
    $('editorTitle').textContent = 'MyTower.js - ' + level.file;
    $('pane-brief').innerHTML = level.brief;
    loading = true;
    editor.set(store.get('code.' + level.id) || level.starter);
    loading = false;
    buildTable();
    snap = null; trails = {};
    updateStats(null);
    showBest();
    conClear();
    conAdd(null, 'sys', level.name + ' loaded. ' + level.flights.length + ' flights on the schedule.');
    conAdd(null, 'sys', 'Press Run to start your tower.');
    coachLines = []; lastResult = '';
    coachReset();
    setStatus('Applet started.');
    setPhase('idle');
    redraw();
  }

  /* ------------------------------------------------------------ simulation */

  function setPhase(p) {
    phase = p;
    var active = p === 'running' || p === 'paused' || p === 'starting';
    $('btnRunLabel').textContent = p === 'paused' ? 'Resume' : 'Run';
    $('btnRun').disabled = p === 'running' || p === 'starting';
    $('btnPause').disabled = p !== 'running';
    $('btnReset').disabled = !(active || p === 'done');
  }

  function stopSim() {
    if (sb) { sb.kill(); sb = null; }
    awaiting = false; acc = 0;
  }

  function redraw() {
    var banner = phase === 'idle' ? 'READY' : phase === 'paused' ? 'PAUSED' : phase === 'starting' ? 'COMPILING' : null;
    radar.draw(snap, trails, { banner: banner, blink: Math.floor(Date.now() / 250) % 2 === 0 });
  }

  function applySnap(s, logs) {
    snap = s;
    var seen = {}, i, p, t;
    for (i = 0; i < s.planes.length; i++) {
      p = s.planes[i]; seen[p.id] = true;
      if (p.st === 'landing' || p.st === 'takeoff') continue;
      t = trails[p.id] || (trails[p.id] = { kind: p.kind, pts: [], at: -99 });
      if (s.time - t.at >= 7) {
        t.at = s.time; t.pts.push({ x: p.x, y: p.y });
        if (t.pts.length > 8) t.pts.shift();
      }
    }
    for (var id in trails) if (!seen[id]) delete trails[id];
    conFlush(logs);
    updateStats(s);
    updateTable(s);
    redraw();
  }

  function run() {
    if (phase === 'running' || phase === 'starting') return;
    if (phase === 'paused') { setPhase('running'); setStatus('Applet running.'); return; }
    start();
  }

  function start() {
    stopSim();
    closeDialog();
    conClear();
    coachLines = []; lastResult = '';
    trails = {}; snap = null;
    buildTable();
    updateStats(null);
    editor.clearRuntime();

    // Do not start a tower that cannot be read: show where the mistake is instead.
    var bad = editor.lint();
    if (bad) {
      var msg = 'MyTower.js, line ' + bad.line + ': ' + bad.message;
      conAdd(null, 'err', 'Syntax error. ' + msg, null, bad.line);
      conAdd(null, 'sys', 'The line is marked in the editor. Fix it and press Run again.');
      coachLines.push('Syntax error in ' + msg);
      selectBottom('console');
      selectTab('code');
      editor.goto(bad.line, bad.col);
      setPhase('idle');
      redraw();
      return;
    }
    setPhase('starting');
    setStatus('Compiling MyTower.js ...');
    redraw();
    awaiting = true;
    sb = TowerSandbox.create({
      onReady: function (s, logs) {
        awaiting = false;
        setPhase('running');
        setStatus('Applet running.');
        applySnap(s, logs);
      },
      onState: function (s, logs) {
        awaiting = false;
        applySnap(s, logs);
        if (s.done) finish(s.result);
      },
      onFatal: function (msg, where) {
        sb = null; awaiting = false;
        coachLines.push(where === 'init' ? 'MyTower.js did not compile: ' + msg : 'The simulation stopped: ' + msg);
        conAdd(null, 'err', where === 'init'
          ? 'MyTower.js did not compile: ' + msg
          : 'The simulation stopped: ' + msg);
        con.scrollTop = con.scrollHeight;
        setStatus(where === 'init' ? 'Compilation failed. See the Console.' : 'Simulation stopped. See the Console.');
        setPhase(snap ? 'done' : 'idle');
        redraw();
      },
      onTimeout: function () {
        sb = null; awaiting = false;
        coachLines.push('The tower code never returned (probably an endless loop) and was shut down.');
        conAdd(snap ? snap.time : null, 'err',
          'TowerTimeoutException: your tower did not answer within a few seconds and was shut down. ' +
          'Look for a loop that never ends.');
        con.scrollTop = con.scrollHeight;
        setStatus('Tower timed out. See the Console.');
        setPhase(snap ? 'done' : 'idle');
        redraw();
      }
    });
    sb.init(level, editor.get());
  }

  function finish(r) {
    stopSim();
    setPhase('done');
    setStatus('Simulation finished. Score: ' + r.score + ' penalty points.');
    var clean = r.collisions === 0 && r.unfinished === 0;
    var prev = store.get(bestKey());
    var star = isAssisted() ? '*' : '';
    var isBest = prev === null || r.score < parseFloat(prev);
    if (isBest) store.set(bestKey(), r.score + star);
    lastResult = 'Flights handled ' + r.handled + ' of ' + r.flights + ', collisions ' + r.collisions +
      ', delay ' + r.delaySec + ' s, extra fuel ' + r.extraFuel + ' kg, penalty score ' + r.score +
      (r.unfinished ? ', flights never finished ' + r.unfinished : '');
    showBest();
    conAdd(r.time, 'sys', 'Simulation finished. Collisions ' + r.collisions + ', delay ' + fmtClock(r.delaySec) +
      ', extra fuel ' + r.extraFuel + ' kg, score ' + r.score + '.');
    con.scrollTop = con.scrollHeight;
    var link = shareUrl(r.score, !!star);
    showDialog('Simulation Complete',
      '<div class="verdict ' + (clean ? 'good' : 'bad') + '">' +
      (clean ? 'CLEAN RUN: no collisions' : r.collisions ? 'INCIDENT REPORT FILED' : 'FLIGHTS LEFT STRANDED') + '</div>' +
      '<table>' +
      '<tr><td>Flights handled</td><td class="num">' + r.handled + ' / ' + r.flights + '</td><td class="num"></td></tr>' +
      '<tr><td>Collisions</td><td class="num">' + r.collisions + '</td><td class="num">' + r.collisionPts + '</td></tr>' +
      '<tr><td>Delay added</td><td class="num">' + fmtClock(r.delaySec) + '</td><td class="num">' + r.delayPts + '</td></tr>' +
      '<tr><td>Extra fuel burned</td><td class="num">' + r.extraFuel + ' kg</td><td class="num">' + r.fuelPts + '</td></tr>' +
      (r.unfinished ? '<tr><td>Flights never finished</td><td class="num">' + r.unfinished + '</td><td class="num">' + r.unfinishedPts + '</td></tr>' : '') +
      '<tr class="total"><td>Penalty points</td><td></td><td class="num">' + r.score + star + '</td></tr>' +
      '</table>' +
      (star ? '<p>* You used the coach on this schedule, so this score carries an asterisk.</p>' : '') +
      '<p>' + (isBest ? 'That is your best score on this schedule.' : 'Your best on this schedule is ' + esc(prev) + '.') +
      ' Lower is better.</p>' +
      (link ? '<p class="share"><input type="text" id="shareUrl" readonly aria-label="Link to this result" value="' + esc(link) + '">' +
      '<button type="button" class="btn" id="shareCopy">Copy link</button></p>' : ''));
    if (!link) return;
    $('shareUrl').addEventListener('focus', function () { this.select(); });
    $('shareCopy').addEventListener('click', function () {
      var box = $('shareUrl'), btn = this;
      var done = function () { btn.textContent = 'Copied'; };
      box.select();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(box.value).then(done, function () { try { if (document.execCommand('copy')) done(); } catch (e) { /* leave it selected */ } });
      } else {
        try { if (document.execCommand('copy')) done(); } catch (e) { /* leave it selected */ }
      }
    });
  }

  // A link that shows this score and schedule to someone else (see share-card.mjs).
  function shareUrl(score, assisted) {
    // The server accepts only plain seeds; other Free Flight seeds get no link.
    if (level.free && !/^[A-Za-z0-9 _.\-]{1,24}$/.test(level.seedText)) return '';
    var origin = /^https?:/.test(location.origin) ? location.origin : 'https://holdingpattern.dev';
    return origin + '/s?a=' + level.id + '&t=' + score + (assisted ? '&c=1' : '') +
      (level.free ? '&seed=' + encodeURIComponent(level.seedText) : '');
  }

  function resetSim() {
    stopSim();
    snap = null; trails = {};
    buildTable();
    updateStats(null);
    setStatus('Applet started.');
    setPhase('idle');
    redraw();
  }

  function frame(ts) {
    var dt = Math.min(0.25, (ts - lastFrame) / 1000 || 0);
    lastFrame = ts;
    if (phase === 'running' && sb && !awaiting) {
      acc += Number($('speed').value) * dt;
      var n = Math.floor(acc);
      if (n > 0) { acc -= n; awaiting = true; sb.step(n); }
    } else if (snap && snap.planes.some(function (p) { return p.al; })) {
      redraw();   // keep collision rings blinking while paused
    }
    requestAnimationFrame(frame);
  }

  /* ------------------------------------------------------------- UI wiring */

  function selectTab(name) {
    document.querySelectorAll('.tab').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
    });
    document.querySelectorAll('.pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'pane-' + name);
    });
    if (name === 'code') editor.refresh();
  }
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { selectTab(t.dataset.tab); });
  });

  // For testing: forget all saved code, scores and settings, then start fresh.
  // Reached from Help > About, or by opening the page with ?reset in the address.
  function wipe() {
    stopSim();
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('towerjs.') === 0) localStorage.removeItem(k);
      });
    } catch (e) { /* storage unavailable */ }
    location.replace(location.pathname);
  }
  if (/[?&]reset\b/.test(location.search)) { wipe(); return; }

  /* ----------------------------------------------------------------- coach */

  var coachHistory = [], coachBusy = false, coachOnline = null;
  var coachLog = $('coachLog');

  function selectBottom(name) {
    document.querySelectorAll('.tab2').forEach(function (t) {
      t.setAttribute('aria-selected', t.dataset.btab === name ? 'true' : 'false');
    });
    $('console').classList.toggle('active', name === 'console');
    $('coach').classList.toggle('active', name === 'coach');
    $('conClear').hidden = name !== 'console';
    document.querySelector('.console-frame').classList.toggle('coach-open', name === 'coach');
    if (name === 'console') con.scrollTop = con.scrollHeight;
    else coachLog.scrollTop = coachLog.scrollHeight;
  }
  document.querySelectorAll('.tab2').forEach(function (t) {
    t.addEventListener('click', function () { selectBottom(t.dataset.btab); });
  });

  // Just enough formatting for chat: code fences, `code`, **bold**.
  function coachFormat(text) {
    return text.split('```').map(function (part, i) {
      if (i % 2) return '<pre><code>' + esc(part.replace(/^[a-z]*\n/, '').replace(/\n$/, '')) + '</code></pre>';
      return esc(part).replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
    }).join('');
  }

  function coachAdd(kind, text) {
    var m = el('div', 'cm ' + kind);
    if (kind === 'user' || kind === 'coach') m.appendChild(el('div', 'who', kind === 'user' ? 'You' : 'Coach'));
    var body = el('div', 'body');
    if (kind === 'user') body.textContent = text; else body.innerHTML = coachFormat(text);
    m.appendChild(body);
    coachLog.appendChild(m);
    coachLog.scrollTop = coachLog.scrollHeight;
    return body;
  }

  function coachReset() {
    coachHistory = [];
    coachLog.textContent = '';
    if (coachOnline === false) {
      coachAdd('note', 'The coach is not available here. It needs the Holding Pattern server running with an API key.');
    } else {
      coachAdd('note', 'Stuck? Ask the coach. It can see your code and the console, and it will help you work ' +
        'the problem out. It will not write the solution for you.');
    }
  }

  function scheduleText() {
    return level.flights.slice(0, 60).map(function (f) {
      return engine.fmtTime(f.t) + ' ' + (f.kind === 'arrival' ? 'ARR ' + f.id + ' from ' : 'DEP ' + f.id + ' to ') + f.fix;
    }).join('\n');
  }

  function coachAsk(text) {
    coachBusy = true;
    $('coachSend').disabled = true;
    store.set(assistedKey(), '1');
    showBest();
    coachAdd('user', text);
    coachHistory.push({ role: 'user', content: text });
    var body = coachAdd('coach', ''), answer = '';
    body.innerHTML = '<span class="cursor"></span>';

    function done(ok) {
      coachBusy = false;
      $('coachSend').disabled = false;
      if (ok && answer.trim()) {
        coachHistory.push({ role: 'assistant', content: answer });
        body.innerHTML = coachFormat(answer);
      } else {
        coachHistory.pop();
        body.parentNode.remove();
      }
      coachLog.scrollTop = coachLog.scrollHeight;
    }

    fetch('api/coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        level: level.id, code: editor.get(), console: coachLines.join('\n'), result: lastResult,
        schedule: scheduleText(), messages: coachHistory.slice(-16)
      })
    }).then(function (res) {
      showLeft(res.headers.get('X-Coach-Left'));
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (j) {
          throw new Error(j.error || 'The coach could not be reached.');
        });
      }
      var reader = res.body.getReader(), dec = new TextDecoder();
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return;
          answer += dec.decode(r.value, { stream: true });
          var stick = coachLog.scrollTop + coachLog.clientHeight >= coachLog.scrollHeight - 40;
          body.innerHTML = coachFormat(answer) + '<span class="cursor"></span>';
          if (stick) coachLog.scrollTop = coachLog.scrollHeight;
          return pump();
        });
      }
      return pump();
    }).then(function () { done(true); }, function (e) {
      done(false);
      coachAdd('error', e.message || 'The coach could not be reached.');
    });
  }

  function showLeft(n) {
    if (n === null || n === undefined || n === '') return;
    $('coachLeft').textContent = n + ' left today';
  }

  function coachSubmit() {
    var text = $('coachInput').value.trim();
    if (!text || coachBusy) return;
    if (coachOnline === false) { coachReset(); return; }
    var go = function () { $('coachInput').value = ''; coachAsk(text); };
    if (store.get('coachAck') === '1') { go(); return; }
    showDialog('About the coach',
      '<p>The coach is an AI model (Claude Haiku). It teaches and gives hints; it will not write your tower.</p>' +
      '<p><b>Scores get an asterisk.</b> Once you ask the coach about a schedule, your scores on that schedule are marked with a *.</p>' +
      '<p>Your question, your code and your console output are sent to the Holding Pattern server and on to Anthropic to produce the answer.</p>',
      { okLabel: 'I understand', onOk: function () { store.set('coachAck', '1'); go(); } });
  }
  $('coachForm').addEventListener('submit', function (e) { e.preventDefault(); coachSubmit(); });
  $('coachInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); coachSubmit(); }
  });
  $('coachNew').addEventListener('click', function () { if (!coachBusy) coachReset(); });

  fetch('api/coach/status').then(function (r) { return r.ok ? r.json() : { enabled: false }; })
    .catch(function () { return { enabled: false }; })
    .then(function (s) {
      coachOnline = !!s.enabled;
      showLeft(s.left);
      if (!coachHistory.length) coachReset();
    });

  /* -------------------------------------------------------------- tutorial */

  // A short tour for first-time visitors. Skippable at every step (Skip, the
  // close box, or Esc) and never shown again once finished or skipped.
  var TOUR = [
    { at: null, title: 'Welcome to Holding Pattern',
      html: '<p>This is a programming game. You write the code for an airport control tower, and the applet flies the airplanes.</p>' +
            '<p>Get every airplane in and out without a collision, adding as little delay as you can.</p>' },
    { at: '.radar-frame', title: 'The radar',
      html: '<p>Airplanes appear here. Arrivals are yellow and departures are blue.</p>' +
            '<p>Each one has a circle around it. If two circles touch, the airplanes are too close and that counts as a collision.</p>' },
    { at: '.editor-frame', title: 'Your code', tab: 'code',
      html: '<p>This is your tower. The game calls these methods as things happen, and you fill them in.</p>' +
            '<p>The <b>Assignment</b> tab explains the task. The <b>API</b> tab lists everything you can call.</p>' },
    { at: '#btnRun', title: 'Run it',
      html: '<p>Press <b>Run</b> (or Ctrl+Enter) to try your tower.</p>' +
            '<p>The starter code crashes airplanes on purpose. Your job is to fix it.</p>' },
    { at: '.console-frame', title: 'Output and Coach',
      html: '<p><b>Output</b> shows what happened and anything you print with <code>console.log</code>.</p>' +
            '<p>Stuck? The <b>Coach</b> tab is an AI that gives hints. It will not write the answer for you.</p>' },
    { at: '.stats', title: 'Your score',
      html: '<p>Collisions cost 1000 points each. Delay and extra fuel cost points too.</p>' +
            '<p>Lower is better. Good luck.</p>' }
  ];
  var tourBox = null, tourStep = 0, tourMarked = null;

  function tourPlace() {
    if (!tourBox) return;
    var step = TOUR[tourStep], target = step.at ? document.querySelector(step.at) : null;
    var w = tourBox.offsetWidth, h = tourBox.offsetHeight, vw = window.innerWidth, vh = window.innerHeight, x, y;
    if (!target) { x = (vw - w) / 2; y = Math.max(20, (vh - h) / 3); }
    else {
      var r = target.getBoundingClientRect();
      x = r.left + (r.width - w) / 2;
      if (r.height > 220) y = r.top + 56;                    // big panel: sit inside it, near the top
      else if (r.bottom + h + 12 < vh) y = r.bottom + 12;      // small control: just below it
      else y = r.top - h - 12;                                 // no room below: above it
    }
    tourBox.style.left = Math.round(Math.max(8, Math.min(vw - w - 8, x))) + 'px';
    tourBox.style.top = Math.round(Math.max(8, Math.min(vh - h - 8, y))) + 'px';
  }

  function tourShow() {
    var step = TOUR[tourStep], last = tourStep === TOUR.length - 1;
    if (tourMarked) tourMarked.classList.remove('tour-target');
    tourMarked = step.at ? document.querySelector(step.at) : null;
    if (step.tab) selectTab(step.tab);
    if (tourMarked) {
      tourMarked.classList.add('tour-target');
      tourMarked.scrollIntoView({ block: 'nearest' });
    }
    tourBox.querySelector('.ttl').textContent = step.title;
    tourBox.querySelector('.tbody').innerHTML = step.html;
    tourBox.querySelector('.count').textContent = (tourStep + 1) + ' of ' + TOUR.length;
    tourBox.querySelector('.back').hidden = tourStep === 0;
    tourBox.querySelector('.skip').hidden = last;
    tourBox.querySelector('.next').textContent = last ? 'Start playing' : 'Next';
    tourPlace();
    tourBox.querySelector('.next').focus();
  }

  function tourEnd() {
    if (!tourBox) return;
    if (tourMarked) tourMarked.classList.remove('tour-target');
    tourBox.remove();
    tourBox = null; tourMarked = null;
    store.set('tourDone', '1');
    window.removeEventListener('resize', tourPlace);
  }

  function tourStart() {
    if (tourBox) tourEnd();
    closeDialog();
    tourStep = 0;
    tourBox = el('div', 'iframe tour');
    tourBox.setAttribute('role', 'dialog');
    tourBox.setAttribute('aria-label', 'Tutorial');
    tourBox.innerHTML =
      '<div class="titlebar"><span class="ico"></span><span class="ttl"></span><span class="grip"></span>' +
      '<button type="button" class="x" aria-label="Close the tutorial">x</button></div>' +
      '<div class="tbody"></div>' +
      '<div class="tfoot"><span class="count"></span>' +
      '<button type="button" class="btn skip">Skip</button>' +
      '<button type="button" class="btn back">Back</button>' +
      '<button type="button" class="btn next">Next</button></div>';
    document.body.appendChild(tourBox);
    tourBox.querySelector('.x').addEventListener('click', tourEnd);
    tourBox.querySelector('.skip').addEventListener('click', tourEnd);
    tourBox.querySelector('.back').addEventListener('click', function () { tourStep--; tourShow(); });
    tourBox.querySelector('.next').addEventListener('click', function () {
      if (tourStep === TOUR.length - 1) { tourEnd(); selectTab('brief'); return; }
      tourStep++; tourShow();
    });
    window.addEventListener('resize', tourPlace);
    tourShow();
  }

  var commands = {
    run: run,
    pause: function () { if (phase === 'running') { setPhase('paused'); setStatus('Paused.'); redraw(); } },
    reset: resetSim,
    resetCode: function () {
      store.del('code.' + level.id);
      loading = true; editor.set(level.starter); loading = false;
      selectTab('code');
      setStatus('Code reset to the starter for ' + level.file + '.');
    },
    import: function () {
      if (levelIdx === 0) { showDialog('Import', '<p>This is the first assignment, so there is nothing to import yet.</p>'); return; }
      var prev = LEVELS[levelIdx - 1];
      var code = store.get('code.' + prev.id);
      if (!code) { showDialog('Import', '<p>You have not written any code for ' + esc(prev.file) + ' yet.</p>'); return; }
      editor.set(code);
      store.set('code.' + level.id, code);
      selectTab('code');
      setStatus('Imported your code from ' + prev.file + '.');
    },
    clearConsole: conClear,
    tour: function () { tourStart(); },
    format: formatCode,
    comment: function () { selectTab('code'); editor.comment(); },
    showBrief: function () { selectTab('brief'); },
    showCoach: function () { selectBottom('coach'); $('coachInput').focus(); },
    showApi: function () { selectTab('api'); },
    about: function () {
      showDialog('About Holding Pattern',
        '<p><b>Holding Pattern</b> prototype</p>' +
        '<p>A programming assignment you can play. You write the control tower; the applet flies the airplanes.</p>' +
        '<p>Your code runs in a sandboxed worker inside this browser tab and is saved only on this computer.</p>' +
        '<p>Made by <a href="https://zamechek.com/" target="_blank" rel="noopener">Shawn Zamechek</a></p>' +
        '<p>Adapted from an assignment created by Chris Murphy for Penn\'s <a href="https://www.cis.upenn.edu/mcit/" target="_blank" rel="noopener">MCIT</a> program, summer 2013.</p>' +
        '<p><button type="button" class="btn" id="wipeBtn">Erase saved data</button></p>');
      $('wipeBtn').addEventListener('click', function () {
        if ($('wipeBtn').dataset.armed) { wipe(); return; }
        $('wipeBtn').dataset.armed = '1';
        $('wipeBtn').textContent = 'Click again to erase code and scores';
      });
    }
  };

  $('btnRun').addEventListener('click', run);
  $('btnPause').addEventListener('click', commands.pause);
  $('btnReset').addEventListener('click', resetSim);
  $('btnFormat').addEventListener('click', formatCode);
  $('btnSeed').addEventListener('click', function () { loadLevel(levelIdx); });
  $('seed').addEventListener('keydown', function (e) { if (e.key === 'Enter') loadLevel(levelIdx); });

  // menus
  var menus = document.querySelectorAll('.menu');
  function closeMenus() { menus.forEach(function (m) { m.classList.remove('open'); }); }
  menus.forEach(function (m) {
    m.firstElementChild.addEventListener('click', function (e) {
      var open = m.classList.contains('open');
      closeMenus();
      if (!open) m.classList.add('open');
      e.stopPropagation();
    });
    m.firstElementChild.addEventListener('mouseenter', function () {
      if (document.querySelector('.menu.open')) { closeMenus(); m.classList.add('open'); }
    });
    m.querySelectorAll('[data-cmd]').forEach(function (b) {
      b.addEventListener('click', function () { closeMenus(); commands[b.dataset.cmd](); });
    });
  });
  document.addEventListener('click', closeMenus);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeMenus(); closeDialog(); tourEnd(); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); run(); }
    // Cmd+/ comments code even when the cursor is not in the editor (say, just after
    // clicking Run), unless the player is typing to the coach.
    if (e.key === '/' && (e.ctrlKey || e.metaKey) && !e.defaultPrevented && e.target.id !== 'coachInput') {
      e.preventDefault();
      commands.comment();
    }
  });

  // assignment picker
  var sel = $('level');
  LEVELS.forEach(function (l, i) {
    var o = document.createElement('option');
    o.value = i; o.textContent = l.name;
    sel.appendChild(o);
  });
  sel.addEventListener('change', function () { loadLevel(Number(sel.value)); });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { radar.resize(); redraw(); }).observe($('radar'));
  } else {
    window.addEventListener('resize', function () { radar.resize(); redraw(); });
  }

  var startIdx = Number(store.get('level'));
  if (!(startIdx >= 0 && startIdx < LEVELS.length)) startIdx = 0;
  // A share link opens the schedule it is about: /?a=a3 or /?a=free&seed=...
  var asked = /[?&]a=([a-z0-9]+)/.exec(location.search);
  if (asked) {
    LEVELS.forEach(function (l, i) {
      if (l.id !== asked[1]) return;
      startIdx = i;
      var seed = /[?&]seed=([^&]*)/.exec(location.search);
      if (l.free && seed) { try { $('seed').value = decodeURIComponent(seed[1]).slice(0, 24); } catch (e) { /* bad escape */ } }
    });
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* not allowed here */ }
  }
  sel.value = startIdx;
  loadLevel(startIdx);
  if (!store.get('seenBrief')) { selectTab('brief'); store.set('seenBrief', '1'); }
  if (!store.get('tourDone')) tourStart();
  requestAnimationFrame(frame);
})();
