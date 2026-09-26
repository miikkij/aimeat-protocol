/**
 * @file public/components/Note.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The sentences a page says about itself, as one component (C8 of the component plan):
 *   the lead that opens a section, the grey hint that explains, the quiet line that says a list is
 *   empty, the loading line, the message after a save, and the attention note (the aside) that asks
 *   the person to look or act. A page passes the words and a kind; it never writes a class. The look
 *   is css/components/hint.css, quiet-note.css, loading-mark.css, form-message.css, page-section.css
 *   (the lead) and the aside shape in css/poster.css.
 *
 *   kind = 'lead' | 'hint' | 'quiet' | 'loading' | 'message' | 'aside'.
 *   - hint: `slab` for the small line beside a loud action.
 *   - quiet: `inline` for one inside a line of words.
 *   - loading: without words it says "Loading…".
 *   - message: `error` for a refusal, otherwise a success.
 *   - aside: `size` = 'small' | 'large'; `tone` = 'irreversible' (an act that cannot be undone) |
 *     'waiting' (the next move is in another window) | 'suggestion' (a line the person can wave away).
 *   - meta: the small grey words of the classic Settings pages (a count, a status, a key's detail;
 *     .text-meta-sm, .75rem in the dim colour, 75 uses on main); `inline` in a line, else a block;
 *     `mono` in the typewriter face (a record's facts under its head: created, changed, version, size).
 * @structure Note({ kind, slab, inline, error, size, tone, title, mono, children })
 * @usage html`<${Note} kind="quiet">${t('x.none')}<//>` · html`<${Note} kind="loading" />`
 * @version-history
 *   v1.5.0 — 2026-09-26 — The message's `pre`: a refusal that names several problems keeps one per
 *     line (the Decide rules and providers, main's .pf-dr-pre; additive, G8).
 *   v1.4.0 — 2026-09-26 — The quiet line takes `role` too (a failure said to a screen reader as an
 *     alert: the Apps page's shared list and roadmap, as main said them; additive, G6).
 *   v1.3.0 — 2026-09-26 — The hint takes `role` too (a hint that is a note to a screen reader, as the
 *     crew's "no key for decisions" line said on main; additive, G1a).
 *   v1.2.0 — 2026-09-26 — The meta kind's `mono` (Memory's record facts, formerly .mp-meta; additive, G3).
 *   v1.1.0 — 2026-09-26 — The meta kind (.text-meta-sm), so a classic page's small grey words need no
 *     class (component plan C9, page parts; additive).
 *   v1.0.0 — 2026-09-26 — Initial (component plan C8).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const ASIDE_TONES = new Set(['irreversible', 'waiting', 'suggestion']);

export function Note({ kind = 'hint', slab, inline, error, size, tone, title, role, mono, pre, children }) {
    switch (kind) {
        case 'lead': return html`<p class="og-lead">${children}</p>`;
        case 'quiet': return inline
            ? html`<span class="poster-quiet" title=${title} role=${role}>${children}</span>`
            : html`<p class="poster-quiet" title=${title} role=${role}>${children}</p>`;
        case 'loading': return inline
            ? html`<span class="poster-quiet loading-mark" role="status">${children || t('profile.loading')}</span>`
            : html`<p class="poster-quiet loading-mark" role="status">${children || t('profile.loading')}</p>`;
        case 'message': return html`<span class=${cx('form-message', error && 'form-message--error', pre && 'form-message--pre')} role=${role || (error ? 'alert' : 'status')}>${children}</span>`;
        case 'meta': return inline
            ? html`<span class=${cx('text-meta-sm', mono && 'text-meta-sm--mono')} title=${title}>${children}</span>`
            : html`<div class=${cx('text-meta-sm', mono && 'text-meta-sm--mono')} title=${title}>${children}</div>`;
        case 'aside': return html`<div class=${cx('poster-aside', (size === 'small' || size === 'large') && `poster-aside--${size}`, ASIDE_TONES.has(tone) && `poster-aside--${tone}`)} role=${role}>${children}</div>`;
        default: return inline
            ? html`<span class=${cx('poster-hint', slab && 'poster-hint--slab')} title=${title} role=${role}>${children}</span>`
            : html`<p class=${cx('poster-hint', slab && 'poster-hint--slab')} title=${title} role=${role}>${children}</p>`;
    }
}

export default Note;
