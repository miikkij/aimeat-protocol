/**
 * @file game/board.js
 * @description Competition and tables: the leaderboard, the stat grid, the compact data table and
 *   the showcase card.
 *
 *   SEVERAL METRICS, NOT ONE. A board that ranks on a single number decides what the game is
 *   about; a board with switchable metrics lets the host say "most used", "highest readiness" and
 *   "fastest to a first customer" are all worth winning. Sorting happens here; the host is only
 *   told which metric was chosen.
 *
 *   AN EMPTY BOARD READS AS "NOBODY YET". Never as an error, never as a blank rectangle — the
 *   first thing a new app shows is its empty state, and a board that looks broken on day one
 *   never gets a day two.
 * @structure leaderboard(spec) · statGrid(spec) · dataTable(spec) · card(spec)
 * @usage  AIMEAT.game.leaderboard({ metrics: [{ id: 'calls', label: 'Calls' }], rows });
 * @version-history
 *   v1.0.0 — 2026-07-28 — Initial (NOSTE prompt 01).
 */
import { el, clear } from './dom.js';
import { t, i18n } from './i18n.js';

/**
 * @typedef {object} BoardMetric
 * @property {string} id
 * @property {string} label
 * @property {(value: any) => string} [format]
 * @property {'desc'|'asc'} [direction]   Default 'desc' — the biggest number wins.
 */

/**
 * @typedef {object} BoardRow
 * @property {string} id
 * @property {string} name
 * @property {string} [sublabel]
 * @property {boolean} [you]     Highlight this row as the viewer's own.
 * @property {number} [rank]     Fixed rank; omit and the board ranks by the active metric.
 * @property {Record<string, any>} values
 */

/**
 * A ranked board with switchable metrics.
 * @param {{
 *   title?: string, metrics: BoardMetric[], metric?: string, rows: BoardRow[],
 *   onSort?: (metricId: string) => void, onPick?: (row: BoardRow) => void, emptyText?: string
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, metric: () => string, destroy: () => void }}
 */
export function leaderboard(spec) {
  const metrics = spec.metrics && spec.metrics.length ? spec.metrics : [{ id: 'score', label: 'Score' }];
  let active = spec.metric || metrics[0].id;
  let rows = spec.rows || [];

  const heading = el('h3', { class: 'ag-title' });
  const tabs = el('div', { class: 'ag-lb__metrics', role: 'group' });
  const list = el('div', { class: 'ag-lb__rows' });
  const root = el('div', { class: 'ag-root ag-lb' }, [heading, tabs, list]);

  /** @returns {BoardMetric} */
  function current() {
    return metrics.find(function (m) { return m.id === active; }) || metrics[0];
  }

  /** @param {any} v @param {BoardMetric} m */
  function show(v, m) {
    if (m.format) return m.format(v);
    if (v == null) return '—';
    return typeof v === 'number' ? String(v) : String(v);
  }

  function renderTabs() {
    clear(tabs);
    if (metrics.length < 2) return;
    tabs.setAttribute('aria-label', t('sortBy'));
    for (const m of metrics) {
      tabs.appendChild(el('button', {
        type: 'button', class: 'ag-lb__metric', 'data-ag-id': m.id,
        'aria-pressed': m.id === active ? 'true' : 'false',
        on: {
          click: function () {
            active = m.id;
            if (spec.onSort) spec.onSort(active);
            renderTabs();
            renderRows();
          },
        },
      }, m.label));
    }
  }

  function renderRows() {
    clear(list);
    const m = current();
    if (!rows.length) {
      list.appendChild(el('p', { class: 'ag-empty', text: spec.emptyText || t('nobodyYet') }));
      return;
    }
    const dir = m.direction === 'asc' ? 1 : -1;
    const sorted = rows.slice().sort(function (a, b) {
      const av = Number(a.values ? a.values[m.id] : 0) || 0;
      const bv = Number(b.values ? b.values[m.id] : 0) || 0;
      return (av - bv) * dir;
    });
    sorted.forEach(function (row, i) {
      const kids = [
        el('span', { class: 'ag-lb__rank ag-num', text: String(row.rank != null ? row.rank : i + 1) }),
        el('span', { class: 'ag-lb__who' }, [
          el('span', { class: 'ag-lb__name', text: row.name + (row.you ? ' · ' + t('you') : '') }),
          row.sublabel ? el('span', { class: 'ag-lb__sub', text: row.sublabel }) : null,
        ]),
        el('span', { class: 'ag-lb__val', text: show(row.values ? row.values[m.id] : null, m) }),
      ];
      const attrs = {
        class: 'ag-lb__row' + (row.you ? ' ag-lb__row--you' : ''),
        'data-ag-id': row.id,
      };
      if (spec.onPick) {
        list.appendChild(el('button', Object.assign({ type: 'button' }, attrs, {
          on: { click: function () { if (spec.onPick) spec.onPick(row); } },
        }), kids));
      } else {
        list.appendChild(el('div', attrs, kids));
      }
    });
  }

  function render() {
    heading.textContent = spec.title || '';
    heading.hidden = !spec.title;
    renderTabs();
    renderRows();
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ rows?: BoardRow[], metric?: string, title?: string }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.rows) rows = patch.rows;
      if (patch.metric) active = patch.metric;
      if (patch.title !== undefined) spec.title = patch.title;
      render();
    },
    metric() { return active; },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * @typedef {object} StatTile
 * @property {string} id
 * @property {string} label
 * @property {string|number} value
 * @property {string} [unit]
 * @property {string|number} [delta]
 * @property {'up'|'down'|'flat'} [deltaTone]  Derived from a numeric delta when omitted.
 */

/**
 * A responsive grid of stat tiles.
 * @param {StatTile[]|{ tiles: StatTile[] }} spec
 * @returns {{ el: HTMLElement, set: (tiles: StatTile[]) => void, destroy: () => void }}
 */
export function statGrid(spec) {
  let tiles = Array.isArray(spec) ? spec : ((spec && spec.tiles) || []);
  const root = el('div', { class: 'ag-root ag-stats' });

  function render() {
    clear(root);
    if (!tiles.length) {
      root.appendChild(el('p', { class: 'ag-empty', text: t('empty') }));
      return;
    }
    for (const tile of tiles) {
      const tone = tile.deltaTone
        || (tile.delta == null ? 'flat' : (Number(tile.delta) > 0 ? 'up' : Number(tile.delta) < 0 ? 'down' : 'flat'));
      root.appendChild(el('div', { class: 'ag-stat', 'data-ag-id': tile.id }, [
        el('span', { class: 'ag-label', text: tile.label }),
        el('span', { class: 'ag-stat__v' }, [
          el('span', { text: String(tile.value) }),
          tile.unit ? el('span', { class: 'ag-stat__u', text: tile.unit }) : null,
        ]),
        tile.delta != null
          ? el('span', { class: 'ag-stat__d ag-stat__d--' + tone, text: String(tile.delta) })
          : null,
      ]));
    }
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {StatTile[]} next */
    set(next) { if (next) tiles = next; render(); },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * @typedef {object} TableColumn
 * @property {string} id
 * @property {string} label
 * @property {boolean} [num]   Right-aligned, tabular figures.
 * @property {(value: any, row: any) => string} [format]
 */

/**
 * A compact table that scrolls inside its own container — never widening the page.
 * @param {{
 *   columns: TableColumn[], rows: any[], onPick?: (row: any) => void, emptyText?: string,
 *   caption?: string
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function dataTable(spec) {
  let rows = spec.rows || [];
  const columns = spec.columns || [];
  const head = el('thead');
  const body = el('tbody');
  const table = el('table', {}, [head, body]);
  const root = el('div', { class: 'ag-root ag-table' }, table);

  function render() {
    clear(head);
    head.appendChild(el('tr', {}, columns.map(function (c) {
      return el('th', { class: c.num ? 'ag-th--num' : null, scope: 'col', text: c.label });
    })));

    clear(body);
    if (!rows.length) {
      body.appendChild(el('tr', {}, el('td', {
        colspan: String(Math.max(1, columns.length)),
      }, el('p', { class: 'ag-empty', text: spec.emptyText || t('empty') }))));
      return;
    }
    for (const row of rows) {
      const cells = columns.map(function (c) {
        const raw = row[c.id];
        const text = c.format ? c.format(raw, row) : (raw == null ? '—' : String(raw));
        return el('td', { class: c.num ? 'ag-td--num' : null, text: text });
      });
      const tr = el('tr', { 'data-ag-pick': spec.onPick ? '' : null }, cells);
      if (spec.onPick) tr.addEventListener('click', function () { if (spec.onPick) spec.onPick(row); });
      body.appendChild(tr);
    }
  }

  const stopLang = i18n.onChange(render);
  render();

  return {
    el: root,
    /** @param {{ rows?: any[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.rows) rows = patch.rows;
      render();
    },
    destroy() { stopLang(); if (root.parentNode) root.parentNode.removeChild(root); },
  };
}

/**
 * A showcase card for one entry — a player, a submission, an offering. Leaderboards and
 * galleries both use it, which is why it carries a headline metric rather than a body of prose.
 * @param {{
 *   title: string, author?: string, metric?: { label: string, value: string|number },
 *   image?: string, imageAlt?: string, tags?: string[], onPick?: () => void
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: any) => void, destroy: () => void }}
 */
export function card(spec) {
  const state = {
    title: spec.title,
    author: spec.author,
    metric: spec.metric,
    image: spec.image,
    tags: spec.tags || [],
  };
  const body = el('div', { class: 'ag-showcase__body' });
  const tag = spec.onPick ? 'button' : 'div';
  const root = el(tag, Object.assign(
    { class: 'ag-root ag-card ag-showcase' },
    spec.onPick ? { type: 'button', on: { click: function () { if (spec.onPick) spec.onPick(); } } } : {},
  ));

  function render() {
    clear(root);
    if (state.image) {
      root.appendChild(el('img', {
        class: 'ag-showcase__img', src: state.image, alt: spec.imageAlt || state.title, loading: 'lazy',
      }));
    }
    clear(body);
    body.appendChild(el('span', { class: 'ag-showcase__title', text: state.title }));
    if (state.author) body.appendChild(el('span', { class: 'ag-showcase__by', text: state.author }));
    if (state.metric) {
      body.appendChild(el('span', { class: 'ag-showcase__metric' }, [
        el('span', { class: 'ag-showcase__mv ag-num', text: String(state.metric.value) }),
        el('span', { class: 'ag-label', text: state.metric.label }),
      ]));
    }
    if (state.tags.length) {
      body.appendChild(el('span', { class: 'ag-showcase__tags' }, state.tags.map(function (x) {
        return el('span', { class: 'ag-chip', text: x });
      })));
    }
    root.appendChild(body);
  }

  render();

  return {
    el: root,
    /** @param {{ title?: string, author?: string, metric?: any, image?: string, tags?: string[] }} patch */
    set(patch) {
      if (!patch) return;
      if (patch.title != null) state.title = patch.title;
      if (patch.author !== undefined) state.author = patch.author;
      if (patch.metric !== undefined) state.metric = patch.metric;
      if (patch.image !== undefined) state.image = patch.image;
      if (patch.tags) state.tags = patch.tags;
      render();
    },
    destroy() { if (root.parentNode) root.parentNode.removeChild(root); },
  };
}
