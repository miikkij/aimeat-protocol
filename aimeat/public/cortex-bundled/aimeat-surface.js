/**
 * @file aimeat-surface.js
 * @description The panel-spec surface engine: turn a person's plain-language request into ONE
 *   panel spec, resolve that spec's data source into rows, and render the rows through the node's
 *   own UI packs. Extracted from the TILA app v0.2.6 (TARGET-051), where the same engine was
 *   already isolated behind {KINDS, resolve, renderBody, compose, reshape, writeBrief, refine,
 *   autoColumns} but closed over that app's PRH company source, its i18n and its app id.
 *
 *   Here the DATA SOURCES ARE PLUGINS: `memory` and `inline` ship built in, and an app registers
 *   whatever else it can fetch — the registered sources assemble the composer's own prompt, so a
 *   source the app did not register is a source the model is never told about. That is what lets
 *   one engine serve both a single self-composing surface (TILA) and a spatial board of many
 *   frames (ORIGAMI) without either one owning the other's data.
 *
 *   The engine renders the panel BODY only. Card, frame, chrome, drag handles and persistence
 *   belong to the host app, which is why the same spec can be a card in one product and a frame
 *   on a canvas in another.
 * @structure
 *   - helpers: esc/uid/num/flatten/agg/fmtNum/autoColumns  (pure, exposed for hosts)
 *   - BUILT_IN sources: memory (owner-scope prefix read), inline
 *   - create(opts) → engine: registerSource, resolve, renderBody, specHint, normalizeSpec,
 *     compose, reshape, refine, writeBrief
 * @usage
 *   <script src="/v1/cortex/aimeat-surface/libs/aimeat-surface.js"></script>
 *   const surface = AIMEAT.surface.create({ appId: 'my-app', locale: 'fi' });
 *   surface.registerSource('companies', { hint: '{"type":"companies","names":["Nokia"]}', resolve: fetchCompanies });
 *   const spec = await surface.compose('show my AI spend per day', { prefixes });
 *   const rows = await surface.resolve(spec, { session });
 *   surface.renderBody(boxEl, spec, rows);
 * @version-history
 *   v1.1.0 — 2026-07-25 — Charts are left uncoloured so aimeat-charts can theme them: the engine
 *     hardcoded four Tailwind colours over the chart lib's palette, which pinned every surface
 *     chart to indigo no matter which of the five palettes the reader had chosen, or whether they
 *     were in light or dark mode.
 *   v1.0.0 — 2026-07-25 — Initial (TARGET-051 Slice 1): engine lifted out of tila.html v0.2.6
 *     behaviour-for-behaviour, including every graceful fallback (statTiles → daisyUI stats,
 *     ChartBuilder → warning, Timeline → <ul>, markdown → escaped <br>, DataTable → <table>).
 *     New: pluggable sources, injected locale/strings/appId, and an onPick callback so a host no
 *     longer has to wire the options button by hand.
 */
(function (global) {
  'use strict';

  var AIMEAT = global.AIMEAT = global.AIMEAT || {};
  if (AIMEAT.surface) return;

  var KINDS = ['stats', 'table', 'chart', 'timeline', 'brief', 'options'];

  var STRINGS = {
    en: { no_data: 'No data', err: 'Could not render this', rows_n: 'Rows', picked: 'picked', pick: 'Pick' },
    fi: { no_data: 'Ei dataa', err: 'Tätä ei voitu piirtää', rows_n: 'Rivejä', picked: 'valittu', pick: 'Valitse' },
  };

  var CSS = '.as-scroll { overflow-x: auto; max-width: 100%; }';
  var cssInjected = false;
  function injectCss() {
    if (cssInjected) return;
    var s = document.createElement('style');
    s.setAttribute('data-aimeat-surface', '1');
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    cssInjected = true;
  }

  function esc(s) {
    var d = document.createElement('div');
    d.textContent = String(s == null ? '' : s);
    return d.innerHTML;
  }
  function uid(p) { return (p || 'pnl') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function num(v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.,-]/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function agentOf(gaii) { return (gaii && String(gaii).indexOf('#') > 0) ? String(gaii).split('#')[0] : null; }
  async function unwrap(r) {
    if (!r) return null;
    if (typeof r.json === 'function') { try { return await r.json(); } catch (e) { return null; } }
    return r;
  }

  /**
   * Scalar view of a record so auto-picked columns show meaning (date, total_cost_usd, …)
   * instead of plumbing. Nested objects contribute their scalar leaves one level deep.
   */
  function flatten(v) {
    var out = {};
    Object.keys(v || {}).slice(0, 30).forEach(function (k) {
      var val = v[k];
      /* Float noise (0.07853924430000002) reads as broken data: keep it numeric, lose the tail. */
      if (typeof val === 'number' && !Number.isInteger(val)) { out[k] = Math.round(val * 1e6) / 1e6; return; }
      if (val === null || typeof val !== 'object') { out[k] = val; return; }
      if (Array.isArray(val)) { out[k + '_n'] = val.length; return; }
      Object.keys(val).slice(0, 6).forEach(function (ik) {
        var iv = val[ik];
        if (iv === null || typeof iv !== 'object') out[k + '_' + ik] = iv;
        else Object.keys(iv).slice(0, 4).forEach(function (jk) {
          if (iv[jk] === null || typeof iv[jk] !== 'object') out[ik + '_' + jk] = iv[jk];
        });
      });
    });
    return out;
  }

  /** Columns worth showing: skip near-empty fields and plumbing, prettify the labels. */
  function autoColumns(rows) {
    if (!rows.length) return [];
    var keys = Object.keys(rows[0]);
    /* When the record carries its own date, the storage timestamps and the key tail are
       duplicates of it: three columns saying the same thing is what makes a surface read
       like a log instead of an answer. */
    var hasDate = keys.indexOf('date') >= 0 || keys.indexOf('day') >= 0;
    var PLUMBING = hasDate ? ['author', 'updated_at', 'saved', 'id', 'updatedAt'] : ['author'];
    var scored = keys.filter(function (k) {
      if (PLUMBING.indexOf(k) >= 0) return false;
      var filled = 0, objish = false;
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i][k];
        if (v !== '' && v != null) filled++;
        if (v != null && typeof v === 'object') objish = true;
      }
      /* An object or array value has no useful cell rendering — it reaches a table as
         "[object Object]", which reads as broken data. Memory rows are flattened before they get
         here so they never hit this; inline rows the model wrote can. */
      if (objish) return false;
      return filled / rows.length > 0.2;
    });
    return scored.slice(0, 6).map(function (k) {
      return {
        key: k,
        label: k.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }),
        type: typeof rows[0][k] === 'number' ? 'number' : 'string',
      };
    });
  }

  function agg(rows, key, how) {
    if (how === 'count' || !key) return rows.length;
    var vals = rows.map(function (r) { return r[key]; });
    if (how === 'sum') return vals.reduce(function (a, b) { return a + num(b); }, 0);
    if (how === 'avg') return rows.length ? vals.reduce(function (a, b) { return a + num(b); }, 0) / rows.length : 0;
    if (how === 'latest') {
      var last = vals.filter(function (v) { return v != null && v !== ''; }).sort();
      return last[last.length - 1] || '';
    }
    return rows.length;
  }

  function pickJson(v) {
    if (!v) return null;
    if (typeof v === 'object') return v;
    var raw = String(v).replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  /** Owner-scope memory read: also picks up what the owner's AGENTS wrote. */
  async function resolveMemory(src, ctx) {
    var session = ctx && ctx.session;
    if (!session || typeof session.fetch !== 'function') return [];
    var qs = '/v1/memory?owner_scope=true&prefix=' + encodeURIComponent(src.prefix || '');
    var body = await unwrap(await session.fetch(qs));
    var items = (body && (body.items || (body.data && body.data.items))) || [];
    var rows = [];
    items.forEach(function (it) {
      /* Meta LAST: the long memory key is plumbing, so it must not win a column slot. */
      var meta = {
        id: String(it.key || '').split('.').pop(),
        author: agentOf(it.owner_gaii) || '',
        saved: (it.updated_at || '').slice(0, 10),
      };
      var v = it.value;
      if (Array.isArray(v)) {
        v.slice(0, 200).forEach(function (r) {
          rows.push(Object.assign({}, (r && typeof r === 'object') ? flatten(r) : { value: r }, meta));
        });
      } else if (v && typeof v === 'object') {
        rows.push(Object.assign(flatten(v), meta));
      } else {
        rows.push(Object.assign({ value: v }, meta));
      }
    });
    /* Newest last for time series, so a chart reads left to right. */
    var dk = rows.length ? ['date', 'day', 'ts', 'saved'].filter(function (k) { return rows[0][k] !== undefined; })[0] : null;
    if (dk) rows.sort(function (a, b) { return String(a[dk]).localeCompare(String(b[dk])); });
    return rows;
  }

  var BUILT_IN = {
    memory: {
      resolve: resolveMemory,
      hint: '  {"type":"memory","prefix":"ai-usage."}          the owner\'s own stored data by key prefix',
      normalize: function (src) { return { type: 'memory', prefix: src.prefix || src.key || '' }; },
      claims: function (src) { return !!(src.prefix || src.key); },
    },
    inline: {
      resolve: function (src) { return (src.rows || []).slice(0, 400); },
      hint: '  {"type":"inline","rows":[{…}]}                  only when the user supplied the data themselves',
      normalize: function (src) { return { type: 'inline', rows: src.rows || src.items || [] }; },
      claims: function () { return false; },   // the fallback, never claimed by shape
    },
  };

  /**
   * Create a surface engine.
   * @param {Object} [opts]
   * @param {string} [opts.appId] app id passed to AIMEAT.ai.complete (H-2 app grant)
   * @param {string} [opts.locale='en'] 'fi' | 'en' — drives strings, number formatting and the
   *   language the composer is told to answer in
   * @param {Object} [opts.strings] overrides for no_data / err / rows_n / picked / pick
   * @param {Function} [opts.ai] (req) → completion; defaults to AIMEAT.ai.complete
   * @param {string} [opts.scrollClass='as-scroll'] wrapper class for the table body
   */
  function create(opts) {
    opts = opts || {};
    injectCss();
    var appId = opts.appId;
    var locale = opts.locale === 'fi' ? 'fi' : 'en';
    var strings = Object.assign({}, STRINGS.en, STRINGS[locale], opts.strings || {});
    var scrollClass = opts.scrollClass || 'as-scroll';
    var sources = Object.assign({}, BUILT_IN);
    var extraHints = [];

    function t(k) { return strings[k] || k; }
    function ai(req) {
      if (opts.ai) return opts.ai(req);
      return AIMEAT.ai.complete(Object.assign({ app_id: appId }, req));
    }
    function lang() { return locale === 'fi' ? 'Finnish' : 'English'; }

    function fmtNum(n, format) {
      if (typeof n !== 'number') return String(n == null ? '' : n);
      if (format === 'usd') return '$' + n.toFixed(n < 1 ? 4 : 2);
      if (format === 'eur') return n.toFixed(2) + ' EUR';
      var s = Math.abs(n) >= 1000
        ? Math.round(n).toLocaleString(locale === 'fi' ? 'fi-FI' : 'en-GB')
        : (Math.round(n * 100) / 100);
      return String(s);
    }

    /**
     * Teach the engine a data source. The registered sources assemble the composer prompt, so a
     * source that is not registered is a source the model is never offered.
     * @param {string} type
     * @param {Object} def { resolve(src, ctx) → rows, hint, fields?, normalize?(src), claims?(src) }
     */
    function registerSource(type, def) {
      sources[type] = def;
      if (def.hint) extraHints.push(def.hint);
      if (def.fields) extraHints.push('A ' + type + ' row always has these fields, use them as column/tile keys:\n  ' + def.fields);
    }

    async function resolve(spec, ctx) {
      var src = (spec && spec.source) || { type: 'inline', rows: [] };
      var def = sources[src.type] || sources.inline;
      return await def.resolve(src, ctx || {});
    }

    /* ------------------------------------------------------------ rendering --
       Every kind renders through the node's own UI packs so a surface looks like one product
       and we do not re-implement tables, charts or motion. Each pack call has a plain-DOM
       fallback: a missing pack must degrade, never blank the panel. */
    function renderBody(box, spec, rows, o) {
      o = o || {};
      var kind = KINDS.indexOf(spec.kind) >= 0 ? spec.kind : 'table';
      var view = spec.view || {};
      rows = rows || [];

      if (!rows.length && kind !== 'options' && kind !== 'brief') {
        box.innerHTML = '<div class="alert alert-warning text-sm">' + esc(t('no_data')) + '</div>';
        return;
      }

      if (kind === 'stats') {
        var host = document.createElement('div');
        box.appendChild(host);
        var tiles = (view.tiles || []).slice(0, 4).map(function (ti) {
          var v = agg(rows, ti.key, ti.agg || 'count');
          return {
            label: ti.label || ti.key || '',
            value: typeof v === 'number' ? v : 0,
            format: function (n) { return fmtNum(n, ti.format); },
            spark: ti.sparkKey ? rows.slice(-12).map(function (r) { return num(r[ti.sparkKey]); }) : undefined,
          };
        });
        if (!tiles.length) tiles = [{ label: t('rows_n'), value: rows.length }];
        try { AIMEAT.ui.motion.statTiles(host, tiles); }
        catch (e) {
          host.className = 'stats stats-vertical sm:stats-horizontal w-full';
          host.innerHTML = tiles.map(function (x) {
            /* Apply the tile's own format here too. Printing the raw value made a documented
               feature (format:'usd') silently do nothing whenever the motion pack was absent,
               so a currency tile read as 4.4845678901 instead of $4.48. */
            var shown = x.format ? x.format(x.value) : String(x.value);
            return '<div class="stat"><div class="stat-title">' + esc(x.label) +
              '</div><div class="stat-value text-2xl">' + esc(shown) + '</div></div>';
          }).join('');
        }
        return;
      }

      if (kind === 'chart') {
        /* ChartBuilder wants a CONTAINER id and creates the <canvas> itself. Handing it a canvas
           id nests a canvas inside a canvas: no error, no chart, just a blank box. */
        var cid = 'cv-' + (spec.id || uid('c'));
        var wrap = document.createElement('div');
        wrap.id = cid;
        box.appendChild(wrap);
        var labelKey = view.labelKey || Object.keys(rows[0])[0];
        var valueKeys = (view.valueKeys && view.valueKeys.length)
          ? view.valueKeys
          : [Object.keys(rows[0]).filter(function (k) { return k !== labelKey; })[0]];
        try {
          AIMEAT.charts.ChartBuilder({
            elementId: cid,
            type: view.chartType || 'bar',
            data: {
              labels: rows.map(function (r) { return String(r[labelKey]); }),
              /* No colours here on purpose: aimeat-charts resolves them from the theme tokens and
                 repaints when the palette or light/dark changes. Naming a colour here would pin
                 the series to it forever, which is exactly what used to happen. */
              datasets: valueKeys.map(function (k) {
                return { label: k, data: rows.map(function (r) { return num(r[k]); }) };
              }),
            },
            /* The lib keeps the aspect ratio and pins canvas{height:auto!important}, so a fixed
               container height is ignored and the chart spills out of the card. Give it a RATIO
               instead and let the card grow to fit. */
            options: { aspectRatio: rows.length > 10 ? 3.2 : 2.4 },
          });
        } catch (e) {
          box.innerHTML = '<div class="alert alert-warning text-sm">' + esc(t('err')) + '</div>';
        }
        return;
      }

      if (kind === 'timeline') {
        var thost = document.createElement('div');
        box.appendChild(thost);
        var tsKey = view.tsKey || 'lastChange', txKey = view.textKey || 'name';
        var events = rows.filter(function (r) { return r[tsKey]; })
          .sort(function (a, b) { return String(b[tsKey]).localeCompare(String(a[tsKey])); })
          .slice(0, 30)
          .map(function (r) {
            return {
              date: String(r[tsKey]).slice(0, 10),
              title: String(r[txKey] || ''),
              description: String(r.lastChangeWhat || r.description || r.line || ''),
            };
          });
        try { AIMEAT.ui.viewers.Timeline({ target: thost, events: events }); }
        catch (e) {
          thost.innerHTML = '<ul class="timeline timeline-vertical">' + events.map(function (ev) {
            return '<li><div class="timeline-start text-xs opacity-60">' + esc(ev.date) + '</div><div class="timeline-middle">•</div>' +
              '<div class="timeline-end timeline-box"><b>' + esc(ev.title) + '</b><br><span class="text-sm opacity-70">' + esc(ev.description) + '</span></div></li>';
          }).join('') + '</ul>';
        }
        return;
      }

      if (kind === 'brief') {
        var md = view.markdown || '';
        var bhost = document.createElement('div');
        bhost.className = 'prose prose-sm max-w-none';
        box.appendChild(bhost);
        if (global.AIMEAT && AIMEAT.md && AIMEAT.md.render) { try { AIMEAT.md.render(md, bhost); return; } catch (e) { /* fall through */ } }
        bhost.innerHTML = esc(md).replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
        return;
      }

      if (kind === 'options') {
        var items = (view.items || []).slice(0, 4);
        var ohost = document.createElement('div');
        ohost.className = 'grid gap-3';
        ohost.innerHTML = items.map(function (op, i) {
          var isPicked = view.chosen && view.chosen.title === op.title;
          return '<div class="card ' + (isPicked ? 'bg-success/10 border border-success' : 'bg-base-200') + '">' +
            '<div class="card-body p-4 gap-2">' +
            '<h4 class="font-semibold">' + esc(op.title) + (isPicked ? ' <span class="badge badge-success badge-sm">' + esc(t('picked')) + '</span>' : '') + '</h4>' +
            '<p class="text-sm opacity-80 whitespace-pre-line">' + esc(op.body) + '</p>' +
            (isPicked ? '' : '<div class="card-actions"><button class="btn btn-sm" data-pick="' + i + '">' + esc(t('pick')) + '</button></div>') +
            '</div></div>';
        }).join('');
        box.appendChild(ohost);
        /* Hosts used to wire this button themselves; onPick means one less thing to get wrong. */
        if (o.onPick) {
          ohost.addEventListener('click', function (ev) {
            var b = ev.target.closest ? ev.target.closest('[data-pick]') : null;
            if (b) o.onPick(Number(b.getAttribute('data-pick')), spec);
          });
        }
        return;
      }

      /* table (default) */
      var cols = (view.columns && view.columns.length) ? view.columns : autoColumns(rows);
      var thost2 = document.createElement('div');
      thost2.className = scrollClass;
      box.appendChild(thost2);
      try {
        AIMEAT.ui.viewers.DataTable({
          target: thost2, columns: cols, rows: rows,
          sortable: true, filterable: rows.length > 8, pageSize: o.pageSize || 25,
        });
      } catch (e) {
        thost2.innerHTML = '<table class="table table-sm"><thead><tr>' +
          cols.map(function (c) { return '<th>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' + cols.map(function (c) { return '<td>' + esc(r[c.key]) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>';
      }
    }

    /* ------------------------------------------------------------ composing -- */
    function specHint() {
      var srcLines = Object.keys(sources)
        .map(function (k) { return sources[k].hint; })
        .filter(Boolean);
      return [
        'You turn a person\'s plain-language request into ONE panel spec (JSON) for a live surface.',
        '',
        'Return ONLY JSON: {"title":"…","kind":"…","source":{…},"view":{…}}',
        '',
        'kind is one of: ' + KINDS.join(' | '),
        'source is one of:',
        srcLines.join('\n'),
        '',
        extraHints.filter(function (h) { return h.indexOf('always has these fields') > 0; }).join('\n'),
        '',
        'view by kind:',
        '  table    {"columns":[{"key":"name","label":"Name"},{"key":"form","label":"Form"}]}',
        '  chart    {"chartType":"bar|line|pie|doughnut","labelKey":"name","valueKeys":["count"]}',
        '  stats    {"tiles":[{"label":"Total","key":"name","agg":"count"}]}  agg: count|sum|avg|latest',
        '  timeline {"tsKey":"lastChange","textKey":"name"}',
        '  brief    {}   (leave empty, the surface writes the prose afterwards)',
        '  options  {"items":[{"title":"…","body":"…"}]}',
        '',
        'Rules: pick the kind that ANSWERS the request, not the fanciest one. A comparison is a table.',
        'A trend over time is a chart. A count or total is stats. History of changes is a timeline.',
        'An open question for the owner is options. Column labels in the user\'s language.',
        'Never invent names the user did not mention. Never put made-up rows in inline.',
      ].join('\n');
    }

    /** Models ignore schema wrappers and rename keys, so normalise hard. */
    function normalizeSpec(out, intent) {
      var o = pickJson(out && out.parsed) || pickJson(out && out.data) ||
              pickJson(out && (out.content || out.text)) || pickJson(out);
      if (o && o.spec) o = o.spec;
      if (o && o.panel) o = o.panel;
      if (!o || typeof o !== 'object') return null;

      var kind = String(o.kind || o.type || 'table').toLowerCase();
      if (KINDS.indexOf(kind) < 0) kind = 'table';

      var src = o.source || o.data || {};
      if (Array.isArray(src)) src = { type: 'inline', rows: src };
      var stype = String(src.type || '').toLowerCase();
      if (!sources[stype]) {
        /* The model renamed or dropped the type: let each registered source claim it by shape,
           and fall back to inline. */
        stype = Object.keys(sources).filter(function (k) {
          return sources[k].claims && sources[k].claims(src);
        })[0] || 'inline';
      }
      var norm = sources[stype].normalize;
      var source = norm ? norm(src) : { type: stype };
      source.type = stype;

      var view = o.view || o.config || {};
      if (kind === 'table' && !view.columns && o.columns) view.columns = o.columns;
      if (kind === 'options' && !view.items) view.items = o.items || o.options || [];

      return {
        id: uid('pnl'),
        title: String(o.title || intent || '').slice(0, 90) || intent,
        kind: kind, intent: intent, source: source, view: view,
        needsYou: null, updatedAt: new Date().toISOString(), author: 'you',
      };
    }

    async function compose(text, ctx) {
      var out = await ai({
        prompt: specHint() +
          '\n\nAvailable memory key prefixes on this owner\'s node (use one only if it fits):\n' +
          (((ctx && ctx.prefixes) || []).slice(0, 40).join('\n')) +
          '\n\nWrite the panel spec for this request, answering in ' + lang() + ':\n' + text,
      });
      return normalizeSpec(out, text);
    }

    async function reshape(spec, text) {
      var out = await ai({
        prompt: specHint() + '\n\nHere is an EXISTING panel spec:\n' +
          JSON.stringify({ title: spec.title, kind: spec.kind, source: spec.source, view: spec.view }) +
          '\n\nThe owner asks you to change it: "' + text + '"\n' +
          'Return the FULL updated spec, keeping everything they did not ask to change. ' +
          'Keep the same source unless they clearly asked for different data. Answer in ' + lang() + '.',
      });
      var next = normalizeSpec(out, spec.intent || text);
      if (!next) return null;
      next.id = spec.id;
      next.author = spec.author;
      if (next.kind === 'options' && spec.view && spec.view.chosen) next.view.chosen = spec.view.chosen;
      return next;
    }

    /**
     * Prose for a brief panel is written AFTER the rows are known, so it can never be invented:
     * the model only sees real fetched data.
     */
    async function writeBrief(spec, rows) {
      var out = await ai({
        prompt: 'Write a short brief in ' + lang() +
          ' answering the request below. Use ONLY the data rows given, invent nothing. ' +
          '3 to 6 sentences, plain language, no dashes as punctuation.\n\nREQUEST: ' +
          (spec.intent || spec.title) + '\n\nDATA:\n' + JSON.stringify(rows).slice(0, 6000),
      });
      return (out && (out.content || out.text)) || '';
    }

    /**
     * SECOND PASS: when the request hit data whose shape the composer had to guess blind, the
     * real fields are only known once the rows arrive. Letting the model pick kind + view against
     * them is what makes "show my AI spend per day" arrive as a chart of the right column instead
     * of a table of plumbing.
     */
    async function refine(spec, rows) {
      if (!rows || !rows.length) return null;
      var fields = Object.keys(rows[0]);
      var out = await ai({
        prompt: specHint() + '\n\nThe data is ALREADY FETCHED. These are the REAL fields:\n' +
          fields.join(', ') + '\n\nTwo sample rows:\n' + JSON.stringify(rows.slice(0, 2)) +
          '\n\nThe owner asked: "' + (spec.intent || spec.title) + '"\n' +
          'Return the spec with source EXACTLY ' + JSON.stringify(spec.source) + ' ' +
          'and a kind + view that answers the request using ONLY the field names above. ' +
          'A per-day or per-period question is a chart (labelKey = the date field, valueKeys = the measure). ' +
          'Labels in ' + lang() + '.',
      });
      var next = normalizeSpec(out, spec.intent);
      if (!next) return null;
      next.id = spec.id;
      next.author = spec.author;
      next.source = spec.source;
      next.needsYou = spec.needsYou || null;
      return next;
    }

    return {
      KINDS: KINDS,
      registerSource: registerSource,
      resolve: resolve,
      renderBody: renderBody,
      specHint: specHint,
      normalizeSpec: normalizeSpec,
      compose: compose,
      reshape: reshape,
      writeBrief: writeBrief,
      refine: refine,
      autoColumns: autoColumns,
      fmtNum: fmtNum,
      t: t,
    };
  }

  AIMEAT.surface = {
    create: create,
    KINDS: KINDS,
    // Pure helpers a host may need outside an engine instance.
    flatten: flatten,
    autoColumns: autoColumns,
    agg: agg,
    num: num,
    VERSION: '1.1.0',
  };

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
