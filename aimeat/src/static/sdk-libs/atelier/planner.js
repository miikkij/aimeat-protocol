/**
 * @file atelier/planner.js
 * @description The work-planning family — the three blocks that show work against people and
 *   time, approved as basket two of the component expansion:
 *
 *     kanban    work as columns by state, a card per piece; with an onMove handler the cards
 *               MOVE — drag between columns, or arrow keys on a focused card — and the app is
 *               told, so the board is the control, not a picture of one;
 *     plan      stretches on a shared time axis (project phases, campaigns, leases): what is
 *               under way, how long still — with today drawn as a line through everything;
 *     schedule  a week as a grid, bookings as blocks: next week at a glance, where calendar
 *               (the year heat wall) shows the past at a distance.
 *
 *   All three follow the family physics: data in, picture out, tones on --ak-ok/-warn/-err,
 *   set() repaints, nothing polls, nothing animates at idle. Dates are 'YYYY-MM-DD' strings
 *   and times 'HH:MM', because the record travels through memory as words.
 *     steps     where a process stands: the stations in order, done behind, current lit,
 *               the rest ahead — an order, an application, an onboarding at a glance.
 *
 * @structure kanban(spec) · plan(spec) · schedule(spec) · steps(spec) — each → { el, set, destroy }
 * @usage
 *   AIMEAT.atelier.kanban({ target: host, onMove: (id, col) => save(id, col), data: {
 *     columns: [{ id: 'todo', label: 'To do' }, { id: 'doing', label: 'Doing', tone: 'warn' }],
 *     cards: [{ id: 'c1', column: 'todo', title: 'Order flour', sub: 'before Friday' }] } });
 *   AIMEAT.atelier.plan({ target: host, data: { rows: [
 *     { label: 'Oven rebuild', spans: [{ from: '2026-08-10', to: '2026-09-02', label: 'build' }] } ] } });
 *   AIMEAT.atelier.schedule({ target: host, data: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
 *     from: '08:00', to: '18:00', events: [{ day: 1, from: '09:00', to: '11:30', label: 'Baking class' }] } });
 * @version-history
 *   v0.37.0 — 2026-08-30 — steps: the process tracker (done / current / ahead on one line).
 *   v0.36.0 — 2026-08-30 — Initial (basket two of the approved expansion).
 */
import { el, clear, resolve, reducedMotion } from './dom.js';
import { t } from './i18n.js';
import { emptyState } from './state.js';

const TONES = ['ok', 'warn', 'err', 'accent'];
function toneOf(value, fallback) { return TONES.indexOf(value) >= 0 ? value : (fallback || 'accent'); }

function emptyInto(root, spec) {
  const e = spec.empty || {};
  return emptyState({ target: root, tone: 'quiet', title: e.title || t('empty'), hint: e.hint || t('emptyHint') });
}

/**
 * The kanban board.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { columns: Array<{ id: string, label: string, tone?: string }>,
 *            cards: Array<{ id: string, column: string, title: string, sub?: string, badge?: string, tone?: string }> }|null,
 *   onMove?: (cardId: string, toColumnId: string) => void,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function kanban(spec) {
  const root = el('div', { class: 'ak-root ak-kanban' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;
  let current = null;

  function moveCard(cardId, toColumn) {
    if (!current) return;
    const card = (current.cards || []).find((c) => c && c.id === cardId);
    if (!card || card.column === toColumn) return;
    card.column = toColumn;
    render(current);
    // The focused card keeps the keyboard: after the repaint, focus follows it.
    const again = root.querySelector(`[data-card="${cardId}"]`);
    if (again) /** @type {HTMLElement} */ (again).focus();
    if (spec.onMove) spec.onMove(cardId, toColumn);
  }

  function render(data) {
    current = data;
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const columns = (data && Array.isArray(data.columns)) ? data.columns.filter((c) => c && c.id) : [];
    const cards = (data && Array.isArray(data.cards)) ? data.cards.filter((c) => c && c.id) : [];
    if (!columns.length) { emptyCard = emptyInto(root, spec); return; }
    const movable = !!spec.onMove;

    columns.forEach((col, colIdx) => {
      const inCol = cards.filter((c) => c.column === col.id);
      const lane = el('div', { class: 'ak-kanban__col', 'data-col': col.id, role: 'group', 'aria-label': `${col.label} · ${inCol.length}` });
      lane.appendChild(el('div', { class: 'ak-kanban__head ak-kanban__head--' + toneOf(col.tone, 'accent') }, [
        el('span', { class: 'ak-kanban__colname', text: col.label || col.id }),
        el('span', { class: 'ak-kanban__count', text: String(inCol.length) }),
      ]));
      const well = el('div', { class: 'ak-kanban__well' });
      if (movable) {
        well.addEventListener('dragover', (ev) => { ev.preventDefault(); well.classList.add('ak-kanban__well--over'); });
        well.addEventListener('dragleave', () => well.classList.remove('ak-kanban__well--over'));
        well.addEventListener('drop', (ev) => {
          ev.preventDefault();
          well.classList.remove('ak-kanban__well--over');
          const id = ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '';
          if (id) moveCard(id, col.id);
        });
      }
      inCol.forEach((card, i) => {
        const node = el('div', {
          class: 'ak-kanban__card' + (TONES.indexOf(card.tone) >= 0 ? ' ak-kanban__card--' + card.tone : ''),
          'data-card': card.id,
          tabindex: movable ? '0' : undefined,
          role: movable ? 'button' : undefined,
        }, [
          el('span', { class: 'ak-kanban__cardtitle', text: card.title || card.id }),
          card.sub ? el('span', { class: 'ak-kanban__cardsub', text: card.sub }) : null,
          card.badge ? el('span', { class: 'ak-kanban__badge', text: card.badge }) : null,
        ]);
        if (!reducedMotion()) { node.classList.add('ak-kanban__card--enter'); node.style.animationDelay = `${i * 40}ms`; }
        if (movable) {
          node.draggable = true;
          node.addEventListener('dragstart', (ev) => {
            if (ev.dataTransfer) { ev.dataTransfer.setData('text/plain', card.id); ev.dataTransfer.effectAllowed = 'move'; }
            node.classList.add('ak-kanban__card--lift');
          });
          node.addEventListener('dragend', () => node.classList.remove('ak-kanban__card--lift'));
          node.addEventListener('keydown', (ev) => {
            const dir = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
            if (!dir) return;
            const next = columns[colIdx + dir];
            if (next) { ev.preventDefault(); moveCard(card.id, next.id); }
          });
        }
        well.appendChild(node);
      });
      lane.appendChild(well);
      root.appendChild(lane);
    });
  }

  render(spec.data || null);
  return {
    el: root,
    set: (patch) => { if (patch && 'data' in patch) render(patch.data || null); },
    destroy: () => root.remove(),
  };
}

const DAY_MS = 86400000;
function day(value) { const d = new Date(value); return isNaN(d.getTime()) ? null : d; }

/**
 * The plan: stretches on a shared time axis, today drawn through everything.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { rows: Array<{ label: string, spans: Array<{ from: string, to: string, label?: string, tone?: string }> }>,
 *            start?: string, end?: string, today?: string }|null,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function plan(spec) {
  const root = el('div', { class: 'ak-root ak-plan' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const rows = (data && Array.isArray(data.rows) ? data.rows : [])
      .map((r) => ({
        label: r && r.label || '',
        spans: (r && Array.isArray(r.spans) ? r.spans : [])
          .map((s) => ({ from: day(s.from), to: day(s.to), label: s.label, tone: s.tone }))
          .filter((s) => s.from && s.to && s.to.getTime() >= s.from.getTime()),
      }))
      .filter((r) => r.spans.length);
    if (!rows.length) { emptyCard = emptyInto(root, spec); return; }

    let min = data.start ? day(data.start) : null;
    let max = data.end ? day(data.end) : null;
    for (const r of rows) for (const s of r.spans) {
      if (!min || s.from < min) min = s.from;
      if (!max || s.to > max) max = s.to;
    }
    const span = Math.max(max.getTime() - min.getTime(), DAY_MS);
    const X = (d) => Math.min(Math.max((d.getTime() - min.getTime()) / span, 0), 1) * 100;

    // Month lines across the whole board, each named at the top.
    const head = el('div', { class: 'ak-plan__months' });
    const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
    while (cursor.getTime() <= max.getTime()) {
      if (cursor.getTime() >= min.getTime()) {
        const mark = el('span', { class: 'ak-plan__month', text: t('m' + (cursor.getMonth() + 1)) });
        mark.style.left = X(cursor) + '%';
        head.appendChild(mark);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
    root.appendChild(head);

    const body = el('div', { class: 'ak-plan__rows' });
    rows.forEach((r, ri) => {
      const lane = el('div', { class: 'ak-plan__row' }, [
        el('span', { class: 'ak-plan__rowname', text: r.label }),
      ]);
      const track = el('span', { class: 'ak-plan__track' });
      r.spans.forEach((s, si) => {
        const left = X(s.from);
        const width = Math.max(X(new Date(s.to.getTime() + DAY_MS)) - left, 1.2);
        const bar = el('span', {
          class: 'ak-plan__span ak-plan__span--' + toneOf(s.tone, 'accent'),
          title: (s.label ? s.label + ' · ' : '') + `${s.from.toISOString().slice(0, 10)} → ${s.to.toISOString().slice(0, 10)}`,
        }, s.label && width > 8 ? [el('span', { class: 'ak-plan__spanlabel', text: s.label })] : []);
        bar.style.left = left + '%';
        bar.style.width = width + '%';
        if (!reducedMotion()) { bar.classList.add('ak-plan__span--enter'); bar.style.animationDelay = `${(ri * 2 + si) * 60}ms`; }
        track.appendChild(bar);
      });
      lane.appendChild(track);
      body.appendChild(lane);
    });
    const today = data.today ? day(data.today) : new Date();
    if (today && today.getTime() >= min.getTime() && today.getTime() <= max.getTime()) {
      const line = el('span', { class: 'ak-plan__today', title: t('today') });
      line.style.left = X(today) + '%';
      body.appendChild(line);
    }
    root.appendChild(body);
  }

  render(spec.data || null);
  return {
    el: root,
    set: (patch) => { if (patch && 'data' in patch) render(patch.data || null); },
    destroy: () => root.remove(),
  };
}

function minutes(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * The week schedule: days as columns, bookings as blocks.
 * @param {{ target?: string|Element, title?: string,
 *   data?: { days?: string[], from?: string, to?: string,
 *            events: Array<{ day: number, from: string, to: string, label: string, sub?: string, tone?: string }> }|null,
 *   empty?: { title?: string, hint?: string }, onPick?: (event: any) => void,
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function schedule(spec) {
  const root = el('div', { class: 'ak-root ak-schedule' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const days = (data && Array.isArray(data.days) && data.days.length ? data.days : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']).slice(0, 7);
    const events = (data && Array.isArray(data.events) ? data.events : [])
      .map((e) => ({ ...e, fromMin: minutes(e.from), toMin: minutes(e.to) }))
      .filter((e) => e && typeof e.day === 'number' && e.day >= 0 && e.day < days.length
        && e.fromMin !== null && e.toMin !== null && e.toMin > e.fromMin);
    if (!events.length) { emptyCard = emptyInto(root, spec); return; }
    const open = minutes(data.from) ?? Math.max(Math.floor(Math.min(...events.map((e) => e.fromMin)) / 60) * 60 - 60, 0);
    const close = minutes(data.to) ?? Math.min(Math.ceil(Math.max(...events.map((e) => e.toMin)) / 60) * 60 + 60, 1440);
    const span = Math.max(close - open, 60);
    const Y = (m) => Math.min(Math.max((m - open) / span, 0), 1) * 100;

    const grid = el('div', { class: 'ak-schedule__grid' });
    // Hour lines with their times, drawn once behind every column.
    const hours = el('div', { class: 'ak-schedule__hours' });
    for (let m = Math.ceil(open / 60) * 60; m <= close; m += 60) {
      const line = el('span', { class: 'ak-schedule__hour', text: `${String(Math.floor(m / 60)).padStart(2, '0')}:00` });
      line.style.top = Y(m) + '%';
      hours.appendChild(line);
    }
    grid.appendChild(hours);
    days.forEach((label, di) => {
      const inDay = events.filter((e) => e.day === di);
      const col = el('div', { class: 'ak-schedule__day', role: 'group', 'aria-label': `${label} · ${inDay.length}` }, [
        el('span', { class: 'ak-schedule__dayname', text: label }),
      ]);
      const well = el('div', { class: 'ak-schedule__well' });
      inDay.forEach((e, i) => {
        const block = el(spec.onPick ? 'button' : 'span', {
          class: 'ak-schedule__event ak-schedule__event--' + toneOf(e.tone, 'accent'),
          type: spec.onPick ? 'button' : undefined,
          title: `${e.label} · ${e.from}–${e.to}`,
        }, [
          el('span', { class: 'ak-schedule__eventname', text: e.label }),
          // A short booking has room for its name only; the title carries the hours anyway.
          e.toMin - e.fromMin >= 75 ? el('span', { class: 'ak-schedule__eventtime', text: `${e.from}–${e.to}` }) : null,
        ]);
        block.style.top = Y(e.fromMin) + '%';
        block.style.height = Math.max(Y(e.toMin) - Y(e.fromMin), 4) + '%';
        if (spec.onPick) block.addEventListener('click', () => spec.onPick(e));
        if (!reducedMotion()) { block.classList.add('ak-schedule__event--enter'); block.style.animationDelay = `${(di * 3 + i) * 50}ms`; }
        well.appendChild(block);
      });
      col.appendChild(well);
      grid.appendChild(col);
    });
    root.appendChild(grid);
  }

  render(spec.data || null);
  return {
    el: root,
    set: (patch) => { if (patch && 'data' in patch) render(patch.data || null); },
    destroy: () => root.remove(),
  };
}

/**
 * The process tracker: stations in order, done behind, current lit, the rest ahead.
 * @param {{ target?: string|Element,
 *   data?: { steps: Array<{ label: string, sub?: string }>, current?: number }|null,
 *   empty?: { title?: string, hint?: string },
 * }} spec
 * @returns {{ el: HTMLElement, set: (patch: { data?: object|null }) => void, destroy: () => void }}
 */
export function steps(spec) {
  const root = el('ol', { class: 'ak-root ak-steps' });
  if (spec.target) resolve(spec.target).appendChild(root);
  let emptyCard = null;

  function render(data) {
    if (emptyCard) { emptyCard.destroy(); emptyCard = null; }
    clear(root);
    const items = (data && Array.isArray(data.steps) ? data.steps : []).filter((s) => s && s.label);
    if (!items.length) { emptyCard = emptyInto(root, spec); return; }
    const current = Math.min(Math.max(Number(data.current) || 0, 0), items.length - 1);
    items.forEach((s, i) => {
      const state = i < current ? 'done' : i === current ? 'now' : 'ahead';
      root.appendChild(el('li', {
        class: 'ak-steps__step ak-steps__step--' + state,
        'aria-current': state === 'now' ? 'step' : undefined,
      }, [
        el('span', { class: 'ak-steps__dot', 'aria-hidden': 'true' }, state === 'done' ? '✓' : String(i + 1)),
        el('span', { class: 'ak-steps__words' }, [
          el('span', { class: 'ak-steps__label', text: s.label }),
          s.sub ? el('span', { class: 'ak-steps__sub', text: s.sub }) : null,
        ]),
      ]));
    });
  }

  render(spec.data || null);
  return {
    el: root,
    set: (patch) => { if (patch && 'data' in patch) render(patch.data || null); },
    destroy: () => root.remove(),
  };
}
