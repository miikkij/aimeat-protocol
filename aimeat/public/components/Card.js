/**
 * @file Card.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One thing as a tile, and the grid the tiles stand in (C3 of the component plan): a
 *   mark, a name, a line about it, a meta line, and a door. A page passes the data and named options;
 *   it never writes a class. The look is css/components/card.css; a framed tile is the Object box
 *   (components/Box.js, poster.css .poster-box).
 *
 *   Card tone:
 *   - none: the ruled tile, its name in bold over its words and a grey typewriter meta line, a thin
 *     rule under it (the Item grid of Data wallet, Wallet and Email; the apps of a workspace).
 *   - 'framed': the tile in the Object box, its name in bold, a grey sentence, the meta line and the
 *     doors at its foot (Notifications' devices, the overview's extensions; the Road's look).
 *     `state` = 'current' (the one you are on: a coral frame) | 'off' (switched off: dashed, grey) |
 *     'raised' (the one that stands out).
 *   - 'section': an older Settings group drawn as a section: the thick rule on top, no frame, no
 *     ground (the classic .card and an agent's .pf-agd-card; Jouni's decision "Classic cards").
 *     `title` names it, `aside` stands at the right of the title, `wide` spans every column of a
 *     CardGrid of sections, `inRow` stands it inside a list row (.4rem air, no margin: the Access
 *     page's two-step and passkey rows, main's .ac-panel .card).
 *   - 'panel': one part of the overview (Continue, Agents, Usage & quotas, Commerce, AI spend): its
 *     headline over its content, no frame. `title` is the headline, `note` a grey typewriter line
 *     after it, `onOpen` makes the headline the door to its tab, `rule` puts the thick rule on top,
 *     `wide` spans both columns of a CardGrid of panels.
 *   - 'figure': a number that is a door to its tab, a small grey word beside it (the overview's
 *     usage figures); `figure` is the number, `name` the word; with no `onOpen` it opens nothing and
 *     is not pressable.
 *
 *   The parts of a tile (ruled and framed): `mark` (an Avatar or a sign before the name), `kicker`
 *   (a small coral typewriter line over the name), `name`, `sub` (the same small line under the
 *   name), `text` (the sentence; `clamp` cuts it after two lines), `code` (a code block to copy),
 *   children (a field, a form), `meta` (the grey typewriter line), `codeLine` (a line of code at the
 *   foot), `doors` (the row of ways at the foot), `lines` (after the meta line: named counts, each
 *   on its own line under a hairline, the count in the grey typewriter face at the right; `dim` for
 *   a "3 more" line; Discover's places and their workspaces).
 *   `onOpen` makes the whole tile the door: it opens on a press, on Enter and on Space, and says
 *   `openLabel` as its tooltip.
 *
 *   `onOpen` on a tile that has `doors` is not allowed: a door inside a door. Give the tile one or
 *   the other.
 *
 *   CardGrid cols = 'three' (the default) | 'two' | 'fill' (as many 180px tiles as fit) | 'one' |
 *   'sections' (section cards side by side, 340px or wider) | 'panels' (the overview's two columns
 *   of panels) | 'figures' (figure doors in a line).
 *
 *   Without `tone` and without `name` a Card is still the classic card of the classic shell
 *   (title, subtitle, onClick, hoverable, variant "glass"), unchanged for the callers that draw it
 *   (the design lab, the component catalogue).
 * @structure Card(props) · CardGrid({ cols, children }) · tileParts(props) (for Road)
 * @usage html`<${CardGrid}>${items.map(i => html`<${Card} key=${i.k} name=${i.name} meta=${i.sub} />`)}<//>`
 *        html`<${Card} tone="framed" name=${d.name} text=${d.body} meta=${d.when} doors=${…} />`
 *        html`<${Card} tone="section" title=${t('x.title')}>…<//>`
 *        html`<${CardGrid} cols="figures"><${Card} tone="figure" figure=${n} name=${t('x.apps')} onOpen=${go} /><//>`
 * @version-history
 *   v2.3.0 — 2026-09-27 — CardGrid cols 'strip': the tiles in one line that scrolls sideways (the app
 *     catalogue's active extensions, appcat); additive, card.css .card-grid--strip.
 *   v2.2.0 — 2026-09-26 — The tile's `lines` (named counts under the meta line: Discover's places and
 *     their workspaces, main's .dv-place / .dv-ws); additive, page group G8.
 *   v2.1.0 — 2026-09-26 — The section's `inRow` option (G3, additive): a section inside a list row.
 *   v2.0.0 — 2026-09-26 — The tile and its grid (component plan C3): the ruled, framed, section, panel
 *     and figure tones, CardGrid, and the tile's parts shared with Road. The classic card is kept for a
 *     call with neither tone nor name, so its callers are unchanged.
 *   v1.1.0 — 2026-06-02 — Component unification (#22): add `variant` prop;
 *     `variant="glass"` appends `.card-glass` so profile's GlassCard folds into Card.
 *   v1.0.0 — prior — Initial canonical card (title/subtitle/hoverable/className).
 */
import { h } from 'preact';
import htm from 'htm';
import { boxClass } from '/components/Box.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
// 'strip' (added for appcat): the tiles in one line that scrolls sideways (the app catalogue's
// active extensions).
const GRID_COLS = new Set(['three', 'two', 'fill', 'one', 'sections', 'panels', 'figures', 'strip']);
const FRAMED_STATES = new Set(['current', 'off', 'raised']);

/** Enter and Space open a tile that is a door, as a button does. */
const keyOpen = (onOpen) => (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(e); }
};

/**
 * The inside of a tile, in its reading order. Road draws the same parts, so it takes them from here;
 * a page calls Card or Road, never this.
 * @param {{ mark?: any, kicker?: any, name?: any, sub?: any, text?: any, clamp?: boolean, code?: string,
 *   meta?: any, lines?: Array<{ label?: any, count?: any, dim?: boolean, key?: any }>, codeLine?: any,
 *   doors?: any, children?: any }} props
 */
export function tileParts({ mark, kicker, name, sub, text, clamp, code, meta, lines, codeLine, doors, children }) {
    const nameEl = name !== undefined && name !== null && name !== '' ? html`<b class="card-tile-name">${name}</b>` : null;
    return html`
        ${kicker ? html`<span class="card-tile-kicker">${kicker}</span>` : null}
        ${mark ? html`<div class="card-tile-head"><span class="card-tile-mark">${mark}</span>${nameEl}</div>` : nameEl}
        ${sub ? html`<span class="card-tile-kicker">${sub}</span>` : null}
        ${text ? html`<p class=${cx('card-tile-text', clamp && 'card-tile-text--clamp')}>${text}</p>` : null}
        ${code ? html`<pre class="code-block">${code}</pre>` : null}
        ${children}
        ${meta ? html`<small class="card-tile-meta">${meta}</small>` : null}
        ${lines && lines.length ? html`<div class="card-tile-lines">${lines.map((l, i) => html`<span class=${cx('card-tile-line', l.dim && 'card-tile-line--dim')} key=${l.key ?? i}><span>${l.label}</span>${l.count !== undefined && l.count !== null ? html`<i>${l.count}</i>` : null}</span>`)}</div>` : null}
        ${codeLine ? html`<code class="code-inline card-tile-foot">${codeLine}</code>` : null}
        ${doors ? html`<div class="og-doors card-tile-doors">${doors}</div>` : null}`;
}

/**
 * The classic card of the classic shell, as it always drew (title, subtitle, hover lift, glass).
 * @param {{ title?: any, subtitle?: any, onClick?: (e: Event) => void, hoverable?: boolean,
 *   className?: string, variant?: string, children?: any }} props
 */
function ClassicCard({ title, subtitle, onClick, hoverable = true, className = '', variant, children }) {
    const variantClass = variant === 'glass' ? 'card-glass' : '';
    return html`
    <div class="card ${variantClass} ${hoverable ? 'card-hoverable' : ''} ${className}" onClick=${onClick}>
      ${(title || subtitle) && html`
        <div class="card-header">
          ${title && html`<span class="card-title">${title}</span>`}
          ${subtitle && html`<span class="card-subtitle">${subtitle}</span>`}
        </div>`}
      ${children}
    </div>`;
}

/** An older Settings group drawn as a section: the thick rule on top. `inRow`: it stands inside a
 *  list row (the Access page's two-step and passkey rows), with row air and no margin.
 * @param {{ title?: any, aside?: any, wide?: boolean, inRow?: boolean, id?: string, children?: any }} props */
function SectionCard({ title, aside, wide, inRow, id, children }) {
    return html`<div class=${cx('card', 'poster-row--thing', 'card-section', wide && 'card-section--wide', inRow && 'card-section--in-row')} id=${id}>
        ${title || aside ? html`<div class="card-header">${title ? html`<h4 class="sub-heading">${title}</h4>` : null}${aside}</div>` : null}
        ${children}
    </div>`;
}

/**
 * One part of the overview: its headline (a door when `onOpen`), a grey note after it, the content.
 * @param {{ title?: any, note?: any, onOpen?: (e: Event) => void, openLabel?: string, rule?: boolean,
 *   wide?: boolean, id?: string, children?: any }} props
 */
function PanelCard({ title, note, onOpen, openLabel, rule, wide, id, children }) {
    const words = html`${title}${note ? html`<span class="card-panel-note"> · ${note}</span>` : null}`;
    return html`<div class=${cx('card-panel', rule && 'poster-row--thing', wide && 'card-panel--wide')} id=${id}>
        ${onOpen
            ? html`<button type="button" class="poster-section-title card-panel-title card-panel-title--door" title=${openLabel} onClick=${onOpen}>${words}</button>`
            : html`<div class="poster-section-title card-panel-title">${words}</div>`}
        ${children}
    </div>`;
}

/**
 * A figure that opens its tab.
 * @param {{ figure?: any, name?: any, onOpen?: (e: Event) => void, openLabel?: string }} props
 */
function FigureCard({ figure, name, onOpen, openLabel }) {
    return html`<button type="button" class="card-figure" disabled=${!onOpen} title=${openLabel} onClick=${onOpen}>
        <span class="card-figure-value poster-stat-number poster-stat-number--small">${figure}</span>
        <span class="card-figure-word">${name}</span>
    </button>`;
}

/**
 * Card — one thing as a tile. See the file header for the tones and the parts.
 * @param {{ tone?: 'framed'|'section'|'panel'|'figure', state?: 'current'|'off'|'raised', name?: any,
 *   mark?: any, kicker?: any, sub?: any, text?: any, clamp?: boolean, code?: string, meta?: any,
 *   lines?: Array<{ label?: any, count?: any, dim?: boolean, key?: any }>,
 *   codeLine?: any, doors?: any, onOpen?: (e: Event) => void, openLabel?: string, figure?: any,
 *   title?: any, aside?: any, note?: any, rule?: boolean, wide?: boolean, inRow?: boolean, id?: string,
 *   subtitle?: any, onClick?: (e: Event) => void, hoverable?: boolean, className?: string,
 *   variant?: string, children?: any }} props
 */
export function Card(props) {
    const { tone, name, onOpen, openLabel, state, id } = props;
    if (!tone && (name === undefined || name === null)) return ClassicCard(props);
    if (tone === 'section') return SectionCard(props);
    if (tone === 'panel') return PanelCard(props);
    if (tone === 'figure') return FigureCard(props);
    const framed = tone === 'framed';
    const cls = cx(framed && boxClass(state === 'raised' ? 'raised' : FRAMED_STATES.has(state) ? state : undefined),
        'card-tile', framed ? 'card-tile--framed' : 'card-tile--ruled', onOpen && 'card-tile--door');
    const door = onOpen ? { role: 'button', tabIndex: 0, title: openLabel, onClick: onOpen, onKeyDown: keyOpen(onOpen) } : {};
    return html`<div class=${cls} id=${id} ...${door}>${tileParts(props)}</div>`;
}

/** The grid the tiles stand in; one column on a phone. */
export function CardGrid({ cols = 'three', children }) {
    return html`<div class=${cx('card-grid', `card-grid--${GRID_COLS.has(cols) ? cols : 'three'}`)}>${children}</div>`;
}

export default Card;
