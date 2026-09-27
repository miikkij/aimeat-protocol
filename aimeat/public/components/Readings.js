/**
 * @file public/components/Readings.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A reading of a status page, as one component: what is measured and a line on why it
 *   matters on the left, its state mark in the middle, its value on the right as a machine reading;
 *   and the verdict that opens such a page: the status word in the poster face, one line on what
 *   needs a look, a machine stamp under it, with the readings beside it. A page passes data and
 *   named options, never a class. The look is css/components/readings.css (the operator pages' look
 *   on main: .adm-mrow, .adm-why, .adm-mval, .adm-ov-grid, .adm-ov-status, .adm-alert-line,
 *   .adm-ov-up in views/admin.css, ~27 admin pages).
 *
 *   Reading({ name, why, mark, value, end, last, children })
 *   - name: the measured thing (bold). why: the grey line under it. children: the left cell's own
 *     content when it is more than a name and a line (a stamp and a tag); drawn after name and why.
 *   - mark: the state mark (a Mark). Passing the key at all gives the row its middle column, as main's
 *     three-column row; leave it out for the two-column row (.adm-mrow--two).
 *   - value: the reading on the right, mono and grey. end: controls or words on the right instead
 *     (an action, a switch), not mono.
 *   - last: the last row of its section, no rule under it (the section's own rule follows).
 *   On a phone the name takes the left, the mark and the value stack on the right.
 *   Readings({ rows }): the rows as data, [{ key, name, why, mark, value, end, last }]; a falsy row
 *   is left out.
 *   Verdict({ label, word, tone, line, stamp, doors, children }): the status column (label: the row
 *   label over the word; word; tone = 'danger'
 *   coral, 'watch' the warning colour, 'quiet' grey; line: the one line under it; stamp: the mono
 *   reading under that; doors: actions under the column) with `children` beside it (the readings).
 * @structure Reading · Readings · Verdict
 * @usage html`<${Verdict} word=${status} tone=${danger ? 'danger' : undefined} line=${alertLine} stamp=${uptime}>
 *          <${Readings} rows=${[{ key: 'burn', name: t('x.burn'), why: t('x.burnWhy'), mark: html`<${Mark} kind="status" tone="fine">OK<//>`, value: '0.4' }]} />
 *        <//>`
 * @version-history
 *   v1.1.0 — 2026-09-27 — Verdict `label`: the row label over the word (the admin Boards and Memory
 *     pages' coral label over their headline); additive, page group G5.
 *   v1.0.0 — 2026-09-27 — Initial: the operator pages' metric row (shared.js Row and ~15 hand-written
 *     copies) and the overview's status column as one component; the page sheets' variants kept as
 *     the component's own (no rule under the last row, a mono value that breaks anywhere, the phone
 *     layout of the Applications and CORS pages).
 */
import { h } from 'preact';
import htm from 'htm';
import { Label } from '/components/Mark.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const has = (x) => x !== undefined && x !== null && x !== false;
const VERDICT_TONES = new Set(['danger', 'watch', 'quiet']);

/**
 * One reading.
 * @param {{ name?: any, why?: any, mark?: any, value?: any, end?: any, last?: boolean, children?: any }} props
 */
export function Reading(props) {
  const { name, why, mark, value, end, last, children } = props;
  const three = 'mark' in props;
  return html`
    <div class=${cx('reading', !three && 'reading--two', last && 'reading--last')}>
      <span class="reading-lead">
        ${has(name) ? html`<b class="reading-name">${name}</b>` : null}
        ${has(why) ? html`<span class="reading-why">${why}</span>` : null}
        ${children}
      </span>
      ${three ? html`<span class="reading-mark">${mark}</span>` : null}
      ${has(end) ? html`<span class="reading-end">${end}</span>` : html`<span class="reading-value">${value}</span>`}
    </div>`;
}

/**
 * The rows as data.
 * @param {{ rows: Array<any> }} props
 */
export function Readings({ rows = [] }) {
  const list = rows.filter(Boolean);
  return list.map((r, i) => html`<${Reading} key=${r.key ?? i} ...${r} />`);
}

/**
 * The verdict column with the readings beside it.
 * @param {{ label?: any, word: any, tone?: string, line?: any, stamp?: any, doors?: any, children?: any }} props
 */
export function Verdict({ label, word, tone, line, stamp, doors, children }) {
  // label (added by page group G5, admin): the row label over the word (main's Boards and Memory
  // pages: a coral label over their headline, .adm-brd-lbl, .adm-mem-lbl).
  return html`
    <div class="verdict">
      <div class="verdict-side">
        ${has(label) ? html`<${Label} block>${label}<//>` : null}
        <div class=${cx('verdict-word', VERDICT_TONES.has(tone) && `verdict-word--${tone}`)}>${word}</div>
        ${has(line) ? html`<p class="verdict-line">${line}</p>` : null}
        ${has(stamp) ? html`<div class="verdict-stamp">${stamp}</div>` : null}
        ${has(doors) ? html`<div class="verdict-doors">${doors}</div>` : null}
      </div>
      <div class="verdict-main">${children}</div>
    </div>`;
}

export default Readings;
