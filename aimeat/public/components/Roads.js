/**
 * @file public/components/Roads.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The ways to do one thing, side by side (C3 of the component plan): ask your AI, do it
 *   here, paste a result. A page passes the words and named options; it never writes a class. Each
 *   Road is the framed tile of the Card (components/Card.js: the Object box, a small coral line, the
 *   name in bold, a grey sentence, the code or the doors at its foot); css/components/roads.css
 *   holds the columns and the chosen road's words. One column on a phone.
 *
 *   Roads cols = 'two' (two equal columns, the default) | 'three'; `wide` gives the first column more
 *   room (the lead road with its request to copy).
 *   Road:
 *   - `lead`: the way to take first, in the raised box (Jouni's decision "Box").
 *   - `chosen`: the road is one of a few to choose; true draws it chosen, on the sun (Jouni's decision
 *     "Choice"), false draws it choosable. `onPick` chooses it when the tile is pressed outside its
 *     doors; a press on a door does only what the door does.
 *   - the parts, as Card's: `kicker` (the small coral line over the name: the road's key), `name`,
 *     `sub` (the same small line under the name: what the road takes), `text`, `code` (a request to
 *     copy, as a code block), children (a form, a field), `meta` (the grey typewriter line: the tools
 *     an agent calls), `codeLine` (a line of code at the foot), `doors`.
 * @structure Roads({ cols, wide, children }) · Road({ lead, chosen, onPick, kicker, name, sub, text,
 *   code, meta, codeLine, doors, children })
 * @usage html`<${Roads} wide>
 *          <${Road} lead name=${x('roadAsk')} text=${x('roadAskBody')} code=${ask} doors=${…} />
 *          <${Road} name=${x('roadAgent')} text=${x('roadAgentBody')} meta=${tools} />
 *        <//>`
 *        html`<${Roads} cols="three">${roads.map(r => html`<${Road} key=${r.k} chosen=${road === r.k}
 *          onPick=${() => setRoad(r.k)} kicker=${r.key} name=${r.title} text=${r.body} doors=${…} />`)}<//>`
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial: the eleven copies of "the ways to do one thing" (ac-, cal-, ct-, dw-,
 *     kp-, nt-, pk-, pf-, sk-, wal-, wp-roads) as one component with named column layouts (component
 *     plan C3).
 */
import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import htm from 'htm';
import { boxClass } from '/components/Box.js';
import { tileParts } from '/components/Card.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');

/** A press that starts on a control inside the tile belongs to that control. */
const INSIDE_CONTROL = 'button, a, input, textarea, select, label, [role="button"]';

export function Roads({ cols = 'two', wide, children }) {
    return html`<div class=${cx('roads', cols === 'three' && 'roads--three', wide && 'roads--wide')}>${children}</div>`;
}

export function Road(props) {
    const { lead, chosen, onPick } = props;
    const choosable = chosen !== undefined && chosen !== null;
    const pick = useCallback((e) => {
        if (!onPick) return;
        const hit = e.target.closest?.(INSIDE_CONTROL);
        if (hit && hit !== e.currentTarget && e.currentTarget.contains(hit)) return;
        onPick(e);
    }, [onPick]);
    const cls = cx(boxClass(lead ? 'raised' : undefined), choosable && 'poster-choice', choosable && chosen && 'on',
        'card-tile', 'card-tile--framed', 'road', choosable && !onPick && 'road--still');
    return html`<div class=${cls} aria-current=${choosable && chosen ? 'true' : undefined}
        onClick=${onPick ? pick : undefined}>${tileParts(props)}</div>`;
}

export default Roads;
